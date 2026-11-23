//! Fingerprint cache so status() and a run can skip a full SHA-256 when the
//! model is unchanged (dev/ino/size/mtime/ctime).

use std::fs::{self, File, Metadata};
use std::path::Path;
use std::time::SystemTime;

use super::super::artifact::ArtifactSpec;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct FileFingerprint {
    #[cfg(unix)]
    pub(super) dev: u64,
    #[cfg(unix)]
    pub(super) ino: u64,
    pub(super) len: u64,
    pub(super) modified: SystemTime,
    /// Change-time (content or metadata). Userspace cannot set it back, so it
    /// usually catches an in-place rewrite that restores mtime. It is only as
    /// fine as the filesystem clock tick, though: a rewrite in the same tick
    /// keeps the fingerprint. The same holds for the hash it saves; any write
    /// through the app (download, delete) drops the cache first.
    #[cfg(unix)]
    pub(super) ctime_secs: i64,
    #[cfg(unix)]
    pub(super) ctime_nsecs: i64,
}

/// A model's last successful hash: which file, checked against which digest.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Verified {
    pub(super) fingerprint: FileFingerprint,
    sha256: &'static str,
}

impl Verified {
    pub(super) fn new(fingerprint: FileFingerprint, artifact: ArtifactSpec) -> Self {
        Self {
            fingerprint,
            sha256: artifact.sha256,
        }
    }

    pub(super) fn matches(&self, fingerprint: &FileFingerprint, artifact: ArtifactSpec) -> bool {
        self.fingerprint == *fingerprint && self.sha256 == artifact.sha256
    }
}

pub(super) fn fingerprint(path: &Path) -> Result<FileFingerprint, String> {
    // Match artifact::open_regular: never follow a symlink into the model path.
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("cleanup model must be a regular non-symlink file".into());
    }
    of(&metadata)
}

/// The open descriptor's fingerprint (fstat): what a lease hands the worker.
pub(super) fn descriptor_fingerprint(file: &File) -> Result<FileFingerprint, String> {
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("cleanup model must be a regular file".into());
    }
    of(&metadata)
}

fn of(metadata: &Metadata) -> Result<FileFingerprint, String> {
    let modified = metadata
        .modified()
        .map_err(|error| format!("read cleanup model mtime: {error}"))?;
    Ok(FileFingerprint {
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
