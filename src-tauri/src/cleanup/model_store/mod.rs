use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

#[cfg(test)]
use super::artifact::ArtifactSpec;
use super::artifact::{open_regular, validate as validate_artifact};

mod catalog;
pub mod download;
mod guard;
mod lease;
mod pin;
mod pin_4b;
mod status_cache;
pub use catalog::ModelSpec;
use catalog::{offered_on, DEFAULT_MODEL};
pub use lease::ModelLease;
#[cfg(test)]
pub use pin::MODEL_ID;
use status_cache::{fingerprint, Verified};

/// The default model's status, kept at the top level for existing callers,
/// and every model this build offers (BUS-229), default first.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub available: bool,
    pub id: &'static str,
    pub runtime_available: bool,
    pub sha256: &'static str,
    pub models: Vec<ModelEntry>,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub available: bool,
    pub id: &'static str,
    pub sha256: &'static str,
}

#[derive(Debug, Default)]
struct StoreInner {
    /// The model a download (or test install, or delete) is replacing. One
    /// write at a time across the store.
    writing: Option<&'static str>,
    /// Open descriptors per model id.
    leases: HashMap<&'static str, usize>,
    /// Cancel flag of the running download (BUS-181), if any.
    download: Option<Arc<AtomicBool>>,
    /// Last successful hash per model id, keyed by dev/ino/size/mtime/ctime
    /// and the digest it was checked against.
    verified: HashMap<&'static str, Verified>,
}

pub struct CleanupModelStore {
    inner: Arc<Mutex<StoreInner>>,
    root: PathBuf,
    catalog: &'static [ModelSpec],
}

impl CleanupModelStore {
    pub fn from_app(app: &AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("resolve app data: {error}"))?
            .join("cleanup-models");
        Ok(Self::new(root))
    }

    /// The models offered on the OS this build targets.
    pub fn new(root: PathBuf) -> Self {
        Self::with_catalog(root, offered_on(std::env::consts::OS))
    }

    fn with_catalog(root: PathBuf, catalog: &'static [ModelSpec]) -> Self {
        Self {
            inner: Arc::new(Mutex::new(StoreInner::default())),
            root,
            catalog,
        }
    }

    pub fn status(&self) -> ModelStatus {
        let models: Vec<ModelEntry> = self
            .catalog
            .iter()
            .map(|spec| ModelEntry {
                available: self.available_for(*spec),
                id: spec.id,
                sha256: spec.artifact.sha256,
            })
            .collect();
        ModelStatus {
            available: models[0].available,
            id: DEFAULT_MODEL.id,
            runtime_available: false,
            sha256: DEFAULT_MODEL.artifact.sha256,
            models,
        }
    }

    /// An offered model, or an error naming the unknown id.
    pub fn spec(&self, model_id: &str) -> Result<ModelSpec, String> {
        self.catalog
            .iter()
            .find(|spec| spec.id == model_id)
            .copied()
            .ok_or_else(|| format!("unknown cleanup model: {model_id}"))
    }

    pub fn lease(&self, model_id: &str) -> Result<ModelLease, String> {
        let spec = self.spec(model_id)?;
        self.lease_spec(spec)
    }

    /// Test seam: lease an offered model, checked against `artifact`.
    #[cfg(test)]
    pub(super) fn lease_artifact(
        &self,
        model_id: &str,
        artifact: ArtifactSpec,
    ) -> Result<ModelLease, String> {
        let spec = self.spec(model_id)?;
        self.lease_spec(ModelSpec { artifact, ..spec })
    }

    fn lease_spec(&self, spec: ModelSpec) -> Result<ModelLease, String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.writing == Some(spec.id) {
            return Err("cleanup model is being installed".into());
        }
        if inner.leases.values().sum::<usize>() >= 2 {
            return Err("cleanup model descriptor capacity is full".into());
        }
        let file = open_regular(&self.path_of(spec))?;
        *inner.leases.entry(spec.id).or_default() += 1;
        Ok(ModelLease {
            file,
            spec,
            inner: Arc::clone(&self.inner),
        })
    }

    fn path_of(&self, spec: ModelSpec) -> PathBuf {
        self.root.join(spec.file)
    }

    /// The default model's path, as most store tests use it.
    #[cfg(test)]
    fn model_path(&self) -> PathBuf {
        self.path_of(DEFAULT_MODEL)
    }

    #[cfg(test)]
    fn status_available_for(&self, artifact: ArtifactSpec) -> bool {
        self.available_for(ModelSpec {
            artifact,
            ..DEFAULT_MODEL
        })
    }

    /// Cheap status path: skip a full re-hash when the fingerprint matches.
    /// Hashing runs without the store lock so lease/download are not blocked.
    fn available_for(&self, spec: ModelSpec) -> bool {
        self.available_with(spec, |path| validate_artifact(path, spec.artifact).is_ok())
    }

    /// `available_for` with the hash step injected, so tests can act inside
    /// the unlocked hash window.
    fn available_with(&self, spec: ModelSpec, hash: impl FnOnce(&Path) -> bool) -> bool {
        let path = self.path_of(spec);
        let to_hash = {
            let mut inner = self.inner.lock().unwrap();
            match fingerprint(&path) {
                Ok(fp)
                    if inner
                        .verified
                        .get(spec.id)
                        .is_some_and(|verified| verified.matches(&fp, spec.artifact)) =>
                {
                    return true
                }
                Ok(fp) => fp,
                Err(_) => {
                    inner.verified.remove(spec.id);
                    return false;
                }
            }
        };

        let hash_ok = hash(&path);

        let mut inner = self.inner.lock().unwrap();
        match fingerprint(&path) {
            Ok(current) if current == to_hash => {
                if hash_ok {
                    let verified = Verified::new(current, spec.artifact);
                    inner.verified.insert(spec.id, verified);
                } else {
                    inner.verified.remove(spec.id);
                }
            }
            Err(_) => {
                inner.verified.remove(spec.id);
            }
            Ok(_) => {
                // File changed while we hashed; leave cache alone.
            }
        }
        hash_ok
    }

    fn remember_verified(&self, spec: ModelSpec) {
        if let Ok(fp) = fingerprint(&self.path_of(spec)) {
            let verified = Verified::new(fp, spec.artifact);
            self.inner
                .lock()
                .unwrap()
                .verified
                .insert(spec.id, verified);
        }
    }
}

#[cfg(test)]
mod catalog_tests;
#[cfg(test)]
mod fixture;
#[cfg(all(test, unix))]
mod run_cache_tests;
#[cfg(test)]
mod status_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod verify_tests;
