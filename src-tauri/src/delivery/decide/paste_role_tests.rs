use super::*;
use crate::delivery::decide::fallback::under_grid;
use crate::delivery::decide::test_support::target;
use crate::delivery::decide::{choose_insert_path, InsertPath};

fn no_walk() -> Vec<String> {
    panic!("ancestors must not be walked")
}

fn no_facts() -> EditFacts {
    panic!("edit facts must not be read")
}

/// Every edit attribute settable and a text value: the strongest evidence.
fn all() -> EditFacts {
    EditFacts {
        value: true,
        selected_text: true,
        selected_range: true,
        text_value: true,
    }
}

#[test]
fn allowlisted_and_secure_roles_classify_as_before() {
    for role in ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"] {
        assert_eq!(
            classify_target(role, None, no_facts, no_walk),
            classify_role(role)
        );
    }
    let secure = classify_target("AXTextField", Some("AXSecureTextField"), all, no_walk);
    assert_eq!(secure.0, "secure");
    assert!(!classify_target("unknown", None, all, no_walk).1);
}

#[test]
fn controls_never_become_paste_targets_even_with_caret_evidence() {
    // Date pickers, steppers, sliders, Finder items, links, menus, ...
    for role in [
        "AXScrollBar",
        "AXIncrementor",
        "AXDisclosureTriangle",
        "AXSplitter",
        "AXColorWell",
        "AXDateField",
        "AXTimeField",
        "AXValueIndicator",
        "AXLevelIndicator",
        "AXRadioGroup",
        "AXTabGroup",
        "AXMenuButton",
        "AXLink",
        "AXSlider",
        "AXPopUpButton",
        "AXCheckBox",
        "AXButton",
        "AXList",
        "AXTable",
        "AXOutline",
        "AXRow",
        "AXCell",
        "AXStaticText",
        "AXImage",
        "AXMenu",
        "AXMenuItem",
        "AXRadioButton",
        "AXWindow",
    ] {
        let (kind, insertable, _) = classify_target(role, None, all, no_walk);
        assert_eq!((kind, insertable), ("unsupported", false), "{role}");
    }
}

#[test]
fn a_settable_value_alone_is_not_caret_evidence() {
    let value_only = || EditFacts {
        value: true,
        text_value: true,
        ..Default::default()
    };
    for role in [
        "AXWebArea",
        "AXGroup",
        "AXScrollArea",
        "AXDocument",
        "AXUnknown",
    ] {
        assert!(
            !classify_target(role, None, value_only, no_walk).1,
            "{role}"
        );
        assert!(
            !classify_target(role, None, EditFacts::default, no_walk).1,
            "{role}"
        );
    }
}

#[test]
fn containers_with_a_caret_become_paste_only_targets() {
    let none: fn() -> Vec<String> = Vec::new;
    for caret in [
        EditFacts {
            selected_range: true,
            ..Default::default()
        },
        EditFacts {
            selected_text: true,
            ..Default::default()
        },
    ] {
        // No text value needed for the four known containers.
        for role in ["AXWebArea", "AXGroup", "AXScrollArea", "AXDocument"] {
            assert_eq!(
                classify_target(role, None, || caret, none),
                ("insertable", true, None),
                "{role}"
            );
            // A paste-only target never takes an AX write.
            let mut snap = target("insertable", Some(1), Some("1:x:#1"));
            snap.element_role = Some(role.into());
            assert!(matches!(
                choose_insert_path(&snap, true),
                InsertPath::Refuse(_)
            ));
        }
    }
}

#[test]
fn unknown_custom_roles_need_a_caret_and_a_text_value() {
    let none: fn() -> Vec<String> = Vec::new;
    let caret_only = || EditFacts {
        selected_range: true,
        value: true,
        ..Default::default()
    };
    for role in ["AXUnknown", "MSOfficeTextCanvas"] {
        assert!(!classify_target(role, None, caret_only, none).1, "{role}");
        assert_eq!(
            classify_target(role, None, all, none),
            ("insertable", true, None),
            "{role}"
        );
    }
}

#[test]
fn a_grid_selection_is_never_a_target_but_a_cell_editor_keeps_the_ax_write() {
    let none: fn() -> Vec<String> = Vec::new;
    for role in [
        "AXTable",
        "AXGrid",
        "AXCell",
        "AXLayoutArea",
        "AXLayoutItem",
    ] {
        let (kind, insertable, reason) = classify_target(role, None, all, none);
        assert_eq!(
            (kind, insertable, reason),
            ("unsupported", false, Some(GRID_REASON))
        );
    }
    let in_grid = || vec!["AXRow".to_string(), "AXTable".into(), "AXWindow".into()];
    assert!(!classify_target("AXGroup", None, all, in_grid).1);
    assert!(!classify_target("AXUnknown", None, all, in_grid).1);
    // Cell in edit mode: the editor is a text role and keeps the verified AX
    // write; its ⌘V fallback is refused by `under_grid` in `may_paste`.
    assert!(!is_grid_selection("AXTextArea", &in_grid()));
    assert!(under_grid(&in_grid()));
    assert_eq!(
        classify_target("AXTextArea", None, no_facts, no_walk),
        ("insertable", true, None)
    );
}

#[test]
fn edit_facts_label_lists_flags_only() {
    assert_eq!(all().label(), "value=1 selected_text=1 range=1 text=1");
    assert_eq!(
        EditFacts::default().label(),
        "value=0 selected_text=0 range=0 text=0"
    );
}

fn wide(f: impl Fn(&mut WideFacts)) -> WideFacts {
    let mut facts = WideFacts::default();
    f(&mut facts);
    facts
}

#[test]
fn bus232_editability_and_caret_signals_are_both_required() {
    let none: fn() -> Vec<String> = Vec::new;
    let editability: [fn(&mut WideFacts); 5] = [
        |f| f.edit.selected_text = true,
        |f| f.edit.selected_range = true,
        |f| {
            f.edit.value = true;
            f.edit.text_value = true;
        },
        |f| f.editable_ancestor = true,
        |f| f.marker_settable = true,
    ];
    let caret: [fn(&mut WideFacts); 4] = [
        |f| f.range_readable = true,
        |f| f.insertion_line = true,
        |f| f.marker_readable = true,
        |f| f.char_count = true,
    ];
    for role in ["AXWebArea", "AXGroup", "AXScrollArea", "AXDocument"] {
        for e in editability {
            assert!(
                !classify_gated_target(role, None, || wide(e), none).1,
                "{role}"
            );
            for c in caret {
                let both = wide(|f| {
                    e(f);
                    c(f);
                });
                assert_eq!(
                    classify_gated_target(role, None, || both, none),
                    ("insertable", true, None),
                    "{role} {both:?}"
                );
            }
        }
        for c in caret {
            // Read-only view: a readable selection, nothing editable.
            assert!(
                !classify_gated_target(role, None, || wide(c), none).1,
                "{role}"
            );
        }
        // A settable AXValue without a text value is no editability signal.
        let value_only = wide(|f| {
            f.edit.value = true;
            f.char_count = true;
        });
        assert!(!classify_gated_target(role, None, || value_only, none).1);
    }
}

#[test]
fn bus232_unknown_custom_roles_also_need_a_text_value_or_a_readable_range() {
    let none: fn() -> Vec<String> = Vec::new;
    let marker = wide(|f| {
        f.marker_settable = true;
        f.insertion_line = true;
    });
    assert!(!classify_gated_target("MSOfficeTextCanvas", None, || marker, none).1);
    let ranged = wide(|f| {
        f.marker_settable = true;
        f.range_readable = true;
    });
    assert!(classify_gated_target("MSOfficeTextCanvas", None, || ranged, none).1);
    let texty = wide(|f| {
        f.edit.value = true;
        f.edit.text_value = true;
        f.insertion_line = true;
    });
    assert!(classify_gated_target("MSOfficeTextCanvas", None, || texty, none).1);
    // An unreadable role never pastes.
    assert!(!classify_gated_target("unknown", None, || ranged, none).1);
}

#[test]
fn bus232_never_and_grid_roles_and_grid_ancestors_win_over_any_evidence() {
    let strongest = || WideFacts {
        edit: all(),
        editable_ancestor: true,
        marker_settable: true,
        range_readable: true,
        insertion_line: true,
        marker_readable: true,
        char_count: true,
    };
    let none: fn() -> Vec<String> = Vec::new;
    for role in [
        "AXButton",
        "AXImage",
        "AXSlider",
        "AXStaticText",
        "AXMenuItem",
    ] {
        assert!(
            !classify_gated_target(role, None, strongest, none).1,
            "{role}"
        );
        assert!(!container_or_custom(role, None), "{role}");
    }
    for role in ["AXTable", "AXCell", "AXLayoutArea", "AXGrid"] {
        assert_eq!(
            classify_gated_target(role, None, strongest, none).2,
            Some(GRID_REASON)
        );
        assert!(!container_or_custom(role, None), "{role}");
    }
    let in_grid = || vec!["AXRow".to_string(), "AXTable".into()];
    assert_eq!(
        classify_gated_target("AXGroup", None, strongest, in_grid).2,
        Some(GRID_REASON)
    );
    assert!(!container_or_custom(
        "AXTextField",
        Some("AXSecureTextField")
    ));
    assert!(!container_or_custom("AXTextArea", None));
    for role in [
        "AXWebArea",
        "AXGroup",
        "AXScrollArea",
        "AXDocument",
        "AXUnknown",
        "unknown",
    ] {
        assert!(container_or_custom(role, None), "{role}");
    }
}
