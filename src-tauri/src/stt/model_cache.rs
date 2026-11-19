//! One resident Whisper context, reused across transcription requests.
//!
//! The cache holds at most one model. The previous context is dropped
//! before a new load when the selected model id or path changes, or when
//! the on-disk file's identity (dev/ino/size/mtime/ctime) changes or the
//! file is deleted. There is no idle timeout: Large-class models are
//! ~1.5 GB+, and holding a single copy until the user switches models
//! avoids re-paying load (and Metal setup) on every clip, without ever
//! keeping two models in memory.
//!
//! Access is serialized by a mutex so two inferences never share one
//! context. Whisper's `create_state` / `full` path is not assumed to be
//! re-entrant. Turbo already admits only one executing job; this lock
//! also covers Tiny and Base. Cancel reads an `AtomicBool` and does not
//! need the cache lock.

use super::engine::check_cancelled;
use super::error::SttErrorDto;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime};

#[cfg(test)]
#[path = "model_cache_tests.rs"]
mod tests;

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

pub struct ModelCache<C> {
    slot: Mutex<Option<Resident<C>>>,
}

impl<C> Default for ModelCache<C> {
    fn default() -> Self {
        Self {
            slot: Mutex::new(None),
        }
    }
}

impl<C> ModelCache<C> {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.slot.lock().unwrap().is_none()
    }

    #[cfg(test)]
    fn resident_id(&self) -> Option<String> {
        self.slot
            .lock()
            .unwrap()
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
        let mut slot = self.slot.lock().unwrap();
        let stamp = match file_stamp(path) {
            Ok(stamp) => stamp,
            Err(error) => {
                *slot = None;
                return Err(error.into_dto());
            }
        };
        let hit = slot.as_ref().is_some_and(|resident| {
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
            *slot = None;
            let started = Instant::now();
            let context = load()?;
            let load_ms = started.elapsed().as_millis();
            let stamp = file_stamp(path).unwrap_or(stamp);
            *slot = Some(Resident {
                model_id: model_id.to_owned(),
                path: path.to_owned(),
                stamp,
                context,
            });
            Some(load_ms)
        };
        check_cancelled(cancel)?;
        let inferred_at = Instant::now();
        let result = infer(&slot.as_ref().expect("resident after load or hit").context);
        let infer_ms = inferred_at.elapsed().as_millis();
        check_cancelled(cancel)?;
        result.map(|value| Timed {
            value,
            load_ms,
            infer_ms,
        })
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
