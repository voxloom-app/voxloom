use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

fn observation(element: Option<usize>) -> Observation<usize> {
    Observation {
        pid: Some(7),
        process: Some("org.fixture.UnlistedEditor:process-start-1".into()),
        window: Some(11),
        element,
        trusted: true,
        secure_input: false,
        snapshot: super::super::test_support::target("insertable", Some(7), Some("old")),
        terminal: false,
        apple_terminal: false,
    }
}
fn snapshot(targets: &Targets<usize>, obs: &Observation<usize>) -> TargetSnapshotDto {
    targets
        .snapshot(
            "nonce".into(),
            || obs.clone(),
            |o| (o.snapshot.clone(), o.element),
            || {},
            |_| Some(1),
        )
        .unwrap()
}

#[test]
fn missing_ax_focus_gets_paste_without_fabricating_editability() {
    let targets = Targets::new();
    let mut obs = observation(None);
    obs.snapshot = TargetSnapshotDto::unavailable("no AX focus", 1);
    let snap = snapshot(&targets, &obs);
    assert!(!snap.insertable);
    assert_eq!(snap.kind, "unavailable");
    let token = snap
        .shared_paste_token
        .expect("retained window authorizes paste independently of AX");
    let posted = AtomicUsize::new(0);
    targets
        .deliver(
            &Mutex::new(()),
            &token,
            "hello",
            || obs.clone(),
            |pid, terminal, payload, guard| {
                assert_eq!(payload, "hello");
                assert_eq!(pid, 7);
                assert!(!terminal);
                guard()?;
                posted.fetch_add(1, Ordering::SeqCst);
                Ok(PasteReport {
                    clipboard_restored: true,
                    restore_skipped_reason: None,
                })
            },
        )
        .unwrap();
    assert_eq!(posted.load(Ordering::SeqCst), 1);
}

#[test]
fn original_field_drift_during_warmup_never_publishes_a_replacement() {
    let targets = Targets::new();
    let first = observation(Some(1));
    let mut next = first.clone();
    next.element = Some(2);
    let reads = AtomicUsize::new(0);
    let publications = AtomicUsize::new(0);
    let snap = targets
        .snapshot(
            "n".into(),
            || {
                if reads.fetch_add(1, Ordering::SeqCst) == 0 {
                    first.clone()
                } else {
                    next.clone()
                }
            },
            |_| (next.snapshot.clone(), next.element),
            || {},
            |_| {
                publications.fetch_add(1, Ordering::SeqCst);
                Some(2)
            },
        )
        .unwrap();
    assert!(
        !snap.insertable,
        "a later field must not become the AX destination"
    );
    assert!(snap.shared_paste_token.is_none());
    assert_eq!(publications.load(Ordering::SeqCst), 0);
}

#[test]
fn validation_drift_revokes_even_if_focus_returns() {
    let targets = Targets::new();
    let obs = observation(Some(1));
    let token = snapshot(&targets, &obs).shared_paste_token.unwrap();
    let mut other = obs.clone();
    other.window = Some(99);
    assert!(targets.validate(&token, || other).is_err());
    assert!(
        targets.validate(&token, || obs).is_err(),
        "failed validation permanently revokes this token"
    );
}

#[test]
fn stale_initializer_cannot_replace_newer_target_or_legacy_slot() {
    let targets = Targets::new();
    let legacy = AtomicUsize::new(0);
    let old = observation(Some(1));
    let mut newer = old.clone();
    newer.element = Some(2);
    let result = targets.snapshot(
        "old".into(),
        || old.clone(),
        |_| {
            let b = targets
                .snapshot(
                    "new".into(),
                    || newer.clone(),
                    |o| (o.snapshot.clone(), o.element),
                    || {},
                    |e| {
                        legacy.store(*e.unwrap(), Ordering::SeqCst);
                        Some(2)
                    },
                )
                .unwrap();
            assert!(b.shared_paste_token.is_some());
            (old.snapshot.clone(), old.element)
        },
        || {},
        |e| {
            legacy.store(*e.unwrap(), Ordering::SeqCst);
            Some(1)
        },
    );
    assert!(result.is_err(), "an obsolete initializer must not publish");
    assert_eq!(legacy.load(Ordering::SeqCst), 2);
    assert!(targets.validate("2:new", || newer).is_ok());
}

#[test]
fn missing_window_denies_paste_without_disabling_existing_ax_route() {
    let targets = Targets::new();
    let mut obs = observation(Some(1));
    obs.window = None;
    let snap = snapshot(&targets, &obs);
    assert!(snap.shared_paste_token.is_none());
    assert!(
        snap.insertable,
        "paste-window evidence is not a new prerequisite for existing AX"
    );
    assert_eq!(snap.kind, "insertable");
}

#[test]
fn ax_and_paste_share_one_native_claim_even_if_caller_removes_dto_token() {
    let obs = observation(Some(1));
    let targets = Targets::new();
    let token = snapshot(&targets, &obs).shared_paste_token.unwrap();
    targets.claim_legacy(1).unwrap();
    assert!(targets.claim_legacy(1).is_err());
    assert!(targets
        .deliver(
            &Mutex::new(()),
            &token,
            "never",
            || obs.clone(),
            |_, _, _, _| panic!("no alternate transport after AX claim")
        )
        .is_err());
    let targets = Targets::new();
    let token = snapshot(&targets, &obs).shared_paste_token.unwrap();
    targets
        .deliver(
            &Mutex::new(()),
            &token,
            "hi",
            || obs.clone(),
            |_, _, _text, guard| {
                guard()?;
                Ok(PasteReport {
                    clipboard_restored: true,
                    restore_skipped_reason: None,
                })
            },
        )
        .unwrap();
    assert!(
        targets.claim_legacy(1).is_err(),
        "dropping the DTO token cannot re-enable AX after paste"
    );
}

#[test]
fn poisoned_serialization_does_not_claim_prior_cleanup_was_safe() {
    let targets = Targets::new();
    let serial = Mutex::new(());
    let obs = observation(Some(1));
    let token = snapshot(&targets, &obs).shared_paste_token.unwrap();
    let _ = std::panic::catch_unwind(|| {
        let _held = serial.lock().unwrap();
        panic!("injected prior cleanup panic");
    });
    let error = targets
        .deliver(
            &serial,
            &token,
            "text",
            || panic!("no OS read"),
            |_, _, _, _| panic!("no clipboard call"),
        )
        .unwrap_err();
    assert!(
        !error.starts_with(SAFE_REFUSAL),
        "poisoned ownership is unknown, not a safe cleanup promise"
    );
}

#[test]
fn retirement_clears_legacy_guards_even_if_target_registry_was_poisoned() {
    let targets = Targets::new();
    let obs = observation(Some(1));
    let _ = snapshot(&targets, &obs);
    let _ = std::panic::catch_unwind(|| {
        let _held = targets.state.lock().unwrap();
        panic!("injected registry panic");
    });
    let cleared = AtomicUsize::new(0);
    targets.retire(|| {
        cleared.fetch_add(1, Ordering::SeqCst);
    });
    assert_eq!(
        cleared.load(Ordering::SeqCst),
        1,
        "retirement must still revoke actual legacy chunk guards"
    );
}

#[test]
fn destination_and_security_matrix_never_dispatches_drift() {
    let base = observation(Some(1));
    let mut variants = Vec::new();
    let mut changed = base.clone();
    changed.pid = Some(8);
    variants.push(changed);
    let mut changed = base.clone();
    changed.process = Some("same-pid-new-lifetime".into());
    variants.push(changed);
    let mut changed = base.clone();
    changed.window = Some(12);
    variants.push(changed);
    let mut changed = base.clone();
    changed.window = None;
    variants.push(changed);
    let mut changed = base.clone();
    changed.element = Some(2);
    variants.push(changed);
    let mut changed = base.clone();
    changed.element = None;
    variants.push(changed);
    let mut changed = base.clone();
    changed.trusted = false;
    variants.push(changed);
    let mut changed = base.clone();
    changed.secure_input = true;
    variants.push(changed);
    let mut changed = base.clone();
    changed.snapshot.kind = "secure".into();
    variants.push(changed);
    for (case, current) in variants.into_iter().enumerate() {
        let targets = Targets::new();
        let token = snapshot(&targets, &base).shared_paste_token.unwrap();
        let result = targets.deliver(
            &Mutex::new(()),
            &token,
            "text",
            || current.clone(),
            |_, _, _, _| panic!("case {case}: no clipboard call"),
        );
        assert!(result.unwrap_err().starts_with(SAFE_REFUSAL), "case {case}");
    }
}

#[test]
fn missing_required_evidence_and_secure_controls_never_mint_authority() {
    for field in 0..9 {
        let targets = Targets::new();
        let mut obs = observation(None);
        match field {
            0 => obs.window = None,
            1 => obs.process = None,
            2 => obs.pid = None,
            3 => obs.trusted = false,
            4 => obs.secure_input = true,
            5 => obs.snapshot.kind = "secure".into(),
            6 => obs.snapshot.element_role = Some("AXButton".into()),
            7 => obs.snapshot.element_role = Some("AXGrid".into()),
            _ => obs.apple_terminal = true,
        }
        assert!(
            snapshot(&targets, &obs).shared_paste_token.is_none(),
            "case {field}"
        );
    }
}

#[test]
fn unlisted_container_has_independent_capability_and_no_legacy_flags() {
    for name in ["org.fixture.UnlistedEditor", "org.fixture.RenamedEditor"] {
        let targets = Targets::new();
        let mut obs = observation(Some(1));
        obs.process = Some(name.into());
        obs.snapshot.kind = "unsupported".into();
        obs.snapshot.insertable = false;
        obs.snapshot.element_role = Some("AXGroup".into());
        obs.snapshot.paste_terminal = true;
        obs.snapshot.paste_app = Some("forged-legacy".into());
        let snap = snapshot(&targets, &obs);
        assert!(snap.shared_paste_token.is_some());
        assert!(!snap.insertable);
        assert_eq!(snap.kind, "unsupported");
        assert!(!snap.paste_terminal);
        assert!(snap.paste_app.is_none());
    }
}

#[test]
fn later_observable_element_cannot_redirect_an_original_window_only_target() {
    let targets = Targets::new();
    let initial = observation(None);
    let token = snapshot(&targets, &initial).shared_paste_token.unwrap();
    let mut current = initial.clone();
    current.element = Some(999);
    assert!(targets.validate(&token, || current.clone()).is_ok());
    current.window = Some(12);
    assert!(targets.validate(&token, || current).is_err());
}

#[test]
fn consumed_token_cannot_replay_even_when_transaction_refuses() {
    let targets = Targets::new();
    let obs = observation(Some(1));
    let token = snapshot(&targets, &obs).shared_paste_token.unwrap();
    let failure = targets.deliver(
        &Mutex::new(()),
        &token,
        "hi",
        || obs.clone(),
        |_, _, _text, guard| {
            guard()?;
            Err("unknown failure".into())
        },
    );
    assert_eq!(
        failure.unwrap_err(),
        "unknown failure",
        "unknown errors must remain untagged"
    );
    assert!(targets
        .deliver(
            &Mutex::new(()),
            &token,
            "again",
            || obs.clone(),
            |_, _, _, _| panic!("no replay")
        )
        .is_err());
}

#[test]
fn retirement_between_claim_and_post_refuses_but_cleanup_is_independent() {
    let targets = Targets::new();
    let obs = observation(Some(1));
    let token = snapshot(&targets, &obs).shared_paste_token.unwrap();
    let cleanup = AtomicUsize::new(0);
    let result = targets.deliver(
        &Mutex::new(()),
        &token,
        "hi",
        || obs.clone(),
        |_, _, _text, guard| {
            guard()?; // clipboard prepare preflight
            targets.retire(|| {});
            let refused = guard(); // after OS/main-queue wait, before V
            cleanup.fetch_add(1, Ordering::SeqCst); // transaction owns cleanup even after retirement
            refused?;
            panic!("no dispatch after successor arm");
        },
    );
    assert!(result.is_err());
    assert_eq!(cleanup.load(Ordering::SeqCst), 1);
}

#[test]
fn retirement_after_post_does_not_cancel_settlement_or_mislabel_success() {
    let targets = Targets::new();
    let obs = observation(Some(1));
    let token = snapshot(&targets, &obs).shared_paste_token.unwrap();
    let cleanup = AtomicUsize::new(0);
    let report = targets
        .deliver(
            &Mutex::new(()),
            &token,
            "hi",
            || obs.clone(),
            |_, _, _text, guard| {
                guard()?; // dispatch boundary
                targets.retire(|| {});
                cleanup.fetch_add(1, Ordering::SeqCst);
                Ok(PasteReport {
                    clipboard_restored: false,
                    restore_skipped_reason: Some("external Copy".into()),
                })
            },
        )
        .unwrap();
    assert!(!report.clipboard_restored);
    assert_eq!(cleanup.load(Ordering::SeqCst), 1);
    assert!(targets.validate(&token, || obs).is_err());
}

#[test]
fn newer_arm_retires_a_queued_delivery_without_waiting_for_serial_lock() {
    use std::{
        sync::{mpsc, Arc},
        time::Duration,
    };
    let targets = Arc::new(Targets::new());
    let serial = Arc::new(Mutex::new(()));
    let obs = observation(Some(1));
    let token = snapshot(&targets, &obs).shared_paste_token.unwrap();
    let held = serial.lock().unwrap();
    let (ready_tx, ready_rx) = mpsc::channel();
    let queued = {
        let targets = targets.clone();
        let serial = serial.clone();
        std::thread::spawn(move || {
            ready_tx.send(()).unwrap();
            targets.deliver(
                &serial,
                &token,
                "old",
                || obs.clone(),
                |_, _, _, _| panic!("retired queued delivery must not touch clipboard"),
            )
        })
    };
    ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let (retired_tx, retired_rx) = mpsc::channel();
    let retire = {
        let targets = targets.clone();
        std::thread::spawn(move || {
            targets.retire(|| {});
            retired_tx.send(()).unwrap();
        })
    };
    retired_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("retirement must not wait for settlement lock");
    drop(held);
    retire.join().unwrap();
    assert!(queued.join().unwrap().is_err());
}
