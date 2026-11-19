//! Poisoned-lock recovery and the background sweeper.

use super::*;

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
    // Bounded: touch must recover in place and never block.
    let (done_tx, done) = mpsc::channel();
    std::thread::spawn({
        let cache = cache.clone();
        move || {
            cache.touch();
            done_tx.send(()).unwrap();
        }
    });
    done.recv_timeout(Duration::from_secs(5))
        .expect("touch blocked on a poisoned lock");
    assert!(!cache.inner.is_poisoned());
    assert!(cache.is_empty());
    poison(&cache, &path, false);
    cache.sweep();
    assert!(!cache.inner.is_poisoned());
    assert!(cache.is_empty());
    cleanup(&path);
}

#[test]
fn the_background_sweeper_recovers_a_poisoned_lock_and_stops() {
    let path = temp_file("sweeper", b"weights");
    let clock = FakeClock::new();
    let cache = Arc::new(cache_on(&clock));
    // Poison with no sweeper running, so only the sweeper can clear it:
    // no request touches the cache until the poison is gone.
    poison(&cache, &path, false);
    let stop = Arc::new(AtomicBool::new(false));
    let sweeper = ModelCache::spawn_sweeper(cache.clone(), Duration::from_millis(5), stop.clone())
        .expect("sweeper thread");
    wait_until("the sweeper to recover the lock", || {
        !cache.inner.is_poisoned()
    });
    // It still sweeps afterwards: load, go idle, and it evicts.
    let dropped = Arc::new(AtomicBool::new(false));
    run_ok(&cache, "tiny", &path, &dropped, &AtomicUsize::new(0));
    clock.advance(IDLE_TIMEOUT + Duration::from_secs(1));
    wait_until("the sweeper to evict", || dropped.load(Ordering::SeqCst));
    stop.store(true, Ordering::Release);
    sweeper.join().unwrap();
    cleanup(&path);
}
