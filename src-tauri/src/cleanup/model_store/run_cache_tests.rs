//! BUS-229: a run (or prewarm) doesn't re-hash a model whose descriptor
//! matches the last verified hash of that model, and does re-hash once the
//! file changes. Keyed on dev/ino/size/mtime/ctime, so Unix only.

use std::fs;
use std::io::Write;

use sha2::{Digest, Sha256};

use super::catalog::{offered_on, QUALITY_MODEL};
use super::status_tests::{ctime, wait_for_ctime_tick};
use super::*;

fn spec_for(bytes: &[u8]) -> ArtifactSpec {
    ArtifactSpec {
        sha256: Box::leak(format!("{:x}", Sha256::digest(bytes)).into_boxed_str()),
        size: bytes.len() as u64,
    }
}

fn store(name: &str) -> (CleanupModelStore, PathBuf) {
    let root = crate::cleanup::test_support::test_root().join(format!("run-cache-{name}"));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    (
        CleanupModelStore::with_catalog(root.clone(), offered_on("macos")),
        root,
    )
}

/// Verify a fresh lease of the default model, failing the test if it hashes.
fn verify_without_hashing(store: &CleanupModelStore, artifact: ArtifactSpec) -> bool {
    let mut lease = store.lease_artifact(MODEL_ID, artifact).unwrap();
    lease
        .verify_with(|| true, |_, _, _| panic!("cache hit must not re-hash"))
        .unwrap()
}

#[test]
fn a_verified_model_is_not_hashed_again_by_the_next_run() {
    let (store, root) = store("hit");
    let artifact = spec_for(b"GGUFtest");
    fs::write(store.model_path(), b"GGUFtest").unwrap();
    store
        .lease_artifact(MODEL_ID, artifact)
        .unwrap()
        .verify()
        .unwrap();
    assert!(verify_without_hashing(&store, artifact));
    assert!(
        verify_without_hashing(&store, artifact),
        "and the one after"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_status_hash_spares_the_run_one_and_the_reverse() {
    let (store, root) = store("shared");
    let artifact = spec_for(b"GGUFtest");
    fs::write(store.model_path(), b"GGUFtest").unwrap();
    assert!(store.status_available_for(artifact));
    assert!(verify_without_hashing(&store, artifact));
    let spec = ModelSpec {
        artifact,
        ..DEFAULT_MODEL
    };
    assert!(store.available_with(spec, |_| panic!("status re-hashed")));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn an_in_place_rewrite_is_hashed_again_and_rejected() {
    let (store, root) = store("rewrite");
    let artifact = spec_for(b"GGUFtest");
    let path = store.model_path();
    fs::write(&path, b"GGUFtest").unwrap();
    store
        .lease_artifact(MODEL_ID, artifact)
        .unwrap()
        .verify()
        .unwrap();
    let mtime = fs::metadata(&path).unwrap().modified().unwrap();
    wait_for_ctime_tick(&root, ctime(&path));
    {
        // Same inode and size, mtime put back: only ctime moves.
        let mut file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.write_all(b"GGUFevil").unwrap();
        file.set_modified(mtime).unwrap();
    }
    let mut lease = store.lease_artifact(MODEL_ID, artifact).unwrap();
    assert!(lease.verify().unwrap_err().contains("SHA-256 mismatch"));
    assert!(store.inner.lock().unwrap().verified.is_empty());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_replaced_file_is_hashed_again() {
    let (store, root) = store("replace");
    let artifact = spec_for(b"GGUFtest");
    let path = store.model_path();
    fs::write(&path, b"GGUFtest").unwrap();
    store
        .lease_artifact(MODEL_ID, artifact)
        .unwrap()
        .verify()
        .unwrap();
    // A new inode with the same bytes: verified again, by hashing.
    let staged = root.join("staged.gguf");
    fs::write(&staged, b"GGUFtest").unwrap();
    fs::rename(&staged, &path).unwrap();
    let mut hashed = false;
    let mut lease = store.lease_artifact(MODEL_ID, artifact).unwrap();
    let verified = lease.verify_with(
        || true,
        |file, spec, keep_going| {
            hashed = true;
            crate::cleanup::artifact::validate_file_while(file, spec, keep_going)
        },
    );
    assert_eq!((verified, hashed), (Ok(true), true));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn one_models_verdict_never_covers_the_other() {
    let (store, root) = store("per-model");
    let artifact = spec_for(b"GGUFtest");
    fs::write(store.model_path(), b"GGUFtest").unwrap();
    fs::write(store.path_of(QUALITY_MODEL), b"GGUFtest").unwrap();
    store
        .lease_artifact(MODEL_ID, artifact)
        .unwrap()
        .verify()
        .unwrap();
    let mut quality = store.lease_artifact(QUALITY_MODEL.id, artifact).unwrap();
    let mut hashed = false;
    let verified = quality.verify_with(
        || true,
        |file, spec, keep_going| {
            hashed = true;
            crate::cleanup::artifact::validate_file_while(file, spec, keep_going)
        },
    );
    assert_eq!((verified, hashed), (Ok(true), true));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_verdict_against_another_digest_is_not_reused() {
    let (store, root) = store("digest");
    fs::write(store.model_path(), b"GGUFtest").unwrap();
    store
        .lease_artifact(MODEL_ID, spec_for(b"GGUFtest"))
        .unwrap()
        .verify()
        .unwrap();
    let other = ArtifactSpec {
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        size: 8,
    };
    let mut lease = store.lease_artifact(MODEL_ID, other).unwrap();
    assert!(lease.verify().unwrap_err().contains("SHA-256 mismatch"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn an_abandoned_prewarm_hears_stopped_even_on_a_cache_hit() {
    let (store, root) = store("abandoned");
    let artifact = spec_for(b"GGUFtest");
    fs::write(store.model_path(), b"GGUFtest").unwrap();
    store
        .lease_artifact(MODEL_ID, artifact)
        .unwrap()
        .verify()
        .unwrap();
    let mut lease = store.lease_artifact(MODEL_ID, artifact).unwrap();
    assert_eq!(lease.verify_while(|| false), Ok(false));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_write_drops_the_models_verdict() {
    let (store, root) = store("write");
    let artifact = spec_for(b"GGUFtest");
    fs::write(store.model_path(), b"GGUFtest").unwrap();
    store
        .lease_artifact(MODEL_ID, artifact)
        .unwrap()
        .verify()
        .unwrap();
    drop(store.begin_write(DEFAULT_MODEL).unwrap());
    assert!(!store.inner.lock().unwrap().verified.contains_key(MODEL_ID));
    let _ = fs::remove_dir_all(root);
}
