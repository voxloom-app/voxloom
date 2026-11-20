use super::*;
use std::{
    cell::RefCell,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

const DOCUMENT: &str = r#"{"version":2,"records":[{"text":"FINAL-CANARY-BUS207","rawText":"RAW-CANARY-BUS207","metadata":"META-CANARY-BUS207"}]}"#;
fn scratch() -> PathBuf {
    std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .or_else(|| cfg!(target_os = "windows").then(std::env::temp_dir))
        .expect("tests require an explicit synthetic scratch TMPDIR on macOS")
}
#[derive(Default)]
struct FakeKeys(RefCell<Option<Vec<u8>>>);
impl KeyOps for FakeKeys {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(self.0.borrow().clone())
    }
    fn add(&self, key: &[u8]) -> Result<(), String> {
        if self.0.borrow().is_none() {
            *self.0.borrow_mut() = Some(key.to_vec());
        }
        Ok(())
    }
}
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = scratch().join(format!(
            "history-encryption-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
    fn assert_no_canaries(&self) {
        for e in fs::read_dir(&self.0).unwrap() {
            let path = e.unwrap().path();
            if path.file_name().unwrap() == "history.lock" {
                // Windows byte-range locks prohibit reading via another
                // handle, even in the owning process. This file is empty.
                assert_eq!(fs::metadata(&path).unwrap().len(), 0);
                continue;
            }
            let data = fs::read(path).unwrap();
            for canary in [
                "FINAL-CANARY-BUS207",
                "RAW-CANARY-BUS207",
                "META-CANARY-BUS207",
            ] {
                assert!(
                    !data.windows(canary.len()).any(|w| w == canary.as_bytes()),
                    "plaintext canary on disk"
                );
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
fn missing_key_never_reprovisions_for_encrypted_artifacts() {
    for name in [
        "history.json",
        "history.json.unreadable-1.bak",
        "history.json.tmp",
        "history.json.encrypted-stale.tmp",
    ] {
        let f = Fixture::new();
        let keys = FakeKeys::default();
        let store = Store::new(&f.0, &keys);
        store.save(DOCUMENT).unwrap();
        let bytes = fs::read(f.0.join("history.json")).unwrap();
        fs::rename(f.0.join("history.json"), f.0.join(name)).unwrap();
        *keys.0.borrow_mut() = None;
        assert!(store.load().is_err(), "missing key must block load");
        assert!(store.save(DOCUMENT).is_err(), "missing key must block save");
        assert!(keys.0.borrow().is_none(), "must not add a replacement key");
        assert_eq!(fs::read(f.0.join(name)).unwrap(), bytes);
    }
}

#[test]
fn case_variant_ciphertext_inventory_never_reprovisions() {
    for name in [
        "HISTORY.JSON",
        "HiStOrY.JsOn",
        "HISTORY.JSON.TMP",
        "HiStOrY.JsOn.TmP",
        "HISTORY.JSON.UNREADABLE-1-2.BAK",
        "HiStOrY.JsOn.UnReAdAbLe-1-2.BaK",
        "HISTORY.JSON.ENCRYPTED-STALE.TMP",
        "HiStOrY.JsOn.EnCrYpTeD-StAlE.TmP",
    ] {
        let f = Fixture::new();
        let keys = FakeKeys::default();
        let store = Store::new(&f.0, &keys);
        store.save(DOCUMENT).unwrap();
        fs::rename(f.0.join(PRIMARY), f.0.join(name)).unwrap();
        assert!(fs::read_dir(&f.0)
            .unwrap()
            .any(|e| e.unwrap().file_name() == name));
        let before = fs::read(f.0.join(name)).unwrap();
        *keys.0.borrow_mut() = None;
        for result in [store.load().map(|_| ()), store.save(DOCUMENT)] {
            assert!(result.unwrap_err().contains("key missing"), "{name}");
            assert!(keys.0.borrow().is_none(), "replacement key for {name}");
            assert_eq!(fs::read(f.0.join(name)).unwrap(), before, "{name}");
        }
        f.assert_no_canaries();
    }
}

#[test]
fn case_variant_legacy_files_migrate_losslessly_without_plaintext() {
    for [primary, tmp, archive] in [
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
        let keys = FakeKeys::default();
        let store = Store::new(&f.0, &keys);
        let raw = b"RAW-CANARY-BUS207\xff\0";
        fs::write(f.0.join(primary), DOCUMENT).unwrap();
        fs::write(f.0.join(tmp), DOCUMENT).unwrap();
        fs::write(f.0.join(archive), raw).unwrap();
        assert_eq!(store.load().unwrap().as_deref(), Some(DOCUMENT));
        assert!(!f.0.join(tmp).exists(), "legacy tmp was not quarantined");
        let migrated = fs::read(f.0.join(archive)).unwrap();
        assert_eq!(
            open(keys.0.borrow().as_ref().unwrap(), &migrated).unwrap(),
            raw
        );
        let first_backup = store.backup().unwrap().unwrap();
        let renamed = f.0.join("HiStOrY.JsOn.UnReAdAbLe-9-2.BaK");
        fs::rename(first_backup, &renamed).unwrap();
        assert_eq!(store.backup().unwrap().unwrap(), renamed);
        store.save(DOCUMENT).unwrap();
        assert_eq!(fs::read(f.0.join(archive)).unwrap(), migrated);
        assert!(fs::read_dir(&f.0)
            .unwrap()
            .any(|e| e.unwrap().file_name() == primary));
        assert_eq!(store.load().unwrap().as_deref(), Some(DOCUMENT));
        f.assert_no_canaries();
    }
}

#[test]
fn case_variant_staging_requires_ciphertext_before_any_migration() {
    for name in [
        "HISTORY.JSON.ENCRYPTED-STALE.TMP",
        "HiStOrY.JsOn.EnCrYpTeD-StAlE.TmP",
    ] {
        for has_key in [false, true] {
            let f = Fixture::new();
            let keys = FakeKeys(RefCell::new(has_key.then(|| vec![7; 32])));
            let store = Store::new(&f.0, &keys);
            fs::write(f.0.join(name), DOCUMENT).unwrap();
            assert!(store.load().is_err(), "{name}/{has_key}");
            assert!(store.save(DOCUMENT).is_err(), "{name}/{has_key}");
            assert_eq!(keys.0.borrow().is_some(), has_key);
            assert_eq!(fs::read(f.0.join(name)).unwrap(), DOCUMENT.as_bytes());
            assert!(!f.0.join(PRIMARY).exists());
        }
        let f = Fixture::new();
        let keys = FakeKeys(RefCell::new(Some(vec![7; 32])));
        let store = Store::new(&f.0, &keys);
        let ciphertext = seal(&[7; 32], DOCUMENT.as_bytes()).unwrap();
        fs::write(f.0.join(name), &ciphertext).unwrap();
        assert_eq!(store.load().unwrap(), None, "staging must not be restored");
        store.save(DOCUMENT).unwrap();
        assert_eq!(fs::read(f.0.join(name)).unwrap(), ciphertext);
        f.assert_no_canaries();
    }
}

#[test]
fn case_variant_unknown_or_unsafe_artifacts_fail_closed() {
    for name in [
        "HISTORY.JSON",
        "HiStOrY.JsOn",
        "HISTORY.JSON.TMP",
        "HiStOrY.JsOn.TmP",
        "HISTORY.JSON.UNREADABLE-1-2.BAK",
        "HiStOrY.JsOn.UnReAdAbLe-1-2.BaK",
        "HISTORY.JSON.ENCRYPTED-STALE.TMP",
        "HiStOrY.JsOn.EnCrYpTeD-StAlE.TmP",
    ] {
        for has_key in [false, true] {
            let f = Fixture::new();
            let keys = FakeKeys(RefCell::new(has_key.then(|| vec![7; 32])));
            let store = Store::new(&f.0, &keys);
            let raw = br#"{"format":"voxloom-history-encrypted","envelopeVersion":99}"#;
            fs::write(f.0.join(name), raw).unwrap();
            assert!(store.load().is_err(), "{name}/{has_key}");
            assert!(store.save(DOCUMENT).is_err(), "{name}/{has_key}");
            assert_eq!(keys.0.borrow().is_some(), has_key);
            assert_eq!(fs::read(f.0.join(name)).unwrap(), raw);
        }
        for directory in [false, true] {
            let f = Fixture::new();
            let keys = FakeKeys::default();
            let victim = f.0.join("unrelated.txt");
            fs::write(&victim, DOCUMENT).unwrap();
            if directory {
                fs::create_dir(f.0.join(name)).unwrap();
            } else {
                fs::hard_link(&victim, f.0.join(name)).unwrap();
            }
            let store = Store::new(&f.0, &keys);
            assert!(store.load().is_err(), "unsafe {name}");
            assert!(store.save(DOCUMENT).is_err(), "unsafe {name}");
            assert!(keys.0.borrow().is_none());
            assert_eq!(fs::read(&victim).unwrap(), DOCUMENT.as_bytes());
        }
    }
}

#[test]
fn unreadable_primary_blocks_native_replacement() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let store = Store::new(&f.0, &keys);
    store.save(DOCUMENT).unwrap();
    let original = fs::read(f.0.join("history.json")).unwrap();
    let mut cases = vec![
        b"not JSON".to_vec(),
        br#"{"version":99,"records":[]}"#.to_vec(),
    ];
    for (field, value) in [
        ("envelopeVersion", serde_json::json!(0)),
        ("envelopeVersion", serde_json::json!(99)),
        ("algorithm", serde_json::json!("other")),
        ("ciphertext", serde_json::json!("AAAA")),
        ("nonce", serde_json::json!("!")),
        ("format", serde_json::json!("other")),
    ] {
        let mut v: serde_json::Value = serde_json::from_slice(&original).unwrap();
        v[field] = value;
        cases.push(serde_json::to_vec(&v).unwrap());
    }
    cases.push(
        seal(
            &keys.0.borrow().as_ref().unwrap(),
            br#"{"version":99,"records":[]}"#,
        )
        .unwrap(),
    );
    for bytes in cases {
        fs::write(f.0.join("history.json"), &bytes).unwrap();
        assert!(store.load().is_err());
        assert!(
            store.save(DOCUMENT).is_err(),
            "native save must recheck current primary"
        );
        assert_eq!(fs::read(f.0.join("history.json")).unwrap(), bytes);
    }
}

#[test]
fn plaintext_upgrade_preserves_original_bytes_before_normalization() {
    for original in [
        include_bytes!("../../../tests/fixtures/history-v1.json").as_slice(),
        include_bytes!("../../../tests/fixtures/history-v2.json").as_slice(),
    ] {
        let f = Fixture::new();
        let keys = FakeKeys::default();
        let store = Store::new(&f.0, &keys);
        fs::write(f.0.join("history.json"), original).unwrap();
        assert_eq!(store.load().unwrap().unwrap().as_bytes(), original);
        store.save(DOCUMENT).unwrap();
        let backups: Vec<_> = fs::read_dir(&f.0)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "bak"))
            .collect();
        assert_eq!(
            backups.len(),
            1,
            "upgrade needs original-byte encrypted backup"
        );
        assert_eq!(
            open(
                keys.0.borrow().as_ref().unwrap(),
                &fs::read(&backups[0]).unwrap()
            )
            .unwrap(),
            original
        );
        let first = fs::read(&backups[0]).unwrap();
        store.save(DOCUMENT).unwrap();
        assert_eq!(fs::read(&backups[0]).unwrap(), first);
        f.assert_no_canaries();
    }
}

#[test]
fn archives_and_legacy_tmp_migrate_losslessly_without_resurrection() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let store = Store::new(&f.0, &keys);
    let archive = f.0.join("history.json.unreadable-1.bak");
    let mut raw = b"RAW-CANARY-BUS207".to_vec();
    raw.extend_from_slice(&[0xff, 0xfe, 0]);
    fs::write(&archive, &raw).unwrap();
    fs::write(f.0.join("history.json.tmp"), DOCUMENT).unwrap();
    assert_eq!(store.load().unwrap(), None);
    f.assert_no_canaries();
    assert!(!f.0.join("history.json.tmp").exists());
    assert!(
        !f.0.join("history.json").exists(),
        "stale tmp must never be restored"
    );
    assert_eq!(
        open(
            keys.0.borrow().as_ref().unwrap(),
            &fs::read(&archive).unwrap()
        )
        .unwrap(),
        raw
    );
    let before = fs::read(&archive).unwrap();
    let restarted = Store::new(&f.0, &keys);
    assert_eq!(restarted.load().unwrap(), None);
    assert_eq!(fs::read(&archive).unwrap(), before);
    let originals: Vec<_> = fs::read_dir(&f.0)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "bak"))
        .map(|p| open(keys.0.borrow().as_ref().unwrap(), &fs::read(p).unwrap()).unwrap())
        .collect();
    assert!(originals.iter().any(|b| b == DOCUMENT.as_bytes()));
    // Off/delete is an empty active document, not key deletion/archive pruning.
    restarted.save(r#"{"version":2,"records":[]}"#).unwrap();
    assert_eq!(fs::read(&archive).unwrap(), before);
    assert!(keys.0.borrow().is_some());
}

#[test]
fn transactions_hold_the_os_lock_through_key_and_file_work() {
    use std::sync::{atomic::AtomicUsize, mpsc, Condvar, Mutex};
    struct BlockingKeys {
        entered: AtomicUsize,
        released: Mutex<bool>,
        wake: Condvar,
        ready: mpsc::Sender<()>,
    }
    impl KeyOps for BlockingKeys {
        fn read(&self) -> Result<Option<Vec<u8>>, String> {
            if self.entered.fetch_add(1, Ordering::SeqCst) == 0 {
                self.ready.send(()).unwrap();
                let mut released = self.released.lock().unwrap();
                while !*released {
                    released = self.wake.wait(released).unwrap();
                }
            }
            Ok(Some(vec![7; 32]))
        }
        fn add(&self, _: &[u8]) -> Result<(), String> {
            panic!("must not provision")
        }
    }
    let f = Fixture::new();
    let (tx, rx) = mpsc::channel();
    let keys = BlockingKeys {
        entered: AtomicUsize::new(0),
        released: Mutex::new(false),
        wake: Condvar::new(),
        ready: tx,
    };
    let observed = std::thread::scope(|s| {
        let one = s.spawn(|| Store::new(&f.0, &keys).save(DOCUMENT));
        rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        let two = s.spawn(|| Store::new(&f.0, &keys).save(DOCUMENT));
        std::thread::sleep(std::time::Duration::from_millis(100));
        let observed = keys.entered.load(Ordering::SeqCst);
        *keys.released.lock().unwrap() = true;
        keys.wake.notify_all();
        one.join().unwrap().unwrap();
        two.join().unwrap().unwrap();
        observed
    });
    assert_eq!(
        observed, 1,
        "second transaction reached keys before first released its OS lock"
    );
    f.assert_no_canaries();
}

#[test]
fn legacy_document_extensions_are_not_mistaken_for_envelopes() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let store = Store::new(&f.0, &keys);
    let original = br#"{"version":1,"records":[{"nonce":"legacy metadata","text":"voxloom-history-encrypted"}],"extra":"preserve me"}"#;
    fs::write(f.0.join(PRIMARY), original).unwrap();
    assert_eq!(store.load().unwrap().unwrap().as_bytes(), original);
    store.save(DOCUMENT).unwrap();
}

#[test]
fn precommit_io_failures_preserve_primary_and_only_stage_ciphertext() {
    for stage in ["write", "sync", "verify", "publish"] {
        let f = Fixture::new();
        let keys = FakeKeys::default();
        let mut store = Store::new(&f.0, &keys);
        store.save(DOCUMENT).unwrap();
        let before = fs::read(f.0.join(PRIMARY)).unwrap();
        let fail = |at: &str| {
            f.assert_no_canaries();
            if at == stage {
                Err("injected IO failure".into())
            } else {
                Ok(())
            }
        };
        store.io_fault = Some(&fail);
        assert!(
            store.save(r#"{"version":2,"records":[]}"#).is_err(),
            "missing injected {stage} fault"
        );
        assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), before);
        f.assert_no_canaries();
        assert!(!fs::read_dir(&f.0).unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|s| s == "tmp")));
    }
}

#[test]
fn legacy_empty_file_keeps_existing_empty_history_semantics() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let store = Store::new(&f.0, &keys);
    fs::write(f.0.join(PRIMARY), b" \n").unwrap();
    assert_eq!(store.load().unwrap().as_deref(), Some(" \n"));
    store.save(r#"{"version":2,"records":[]}"#).unwrap();
    assert!(store.load().unwrap().unwrap().contains("records"));
}

#[test]
fn backup_preserves_corrupt_non_utf8_bytes_encrypted_and_deduplicated() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let store = Store::new(&f.0, &keys);
    let raw = b"RAW-CANARY-BUS207\xff\xfe\0corrupt";
    fs::write(f.0.join(PRIMARY), raw).unwrap();
    let first = store.backup().unwrap().unwrap();
    let second = store.backup().unwrap().unwrap();
    assert_eq!(first, second);
    assert_eq!(
        open(keys.0.borrow().as_ref().unwrap(), &fs::read(first).unwrap()).unwrap(),
        raw
    );
    assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), raw);
    assert!(store.load().is_err());
    assert!(store.save(DOCUMENT).is_err());
}

#[test]
fn unknown_ciphertext_backup_is_opaque_and_never_authorizes_save() {
    struct NoAccess;
    impl KeyOps for NoAccess {
        fn read(&self) -> Result<Option<Vec<u8>>, String> {
            Err("synthetic key unavailable".into())
        }
        fn add(&self, _: &[u8]) -> Result<(), String> {
            panic!("no provisioning")
        }
    }
    let f = Fixture::new();
    let store = Store::new(&f.0, &NoAccess);
    let raw =
        br#"{"format":"voxloom-history-encrypted","envelopeVersion":99,"ciphertext":"opaque"}"#;
    fs::write(f.0.join(PRIMARY), raw).unwrap();
    let path = store.backup().unwrap().unwrap();
    assert_eq!(fs::read(&path).unwrap(), raw);
    assert_eq!(store.backup().unwrap().unwrap(), path);
    assert!(store.load().is_err());
    assert!(store.save(DOCUMENT).is_err());
    assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), raw);
}

#[test]
fn denied_invalid_and_unpersisted_keys_never_fall_back_to_plaintext() {
    struct BadKeys {
        value: Option<Vec<u8>>,
        denied: bool,
    }
    impl KeyOps for BadKeys {
        fn read(&self) -> Result<Option<Vec<u8>>, String> {
            if self.denied {
                Err("synthetic access denied".into())
            } else {
                Ok(self.value.clone())
            }
        }
        fn add(&self, _: &[u8]) -> Result<(), String> {
            assert!(!self.denied);
            Ok(())
        }
    }
    for keys in [
        BadKeys {
            value: None,
            denied: true,
        },
        BadKeys {
            value: Some(vec![3; 31]),
            denied: false,
        },
        BadKeys {
            value: Some(vec![3; 33]),
            denied: false,
        },
        BadKeys {
            value: None,
            denied: false,
        },
    ] {
        let f = Fixture::new();
        let store = Store::new(&f.0, &keys);
        assert!(store.save(DOCUMENT).is_err());
        assert!(!f.0.join(PRIMARY).exists());
        fs::write(f.0.join(PRIMARY), DOCUMENT).unwrap();
        assert!(store.load().is_err());
        assert!(store.backup().is_err());
        assert_eq!(fs::read_to_string(f.0.join(PRIMARY)).unwrap(), DOCUMENT);
        assert_eq!(fs::read_dir(&f.0).unwrap().count(), 2); // source plus lock
    }
}

#[test]
fn duplicate_provision_reads_the_persisted_winner_before_first_ciphertext() {
    struct RacingKeys {
        reads: std::cell::Cell<u32>,
        winner: RefCell<Option<Vec<u8>>>,
    }
    impl KeyOps for RacingKeys {
        fn read(&self) -> Result<Option<Vec<u8>>, String> {
            self.reads.set(self.reads.get() + 1);
            Ok(self.winner.borrow().clone())
        }
        fn add(&self, proposed: &[u8]) -> Result<(), String> {
            assert_eq!(proposed.len(), 32);
            *self.winner.borrow_mut() = Some(vec![9; 32]); // another creator wins add-only race
            Ok(())
        }
    }
    let f = Fixture::new();
    let keys = RacingKeys {
        reads: std::cell::Cell::new(0),
        winner: RefCell::new(None),
    };
    Store::new(&f.0, &keys).save(DOCUMENT).unwrap();
    assert_eq!(keys.reads.get(), 2);
    assert_eq!(
        open(&[9; 32], &fs::read(f.0.join(PRIMARY)).unwrap()).unwrap(),
        DOCUMENT.as_bytes()
    );
    f.assert_no_canaries();
}

#[test]
fn wrong_key_tag_nonce_and_role_changes_fail_authentication_without_mutation() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let store = Store::new(&f.0, &keys);
    store.save(DOCUMENT).unwrap();
    let raw = fs::read(f.0.join(PRIMARY)).unwrap();
    let original_key = keys.0.borrow().clone();
    *keys.0.borrow_mut() = Some(vec![42; 32]);
    assert!(store.load().unwrap_err().contains("authentication"));
    assert!(store.save(DOCUMENT).is_err());
    assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), raw);
    *keys.0.borrow_mut() = original_key;
    for field in ["ciphertext", "nonce", "role"] {
        let mut v: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        if field == "role" {
            v[field] = serde_json::json!(PRESERVATION);
        } else {
            let mut bytes = STANDARD.decode(v[field].as_str().unwrap()).unwrap();
            let last = bytes.len() - 1;
            bytes[last] ^= 1;
            v[field] = serde_json::json!(STANDARD.encode(bytes));
        }
        let changed = serde_json::to_vec(&v).unwrap();
        fs::write(f.0.join(PRIMARY), &changed).unwrap();
        assert!(store.load().is_err());
        assert!(store.save(DOCUMENT).is_err());
        assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), changed);
    }
}

#[test]
fn each_seal_uses_a_fresh_os_random_nonce_including_archives() {
    let mut nonces = std::collections::HashSet::new();
    for _ in 0..64 {
        for role in [HISTORY, PRESERVATION] {
            let raw = seal_as(&[7; 32], DOCUMENT.as_bytes(), role, random).unwrap();
            let e = envelope(&raw).unwrap();
            assert!(nonces.insert(e.nonce));
            assert_eq!(open(&[7; 32], &raw).unwrap(), DOCUMENT.as_bytes());
        }
    }
}

#[test]
fn entropy_failure_blocks_key_creation_and_existing_key_writes() {
    fn fail(_: &mut [u8]) -> Result<(), String> {
        Err("synthetic RNG failure".into())
    }
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let mut store = Store::new(&f.0, &keys);
    store.entropy = fail;
    assert!(store.save(DOCUMENT).is_err());
    assert!(keys.0.borrow().is_none());
    assert!(!f.0.join(PRIMARY).exists());
    store.entropy = random;
    store.save(DOCUMENT).unwrap();
    let before = fs::read(f.0.join(PRIMARY)).unwrap();
    store.entropy = fail;
    assert!(store.save(DOCUMENT).is_err());
    assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), before);
    f.assert_no_canaries();
}

#[test]
fn unknown_archives_and_staging_block_load_and_save_without_mutation() {
    for name in [
        "history.json.unreadable-1.bak",
        "history.json.tmp",
        "history.json.encrypted-stale.tmp",
    ] {
        for version in [0, 99] {
            let f = Fixture::new();
            let keys = FakeKeys::default();
            let store = Store::new(&f.0, &keys);
            store.save(DOCUMENT).unwrap();
            let before = fs::read(f.0.join(PRIMARY)).unwrap();
            let raw = format!("{{\"format\":\"{FORMAT}\",\"envelopeVersion\":{version}}}");
            fs::write(f.0.join(name), &raw).unwrap();
            assert!(store.load().is_err());
            assert!(store.save(DOCUMENT).is_err());
            assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), before);
            assert_eq!(fs::read_to_string(f.0.join(name)).unwrap(), raw);
        }
    }
}

#[test]
fn planted_nonregular_history_artifacts_are_never_followed_or_overwritten() {
    #[cfg(unix)]
    for name in [
        PRIMARY,
        "history.json.tmp",
        "history.json.unreadable-1.bak",
        "history.json.encrypted-stale.tmp",
        "history.lock",
    ] {
        let f = Fixture::new();
        let keys = FakeKeys::default();
        let store = Store::new(&f.0, &keys);
        let victim = f.0.join("unrelated.txt");
        fs::write(&victim, b"unrelated synthetic bytes").unwrap();
        std::os::unix::fs::symlink(&victim, f.0.join(name)).unwrap();
        assert!(store.load().is_err());
        assert!(store.save(DOCUMENT).is_err());
        assert_eq!(fs::read(&victim).unwrap(), b"unrelated synthetic bytes");
    }
    let f = Fixture::new();
    let keys = FakeKeys::default();
    fs::create_dir(f.0.join(PRIMARY)).unwrap();
    assert!(Store::new(&f.0, &keys).save(DOCUMENT).is_err());
    fs::remove_dir(f.0.join(PRIMARY)).unwrap();
    let victim = f.0.join("unrelated.txt");
    fs::write(&victim, DOCUMENT).unwrap();
    fs::hard_link(&victim, f.0.join(PRIMARY)).unwrap();
    assert!(Store::new(&f.0, &keys).load().is_err());
    assert_eq!(fs::read_to_string(victim).unwrap(), DOCUMENT);
}

#[cfg(target_os = "windows")]
#[test]
fn planted_windows_junction_artifacts_are_rejected_without_touching_target() {
    for name in [
        PRIMARY,
        "history.json.tmp",
        "history.json.unreadable-1.bak",
        "history.json.encrypted-stale.tmp",
        "history.lock",
    ] {
        let f = Fixture::new();
        let victim = f.0.join("unrelated-directory");
        fs::create_dir(&victim).unwrap();
        fs::write(victim.join("canary"), b"unrelated bytes").unwrap();
        // Directory junctions do not require Developer Mode/symlink privilege.
        // Fail the test if the synthetic reparse fixture cannot be created.
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(f.0.join(name))
            .arg(&victim)
            .output()
            .unwrap();
        assert!(status.status.success(), "junction fixture: {:?}", status);
        let keys = FakeKeys::default();
        assert!(Store::new(&f.0, &keys).load().is_err());
        assert!(Store::new(&f.0, &keys).save(DOCUMENT).is_err());
        assert_eq!(fs::read(victim.join("canary")).unwrap(), b"unrelated bytes");
        fs::remove_dir(f.0.join(name)).unwrap();
    }
}

#[test]
fn native_create_only_publication_preserves_collision_and_replacement_is_readable() {
    let f = Fixture::new();
    let from = f.0.join("new");
    let to = f.0.join("existing");
    fs::write(&from, b"new bytes").unwrap();
    fs::write(&to, b"winner").unwrap();
    assert!(native_fs::create_new(&to).is_err());
    assert_eq!(
        native_fs::publish(&from, &to, false).unwrap_err().kind(),
        ErrorKind::AlreadyExists
    );
    assert_eq!(fs::read(&to).unwrap(), b"winner");
    assert_eq!(fs::read(&from).unwrap(), b"new bytes");
    native_fs::publish(&from, &to, true).unwrap();
    native_fs::sync_publication(&f.0, &to).unwrap();
    native_fs::open_regular(&to, false).unwrap();
    assert_eq!(fs::read(&to).unwrap(), b"new bytes");
    assert!(!from.exists());
}

#[test]
fn partial_archival_migration_resumes_without_reencrypting_completed_files() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let mut store = Store::new(&f.0, &keys);
    let one = f.0.join("history.json.unreadable-1.bak");
    let two = f.0.join("history.json.unreadable-2.bak");
    fs::write(&one, b"first exact bytes\xff").unwrap();
    fs::write(&two, b"second exact bytes\xfe").unwrap();
    let published = std::cell::Cell::new(0);
    let fault = |at: &str| {
        if at == "publish" {
            published.set(published.get() + 1);
            if published.get() == 2 {
                return Err("synthetic interruption".into());
            }
        }
        Ok(())
    };
    store.io_fault = Some(&fault);
    assert!(store.load().is_err());
    let completed = fs::read(&one).unwrap();
    assert!(encrypted_marker(&completed));
    assert_eq!(fs::read(&two).unwrap(), b"second exact bytes\xfe");
    store.io_fault = None;
    assert_eq!(store.load().unwrap(), None);
    assert_eq!(fs::read(&one).unwrap(), completed);
    assert_eq!(
        open(keys.0.borrow().as_ref().unwrap(), &fs::read(two).unwrap()).unwrap(),
        b"second exact bytes\xfe"
    );
}

#[test]
fn quarantined_tmp_survives_interruption_and_is_deduplicated_on_restart() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let mut store = Store::new(&f.0, &keys);
    fs::write(f.0.join("history.json.tmp"), DOCUMENT).unwrap();
    let fault = |at: &str| {
        if at == "remove-legacy" {
            Err("synthetic interruption".into())
        } else {
            Ok(())
        }
    };
    store.io_fault = Some(&fault);
    assert!(store.load().is_err());
    assert_eq!(
        fs::read_to_string(f.0.join("history.json.tmp")).unwrap(),
        DOCUMENT
    );
    let count = || {
        fs::read_dir(&f.0)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|e| e == "bak")
            })
            .count()
    };
    assert_eq!(count(), 1);
    store.io_fault = None;
    assert_eq!(store.load().unwrap(), None);
    assert_eq!(count(), 1);
    assert!(!f.0.join(PRIMARY).exists());
    f.assert_no_canaries();
}

// The first transaction publishes an archive but fails its directory fence.
// A fresh transaction must fence that same duplicate before changing its source.
fn assert_deduplicated_archive_retry_fence(
    source_name: &str,
    original: &[u8],
    retry_failure: Option<&str>,
) {
    let f = Fixture::new();
    let keys = FakeKeys(RefCell::new(Some(vec![7; 32])));
    let source = f.0.join(source_name);
    fs::write(&source, original).unwrap();
    let first_fault = |at: &str| {
        if at == "directory-sync" {
            Err("synthetic archive directory sync failure".into())
        } else {
            Ok(())
        }
    };
    let mut first = Store::new(&f.0, &keys);
    first.io_fault = Some(&first_fault);
    assert!(first.load().unwrap_err().contains("durability"));
    assert_eq!(fs::read(&source).unwrap(), original);
    let archives: Vec<_> = fs::read_dir(&f.0)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| artifact_kind(p) == Some(ArtifactKind::Backup))
        .collect();
    assert_eq!(archives.len(), 1);
    let archive = f.0.join("HiStOrY.JsOn.UnReAdAbLe-9-2.BaK");
    fs::rename(&archives[0], &archive).unwrap();
    let before = fs::read(&archive).unwrap();
    if encrypted_marker(original) {
        assert_eq!(before, original);
    } else {
        assert_eq!(open(&[7; 32], &before).unwrap(), original);
    }

    let stages = RefCell::new(Vec::new());
    let retry_hook = |at: &str| {
        stages.borrow_mut().push(at.to_string());
        if matches!(at, "remove-legacy" | "publish") {
            assert_eq!(
                &stages.borrow()[..2.min(stages.borrow().len())],
                ["sync", "directory-sync"],
                "source change authorized before duplicate file/directory durability"
            );
            assert_eq!(fs::read(&source).unwrap(), original);
        }
        if Some(at) == retry_failure {
            Err("synthetic retry fence failure".into())
        } else {
            Ok(())
        }
    };
    let mut restarted = Store::new(&f.0, &keys);
    restarted.io_fault = Some(&retry_hook);
    let replacement = r#"{"version":2,"records":[]}"#;
    let result = if source_name.eq_ignore_ascii_case(PRIMARY) {
        restarted.save(replacement)
    } else {
        restarted.load().map(|v| assert_eq!(v, None))
    };
    if let Some(stage) = retry_failure {
        let error = result.unwrap_err();
        assert!(error.contains(if stage == "sync" {
            "retry fence"
        } else {
            "durability"
        }));
        let expected = if stage == "sync" {
            vec!["sync"]
        } else {
            vec!["sync", "directory-sync"]
        };
        assert_eq!(*stages.borrow(), expected);
        assert_eq!(fs::read(&source).unwrap(), original);
    } else {
        result.unwrap();
        assert_eq!(&stages.borrow()[..2], ["sync", "directory-sync"]);
        if source_name.eq_ignore_ascii_case(PRIMARY) {
            assert_eq!(
                document(&[7; 32], &fs::read(&source).unwrap()).unwrap(),
                replacement.as_bytes()
            );
        } else {
            assert!(!source.exists());
            assert!(!f.0.join(PRIMARY).exists());
        }
    }
    assert_eq!(
        fs::read(&archive).unwrap(),
        before,
        "reuse must not rewrite the archive"
    );
    assert_eq!(
        fs::read_dir(&f.0)
            .unwrap()
            .filter(|e| artifact_kind(&e.as_ref().unwrap().path()) == Some(ArtifactKind::Backup))
            .count(),
        1
    );
}

#[test]
fn deduplicated_archive_retry_fences_before_legacy_tmp_removal() {
    assert_deduplicated_archive_retry_fence("history.json.tmp", DOCUMENT.as_bytes(), None);
}

#[test]
fn deduplicated_archive_retry_fences_before_plain_primary_replacement() {
    assert_deduplicated_archive_retry_fence(PRIMARY, DOCUMENT.as_bytes(), None);
}

#[test]
fn deduplicated_archive_retry_fences_identical_ciphertext() {
    let encrypted = seal(&[7; 32], DOCUMENT.as_bytes()).unwrap();
    assert_deduplicated_archive_retry_fence("history.json.tmp", &encrypted, None);
}

#[test]
fn deduplicated_archive_retry_fence_failures_leave_sources_intact() {
    let encrypted = seal(&[7; 32], DOCUMENT.as_bytes()).unwrap();
    for (source, original) in [
        ("history.json.tmp", DOCUMENT.as_bytes()),
        (PRIMARY, DOCUMENT.as_bytes()),
        ("history.json.tmp", encrypted.as_slice()),
    ] {
        for stage in ["sync", "directory-sync"] {
            assert_deduplicated_archive_retry_fence(source, original, Some(stage));
        }
    }
}

#[test]
fn case_variant_duplicate_archives_retain_retry_fences() {
    let encrypted = seal(&[7; 32], DOCUMENT.as_bytes()).unwrap();
    for (source, bytes) in [
        ("HISTORY.JSON", DOCUMENT.as_bytes()),
        ("HiStOrY.JsOn", DOCUMENT.as_bytes()),
        ("HISTORY.JSON.TMP", DOCUMENT.as_bytes()),
        ("HiStOrY.JsOn.TmP", DOCUMENT.as_bytes()),
        ("HiStOrY.JsOn.TmP", encrypted.as_slice()),
    ] {
        for failure in [None, Some("sync"), Some("directory-sync")] {
            assert_deduplicated_archive_retry_fence(source, bytes, failure);
        }
    }
}

#[test]
fn source_is_revalidated_before_publish_and_postcommit_errors_are_explicit() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let mut store = Store::new(&f.0, &keys);
    store.save(DOCUMENT).unwrap();
    let future = br#"{"version":99,"records":[]}"#;
    let change = |at: &str| {
        if at == "publish" {
            fs::write(f.0.join(PRIMARY), future).unwrap();
        }
        Ok(())
    };
    store.io_fault = Some(&change);
    assert!(store.save(DOCUMENT).is_err());
    assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), future);
    fs::remove_file(f.0.join(PRIMARY)).unwrap();
    store.io_fault = None;
    store.save(DOCUMENT).unwrap();
    let fault = |at: &str| {
        if at == "directory-sync" {
            Err("synthetic fsync failure".into())
        } else {
            Ok(())
        }
    };
    store.io_fault = Some(&fault);
    let empty = r#"{"version":2,"records":[]}"#;
    let error = store.save(empty).unwrap_err();
    assert!(error.contains("changed") && error.contains("durability"));
    assert_eq!(
        open(
            keys.0.borrow().as_ref().unwrap(),
            &fs::read(f.0.join(PRIMARY)).unwrap()
        )
        .unwrap(),
        empty.as_bytes()
    );
    f.assert_no_canaries();
}

#[test]
fn os_lock_serializes_an_independent_process() {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let store = Store::new(&f.0, &keys);
    let lock = store.lock().unwrap();
    let test_name = format!(
        "{}::lock_process_helper",
        module_path!().split_once("::").unwrap().1
    );
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", &test_name])
        .env("VOXLOOM_HISTORY_TEST_CHILD_DIR", &f.0)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let start = Instant::now();
    while !f.0.join("child-ready").exists() && start.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(10));
    }
    if !f.0.join("child-ready").exists() {
        let _ = child.kill();
        let _ = child.wait();
        panic!("synthetic child did not reach store");
    }
    std::thread::sleep(Duration::from_millis(100));
    let blocked = child.try_wait().unwrap().is_none() && !f.0.join("child-done").exists();
    drop(lock);
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if start.elapsed() > Duration::from_secs(10) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("synthetic child did not finish after unlock");
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(blocked, "child crossed the OS lock");
    assert!(status.success());
    assert_eq!(
        open(&[7; 32], &fs::read(f.0.join(PRIMARY)).unwrap()).unwrap(),
        DOCUMENT.as_bytes()
    );
    f.assert_no_canaries();
}

#[test]
fn lock_process_helper() {
    let Some(dir) = std::env::var_os("VOXLOOM_HISTORY_TEST_CHILD_DIR") else {
        return;
    };
    let dir = PathBuf::from(dir);
    let scratch = scratch();
    assert!(dir.starts_with(&scratch));
    let keys = FakeKeys(RefCell::new(Some(vec![7; 32])));
    fs::write(dir.join("child-ready"), b"ready").unwrap();
    Store::new(&dir, &keys).save(DOCUMENT).unwrap();
    fs::write(dir.join("child-done"), b"done").unwrap();
}

#[test]
fn generated_frontend_fixture_decrypts_to_the_existing_v2_document() {
    let encrypted = include_bytes!("../../../tests/fixtures/history-encrypted-v1.json");
    assert_eq!(
        document(&[7; 32], encrypted).unwrap(),
        include_bytes!("../../../tests/fixtures/history-v2.json")
    );
}

#[test]
fn binary_fields_are_strict_and_preservation_role_cannot_become_active() {
    let raw = seal(&[7; 32], DOCUMENT.as_bytes()).unwrap();
    for (field, value) in [
        ("nonce", "AA=="),
        ("nonce", "!invalid!"),
        ("ciphertext", "AAAA"),
        ("ciphertext", "AA A="),
        ("ciphertext", "AB=="),
    ] {
        let mut v: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        v[field] = serde_json::json!(value);
        assert!(open(&[7; 32], &serde_json::to_vec(&v).unwrap()).is_err());
    }
    let preservation = seal_as(&[7; 32], DOCUMENT.as_bytes(), PRESERVATION, random).unwrap();
    assert_eq!(open(&[7; 32], &preservation).unwrap(), DOCUMENT.as_bytes());
    assert!(document(&[7; 32], &preservation).is_err());
}

#[test]
#[cfg(unix)]
fn new_primary_archives_and_staging_have_private_modes() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let mut store = Store::new(&f.0, &keys);
    let check = |_: &str| {
        for entry in fs::read_dir(&f.0).unwrap() {
            assert_eq!(
                entry.unwrap().metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        Ok(())
    };
    store.io_fault = Some(&check);
    store.save(DOCUMENT).unwrap();
    store.backup().unwrap();
    f.assert_no_canaries();
}

#[test]
fn identical_plaintext_archive_does_not_authorize_removing_legacy_tmp() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let mut store = Store::new(&f.0, &keys);
    fs::write(f.0.join("history.json.tmp"), DOCUMENT).unwrap();
    fs::write(f.0.join("history.json.unreadable-1.bak"), DOCUMENT).unwrap();
    let fault = |at: &str| {
        if at == "write" {
            Err("synthetic disk failure".into())
        } else {
            Ok(())
        }
    };
    store.io_fault = Some(&fault);
    assert!(store.load().is_err());
    assert_eq!(
        fs::read_to_string(f.0.join("history.json.tmp")).unwrap(),
        DOCUMENT,
        "a plaintext duplicate is not an encrypted quarantine"
    );
    store.io_fault = None;
    assert_eq!(store.load().unwrap(), None);
    f.assert_no_canaries();
}

#[test]
fn backup_reports_a_source_change_instead_of_authorizing_a_reset() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let mut store = Store::new(&f.0, &keys);
    fs::write(f.0.join(PRIMARY), DOCUMENT).unwrap();
    let changed = br#"{"version":99,"records":[]}"#;
    let mutate = |at: &str| {
        if at == "publish" {
            fs::write(f.0.join(PRIMARY), changed).unwrap();
        }
        Ok(())
    };
    store.io_fault = Some(&mutate);
    assert!(
        store.backup().is_err(),
        "source changed while backup was being published"
    );
    assert_eq!(fs::read(f.0.join(PRIMARY)).unwrap(), changed);
}

#[test]
fn create_publication_never_leaves_a_double_link_crash_window() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let mut store = Store::new(&f.0, &keys);
    let check = |at: &str| {
        if at == "new-published" {
            // The native regular-file adapter rejects multi-linked files on
            // both platforms, including this immediate publication checkpoint.
            native_fs::open_regular(&f.0.join(PRIMARY), false).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                assert_eq!(fs::metadata(f.0.join(PRIMARY)).unwrap().nlink(), 1);
            }
        }
        Ok(())
    };
    store.io_fault = Some(&check);
    store.save(DOCUMENT).unwrap();
}

#[test]
fn whole_document_round_trip_without_plaintext_artifacts() {
    let f = Fixture::new();
    let keys = FakeKeys::default();
    let store = Store::new(&f.0, &keys);
    store.save(DOCUMENT).unwrap();
    assert_eq!(store.load().unwrap().as_deref(), Some(DOCUMENT));
    f.assert_no_canaries();
    let envelope: serde_json::Value =
        serde_json::from_slice(&fs::read(f.0.join("history.json")).unwrap()).unwrap();
    assert!(envelope.get("version").is_none());
    assert!(envelope.get("records").is_none());
}
