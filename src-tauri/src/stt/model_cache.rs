//! One resident Whisper context, reused across transcription requests.
//!
//! The cache holds at most one model. The previous context is dropped
//! before a new load when the selected model id or path changes, or when
//! the on-disk file's identity changes or the file is deleted (see
//! `file_stamp`). It is also unloaded after [`IDLE_TIMEOUT`] (10
//! minutes) with no inference in flight and no recorded activity.
//! Activity is only a timestamp: the owner touches it at a successful
//! Turbo prepare and at the start and end of each request. There is no
//! hold set to leak, so a renderer that retires mid-recording cannot pin
//! the model. A recording start deliberately does not touch it: that
//! would let Parakeet or a mic test keep a Whisper model resident. A
//! Tiny or Base model can therefore be evicted mid-recording after a
//! long idle; its reload is sub-second, which is accepted.
//! Large-class models are ~1.5 GB+; holding a single copy across clips
//! avoids re-paying load (and Metal setup) without ever keeping two
//! models in memory.
//!
//! Access is serialized by a mutex so two inferences never share one
//! context. The idle sweeper takes that same lock, so it cannot evict
//! mid-transcription. A poisoned lock (a panic in load or infer) is
//! recovered by clearing the slot, so later requests and the sweeper
//! keep working. Cancel reads an `AtomicBool` and does not need the
//! cache lock.

use super::engine::check_cancelled;
use super::error::SttErrorDto;
use super::file_stamp::{file_stamp, needs_reload, FileStamp};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, TryLockError};
use std::time::{Duration, Instant};

#[cfg(test)]
#[path = "model_cache_tests.rs"]
mod tests;

/// Unload the resident context after this much idle time. Not a setting.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// How often the background sweeper checks for an idle resident model.
#[cfg(feature = "whisper")]
const IDLE_SWEEP_INTERVAL: Duration = Duration::from_secs(30);

/// Injectable clock so idle tests can advance time without waiting.
pub(super) trait Clock: Send + Sync + 'static {
    fn now(&self) -> Instant;
}

struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// True when `last_used` is at least `timeout` before `now`.
pub fn idle_expired(last_used: Instant, now: Instant, timeout: Duration) -> bool {
    now.saturating_duration_since(last_used) >= timeout
}

/// Outcome of a cached or freshly loaded inference.
#[derive(Debug)]
pub struct Timed<T> {
    pub value: T,
    /// `None` means the resident context was reused.
    pub load_ms: Option<u128>,
    pub infer_ms: u128,
}

struct Resident<C> {
    model_id: String,
    path: PathBuf,
    stamp: FileStamp,
    context: C,
}

struct Inner<C> {
    slot: Option<Resident<C>>,
    last_used: Option<Instant>,
}

pub struct ModelCache<C> {
    inner: Mutex<Inner<C>>,
    /// One-shot hook that runs just before a request takes the lock, so a
    /// test can cancel a request that is about to queue.
    #[cfg(test)]
    before_lock: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    clock: Arc<dyn Clock>,
}

impl<C> Default for ModelCache<C> {
    fn default() -> Self {
        Self::with_clock(Arc::new(SystemClock))
    }
}

impl<C> ModelCache<C> {
    pub fn new() -> Self {
        Self::default()
    }

    fn with_clock(clock: Arc<dyn Clock>) -> Self {
        Self {
            inner: Mutex::new(Inner {
                slot: None,
                last_used: None,
            }),
            #[cfg(test)]
            before_lock: Mutex::new(None),
            clock,
        }
    }

    /// Lock the slot, recovering from poison (see [`Self::recover`]).
    fn lock_inner(&self) -> MutexGuard<'_, Inner<C>> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| self.recover(poisoned))
    }

    /// A poisoned lock means a load or inference panicked mid-flight, so
    /// the context may be half-built: drop it, reset the timer, clear the
    /// poison, and carry on rather than panic every later call. Works on
    /// the guard the caller already holds, so it never locks again.
    fn recover<'a>(
        &self,
        poisoned: PoisonError<MutexGuard<'a, Inner<C>>>,
    ) -> MutexGuard<'a, Inner<C>> {
        let mut inner = poisoned.into_inner();
        inner.slot = None;
        inner.last_used = None;
        self.inner.clear_poison();
        inner
    }

    fn touch_locked(&self, inner: &mut Inner<C>) {
        inner.last_used = Some(self.clock.now());
    }

    /// Restart the idle window without waiting on an inference. If one
    /// holds the lock, its own start and end touches already cover us.
    /// Never blocks: a poisoned lock is recovered on the guard already held.
    pub fn touch(&self) {
        let mut inner = match self.inner.try_lock() {
            Ok(inner) => inner,
            Err(TryLockError::WouldBlock) => return,
            Err(TryLockError::Poisoned(poisoned)) => self.recover(poisoned),
        };
        self.touch_locked(&mut inner);
    }

    /// Drop the resident context if it has been idle for [`IDLE_TIMEOUT`].
    /// Takes the same lock as inference, so this cannot race a transcribe.
    pub(super) fn sweep(&self) {
        let mut inner = self.lock_inner();
        let Some(last_used) = inner.last_used else {
            return;
        };
        if !idle_expired(last_used, self.clock.now(), IDLE_TIMEOUT) {
            return;
        }
        inner.slot = None;
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.lock_inner().slot.is_none()
    }

    #[cfg(test)]
    fn resident_id(&self) -> Option<String> {
        self.inner
            .lock()
            .unwrap()
            .slot
            .as_ref()
            .map(|resident| resident.model_id.clone())
    }

    pub fn with_context<T>(
        &self,
        model_id: &str,
        path: &Path,
        cancel: Option<&std::sync::atomic::AtomicBool>,
        load: impl FnOnce() -> Result<C, SttErrorDto>,
        infer: impl FnOnce(&C) -> Result<T, SttErrorDto>,
    ) -> Result<Timed<T>, SttErrorDto> {
        check_cancelled(cancel)?;
        #[cfg(test)]
        if let Some(hook) = self.before_lock.lock().unwrap().take() {
            hook();
        }
        let mut inner = self.lock_inner();
        // Queued behind another inference: a request cancelled while
        // waiting must not evict the resident model with a wasted load.
        check_cancelled(cancel)?;
        // Reset the idle timer at request start and end.
        self.touch_locked(&mut inner);
        let timed = (|| {
            let stamp = match file_stamp(path) {
                Ok(stamp) => stamp,
                Err(error) => {
                    inner.slot = None;
                    return Err(error.into_dto());
                }
            };
            let hit = inner.slot.as_ref().is_some_and(|resident| {
                !needs_reload(
                    &resident.model_id,
                    &resident.path,
                    &resident.stamp,
                    model_id,
                    path,
                    Some(&stamp),
                )
            });
            let load_ms = if hit {
                None
            } else {
                // Drop the previous model before loading so two Large
                // contexts are never resident together.
                inner.slot = None;
                let started = Instant::now();
                let context = load()?;
                let load_ms = started.elapsed().as_millis();
                inner.slot = Some(Resident {
                    model_id: model_id.to_owned(),
                    path: path.to_owned(),
                    stamp,
                    context,
                });
                Some(load_ms)
            };
            check_cancelled(cancel)?;
            let inferred_at = Instant::now();
            let result = infer(
                &inner
                    .slot
                    .as_ref()
                    .expect("resident after load or hit")
                    .context,
            );
            let infer_ms = inferred_at.elapsed().as_millis();
            check_cancelled(cancel)?;
            result.map(|value| Timed {
                value,
                load_ms,
                infer_ms,
            })
        })();
        self.touch_locked(&mut inner);
        timed
    }
}

#[cfg(any(test, feature = "whisper"))]
impl<C: Send + 'static> ModelCache<C> {
    /// Background tick used by the process-wide cache. It is never
    /// stopped. Test caches use an injectable clock and call
    /// [`Self::sweep`] directly, or run [`Self::spawn_sweeper`] with a
    /// short interval and a stop flag.
    #[cfg(feature = "whisper")]
    pub(super) fn spawn_idle_sweeper(cache: Arc<Self>) {
        let never_stopped = Arc::new(AtomicBool::new(false));
        drop(Self::spawn_sweeper(
            cache,
            IDLE_SWEEP_INTERVAL,
            never_stopped,
        ));
    }

    /// Sweep every `interval` until `stop` is set. Returns the handle so a
    /// test can join it. A spawn failure is logged and returns `None`.
    pub(super) fn spawn_sweeper(
        cache: Arc<Self>,
        interval: Duration,
        stop: Arc<AtomicBool>,
    ) -> Option<std::thread::JoinHandle<()>> {
        let spawned = std::thread::Builder::new()
            .name("stt-model-idle".into())
            .spawn(move || {
                while !stop.load(Ordering::Acquire) {
                    std::thread::sleep(interval);
                    cache.sweep();
                }
            });
        match spawned {
            Ok(handle) => Some(handle),
            Err(error) => {
                // Without the sweeper the model stays resident until the
                // selection changes; say so rather than fail silently.
                eprintln!("[stt] idle sweeper failed to start: {error}");
                None
            }
        }
    }
}

pub fn format_timing(audio_ms: u64, load_ms: Option<u128>, infer_ms: u128) -> String {
    match load_ms {
        Some(ms) => {
            format!("[stt] timing audio_ms={audio_ms} load_ms={ms} infer_ms={infer_ms}")
        }
        None => format!("[stt] timing audio_ms={audio_ms} load_ms=cached infer_ms={infer_ms}"),
    }
}

pub fn audio_ms(samples_len: usize, sample_rate_hz: u32) -> u64 {
    if sample_rate_hz == 0 {
        return 0;
    }
    (samples_len as u64).saturating_mul(1000) / u64::from(sample_rate_hz)
}
