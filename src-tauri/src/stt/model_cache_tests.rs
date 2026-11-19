use super::*;
use std::fs;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, SystemTime};

fn stamp(len: u64, modified_secs: u64) -> FileStamp {
    FileStamp {
        #[cfg(unix)]
        dev: 1,
        #[cfg(unix)]
        ino: 1,
        len,
        modified: SystemTime::UNIX_EPOCH + Duration::from_secs(modified_secs),
        #[cfg(unix)]
        ctime_secs: modified_secs as i64,
        #[cfg(unix)]
        ctime_nsecs: 0,
    }
}

fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "vx-bus255-c1-{}-{}-{name}",
        std::process::id(),
        name
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("model.bin");
    fs::write(&path, bytes).unwrap();
    path
}

fn cleanup(path: &Path) {
    if let Some(dir) = path.parent() {
        let _ = fs::remove_dir_all(dir);
    }
}

/// Mutation checks for the cache key: dropping any of model id, path,
/// or a stamp field must force a reload. A missing file must too.
#[test]
fn needs_reload_requires_id_path_and_full_stamp() {
    let path_a = Path::new("/models/a.bin");
    let path_b = Path::new("/models/b.bin");
    let base = stamp(10, 100);
    assert!(
        !needs_reload("tiny", path_a, &base, "tiny", path_a, Some(&base)),
        "identical id, path, and stamp must hit"
    );
    // Mutating only the model id must reload (same path and stamp).
    assert!(needs_reload(
        "tiny",
        path_a,
        &base,
        "base",
        path_a,
        Some(&base)
    ));
    // Mutating only the path must reload (same id and stamp).
    assert!(needs_reload(
        "tiny",
        path_a,
        &base,
        "tiny",
        path_b,
        Some(&base)
    ));
    // A deleted or unreadable file has no stamp.
    assert!(needs_reload("tiny", path_a, &base, "tiny", path_a, None));
    let mut different = base;
    different.len = 11;
    assert!(needs_reload(
        "tiny",
        path_a,
        &base,
        "tiny",
        path_a,
        Some(&different)
    ));
    different = base;
    different.modified = SystemTime::UNIX_EPOCH + Duration::from_secs(200);
    assert!(needs_reload(
        "tiny",
        path_a,
        &base,
        "tiny",
        path_a,
        Some(&different)
    ));
    #[cfg(unix)]
    {
        let mut different = base;
        different.ino = 99;
        assert!(needs_reload(
            "tiny",
            path_a,
            &base,
            "tiny",
            path_a,
            Some(&different)
        ));
        different = base;
        different.dev = 99;
        assert!(needs_reload(
            "tiny",
            path_a,
            &base,
            "tiny",
            path_a,
            Some(&different)
        ));
        different = base;
        different.ctime_secs = 201;
        assert!(needs_reload(
            "tiny",
            path_a,
            &base,
            "tiny",
            path_a,
            Some(&different)
        ));
        different = base;
        different.ctime_nsecs = 1;
        assert!(needs_reload(
            "tiny",
            path_a,
            &base,
            "tiny",
            path_a,
            Some(&different)
        ));
    }
}

#[test]
fn audio_ms_is_length_over_rate() {
    assert_eq!(audio_ms(16_000, 16_000), 1_000);
    assert_eq!(audio_ms(8_000, 16_000), 500);
    assert_eq!(audio_ms(16_000, 0), 0);
}

#[test]
fn format_timing_uses_cached_or_millis_and_omits_payload() {
    let miss = format_timing(5_000, Some(1234), 200);
    let hit = format_timing(5_000, None, 200);
    assert_eq!(miss, "[stt] timing audio_ms=5000 load_ms=1234 infer_ms=200");
    assert_eq!(
        hit,
        "[stt] timing audio_ms=5000 load_ms=cached infer_ms=200"
    );
    assert!(!miss.contains("transcript"));
    assert!(!hit.contains("thank"));
}

struct Ctx(Arc<AtomicBool>);
impl Drop for Ctx {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn run_ok(
    cache: &ModelCache<Ctx>,
    id: &str,
    path: &Path,
    dropped: &Arc<AtomicBool>,
    loads: &AtomicUsize,
) -> Timed<()> {
    cache
        .with_context(
            id,
            path,
            None,
            || {
                loads.fetch_add(1, Ordering::SeqCst);
                Ok(Ctx(dropped.clone()))
            },
            |_| Ok(()),
        )
        .unwrap()
}

#[test]
fn cache_hit_does_not_reload() {
    let path = temp_file("hit", b"weights");
    let cache = ModelCache::new();
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    let first = run_ok(&cache, "tiny", &path, &dropped, &loads);
    let second = run_ok(&cache, "tiny", &path, &dropped, &loads);
    assert_eq!(loads.load(Ordering::SeqCst), 1);
    assert_eq!(first.value, ());
    assert_eq!(second.value, ());
    assert!(first.load_ms.is_some());
    assert!(second.load_ms.is_none());
    let _ = (first.infer_ms, second.infer_ms);
    assert!(!dropped.load(Ordering::SeqCst));
    assert_eq!(cache.resident_id().as_deref(), Some("tiny"));
    cleanup(&path);
}

#[test]
fn reload_on_model_id_change_drops_previous_before_load() {
    let path = temp_file("id-change", b"weights");
    let cache = ModelCache::new();
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    let saw_drop_before_load = Arc::new(AtomicBool::new(false));
    let flag = dropped.clone();
    let saw = saw_drop_before_load.clone();
    cache
        .with_context(
            "base",
            &path,
            None,
            || {
                saw.store(flag.load(Ordering::SeqCst), Ordering::SeqCst);
                loads.fetch_add(1, Ordering::SeqCst);
                Ok(Ctx(flag))
            },
            |_| Ok(()),
        )
        .unwrap();
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert!(
        saw_drop_before_load.load(Ordering::SeqCst),
        "previous context must be dropped before the new load"
    );
    assert_eq!(cache.resident_id().as_deref(), Some("base"));
    cleanup(&path);
}

#[test]
fn reload_on_path_change() {
    let path_a = temp_file("path-a", b"weights-a");
    let path_b = temp_file("path-b", b"weights-b");
    let cache = ModelCache::new();
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path_a, &dropped, &loads);
    let timed = run_ok(&cache, "tiny", &path_b, &dropped, &loads);
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert!(timed.load_ms.is_some());
    cleanup(&path_a);
    cleanup(&path_b);
}

#[test]
fn reload_when_size_changes_even_if_mtime_is_restored() {
    let path = temp_file("size", b"abcd");
    let cache = ModelCache::new();
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    let mtime = fs::metadata(&path).unwrap().modified().unwrap();
    fs::write(&path, b"abcdef").unwrap();
    let file = fs::File::options().write(true).open(&path).unwrap();
    file.set_modified(mtime).unwrap();
    drop(file);
    let timed = run_ok(&cache, "tiny", &path, &dropped, &loads);
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert!(timed.load_ms.is_some());
    cleanup(&path);
}

#[test]
fn reload_when_mtime_changes_at_the_same_size() {
    let path = temp_file("mtime", b"abcd");
    let cache = ModelCache::new();
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    let later = fs::metadata(&path).unwrap().modified().unwrap() + Duration::from_secs(5);
    let file = fs::File::options().write(true).open(&path).unwrap();
    file.set_modified(later).unwrap();
    drop(file);
    let timed = run_ok(&cache, "tiny", &path, &dropped, &loads);
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert!(timed.load_ms.is_some());
    cleanup(&path);
}

#[cfg(unix)]
fn ctime(path: &Path) -> (i64, i64) {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::metadata(path).unwrap();
    (metadata.ctime(), metadata.ctime_nsec())
}

/// Block until the filesystem clock has ticked past `after`. ctime is
/// only as fine as that tick, so back-to-back writes can share one.
#[cfg(unix)]
fn wait_for_ctime_tick(dir: &Path, after: (i64, i64)) {
    use std::time::Instant;
    let probe = dir.join("ctime-probe");
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        fs::write(&probe, b"tick").unwrap();
        if ctime(&probe) > after {
            break;
        }
        assert!(Instant::now() < deadline, "filesystem ctime never advanced");
        std::thread::sleep(Duration::from_millis(1));
    }
    let _ = fs::remove_file(probe);
}

#[cfg(unix)]
#[test]
fn reload_on_in_place_rewrite_when_mtime_is_restored() {
    let path = temp_file("ctime", b"abcd");
    let dir = path.parent().unwrap().to_path_buf();
    let cache = ModelCache::new();
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    let prior_mtime = fs::metadata(&path).unwrap().modified().unwrap();
    wait_for_ctime_tick(&dir, ctime(&path));
    fs::write(&path, b"wxyz").unwrap();
    let file = fs::File::options().write(true).open(&path).unwrap();
    file.set_modified(prior_mtime).unwrap();
    drop(file);
    let timed = run_ok(&cache, "tiny", &path, &dropped, &loads);
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert!(timed.load_ms.is_some());
    cleanup(&path);
}

#[test]
fn deleted_model_evicts_and_does_not_load() {
    let path = temp_file("deleted", b"weights");
    let cache = ModelCache::new();
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    fs::remove_file(&path).unwrap();
    let err = cache
        .with_context(
            "tiny",
            &path,
            None,
            || -> Result<Ctx, SttErrorDto> {
                loads.fetch_add(1, Ordering::SeqCst);
                panic!("load must not run for a deleted model");
            },
            |_| Ok(()),
        )
        .unwrap_err();
    assert_eq!(err.code, "model-missing");
    assert_eq!(loads.load(Ordering::SeqCst), 1);
    assert!(cache.is_empty());
    assert!(dropped.load(Ordering::SeqCst));
    cleanup(&path);
}

#[test]
fn cancel_before_load_never_invokes_loader() {
    let path = temp_file("cancel-before", b"weights");
    let cache = ModelCache::<()>::new();
    let flag = AtomicBool::new(true);
    let result: Result<Timed<()>, _> = cache.with_context(
        "tiny",
        &path,
        Some(&flag),
        || panic!("cancelled load"),
        |_| Ok(()),
    );
    assert_eq!(result.unwrap_err().code, "cancelled");
    assert!(cache.is_empty());
    cleanup(&path);
}

#[test]
fn cancel_during_load_caches_context_and_skips_infer() {
    let path = temp_file("cancel-load", b"weights");
    let cache = Arc::new(ModelCache::new());
    let cancel = Arc::new(AtomicBool::new(false));
    let dropped = Arc::new(AtomicBool::new(false));
    let (entered_tx, entered) = mpsc::channel();
    let (finish, finish_rx) = mpsc::channel();
    let flag = cancel.clone();
    let context_dropped = dropped.clone();
    let runner = std::thread::spawn({
        let path = path.clone();
        let cache = cache.clone();
        move || {
            cache.with_context(
                "tiny",
                &path,
                Some(&flag),
                || {
                    entered_tx.send(()).unwrap();
                    finish_rx.recv().unwrap();
                    Ok(Ctx(context_dropped))
                },
                |_| -> Result<(), SttErrorDto> { panic!("inference after cancelled load") },
            )
        }
    });
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    cancel.store(true, Ordering::SeqCst);
    finish.send(()).unwrap();
    assert_eq!(runner.join().unwrap().unwrap_err().code, "cancelled");
    assert!(
        !dropped.load(Ordering::SeqCst),
        "a successful load must stay resident after cancel"
    );
    let timed = cache
        .with_context(
            "tiny",
            &path,
            None,
            || panic!("cancelled load must still be cached"),
            |_| Ok(()),
        )
        .unwrap();
    assert!(timed.load_ms.is_none());
    cleanup(&path);
}

#[test]
fn cancel_during_inference_suppresses_result_and_keeps_resident() {
    let path = temp_file("cancel-infer", b"weights");
    let cache = Arc::new(ModelCache::new());
    let cancel = Arc::new(AtomicBool::new(false));
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = Arc::new(AtomicUsize::new(0));
    let (entered_tx, entered) = mpsc::channel();
    let (finish, finish_rx) = mpsc::channel();
    let flag = cancel.clone();
    let context_dropped = dropped.clone();
    let loads_clone = loads.clone();
    let runner = std::thread::spawn({
        let path = path.clone();
        let cache = cache.clone();
        move || {
            cache.with_context(
                "tiny",
                &path,
                Some(&flag),
                || {
                    loads_clone.fetch_add(1, Ordering::SeqCst);
                    Ok(Ctx(context_dropped))
                },
                |_| {
                    entered_tx.send(()).unwrap();
                    finish_rx.recv().unwrap();
                    Ok("stale text")
                },
            )
        }
    });
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    cancel.store(true, Ordering::SeqCst);
    finish.send(()).unwrap();
    assert_eq!(runner.join().unwrap().unwrap_err().code, "cancelled");
    assert!(!dropped.load(Ordering::SeqCst));
    let timed = cache
        .with_context(
            "tiny",
            &path,
            None,
            || {
                loads.fetch_add(1, Ordering::SeqCst);
                panic!("second request must reuse the resident context")
            },
            |_| Ok(()),
        )
        .unwrap();
    assert_eq!(loads.load(Ordering::SeqCst), 1);
    assert!(timed.load_ms.is_none());
    cleanup(&path);
}

#[test]
fn inferences_on_one_context_are_serialized() {
    let path = temp_file("serial", b"weights");
    let cache = Arc::new(ModelCache::<()>::new());
    // Prime the cache so both threads only infer.
    cache
        .with_context("tiny", &path, None, || Ok(()), |_| Ok(()))
        .unwrap();
    let overlaps = Arc::new(AtomicBool::new(false));
    let inferring = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready) = mpsc::channel();
    let start = {
        let cache = cache.clone();
        let path = path.clone();
        let overlaps = overlaps.clone();
        let inferring = inferring.clone();
        let ready_tx = ready_tx.clone();
        move || {
            cache
                .with_context(
                    "tiny",
                    &path,
                    None,
                    || panic!("cache already primed"),
                    |_| {
                        if inferring.swap(true, Ordering::SeqCst) {
                            overlaps.store(true, Ordering::SeqCst);
                        }
                        let _ = ready_tx.send(());
                        std::thread::sleep(Duration::from_millis(80));
                        inferring.store(false, Ordering::SeqCst);
                        Ok(())
                    },
                )
                .unwrap()
        }
    };
    let a = std::thread::spawn(start.clone());
    // Wait until the first infer has entered, then start the second.
    ready.recv_timeout(Duration::from_secs(2)).unwrap();
    let b = std::thread::spawn(start);
    a.join().unwrap();
    b.join().unwrap();
    assert!(
        !overlaps.load(Ordering::SeqCst),
        "two inferences must not overlap on one context"
    );
    cleanup(&path);
}
