//! One-click download of a pinned cleanup model (BUS-181; either offered
//! model since BUS-229).
//!
//! Reuses `crate::model_fetch` (HTTPS-only agent, `<file>.partial`, size and
//! SHA-256 check before the atomic rename) under the store's write guard, so
//! two downloads never overlap and a download never overlaps a lease. A failed, cancelled or
//! mismatched download leaves no partial file and never touches an installed
//! model. There is no resume: a retry starts from zero.

use std::fs::{self, File};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::{validate_artifact, CleanupModelStore, ModelSpec, ModelStatus};
use crate::model_fetch::{self, FetchError, PinnedArtifact};

/// Payload of `cleanup:download-progress`. `ratio` stays below 1.0 until the
/// file is verified and in place.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub model_id: &'static str,
    pub bytes_received: u64,
    pub bytes_total: u64,
    pub ratio: f64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DownloadError {
    Cancelled,
    Checksum,
    Failed(String),
}

impl CleanupModelStore {
    /// Blocking: download, verify and install an offered model.
    pub fn download(
        &self,
        model_id: &str,
        on_progress: impl FnMut(DownloadProgress),
    ) -> Result<ModelStatus, DownloadError> {
        let spec = self.spec(model_id).map_err(DownloadError::Failed)?;
        self.download_from(spec, model_fetch::shared_agent(), on_progress, sync_dir)?;
        Ok(self.status())
    }

    /// Ask the running download of `model_id` to stop. False when that model
    /// isn't downloading.
    pub fn cancel_download(&self, model_id: &str) -> bool {
        let inner = self.inner.lock().unwrap();
        if inner.writing != Some(model_id) {
            return false;
        }
        match &inner.download {
            Some(flag) => {
                flag.store(true, Ordering::Release);
                true
            }
            None => false,
        }
    }

    /// `download` with the spec (URL and artifact) and agent injected.
    pub(super) fn download_from(
        &self,
        spec: ModelSpec,
        agent: &ureq::Agent,
        mut on_progress: impl FnMut(DownloadProgress),
        sync_parent: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<(), DownloadError> {
        let _guard = self.begin_write(spec).map_err(DownloadError::Failed)?;
        let cancel = Arc::new(AtomicBool::new(false));
        self.inner.lock().unwrap().download = Some(Arc::clone(&cancel));
        let result = self.fetch_into_place(spec, agent, &cancel, &mut on_progress);
        self.inner.lock().unwrap().download = None;
        result?;
        sync_parent(&self.root).map_err(DownloadError::Failed)?;
        self.remember_verified(spec);
        let size = spec.artifact.size;
        on_progress(DownloadProgress {
            model_id: spec.id,
            bytes_received: size,
            bytes_total: size,
            ratio: 1.0,
        });
        Ok(())
    }

    fn fetch_into_place(
        &self,
        spec: ModelSpec,
        agent: &ureq::Agent,
        cancel: &AtomicBool,
        on_progress: &mut impl FnMut(DownloadProgress),
    ) -> Result<(), DownloadError> {
        let (artifact, url) = (spec.artifact, spec.url);
        let destination = self.path_of(spec);
        if validate_artifact(&destination, artifact).is_ok() {
            return Ok(());
        }
        fs::create_dir_all(&self.root).map_err(|error| {
            DownloadError::Failed(format!("create cleanup model directory: {error}"))
        })?;
        // model_fetch opens the partial with File::create, which truncates an
        // existing file and keeps its mode: pre-create it 0600 so the bytes
        // are private for the whole download.
        create_private(&model_fetch::partial_path(&destination)).map_err(DownloadError::Failed)?;
        let pinned = PinnedArtifact {
            size_bytes: artifact.size,
            sha256: artifact.sha256,
        };
        let fetched =
            model_fetch::fetch_verified(agent, url, &destination, &pinned, cancel, |got, total| {
                on_progress(progress(spec.id, got, total));
            });
        if cancel.load(Ordering::Acquire) {
            // Cancel wins even if the last bytes landed: nothing stays behind.
            if fetched.is_ok() {
                let _ = fs::remove_file(&destination);
            }
            let _ = fs::remove_file(model_fetch::partial_path(&destination));
            return Err(DownloadError::Cancelled);
        }
        fetched.map_err(|error| match error {
            FetchError::Cancelled => DownloadError::Cancelled,
            FetchError::SizeMismatch { .. } | FetchError::HashMismatch { .. } => {
                DownloadError::Checksum
            }
            FetchError::Network(message) | FetchError::Io(message) => {
                DownloadError::Failed(message)
            }
        })?;
        make_private(&destination).map_err(DownloadError::Failed)
    }
}

fn progress(model_id: &'static str, received: u64, total: u64) -> DownloadProgress {
    let ratio = if total == 0 {
        0.0
    } else {
        (received as f64 / total as f64).clamp(0.0, 0.999)
    };
    DownloadProgress {
        model_id,
        bytes_received: received,
        bytes_total: total,
        ratio,
    }
}

/// Empty 0600 partial file (replacing any stale one), before any bytes land.
fn create_private(path: &Path) -> Result<(), String> {
    let _ = fs::remove_file(path);
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map(drop)
        .map_err(|error| format!("create partial cleanup model: {error}"))
}

/// Re-asserts the 0600 mode on the installed file (umask-proof).
fn make_private(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("protect cleanup model: {error}"))?;
    }
    let _ = path;
    Ok(())
}

fn sync_dir(parent: &Path) -> Result<(), String> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync cleanup model directory: {error}"))
}

#[cfg(all(test, unix))]
#[path = "download_tests.rs"]
mod tests;
