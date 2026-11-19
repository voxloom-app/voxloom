use super::*;
use crate::delivery::decide::test_support::target;

const FIXTURE: &str = "dictated secret phrase";

fn unavailable(reason: &str) -> TargetSnapshotDto {
    TargetSnapshotDto {
        element_role: None,
        reason: Some(reason.into()),
        ..target("unavailable", None, None)
    }
}

#[test]
fn an_unavailable_completion_snapshot_is_logged_with_its_ax_codes() {
    let snap = unavailable(
        "Accessibility focus unavailable at transcription completion \
         (AX trusted=yes; AXFocusedApplication=0; AXFocusedUIElement=-25204)",
    );
    let line = line(
        Stage::Completion,
        None,
        &snap,
        Some(AxName::new("net.oldj.switchhosts")),
    );
    assert_eq!(
        line.as_deref(),
        Some(
            "[snapshot] unavailable at=completion reason=focus-unavailable \
             ax_codes=app:0,focus:-25204 pid=- role=- bundle=net.oldj.switchhosts"
        )
    );
}

#[test]
fn a_validation_that_changed_the_target_says_what_differed() {
    let intended = target("insertable", Some(7), Some("7:AXTextArea:#3"));
    for (reason, same_element, label) in [
        ("target changed (different field)", false, "different-field"),
        ("target changed (different app)", false, "different-app"),
        (
            "target identity unavailable — insert skipped",
            true,
            "identity-unavailable",
        ),
    ] {
        let current = TargetSnapshotDto {
            reason: Some(reason.into()),
            kind: "changed".into(),
            insertable: false,
            element_id: Some(
                if same_element {
                    "7:AXTextArea:#3"
                } else {
                    "7:AXTextArea:#4"
                }
                .into(),
            ),
            ..target("changed", Some(7), None)
        };
        let got = line(Stage::Validation, Some(&intended), &current, None).unwrap();
        assert!(
            got.starts_with("[snapshot] changed at=validation "),
            "{got}"
        );
        assert!(got.contains(&format!("reason={label}")), "{got}");
        assert!(got.contains("intended_pid=7"), "{got}");
        assert!(got.contains("same_pid=1 same_role=1"), "{got}");
        assert!(
            got.contains(&format!("same_element={}", u8::from(same_element))),
            "{got}"
        );
    }
}

#[test]
fn only_a_silent_copy_cause_is_logged() {
    let ok = target("insertable", Some(7), Some("7:AXTextArea:#3"));
    // Insertable, secure, unsupported (the completion `[snapshot]` line
    // covers it) and an already-uninsertable intended target: no line.
    for kind in ["insertable", "secure", "unsupported", "closed"] {
        let current = target(kind, Some(7), Some("x"));
        assert_eq!(
            line(Stage::Completion, None, &current, None),
            None,
            "{kind}"
        );
        assert_eq!(
            line(Stage::Validation, Some(&ok), &current, None),
            None,
            "{kind}"
        );
    }
    let intended = target("unsupported", Some(7), None);
    let current = unavailable("Accessibility focus unavailable at delivery validation");
    assert_eq!(
        line(Stage::Validation, Some(&intended), &current, None),
        None
    );
}

#[test]
fn reasons_and_roles_never_carry_text_into_the_line() {
    // Assertion messages never print the line: it is built from the hostile
    // fixture, so the message names the check instead.
    let mut snap = unavailable(FIXTURE);
    snap.element_role = Some(FIXTURE.into());
    let got = line(Stage::Completion, None, &snap, Some(AxName::new(FIXTURE))).unwrap();
    assert!(!got.contains("secret"), "check 1: no fixture word leaked");
    assert!(!got.contains("dictated"), "check 2: no fixture word leaked");
    assert!(got.contains("reason=other"), "check 3: unknown reason");
    assert!(got.contains("role=<invalid>"), "check 4: role reduced");
    assert!(got.contains("bundle=<invalid>"), "check 5: bundle reduced");
    // Codes are parsed as integers only.
    let sneaky = unavailable(
        "Accessibility focus unavailable (AXFocusedApplication=secret; AXFocusedUIElement=-1x)",
    );
    let got = line(Stage::Completion, None, &sneaky, None).unwrap();
    assert!(!got.contains("secret"), "check 6: no code text leaked");
    assert!(!got.contains("ax_codes"), "check 7: no partial codes");
}

#[test]
fn every_copy_cause_the_code_produces_has_a_label() {
    use crate::delivery::decide::target::validate_snapshots;
    // The real producers: validate_snapshots' three reasons.
    let intended = target("insertable", Some(7), Some("7:AXTextArea:#3"));
    let other_app = target("insertable", Some(8), Some("8:AXTextArea:#1"));
    let other_field = target("insertable", Some(7), Some("7:AXTextArea:#4"));
    let no_pid = target("insertable", None, Some("-1:AXTextArea:#1"));
    for (current, label) in [
        (other_app, "different-app"),
        (other_field, "different-field"),
        (no_pid, "identity-unavailable"),
    ] {
        let got = validate_snapshots(&intended, current);
        assert_eq!(copy_cause_label(got.reason.as_deref()), label);
    }
    // The macOS producers build `{CONSTANT} at {stage} ...`.
    for (constant, label) in [
        (REASON_FOCUS_UNAVAILABLE, "focus-unavailable"),
        (REASON_PERMISSION_DENIED, "no-permission"),
    ] {
        let reason = format!("{constant} at delivery validation (detail)");
        assert_eq!(copy_cause_label(Some(&reason)), label);
    }
    assert_eq!(COPY_CAUSES.len(), 5, "a new cause needs a producer check");
}

#[test]
fn copy_cause_prefixes_and_classification_reasons_never_overlap() {
    use crate::delivery::decide::paste_role::GRID_REASON;
    use crate::delivery::decide::snapshot_diag::reason_label;
    use crate::delivery::decide::target::classify_role;
    // Neither label function claims the other's reasons, so a reason text
    // edit in one family cannot silently relabel the other.
    for (prefix, _) in COPY_CAUSES {
        assert_eq!(reason_label(Some(prefix)), "other", "{prefix}");
    }
    let classification = ["AXSecureTextField", "AXWebArea", "AXStaticText", ""]
        .into_iter()
        .filter_map(|role| classify_role(role).2)
        .chain([GRID_REASON]);
    for reason in classification {
        assert_eq!(copy_cause_label(Some(reason)), "other");
    }
}

#[test]
fn the_reason_prefixes_are_pinned_to_the_texts_smoke_logs_and_docs_quote() {
    assert_eq!(REASON_FOCUS_UNAVAILABLE, "Accessibility focus unavailable");
    assert_eq!(REASON_PERMISSION_DENIED, "Accessibility permission denied");
    assert_eq!(
        REASON_IDENTITY_UNAVAILABLE,
        "target identity unavailable — insert skipped"
    );
    assert_eq!(REASON_DIFFERENT_APP, "target changed (different app)");
    assert_eq!(REASON_DIFFERENT_FIELD, "target changed (different field)");
}
