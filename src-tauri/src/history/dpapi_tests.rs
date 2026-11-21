//! Native Windows tests: owned synthetic directories and current-user DPAPI.
use super::super::dpapi_blob::HEADER;
use super::super::encrypted::Store;
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

const DOCUMENT: &str = r#"{"version":2,"records":[{"text":"DPAPI-FINAL-CANARY","rawText":"DPAPI-RAW-CANARY","metadata":"DPAPI-META-CANARY"}]}"#;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "voxloom-dpapi-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dir).unwrap();
        Self(dir)
    }
    fn keys(&self) -> SystemKeys {
        SystemKeys::new(&self.0).unwrap()
    }
    fn assert_no_plaintext(&self) {
        for entry in fs::read_dir(&self.0).unwrap() {
            let bytes = fs::read(entry.unwrap().path()).unwrap();
            for canary in [
                b"DPAPI-FINAL-CANARY".as_slice(),
                b"DPAPI-RAW-CANARY",
                b"DPAPI-META-CANARY",
            ] {
                assert!(!bytes.windows(canary.len()).any(|w| w == canary));
            }
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn current_user_dpapi_round_trip_validates_output_and_rejects_tampering() {
    let key = [17; 32];
    let bytes = protect(&key).unwrap();
    assert_eq!(unprotect(&bytes).unwrap(), key);
    assert!(!bytes.windows(key.len()).any(|w| w == key));
    for at in [
        0,
        HEADER.len() - 1,
        HEADER.len(),
        bytes.len() / 2,
        bytes.len() - 1,
    ] {
        let mut bad = bytes.clone();
        bad[at] ^= 0x80;
        assert!(unprotect(&bad).is_err(), "tamper at {at}");
    }
    assert!(unprotect(&bytes[..bytes.len() - 1]).is_err());
    assert!(protect(&[0; 31]).is_err());
    // A successfully unprotected but structurally invalid payload must fail.
    let malformed = crypt(b"not a history key", true).unwrap();
    let wrapped = dpapi_blob::encode(&malformed).unwrap();
    assert!(unprotect(&wrapped).is_err());
    // Bypass only the unkeyed outer corruption checksum to exercise real
    // DPAPI/inner-payload tamper refusal as well as outer framing refusal.
    let mut protected = dpapi_blob::decode(&bytes).unwrap().to_vec();
    protected[0] ^= 1;
    assert!(unprotect(&dpapi_blob::encode(&protected).unwrap()).is_err());
}

#[test]
fn saved_key_is_reused_add_only_and_survives_independent_process_restart() {
    let f = Fixture::new();
    Store::new(&f.0, &f.keys()).save(DOCUMENT).unwrap();
    let original_blob = fs::read(f.0.join(KEY_FILE)).unwrap();
    let original_key = Zeroizing::new(f.keys().read().unwrap().unwrap());
    f.keys().add(&[42; 32]).unwrap();
    assert_eq!(fs::read(f.0.join(KEY_FILE)).unwrap(), original_blob);
    assert_eq!(
        f.keys().read().unwrap().as_deref(),
        Some(original_key.as_slice())
    );
    assert_eq!(
        Store::new(&f.0, &f.keys()).load().unwrap().as_deref(),
        Some(DOCUMENT)
    );
    let name = format!(
        "{}::dpapi_process_helper",
        module_path!().split_once("::").unwrap().1
    );
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", &name])
        .env("VOXLOOM_DPAPI_CHILD_DIR", &f.0)
        .spawn()
        .unwrap();
    let start = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        if start.elapsed() > std::time::Duration::from_secs(30) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("DPAPI helper timeout");
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(fs::read(f.0.join(KEY_FILE)).unwrap(), original_blob);
    f.assert_no_plaintext();
}
#[test]
fn dpapi_process_helper() {
    let Some(dir) = std::env::var_os("VOXLOOM_DPAPI_CHILD_DIR") else {
        return;
    };
    let dir = PathBuf::from(dir);
    assert!(dir.starts_with(std::env::temp_dir()));
    let keys = SystemKeys::new(&dir).unwrap();
    assert_eq!(
        Store::new(&dir, &keys).load().unwrap().as_deref(),
        Some(DOCUMENT)
    );
}

#[test]
fn missing_corrupt_future_or_inaccessible_dpapi_key_never_rekeys_ciphertext() {
    use std::os::windows::fs::OpenOptionsExt;
    for name in [
        "history.json",
        "history.json.unreadable-1.bak",
        "history.json.tmp",
        "history.json.encrypted-stale.tmp",
        "HISTORY.JSON",
        "HiStOrY.JsOn",
        "HISTORY.JSON.TMP",
        "HiStOrY.JsOn.TmP",
        "HISTORY.JSON.UNREADABLE-1-2.BAK",
        "HiStOrY.JsOn.UnReAdAbLe-1-2.BaK",
        "HISTORY.JSON.ENCRYPTED-STALE.TMP",
        "HiStOrY.JsOn.EnCrYpTeD-StAlE.TmP",
    ] {
        for mode in ["missing", "corrupt", "future", "inaccessible", "hardlink"] {
            let f = Fixture::new();
            Store::new(&f.0, &f.keys()).save(DOCUMENT).unwrap();
            let primary = f.0.join("history.json");
            if name != "history.json" {
                fs::rename(&primary, f.0.join(name)).unwrap();
            }
            let original = fs::read(f.0.join(name)).unwrap();
            let key_path = f.0.join(KEY_FILE);
            let mut blocked = None;
            match mode {
                "missing" => fs::remove_file(&key_path).unwrap(),
                "corrupt" => fs::write(&key_path, b"invalid DPAPI blob").unwrap(),
                "future" => {
                    let mut bytes = fs::read(&key_path).unwrap();
                    bytes[HEADER.len() - 1] = 99;
                    fs::write(&key_path, bytes).unwrap();
                }
                "inaccessible" => {
                    blocked = Some(
                        fs::OpenOptions::new()
                            .read(true)
                            .share_mode(0)
                            .open(&key_path)
                            .unwrap(),
                    )
                }
                "hardlink" => fs::hard_link(&key_path, f.0.join("other-key-name")).unwrap(),
                _ => unreachable!(),
            }
            let before = if blocked.is_none() {
                fs::read(&key_path).ok()
            } else {
                None
            };
            assert!(Store::new(&f.0, &f.keys()).load().is_err(), "{name}/{mode}");
            assert!(
                Store::new(&f.0, &f.keys()).save(DOCUMENT).is_err(),
                "{name}/{mode}"
            );
            assert_eq!(fs::read(f.0.join(name)).unwrap(), original);
            drop(blocked);
            if mode != "inaccessible" {
                assert_eq!(fs::read(&key_path).ok(), before);
            }
        }
    }
}

#[test]
fn unavailable_native_key_preserves_plaintext_migration_sources() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    f.keys().add(&[17; 32]).unwrap();
    let sources = [
        "history.json",
        "history.json.tmp",
        "history.json.unreadable-1.bak",
    ];
    for name in sources {
        fs::write(f.0.join(name), DOCUMENT).unwrap();
    }
    let blocked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(f.0.join(KEY_FILE))
        .unwrap();
    assert!(Store::new(&f.0, &f.keys()).load().is_err());
    assert!(Store::new(&f.0, &f.keys()).save(DOCUMENT).is_err());
    assert!(Store::new(&f.0, &f.keys()).backup(false).is_err());
    for name in sources {
        assert_eq!(fs::read_to_string(f.0.join(name)).unwrap(), DOCUMENT);
    }
    drop(blocked);
}

#[test]
fn dpapi_backed_plaintext_archive_and_tmp_migration_is_lossless_without_canaries() {
    for [primary, tmp, archive_name] in [
        [
            "history.json",
            "history.json.tmp",
            "history.json.unreadable-1.bak",
        ],
        [
            "HISTORY.JSON",
            "HISTORY.JSON.TMP",
            "HISTORY.JSON.UNREADABLE-1-2.BAK",
        ],
        [
            "HiStOrY.JsOn",
            "HiStOrY.JsOn.TmP",
            "HiStOrY.JsOn.UnReAdAbLe-1-2.BaK",
        ],
    ] {
        let f = Fixture::new();
        let archive = f.0.join(archive_name);
        fs::write(&archive, b"DPAPI-RAW-CANARY\xff\0").unwrap();
        fs::write(f.0.join(tmp), DOCUMENT).unwrap();
        fs::write(f.0.join(primary), DOCUMENT).unwrap();
        assert_eq!(
            Store::new(&f.0, &f.keys()).load().unwrap().as_deref(),
            Some(DOCUMENT)
        );
        Store::new(&f.0, &f.keys()).save(DOCUMENT).unwrap();
        assert!(!f.0.join(tmp).exists());
        assert!(fs::read_dir(&f.0)
            .unwrap()
            .any(|e| e.unwrap().file_name() == primary));
        let key = Zeroizing::new(f.keys().read().unwrap().unwrap());
        // Verify exact corrupt archive bytes through the shared preservation codec.
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(&archive).unwrap()).unwrap();
        assert_eq!(value["role"], "preservation");
        assert_eq!(
            super::super::encrypted::open(&key, &fs::read(&archive).unwrap()).unwrap(),
            b"DPAPI-RAW-CANARY\xff\0"
        );
        f.assert_no_plaintext();
    }
}
