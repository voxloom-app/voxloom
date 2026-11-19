use super::*;
use crate::delivery::decide::fallback::{
    after_ax_refusal, field_unchanged, may_paste, AxAttempt, PasteFacts,
};
use crate::delivery::decide::report::PasteReport;
use crate::delivery::decide::test_support::target;
use ValueStatus::*;

const SECRET_TEXT: &str = "dictated secret phrase";
const SECRET_FIELD: &str = "confidential field body";

fn restored() -> PasteReport {
    PasteReport {
        clipboard_restored: true,
        restore_skipped_reason: None,
    }
}

/// Journal's body, from the 7aed283 smoke: role=AXTextArea value=no-value
/// settable=[value=1 selected_text=0 range=1].
const JOURNAL: EditFacts = EditFacts {
    value: true,
    selected_text: false,
    selected_range: true,
    text_value: true,
};

fn journal<'a>(before: &'a ValueStatus) -> AxFacts<'a> {
    AxFacts {
        role: "AXTextArea",
        edit: JOURNAL,
        enabled: Some(true),
        before,
        web_host: false,
    }
}

#[test]
fn journals_exact_bits_skip_the_write() {
    assert_eq!(decide_ax_step(&journal(&NoValue)), AxStep::SkipWrite);
    // AXEnabled unreadable (Journal's value is unknown) still skips.
    let unknown_enabled = AxFacts {
        enabled: None,
        ..journal(&NoValue)
    };
    assert_eq!(decide_ax_step(&unknown_enabled), AxStep::SkipWrite);
}

#[test]
fn each_bit_is_load_bearing() {
    let no_value = NoValue;
    let base = journal(&no_value);
    let flip = |f: AxFacts| decide_ax_step(&f);
    let write_cases: Vec<(&str, AxStep)> = vec![
        // A read-only text area: value settable=0 stays on the strict path
        // (Copy when nothing lands), as Excel's formula bar did.
        (
            "value settable=0",
            flip(AxFacts {
                edit: EditFacts {
                    value: false,
                    ..JOURNAL
                },
                ..base
            }),
        ),
        (
            "range settable=0",
            flip(AxFacts {
                edit: EditFacts {
                    selected_range: false,
                    ..JOURNAL
                },
                ..base
            }),
        ),
        (
            "selected_text settable=1",
            flip(AxFacts {
                edit: EditFacts {
                    selected_text: true,
                    ..JOURNAL
                },
                ..base
            }),
        ),
        (
            "AXEnabled=0",
            flip(AxFacts {
                enabled: Some(false),
                ..base
            }),
        ),
        (
            "Chromium/Electron host",
            flip(AxFacts {
                web_host: true,
                ..base
            }),
        ),
    ];
    for (name, got) in write_cases {
        assert_eq!(got, AxStep::Write, "{name}");
    }
}

#[test]
fn only_a_no_value_field_skips() {
    for before in [
        Text(String::new()),
        Text("abc".into()),
        Unreadable(Some(-25205)),
        Unreadable(None),
    ] {
        assert_eq!(
            decide_ax_step(&journal(&before)),
            AxStep::Write,
            "{before:?}"
        );
    }
}

#[test]
fn only_allowlisted_text_roles_skip() {
    for role in ["AXTextArea", "AXTextField", "AXComboBox", "AXSearchField"] {
        let f = AxFacts {
            role,
            ..journal(&NoValue)
        };
        assert_eq!(decide_ax_step(&f), AxStep::SkipWrite, "{role}");
    }
    for role in [
        "AXGroup",
        "AXWebArea",
        "AXScrollArea",
        "AXSplitGroup",
        "AXStaticText",
        "AXButton",
        "AXSlider",
        "AXCell",
        "AXSecureTextField",
        "AXUnknown",
        "unknown",
        "",
    ] {
        let f = AxFacts {
            role,
            ..journal(&NoValue)
        };
        assert_eq!(decide_ax_step(&f), AxStep::Write, "{role}");
    }
}

#[test]
fn the_full_truth_table_skips_in_exactly_the_expected_cases() {
    let befores = [
        NoValue,
        Text(String::new()),
        Text("a".into()),
        Unreadable(Some(-25205)),
        Unreadable(None),
    ];
    let roles = ["AXTextArea", "AXTextField", "AXGroup", "AXWebArea"];
    let (mut skips, mut total) = (0, 0);
    for role in roles {
        for bits in 0..8u8 {
            for before in &befores {
                for enabled in [None, Some(true), Some(false)] {
                    for web_host in [false, true] {
                        let edit = EditFacts {
                            value: bits & 1 != 0,
                            selected_text: bits & 2 != 0,
                            selected_range: bits & 4 != 0,
                            text_value: true,
                        };
                        let got = decide_ax_step(&AxFacts {
                            role,
                            edit,
                            enabled,
                            before,
                            web_host,
                        });
                        total += 1;
                        if got == AxStep::SkipWrite {
                            skips += 1;
                            // Every skip has every bit.
                            assert!(role.starts_with("AXText"), "skip for role #{role}");
                            assert!(edit.value && edit.selected_range && !edit.selected_text);
                            assert!(*before == NoValue && !web_host && enabled != Some(false));
                        }
                    }
                }
            }
        }
    }
    // Two text roles x one bit pattern x no-value x {unknown, enabled} x not web.
    assert_eq!((skips, total), (4, 4 * 8 * 5 * 3 * 2));
}

#[test]
fn a_skipped_write_is_never_attempted_and_a_write_runs_once() {
    let mut diag = DeliveryDiag::default();
    let mut calls = 0;
    let got = run_ax_step(
        AxStep::SkipWrite,
        |_| {
            calls += 1;
            Ok(InsertReport::default())
        },
        &mut diag,
    );
    assert_eq!(calls, 0, "no AX write on a skip");
    assert_eq!(got.unwrap_err(), AX_WRITE_SKIPPED_REASON);
    assert_eq!(diag.ax_write, AX_WRITE_SKIPPED_LABEL);

    let mut diag = DeliveryDiag::default();
    let got = run_ax_step(
        AxStep::Write,
        |_| {
            calls += 1;
            Err("write failed".into())
        },
        &mut diag,
    );
    assert_eq!(calls, 1);
    assert_eq!(got.unwrap_err(), "write failed");
    assert_eq!(diag.ax_write, "");
}

#[test]
fn the_ui_reason_is_the_approved_plain_copy_with_no_ax_vocabulary() {
    // messages.ts `reasonForKind` default for an unsupported target.
    assert_eq!(AX_WRITE_SKIPPED_REASON, "unsupported field");
    for jargon in ["AX", "settable", "AXValue", "skipped", "error", "-25"] {
        assert!(
            !AX_WRITE_SKIPPED_REASON.contains(jargon),
            "reason names {jargon}"
        );
    }
    // The technical label is the log's only.
    assert!(AX_WRITE_SKIPPED_LABEL.contains("selected_text-unsettable"));
    assert!(!AX_WRITE_SKIPPED_REASON.contains("selected_text"));
}

// -- Decision-function level: how many writes and ⌘V per dictation. --

#[derive(Debug, PartialEq, Eq)]
struct Sent {
    writes: usize,
    pastes: usize,
    outcome: &'static str,
}

/// One dictation through the real decision functions, as `macos::insert_text`
/// chains them: `decide_ax_step`, `run_ax_step`, `may_paste`,
/// `after_ax_refusal`. `write_result` is what the AX write would return,
/// `attempt` what it would record.
fn dictate(
    ax: &AxFacts,
    write_result: Result<InsertReport, String>,
    attempt: AxAttempt,
    paste: PasteFacts,
    diag: &mut DeliveryDiag,
) -> (Sent, Result<InsertReport, String>) {
    let mut writes = 0;
    let mut pastes = 0;
    let step = decide_ax_step(ax);
    let attempt = if step == AxStep::SkipWrite {
        AxAttempt::default()
    } else {
        attempt
    };
    let result = run_ax_step(
        step,
        |_| {
            writes += 1;
            write_result
        },
        diag,
    );
    let facts = PasteFacts { attempt, ..paste };
    let ok = target("insertable", Some(42), Some("42:AXTextArea:#1"));
    let got = after_ax_refusal(
        result,
        may_paste(&ok, &facts, "hi"),
        |_| {
            pastes += 1;
            Ok(restored())
        },
        || false,
        diag,
    );
    let outcome = match &got {
        Ok(report) if report.paste.is_some() => "pasted",
        Ok(_) => "written",
        Err(_) => "refused",
    };
    (
        Sent {
            writes,
            pastes,
            outcome,
        },
        got,
    )
}

fn base_paste() -> PasteFacts {
    PasteFacts {
        enabled: true,
        apple_terminal: Some(false),
        field_unchanged: field_unchanged(&NoValue, &NoValue),
        ..Default::default()
    }
}

#[test]
fn journal_pastes_exactly_once_and_writes_nothing() {
    let mut diag = DeliveryDiag::default();
    let (sent, got) = dictate(
        &journal(&NoValue),
        Ok(InsertReport::default()),
        AxAttempt::default(),
        base_paste(),
        &mut diag,
    );
    assert_eq!(
        sent,
        Sent {
            writes: 0,
            pastes: 1,
            outcome: "pasted"
        }
    );
    // No read-back proof for a field that never shows a value: amber.
    assert!(got.unwrap().unverified);
    assert_eq!(diag.fallback, "paste-unverified");
    assert_eq!(diag.ax_write, AX_WRITE_SKIPPED_LABEL);
}

#[test]
fn at_most_one_paste_per_dictation_whatever_the_facts() {
    let befores = [
        NoValue,
        Text(String::new()),
        Text("a".into()),
        Unreadable(Some(-25205)),
        Unreadable(None),
    ];
    let attempts = |n: usize| match n {
        0 => AxAttempt::default(),
        1 => AxAttempt {
            writes: vec![Ok(())],
            ..Default::default()
        },
        2 => AxAttempt {
            writes: vec![Err(-25205)],
            ..Default::default()
        },
        3 => AxAttempt {
            writes: vec![Err(-25204)],
            ..Default::default()
        },
        _ => AxAttempt {
            writes: vec![Ok(()), Ok(())],
            typed: true,
        },
    };
    let results = |n: usize| match n {
        0 => Ok(InsertReport::default()),
        1 => Ok(InsertReport {
            unverified: true,
            ..Default::default()
        }),
        _ => Err("AX refused".to_string()),
    };
    let mut ran = 0;
    for before in &befores {
        for bits in 0..8u8 {
            for web_host in [false, true] {
                for a in 0..5 {
                    for r in 0..3 {
                        for grid in [false, true] {
                            for unchanged in [false, true] {
                                for enabled in [true, false] {
                                    let ax = AxFacts {
                                        edit: EditFacts {
                                            value: bits & 1 != 0,
                                            selected_text: bits & 2 != 0,
                                            selected_range: bits & 4 != 0,
                                            text_value: true,
                                        },
                                        web_host,
                                        ..journal(before)
                                    };
                                    let paste = PasteFacts {
                                        grid_ancestor: grid,
                                        field_unchanged: unchanged,
                                        web_host,
                                        enabled,
                                        ..base_paste()
                                    };
                                    let mut diag = DeliveryDiag::default();
                                    let (sent, _) =
                                        dictate(&ax, results(r), attempts(a), paste, &mut diag);
                                    ran += 1;
                                    assert!(sent.pastes <= 1, "case #{ran}: more than one paste");
                                    assert!(sent.writes <= 1, "case #{ran}: more than one write");
                                    if decide_ax_step(&ax) == AxStep::SkipWrite {
                                        assert_eq!(sent.writes, 0, "case #{ran}: skip wrote");
                                    }
                                    // An Ok write is never pasted over.
                                    if r < 2 && decide_ax_step(&ax) == AxStep::Write {
                                        assert_eq!(sent.pastes, 0, "case #{ran}: wrote and pasted");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    assert_eq!(ran, 5 * 8 * 2 * 5 * 3 * 2 * 2 * 2);
}

#[test]
fn a_skipped_write_hits_every_may_paste_guard() {
    // Same Journal facts; each guard alone turns the one ⌘V into Copy.
    let guards: Vec<(&str, PasteFacts)> = vec![
        (
            "setting off",
            PasteFacts {
                enabled: false,
                ..base_paste()
            },
        ),
        (
            "terminal",
            PasteFacts {
                apple_terminal: Some(true),
                ..base_paste()
            },
        ),
        (
            "unknown terminal state",
            PasteFacts {
                apple_terminal: None,
                ..base_paste()
            },
        ),
        (
            "known terminal",
            PasteFacts {
                known_terminal: true,
                ..base_paste()
            },
        ),
        (
            "grid",
            PasteFacts {
                grid_ancestor: true,
                ..base_paste()
            },
        ),
        (
            "field changed",
            PasteFacts {
                field_unchanged: false,
                ..base_paste()
            },
        ),
        (
            "web host and content",
            PasteFacts {
                web_host: true,
                web_content: true,
                ..base_paste()
            },
        ),
    ];
    for (name, paste) in guards {
        let mut diag = DeliveryDiag::default();
        let (sent, got) = dictate(
            &journal(&NoValue),
            Ok(InsertReport::default()),
            AxAttempt::default(),
            paste,
            &mut diag,
        );
        assert_eq!(sent.pastes, 0, "{name}");
        assert_eq!(sent.writes, 0, "{name}");
        assert_eq!(got.unwrap_err(), AX_WRITE_SKIPPED_REASON, "{name}");
        assert!(diag.fallback.starts_with("skipped("), "{name}");
    }
}

#[test]
fn a_refused_paste_after_a_skip_shows_only_the_plain_reason() {
    let mut diag = DeliveryDiag {
        ax_write: AX_WRITE_SKIPPED_LABEL,
        ..Default::default()
    };
    let got = after_ax_refusal(
        Err(AX_WRITE_SKIPPED_REASON.into()),
        Ok(42),
        |_| Err("Secure Keyboard Entry is on — paste skipped".into()),
        || false,
        &mut diag,
    );
    assert_eq!(got.unwrap_err(), "unsupported field");
    // The technical cause is in the log only.
    assert!(diag.fallback.contains("Secure Keyboard Entry"));
}

#[test]
fn the_skip_label_is_logged_without_text_or_field_contents() {
    let mut diag = DeliveryDiag {
        bundle_id: Some("com.apple.journal".into()),
        role: Some("AXTextArea".into()),
        value: NoValue.label(),
        settable: JOURNAL.label(),
        gate: "ax",
        ax_write: AX_WRITE_SKIPPED_LABEL,
        ..Default::default()
    };
    let _ = after_ax_refusal(
        Err(AX_WRITE_SKIPPED_REASON.into()),
        Ok(7),
        |_| Ok(restored()),
        || false,
        &mut diag,
    );
    let line = diag.line();
    assert!(line.contains("ax_write=skipped(selected_text-unsettable)"));
    assert!(line.contains("value=no-value"));
    // The messages name the check; the line is built from fixtures.
    for (i, secret) in [SECRET_TEXT, SECRET_FIELD].into_iter().enumerate() {
        assert!(!line.contains(secret), "fixture #{i} leaked into the line");
    }
    // Every other line says `ax_write=-`.
    assert!(DeliveryDiag::default().line().contains("ax_write=-"));
}
