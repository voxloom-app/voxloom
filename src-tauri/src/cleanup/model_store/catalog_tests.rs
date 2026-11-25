//! BUS-229: two models side by side; BUS-247: Windows only has the default.

use std::fs;

use super::catalog::{offered_on, QUALITY_MODEL};
use super::*;

fn store(name: &str, os: &str) -> (CleanupModelStore, PathBuf) {
    let root = crate::cleanup::test_support::test_root().join(format!("catalog-{name}"));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    (
        CleanupModelStore::with_catalog(root.clone(), offered_on(os)),
        root,
    )
}

#[test]
fn status_lists_both_models_on_macos_with_the_default_on_top() {
    let (store, root) = store("macos-status", "macos");
    let status = store.status();
    assert_eq!((status.id, status.available), (MODEL_ID, false));
    let ids: Vec<_> = status.models.iter().map(|model| model.id).collect();
    assert_eq!(ids, [MODEL_ID, QUALITY_MODEL.id]);
    assert_eq!(status.models[1].sha256, QUALITY_MODEL.artifact.sha256);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn windows_knows_nothing_of_the_4b() {
    let (store, root) = store("windows", "windows");
    let status = store.status();
    assert_eq!(status.models.len(), 1);
    assert_eq!(status.models[0].id, MODEL_ID);
    fs::write(root.join(QUALITY_MODEL.file), b"GGUFtest").unwrap();
    let unknown = "unknown cleanup model: qwen3-4b-instruct-2507-q4-k-m";
    assert_eq!(store.lease(QUALITY_MODEL.id).unwrap_err(), unknown);
    assert_eq!(store.delete(QUALITY_MODEL.id).unwrap_err(), unknown);
    assert!(store.download(QUALITY_MODEL.id, |_| {}).is_err());
    assert!(root.join(QUALITY_MODEL.file).exists(), "nothing touched it");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn each_model_has_its_own_file_and_lease() {
    let (store, root) = store("leases", "macos");
    fs::write(store.path_of(QUALITY_MODEL), b"GGUFtest").unwrap();
    let lease = store.lease(QUALITY_MODEL.id).unwrap();
    assert_eq!(lease.model_id(), QUALITY_MODEL.id);
    assert_eq!(lease.identity().model_digest, QUALITY_MODEL.artifact.sha256);
    assert!(
        store.lease(MODEL_ID).is_err(),
        "the default isn't installed"
    );
    // The 4B in use blocks a write of the 4B only.
    assert!(store.begin_write(QUALITY_MODEL).is_err());
    assert!(store.begin_write(DEFAULT_MODEL).is_ok());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn descriptor_capacity_spans_both_models() {
    let (store, root) = store("capacity", "macos");
    fs::write(store.model_path(), b"GGUFtest").unwrap();
    fs::write(store.path_of(QUALITY_MODEL), b"GGUFtest").unwrap();
    let _default = store.lease(MODEL_ID).unwrap();
    let _quality = store.lease(QUALITY_MODEL.id).unwrap();
    assert!(store.lease(MODEL_ID).unwrap_err().contains("capacity"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_removes_one_model_and_reports_the_new_status() {
    let (store, root) = store("delete", "macos");
    let bytes = b"GGUFtest";
    fs::write(store.model_path(), bytes).unwrap();
    fs::write(store.path_of(QUALITY_MODEL), bytes).unwrap();
    fs::write(
        crate::model_fetch::partial_path(&store.path_of(QUALITY_MODEL)),
        b"GG",
    )
    .unwrap();
    let status = store.delete(QUALITY_MODEL.id).unwrap();
    assert!(!status.models[1].available);
    assert!(!store.path_of(QUALITY_MODEL).exists());
    assert!(!crate::model_fetch::partial_path(&store.path_of(QUALITY_MODEL)).exists());
    assert_eq!(fs::read(store.model_path()).unwrap(), bytes, "default kept");
    assert!(
        store.delete(QUALITY_MODEL.id).is_ok(),
        "missing is not an error"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_is_refused_while_the_model_is_leased() {
    let (store, root) = store("delete-leased", "macos");
    fs::write(store.path_of(QUALITY_MODEL), b"GGUFtest").unwrap();
    let lease = store.lease(QUALITY_MODEL.id).unwrap();
    assert!(store
        .delete(QUALITY_MODEL.id)
        .unwrap_err()
        .contains("in use"));
    assert!(store.path_of(QUALITY_MODEL).exists());
    drop(lease);
    assert!(store.delete(QUALITY_MODEL.id).is_ok());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn cancel_only_stops_the_named_models_download() {
    let (store, root) = store("cancel", "macos");
    let _guard = store.begin_write(QUALITY_MODEL).unwrap();
    let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    store.inner.lock().unwrap().download = Some(flag.clone());
    assert!(!store.cancel_download(MODEL_ID));
    assert!(!flag.load(std::sync::atomic::Ordering::Acquire));
    assert!(store.cancel_download(QUALITY_MODEL.id));
    assert!(flag.load(std::sync::atomic::Ordering::Acquire));
    let _ = fs::remove_dir_all(root);
}
