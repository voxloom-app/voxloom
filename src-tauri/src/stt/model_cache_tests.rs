use super::*;
use std::fs;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime};

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

struct FakeClock {
    epoch: Instant,
    offset: Mutex<Duration>,
}

impl FakeClock {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            epoch: Instant::now(),
            offset: Mutex::new(Duration::ZERO),
        })
    }

    fn advance(&self, d: Duration) {
        *self.offset.lock().unwrap() += d;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> Instant {
        self.epoch + *self.offset.lock().unwrap()
    }
}

fn cache_on(clock: &Arc<FakeClock>) -> ModelCache<Ctx> {
    ModelCache::with_clock(clock.clone())
}

fn just_under_idle() -> Duration {
    IDLE_TIMEOUT - Duration::from_nanos(1)
}

#[test]
fn idle_timeout_is_ten_minutes() {
    assert_eq!(IDLE_TIMEOUT, Duration::from_secs(10 * 60));
}

/// Mutation checks for the idle comparison: evict at the timeout,
/// not a nanosecond before, and not when the operator is inverted.
#[test]
fn idle_expired_is_true_at_and_after_the_timeout() {
    let start = Instant::now();
    assert!(!idle_expired(start, start, IDLE_TIMEOUT));
    assert!(!idle_expired(
        start,
        start + just_under_idle(),
        IDLE_TIMEOUT
    ));
    assert!(idle_expired(start, start + IDLE_TIMEOUT, IDLE_TIMEOUT));
    assert!(idle_expired(
        start,
        start + IDLE_TIMEOUT + Duration::from_secs(1),
        IDLE_TIMEOUT
    ));
}

#[test]
fn sweep_evicts_after_the_idle_timeout_but_not_before() {
    let path = temp_file("idle-boundary", b"weights");
    let clock = FakeClock::new();
    let cache = cache_on(&clock);
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    clock.advance(just_under_idle());
    cache.sweep();
    assert!(
        !cache.is_empty(),
        "must stay resident a nanosecond under the timeout"
    );
    assert!(!dropped.load(Ordering::SeqCst));
    clock.advance(Duration::from_nanos(1));
    cache.sweep();
    assert!(cache.is_empty());
    assert!(dropped.load(Ordering::SeqCst));
    cleanup(&path);
}

#[test]
fn a_request_resets_the_idle_timer() {
    let path = temp_file("idle-reset", b"weights");
    let clock = FakeClock::new();
    let cache = cache_on(&clock);
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    clock.advance(just_under_idle());
    // A request at 10m-1ns must restart the idle window.
    let mid = run_ok(&cache, "tiny", &path, &dropped, &loads);
    assert!(mid.load_ms.is_none(), "still a cache hit");
    clock.advance(just_under_idle());
    cache.sweep();
    assert!(
        !cache.is_empty(),
        "idle time is measured from the last request, not the first"
    );
    clock.advance(Duration::from_nanos(1));
    cache.sweep();
    assert!(cache.is_empty());
    cleanup(&path);
}

#[test]
fn reload_after_idle_eviction_reports_load_ms() {
    let path = temp_file("idle-reload", b"weights");
    let clock = FakeClock::new();
    let cache = cache_on(&clock);
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    clock.advance(IDLE_TIMEOUT);
    cache.sweep();
    assert!(cache.is_empty());
    let timed = run_ok(&cache, "tiny", &path, &dropped, &loads);
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert!(
        timed.load_ms.is_some(),
        "a transcribe after idle eviction must log load_ms=<n>, not cached"
    );
    cleanup(&path);
}

#[test]
fn sweep_does_not_evict_while_inference_holds_the_lock() {
    let path = temp_file("idle-locked", b"weights");
    let clock = FakeClock::new();
    let cache = Arc::new(cache_on(&clock));
    let dropped = Arc::new(AtomicBool::new(false));
    let (entered_tx, entered) = mpsc::channel();
    let (finish, finish_rx) = mpsc::channel();
    let runner = std::thread::spawn({
        let cache = cache.clone();
        let path = path.clone();
        let dropped = dropped.clone();
        move || {
            cache.with_context(
                "tiny",
                &path,
                None,
                || Ok(Ctx(dropped)),
                |_| {
                    entered_tx.send(()).unwrap();
                    finish_rx.recv().unwrap();
                    Ok(())
                },
            )
        }
    });
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    clock.advance(IDLE_TIMEOUT + Duration::from_secs(1));
    // The inference holds the lock, so a sweep has to wait for it.
    assert!(
        matches!(
            cache.inner.try_lock(),
            Err(std::sync::TryLockError::WouldBlock)
        ),
        "the inference must hold the cache lock"
    );
    let sweeping = std::thread::spawn({
        let cache = cache.clone();
        move || cache.sweep()
    });
    finish.send(()).unwrap();
    runner.join().unwrap().unwrap();
    sweeping.join().unwrap();
    assert!(
        !cache.is_empty(),
        "the request's end touch restarts the idle window"
    );
    assert!(!dropped.load(Ordering::SeqCst));
    cleanup(&path);
}

fn loaded_cache(clock: &Arc<FakeClock>, name: &str) -> (ModelCache<Ctx>, PathBuf, Arc<AtomicBool>) {
    let path = temp_file(name, b"weights");
    let cache = cache_on(clock);
    let dropped = Arc::new(AtomicBool::new(false));
    run_ok(&cache, "tiny", &path, &dropped, &AtomicUsize::new(0));
    (cache, path, dropped)
}

#[test]
fn a_touch_at_recording_start_restarts_the_idle_window() {
    let clock = FakeClock::new();
    let (cache, path, _) = loaded_cache(&clock, "touch-restarts");
    clock.advance(just_under_idle());
    cache.touch();
    clock.advance(just_under_idle());
    cache.sweep();
    assert!(!cache.is_empty(), "the touch moved the window forward");
    clock.advance(Duration::from_nanos(1));
    cache.sweep();
    assert!(cache.is_empty(), "and the window still expires");
    cleanup(&path);
}

#[test]
fn a_recording_that_never_reaches_transcribe_still_evicts_after_the_timeout() {
    // The renderer retired mid-recording, so no cancel and no transcribe
    // ever arrive. Nothing may pin the model: the touches stop and the
    // sweep evicts once the timeout has passed.
    let clock = FakeClock::new();
    let (cache, path, dropped) = loaded_cache(&clock, "retired");
    cache.touch(); // stt_prepare / capture start
    clock.advance(just_under_idle());
    cache.sweep();
    assert!(!cache.is_empty());
    clock.advance(Duration::from_nanos(1));
    cache.sweep();
    assert!(cache.is_empty());
    assert!(dropped.load(Ordering::SeqCst), "the context was released");
    cleanup(&path);
}

#[test]
fn touch_on_an_empty_cache_loads_nothing() {
    let clock = FakeClock::new();
    let cache = cache_on(&clock);
    cache.touch();
    clock.advance(IDLE_TIMEOUT * 2);
    cache.sweep();
    assert!(cache.is_empty());
}

#[test]
fn touch_does_not_wait_for_a_running_inference() {
    let path = temp_file("touch-contended", b"weights");
    let clock = FakeClock::new();
    let cache = cache_on(&clock);
    let dropped = Arc::new(AtomicBool::new(false));
    cache
        .with_context(
            "tiny",
            &path,
            None,
            || Ok(Ctx(dropped.clone())),
            |_| {
                // The lock is held here. The contended branch must
                // return at once instead of blocking on it.
                cache.touch();
                Ok(())
            },
        )
        .unwrap();
    assert!(!cache.is_empty());
    cleanup(&path);
}

fn poison(cache: &Arc<ModelCache<Ctx>>, path: &Path, in_load: bool) {
    panic_in_request(cache, path, in_load);
    assert!(cache.inner.is_poisoned());
}

/// A request that panics while holding the cache lock. Does not assert the
/// poison, since a running sweeper may already have recovered it.
fn panic_in_request(cache: &Arc<ModelCache<Ctx>>, path: &Path, in_load: bool) {
    let result = std::thread::spawn({
        let cache = cache.clone();
        let path = path.to_owned();
        move || {
            let _ = cache.with_context(
                "tiny",
                &path,
                None,
                || {
                    if in_load {
                        panic!("load panicked");
                    }
                    Ok(Ctx(Arc::new(AtomicBool::new(false))))
                },
                |_| -> Result<(), SttErrorDto> { panic!("inference panicked") },
            );
        }
    })
    .join();
    assert!(result.is_err(), "the worker must have panicked");
}

#[test]
fn a_panic_in_inference_does_not_wedge_later_requests() {
    let path = temp_file("poison-infer", b"weights");
    let clock = FakeClock::new();
    let cache = Arc::new(cache_on(&clock));
    poison(&cache, &path, false);
    // Recovery clears the half-used slot, then the cache works again.
    assert!(cache.is_empty());
    assert!(!cache.inner.is_poisoned());
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    let first = run_ok(&cache, "tiny", &path, &dropped, &loads);
    assert!(first.load_ms.is_some(), "reloaded after the poison");
    assert!(run_ok(&cache, "tiny", &path, &dropped, &loads)
        .load_ms
        .is_none());
    cleanup(&path);
}

#[test]
fn a_panic_in_load_does_not_wedge_later_requests() {
    let path = temp_file("poison-load", b"weights");
    let cache = Arc::new(ModelCache::new());
    poison(&cache, &path, true);
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    assert!(run_ok(&cache, "tiny", &path, &dropped, &loads)
        .load_ms
        .is_some());
    cleanup(&path);
}

#[test]
fn touch_and_sweep_recover_from_a_poisoned_lock() {
    let path = temp_file("poison-touch", b"weights");
    let clock = FakeClock::new();
    let cache = Arc::new(cache_on(&clock));
    poison(&cache, &path, false);
    cache.touch();
    assert!(!cache.inner.is_poisoned());
    poison(&cache, &path, false);
    cache.sweep();
    assert!(!cache.inner.is_poisoned());
    assert!(cache.is_empty());
    cleanup(&path);
}

#[test]
fn a_request_cancelled_while_queued_never_loads_or_evicts() {
    let path = temp_file("cancel-queued", b"weights");
    let other = temp_file("cancel-queued-other", b"other weights");
    let cache = Arc::new(ModelCache::new());
    let dropped = Arc::new(AtomicBool::new(false));
    let (entered_tx, entered) = mpsc::channel();
    let (finish, finish_rx) = mpsc::channel();
    let running = std::thread::spawn({
        let (cache, path, dropped) = (cache.clone(), path.clone(), dropped.clone());
        move || {
            cache.with_context(
                "tiny",
                &path,
                None,
                || Ok(Ctx(dropped)),
                |_| {
                    entered_tx.send(()).unwrap();
                    finish_rx.recv().unwrap();
                    Ok(())
                },
            )
        }
    });
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let loads = Arc::new(AtomicUsize::new(0));
    let (started_tx, started) = mpsc::channel();
    let queued = std::thread::spawn({
        let (cache, other, cancel, loads) =
            (cache.clone(), other.clone(), cancel.clone(), loads.clone());
        move || {
            started_tx.send(()).unwrap();
            cache.with_context(
                "turbo",
                &other,
                Some(&cancel),
                || {
                    loads.fetch_add(1, Ordering::SeqCst);
                    Ok(Ctx(Arc::new(AtomicBool::new(false))))
                },
                |_| Ok(()),
            )
        }
    });
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    // Give the queued request time to reach the lock; if it has not,
    // the pre-lock check rejects it and the assertions still hold.
    std::thread::sleep(Duration::from_millis(100));
    cancel.store(true, Ordering::SeqCst);
    finish.send(()).unwrap();
    running.join().unwrap().unwrap();
    assert_eq!(queued.join().unwrap().unwrap_err().code, "cancelled");
    assert_eq!(
        loads.load(Ordering::SeqCst),
        0,
        "no load for a cancelled request"
    );
    assert_eq!(cache.resident_id().as_deref(), Some("tiny"));
    assert!(!dropped.load(Ordering::SeqCst), "the resident model stayed");
    cleanup(&path);
    cleanup(&other);
}

#[test]
fn the_stamp_recorded_is_the_one_from_before_the_load() {
    // The file is replaced while the load runs. The loaded weights may be
    // the old or the new bytes, so the next request must reload instead
    // of trusting a stamp taken after the swap.
    let path = temp_file("stamp-before-load", b"old weights");
    let cache = ModelCache::new();
    let dropped = Arc::new(AtomicBool::new(false));
    cache
        .with_context(
            "tiny",
            &path,
            None,
            || {
                fs::write(&path, b"new, longer weights").unwrap();
                Ok(Ctx(dropped.clone()))
            },
            |_| Ok(()),
        )
        .unwrap();
    let loads = AtomicUsize::new(0);
    let next = run_ok(&cache, "tiny", &path, &dropped, &loads);
    assert_eq!(loads.load(Ordering::SeqCst), 1, "reloaded after the swap");
    assert!(next.load_ms.is_some());
    cleanup(&path);
}

fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn the_background_sweeper_evicts_and_survives_a_poisoned_lock() {
    let path = temp_file("sweeper", b"weights");
    let clock = FakeClock::new();
    let cache = Arc::new(cache_on(&clock));
    ModelCache::spawn_sweeper_every(cache.clone(), Duration::from_millis(5));
    let dropped = Arc::new(AtomicBool::new(false));
    let loads = AtomicUsize::new(0);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    clock.advance(IDLE_TIMEOUT + Duration::from_secs(1));
    wait_until("the sweeper to evict", || dropped.load(Ordering::SeqCst));
    wait_until("the slot to clear", || cache.is_empty());

    panic_in_request(&cache, &path, false);
    run_ok(&cache, "tiny", &path, &dropped, &loads);
    clock.advance(IDLE_TIMEOUT + Duration::from_secs(1));
    // is_empty locks the cache; the sweeper must evict again.
    wait_until("the sweeper to evict after poison", || cache.is_empty());
    cleanup(&path);
}
