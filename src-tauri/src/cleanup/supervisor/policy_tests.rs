//! Portable supervisor policy: no script execution, model download or OS input.
//! The Unix subprocess tests remain in `tests`; these exercise the same native
//! reservation, framing and response rules even where cleanup is unavailable.

use super::*;
use crate::cleanup::protocol::WorkerResponse;
use serde_json::json;

#[test]
fn cancellation_keeps_the_slot_until_the_reservation_owner_settles() {
    let supervisor = WorkerSupervisor::new(PathBuf::new());
    let mut reservation = supervisor.reserve("reserved".into()).unwrap();
    assert!(supervisor.cancel("reserved"));
    supervisor.release("reserved");
    assert!(reservation.cancelled());
    assert!(supervisor.reserve("too-early".into()).is_err());
    let error = reservation
        .run_with_spawn("p".into(), || panic!("cancelled requests cannot spawn"))
        .unwrap_err();
    assert_eq!(error.code, "cancelled");
    drop(reservation);
    assert!(supervisor.reserve("after-settlement".into()).is_ok());
}

#[test]
fn prestart_cancellation_is_consumed_and_release_allows_reuse() {
    let supervisor = WorkerSupervisor::new(PathBuf::new());
    supervisor.cancel("queued");
    assert_eq!(
        supervisor.reserve("queued".into()).err().unwrap().code,
        "cancelled"
    );
    drop(supervisor.reserve("queued".into()).unwrap());
    supervisor.cancel("released");
    supervisor.release("released");
    assert!(supervisor.reserve("released".into()).is_ok());
}

#[test]
fn cancellation_metadata_is_bounded_independently_of_admission() {
    let supervisor = WorkerSupervisor::new(PathBuf::new());
    for i in 0..CANCELLED_REQUEST_LIMIT + 1 {
        supervisor.cancel(&format!("cancel-{i}"));
    }
    assert_eq!(
        supervisor.shared.state.lock().unwrap().cancelled.len(),
        CANCELLED_REQUEST_LIMIT
    );
    drop(supervisor.reserve("cancel-0".into()).unwrap());
    assert_eq!(
        supervisor.reserve("cancel-1".into()).err().unwrap().code,
        "cancelled"
    );
    assert!(supervisor.reserve("fresh".into()).is_ok());
}

#[test]
fn preflight_failure_never_spawns_and_drop_recovers_the_slot() {
    let supervisor = WorkerSupervisor::new(PathBuf::new());
    for (id, prompt, code) in [
        ("oversize", "x".repeat(128 * 1024), "context-overflow"),
        ("missing-worker", "p".into(), "runtime-error"),
    ] {
        let mut reservation = supervisor.reserve(id.into()).unwrap();
        let error = reservation
            .run_with_spawn(prompt, || panic!("preflight failure cannot spawn"))
            .unwrap_err();
        assert_eq!(error.code, code);
        assert!(supervisor.reserve("overlap".into()).is_err());
        drop(reservation);
    }
    assert!(supervisor.reserve("recovered".into()).is_ok());
}

#[test]
fn response_policy_binds_ids_and_bounds_utf8_without_a_worker() {
    let ok = json!({"requestId": "r", "status": "ok", "text": "cleaned"});
    let interpret = |value| {
        let reply: WorkerResponse = serde_json::from_value(value).unwrap();
        response::interpret(reply, "r")
    };
    assert_eq!(interpret(ok.clone()).unwrap(), "cleaned");
    for (field, value) in [
        ("requestId", json!("other")),
        ("status", json!("future")),
        ("text", json!(null)),
        ("errorCode", json!("timeout")),
        ("error", json!("unexpected")),
    ] {
        let mut reply = ok.clone();
        reply[field] = value;
        assert_eq!(
            interpret(reply).unwrap_err().code,
            "runtime-error",
            "{field}"
        );
    }
    let mut reply = ok;
    reply["text"] = json!("é".repeat(16_000));
    assert!(interpret(reply.clone()).is_ok());
    reply["text"] = json!("é".repeat(16_001));
    assert_eq!(interpret(reply).unwrap_err().code, "invalid-output");

    let startup = json!({"requestId": "", "status": "error", "errorCode": "timeout", "error": "bounded diagnostic"});
    assert_eq!(interpret(startup.clone()).unwrap_err().code, "timeout");
    for (field, value) in [
        ("requestId", json!("other")),
        ("errorCode", json!("x".repeat(65))),
        ("error", json!("é".repeat(513))),
        ("text", json!("mixed result")),
    ] {
        let mut reply = startup.clone();
        reply[field] = value;
        assert_eq!(
            interpret(reply).unwrap_err().code,
            "runtime-error",
            "{field}"
        );
    }
}

#[cfg(windows)]
#[test]
fn cleanup_remains_unavailable_without_a_windows_model_handoff() {
    let root = crate::cleanup::test_support::test_root().join("windows-cleanup-unavailable");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("not-a-worker.exe");
    std::fs::write(&path, b"not executable code").unwrap();
    assert!(!WorkerSupervisor::new(path).available());
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
#[ignore = "Windows native fixture follow-up: verified model HANDLE handoff, spawn/timeout/cancel/reap, prewarm and post-spawn attempt identity"]
fn windows_cleanup_process_fixtures() {
    panic!("Requires a Windows worker transport; Unix shebang/fd fixtures cannot prove it");
}
