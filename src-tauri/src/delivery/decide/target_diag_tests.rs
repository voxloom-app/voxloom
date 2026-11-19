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
    let mut snap = unavailable(FIXTURE);
    snap.element_role = Some(FIXTURE.into());
    let got = line(Stage::Completion, None, &snap, Some(AxName::new(FIXTURE))).unwrap();
    assert!(
        !got.contains("secret") && !got.contains("dictated"),
        "{got}"
    );
    assert!(got.contains("reason=other"), "{got}");
    assert!(
        got.contains("role=<invalid>") && got.contains("bundle=<invalid>"),
        "{got}"
    );
    // Codes are parsed as integers only.
    let sneaky = unavailable(
        "Accessibility focus unavailable (AXFocusedApplication=secret; AXFocusedUIElement=-1x)",
    );
    let got = line(Stage::Completion, None, &sneaky, None).unwrap();
    assert!(
        !got.contains("secret") && !got.contains("ax_codes"),
        "{got}"
    );
}
