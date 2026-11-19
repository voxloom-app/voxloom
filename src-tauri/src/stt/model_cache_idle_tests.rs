//! Idle eviction, touches and the idle clock.

use super::*;

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

#[test]
fn a_touch_restarts_the_idle_window() {
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
    cache.touch(); // an admitted Turbo stt_prepare
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
fn other_engines_recording_starts_do_not_extend_whisper_residency() {
    // Turbo is loaded, then Parakeet dictations and Settings mic tests
    // start recordings. Those never touch the Whisper cache (the capture
    // start test in the coordinator pins that), so the model still
    // evicts once the timeout has passed since its last use.
    let clock = FakeClock::new();
    let (cache, path, dropped) = loaded_cache(&clock, "other-engines");
    for _ in 0..4 {
        clock.advance(IDLE_TIMEOUT / 5);
        cache.sweep();
        assert!(!cache.is_empty(), "not yet idle long enough");
    }
    clock.advance(IDLE_TIMEOUT / 5);
    cache.sweep();
    assert!(cache.is_empty(), "evicted at the timeout");
    assert!(dropped.load(Ordering::SeqCst));
    cleanup(&path);
}

#[test]
fn touch_does_not_wait_for_a_running_inference() {
    let path = temp_file("touch-contended", b"weights");
    let clock = FakeClock::new();
    let cache = Arc::new(cache_on(&clock));
    let (done_tx, done) = mpsc::channel();
    std::thread::spawn({
        let (cache, path) = (cache.clone(), path.clone());
        move || {
            let _ = cache.with_context(
                "tiny",
                &path,
                None,
                || Ok(Ctx(Arc::new(AtomicBool::new(false)))),
                |_| {
                    // The lock is held here. The contended branch must
                    // return at once instead of blocking on it.
                    cache.touch();
                    done_tx.send(()).unwrap();
                    Ok(())
                },
            );
        }
    });
    done.recv_timeout(Duration::from_secs(5))
        .expect("touch blocked behind a running inference");
    cleanup(&path);
}
