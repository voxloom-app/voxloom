//! File identity stamp for the resident Whisper model.
//!
//! A cached context is reusable only while the on-disk file keeps the
//! same identity (dev/ino/size/mtime/ctime on Unix; size and mtime
//! elsewhere). Nothing here logs or exposes the path.

use super::error::SttErrorDto;
use std::fs;
use std::path::Path;
use std::time::SystemTime;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileStamp {
    #[cfg(unix)]
    pub(super) dev: u64,
    #[cfg(unix)]
    pub(super) ino: u64,
    pub(super) len: u64,
    pub(super) modified: SystemTime,
    /// Change-time. Userspace cannot set it back, so it usually
    /// catches an in-place rewrite that restores mtime. It is only as
    /// fine as the filesystem clock tick.
    #[cfg(unix)]
    pub(super) ctime_secs: i64,
    #[cfg(unix)]
    pub(super) ctime_nsecs: i64,
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

    pub(super) fn into_dto(self) -> SttErrorDto {
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
