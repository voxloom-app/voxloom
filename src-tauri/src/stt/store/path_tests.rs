//! Model-store publication under paths real Windows profiles produce:
//! non-ASCII, spaced, and longer than the classic 260-character limit. Temp
//! dirs and a loopback server only; no model is downloaded from the network.
use super::tests::{serve_bytes, spec_for, test_agent};
use super::*;
use std::sync::atomic::{AtomicU32, Ordering};
use std::{env, fs};

const MODEL_ID: &str = "whisper-tiny.en";

/// Directory names for each path shape; the model root is built beneath them.
fn shapes() -> Vec<(&'static str, Vec<String>)> {
    vec![
        ("ascii", vec!["models".into()]),
        (
            "non-ascii",
            vec!["Привет café 日本語 🎙".into(), "models".into()],
        ),
        (
            "spaced",
            vec!["Voxloom Test (x86) & Co".into(), "app  data".into()],
        ),
        // Four 90-character names push the model path past 260 characters
        // while each component stays under the 255-character name limit.
        (
            "long",
            (1..=4)
                .map(|n| format!("segment-{n}-{}", "x".repeat(80)))
                .collect(),
        ),
    ]
}

/// A store whose root is `shape` under a fresh temp dir. Returns that temp
/// dir too, so the caller removes everything it created.
fn store_for(shape: &[String]) -> (ModelStore, PathBuf, PathBuf) {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let base = env::temp_dir().join(format!(
        "voxloom-bus242a-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut root = base.clone();
    root.extend(shape);
    (ModelStore::new(root.clone()), root, base)
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// A published model is the file plus the store's `.verified` marker.
fn published(spec: &ModelSpec) -> [String; 2] {
    [
        spec.filename.to_owned(),
        format!("{}.verified", spec.filename),
    ]
}

#[test]
fn long_shape_really_exceeds_the_classic_path_limit() {
    let (_, shape) = shapes().pop().unwrap();
    let (store, _, _) = store_for(&shape);
    let spec = catalog::find(MODEL_ID).unwrap();
    assert!(store.model_path(spec).as_os_str().len() > 300);
}

#[test]
fn verified_download_is_published_whole_under_every_path_shape() {
    for (name, shape) in shapes() {
        let body = vec![0x5Au8; 8 * 1024];
        let (store, root, base) = store_for(&shape);
        let spec = &spec_for(MODEL_ID, &body);
        let dest = store.model_path(spec);
        let url = serve_bytes(body.clone(), None);
        let result = store.download_spec_with_sink(&test_agent(), spec, &url, |p| {
            // Only `<file>.partial` may exist until verification passes; the
            // 1.0 event is sent after publication.
            assert!(p.ratio >= 1.0 || !dest.exists(), "{name}: early final file");
        });
        assert!(result.is_ok(), "{name}: {result:?}");
        assert_eq!(fs::read(&dest).unwrap(), body, "{name}");
        assert_eq!(entries(&root), published(spec), "{name}: stray files");
        assert_eq!(
            store.status(MODEL_ID).unwrap().status,
            "available",
            "{name}"
        );
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn publishing_replaces_an_older_file_in_one_step() {
    for (name, shape) in shapes() {
        let body = vec![0x11u8; 4 * 1024];
        let (store, root, base) = store_for(&shape);
        let spec = &spec_for(MODEL_ID, &body);
        fs::create_dir_all(&root).unwrap();
        fs::write(store.model_path(spec), b"older bytes").unwrap();
        let url = serve_bytes(body.clone(), None);
        store
            .download_spec_with_sink(&test_agent(), spec, &url, |_| {})
            .unwrap();
        assert_eq!(fs::read(store.model_path(spec)).unwrap(), body, "{name}");
        assert_eq!(entries(&root), published(spec), "{name}");
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn failed_verification_publishes_nothing_and_keeps_the_older_file() {
    for (name, shape) in shapes() {
        let served = vec![0x22u8; 4 * 1024];
        // Same size, different bytes: the whole body is written to the
        // partial file before the hash check rejects it.
        let (store, root, base) = store_for(&shape);
        let spec = &spec_for(MODEL_ID, &vec![0x33u8; served.len()]);
        let url = serve_bytes(served, None);
        let err = store
            .download_spec_with_sink(&test_agent(), spec, &url, |_| {})
            .unwrap_err();
        assert_eq!(err.code, "download-corrupted", "{name}");
        assert!(entries(&root).is_empty(), "{name}: {:?}", entries(&root));
        assert_eq!(store.status(MODEL_ID).unwrap().status, "missing", "{name}");

        // A previously published file survives a later failed attempt.
        fs::write(store.model_path(spec), b"published earlier").unwrap();
        let url = serve_bytes(vec![0x22u8; 4 * 1024], None);
        store
            .download_spec_with_sink(&test_agent(), spec, &url, |_| {})
            .unwrap_err();
        assert_eq!(
            fs::read(store.model_path(spec)).unwrap(),
            b"published earlier",
            "{name}"
        );
        assert_eq!(entries(&root), [spec.filename], "{name}");
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn failed_finalize_leaves_no_partial_file() {
    for (name, shape) in shapes() {
        let body = vec![0x44u8; 4 * 1024];
        let (store, root, base) = store_for(&shape);
        let spec = &spec_for(MODEL_ID, &body);
        // A directory squatting on the model path makes the final rename
        // fail on every OS, after the verified bytes were fully written.
        fs::create_dir_all(store.model_path(spec)).unwrap();
        let url = serve_bytes(body, None);
        let err = store
            .download_spec_with_sink(&test_agent(), spec, &url, |_| {})
            .unwrap_err();
        assert_eq!(err.code, "download-failed", "{name}");
        assert_eq!(
            entries(&root),
            [spec.filename],
            "{name}: partial left behind"
        );
        assert!(store.model_path(spec).is_dir(), "{name}");
        assert!(store.inflight.lock().unwrap().is_none(), "{name}");
        fs::remove_dir_all(&base).unwrap();
    }
}
