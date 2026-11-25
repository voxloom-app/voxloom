//! The store's exclusive-write guard: one download, delete (or test
//! install) at a time, and never while a lease holds that model open. A
//! lease on another model doesn't block it (BUS-229: the 0.6B can stay
//! prewarmed while the 4B downloads).

use std::fs;
use std::sync::{Arc, Mutex};

use super::{CleanupModelStore, ModelSpec, ModelStatus, StoreInner};

pub(super) struct WriteGuard {
    inner: Arc<Mutex<StoreInner>>,
}

impl Drop for WriteGuard {
    fn drop(&mut self) {
        self.inner.lock().unwrap().writing = None;
    }
}

impl CleanupModelStore {
    pub(super) fn begin_write(&self, spec: ModelSpec) -> Result<WriteGuard, String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.leases.get(spec.id).is_some_and(|count| *count > 0) {
            return Err("cleanup model is in use".into());
        }
        if inner.writing.is_some() {
            return Err("cleanup model download is already running".into());
        }
        inner.writing = Some(spec.id);
        // A write replaces the on-disk bytes; drop any stale cache.
        inner.verified.remove(spec.id);
        Ok(WriteGuard {
            inner: Arc::clone(&self.inner),
        })
    }

    /// Remove an installed model (BUS-229). Refused while it is in use or
    /// any download runs; removing a missing model is not an error.
    pub fn delete(&self, model_id: &str) -> Result<ModelStatus, String> {
        let spec = self.spec(model_id)?;
        let guard = self.begin_write(spec)?;
        let path = self.path_of(spec);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("remove cleanup model: {error}")),
        }
        let _ = fs::remove_file(crate::model_fetch::partial_path(&path));
        drop(guard);
        Ok(self.status())
    }
}
