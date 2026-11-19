//! One resident Whisper context, reused across transcription requests.
//!
//! The cache holds at most one model. The previous context is dropped
//! before a new load when the selected model id or path changes, or when
//! the on-disk file's identity (dev/ino/size/mtime/ctime) changes or the
//! file is deleted. It is also unloaded after [`IDLE_TIMEOUT`] (10
//! minutes) with no inference in flight and no recorded activity. A
//! pending Turbo prepare counts as activity so a long recording does
//! not evict the model. Large-class models are ~1.5 GB+; holding a
//! single copy across clips avoids re-paying load (and Metal setup)
//! without ever keeping two models in memory.
//!
//! Access is serialized by a mutex so two inferences never share one
//! context. The idle sweeper takes that same lock, so it cannot evict
//! mid-transcription. Whisper's `create_state` / `full` path is not
//! assumed to be re-entrant. Turbo already admits only one executing
//! job; this lock also covers Tiny and Base. Cancel reads an
//! `AtomicBool` and does not need the cache lock.

use super::engine::check_cancelled;
use super::error::SttErrorDto;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileStamp {
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    len: u64,
    modified: SystemTime,
    /// Change-time. Userspace cannot set it back, so it usually
    /// catches an in-place rewrite that restores mtime. It is only as
    /// fine as the filesystem clock tick.
    #[cfg(unix)]
    ctime_secs: i64,
    #[cfg(unix)]
    ctime_nsecs: i64,
}

pub enum StampError {
    Missing,
    NotAFile,
    Io(String),
}

impl StampError {
    fn from_io(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::NotFound {
            Self::Missing
        } else {
            Self::Io(error.to_string())
        }
    }

    fn into_dto(self) -> SttErrorDto {
        match self {
            Self::Missing => SttErrorDto::new("model-missing", "Model file is missing"),
            Self::NotAFile => SttErrorDto::new("model-missing", "Model path is not a regular file"),
            Self::Io(message) => SttErrorDto::new(
                "model-missing",
                format!("Cannot read model file: {message}"),
            ),
        }
    }
}

pub fn file_stamp(path: &Path) -> Result<FileStamp, StampError> {
    let metadata = fs::metadata(path).map_err(StampError::from_io)?;
    if !metadata.is_file() {
        return Err(StampError::NotAFile);
    }
    let modified = metadata.modified().map_err(StampError::from_io)?;
    Ok(FileStamp {
        #[cfg(unix)]
        dev: {
            use std::os::unix::fs::MetadataExt;
            metadata.dev()
        },
        #[cfg(unix)]
        ino: {
            use std::os::unix::fs::MetadataExt;
            metadata.ino()
        },
        len: metadata.len(),
        modified,
        #[cfg(unix)]
        ctime_secs: {
            use std::os::unix::fs::MetadataExt;
            metadata.ctime()
        },
        #[cfg(unix)]
        ctime_nsecs: {
            use std::os::unix::fs::MetadataExt;
            metadata.ctime_nsec()
        },
    })
}

/// True when the resident slot cannot be reused for this request.
/// A missing stamp (deleted or unreadable file) always reloads.
pub fn needs_reload(
    resident_id: &str,
    resident_path: &Path,
    resident_stamp: &FileStamp,
    model_id: &str,
    path: &Path,
    stamp: Option<&FileStamp>,
) -> bool {
    match stamp {
        None => true,
        Some(stamp) => resident_id != model_id || resident_path != path || resident_stamp != stamp,
    }
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
    /// Request ids from `stt_prepare` that have not yet finished or
    /// cancelled. Stored apart from `inner` so cancel does not wait
    /// on an in-flight inference.
    holds: Mutex<HashSet<String>>,
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
            holds: Mutex::new(HashSet::new()),
            clock,
        }
    }

    fn touch_locked(&self, inner: &mut Inner<C>) {
        inner.last_used = Some(self.clock.now());
    }

    /// Mark a pending request so a long recording is not treated as idle.
    /// The hold set is a separate lock so cancel never waits on inference.
    pub fn begin_activity(&self, id: &str) {
        if id.is_empty() {
            return;
        }
        self.holds.lock().unwrap().insert(id.to_owned());
        self.try_touch();
    }

    pub fn end_activity(&self, id: &str) {
        if id.is_empty() {
            return;
        }
        self.holds.lock().unwrap().remove(id);
        self.try_touch();
    }

    fn try_touch(&self) {
        // If inference holds `inner`, its own start/end touch covers us.
        if let Ok(mut inner) = self.inner.try_lock() {
            self.touch_locked(&mut inner);
        }
    }

    fn has_holds(&self) -> bool {
        !self.holds.lock().unwrap().is_empty()
    }

    /// Drop the resident context if it has been idle for [`IDLE_TIMEOUT`].
    /// Takes the same lock as inference, so this cannot race a transcribe.
    fn sweep(&self) {
        if self.has_holds() {
            return;
        }
        let mut inner = self.inner.lock().unwrap();
        if self.has_holds() {
            return;
        }
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
        self.inner.lock().unwrap().slot.is_none()
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
        let mut inner = self.inner.lock().unwrap();
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
                let stamp = file_stamp(path).unwrap_or(stamp);
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

#[cfg(feature = "whisper")]
impl<C: Send + 'static> ModelCache<C> {
    /// Background tick used by the process-wide cache. Test caches do
    /// not start this; they call [`Self::sweep`] directly.
    pub(super) fn spawn_idle_sweeper(cache: Arc<Self>) {
        let _ = std::thread::Builder::new()
            .name("stt-model-idle".into())
            .spawn(move || loop {
                std::thread::sleep(IDLE_SWEEP_INTERVAL);
                cache.sweep();
            });
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
