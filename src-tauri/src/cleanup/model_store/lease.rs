//! A held model descriptor: what a run or a prewarm hands the worker. It is
//! verified on the descriptor itself, right before use; a descriptor whose
//! identity matches this model's last verified hash is not hashed again
//! (BUS-229: hashing the 2.5 GB model would eat the cleanup budget).

use std::fs::File;
use std::io::{Seek, SeekFrom};
use std::sync::{Arc, Mutex};

use super::super::artifact::{validate_file_while, ArtifactSpec};
use super::catalog::ModelSpec;
use super::status_cache::{descriptor_fingerprint, FileFingerprint, Verified};
use super::StoreInner;

#[derive(Debug)]
pub struct ModelLease {
    pub file: File,
    pub(super) spec: ModelSpec,
    pub(super) inner: Arc<Mutex<StoreInner>>,
}

impl ModelLease {
    pub fn model_id(&self) -> &'static str {
        self.spec.id
    }

    pub(in crate::cleanup) fn identity(&self) -> crate::cleanup::CleanupAttempt {
        crate::cleanup::CleanupAttempt {
            model_id: self.spec.id,
            model_digest: self.spec.artifact.sha256,
        }
    }

    /// Verify the already reserved descriptor, without holding the store lock.
    pub fn verify(&mut self) -> Result<(), String> {
        self.verify_while(|| true).map(drop)
    }

    /// `verify`, stopped between chunks of the hash once `keep_going` says
    /// no: Ok(true) if verified, Ok(false) if stopped. A stopped hash found
    /// nothing wrong, so the cache is kept.
    pub fn verify_while<K: FnMut() -> bool>(&mut self, keep_going: K) -> Result<bool, String> {
        self.verify_with(keep_going, |file, artifact, keep_going| {
            validate_file_while(file, artifact, keep_going)
        })
    }

    /// `verify_while` with the hash injected, so tests can see whether it ran.
    pub(super) fn verify_with<K: FnMut() -> bool>(
        &mut self,
        mut keep_going: K,
        hash: impl FnOnce(&mut File, ArtifactSpec, K) -> Result<bool, String>,
    ) -> Result<bool, String> {
        // fstat of this descriptor: the very file the worker will read, so a
        // swapped path or a symlink can't borrow another file's verdict.
        let before = descriptor_fingerprint(&self.file);
        if self.cached(&before) {
            self.file
                .seek(SeekFrom::Start(0))
                .map_err(|error| format!("rewind cleanup model: {error}"))?;
            // As a hash asks before its first chunk: a caller that has given
            // up (an abandoned prewarm) still hears "stopped".
            return Ok(keep_going());
        }
        match hash(&mut self.file, self.spec.artifact, keep_going) {
            Ok(true) => {
                // Remembered only if the descriptor didn't change while hashed.
                if let (Ok(before), Ok(after)) = (before, descriptor_fingerprint(&self.file)) {
                    if before == after {
                        self.remember(after);
                    }
                }
                Ok(true)
            }
            Ok(false) => Ok(false),
            Err(error) => {
                // Status may still trust a stale fingerprint (e.g. in-place
                // rewrite that restored mtime before ctime was keyed). Drop it.
                self.inner.lock().unwrap().verified.remove(self.spec.id);
                Err(error)
            }
        }
    }

    /// Whether this model was verified, against this digest, as this exact
    /// file. Windows has no inode or change time to key on, only size and a
    /// settable mtime, so a run there always hashes (it only has the 397 MB
    /// default; the 4B is never offered there). The hash itself never waits
    /// on the store lock: when it is busy, this misses.
    fn cached(&self, fingerprint: &Result<FileFingerprint, String>) -> bool {
        let Ok(fingerprint) = fingerprint else {
            return false;
        };
        cfg!(unix)
            && self.inner.try_lock().is_ok_and(|inner| {
                inner
                    .verified
                    .get(self.spec.id)
                    .is_some_and(|verified| verified.matches(fingerprint, self.spec.artifact))
            })
    }

    /// Skipped when the store lock is busy, like the lookup.
    fn remember(&self, fingerprint: FileFingerprint) {
        if let Ok(mut inner) = self.inner.try_lock() {
            let verified = Verified::new(fingerprint, self.spec.artifact);
            inner.verified.insert(self.spec.id, verified);
        }
    }
}

/// A prewarm spawns from the lease and keeps it until the worker is reaped.
impl std::borrow::Borrow<File> for ModelLease {
    fn borrow(&self) -> &File {
        &self.file
    }
}

impl Drop for ModelLease {
    fn drop(&mut self) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(count) = inner.leases.get_mut(self.spec.id) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                inner.leases.remove(self.spec.id);
            }
        }
    }
}
