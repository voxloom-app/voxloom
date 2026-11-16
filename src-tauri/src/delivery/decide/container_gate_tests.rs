use super::*;

/// `paste_role`'s classification exactly as at #184 head b422add
/// (b422addb0971c42a635058c33cacaf687666009a), copied verbatim and frozen:
/// non-gated apps must keep this decision. Only the imports are new
/// (`EditFacts`, `classify_role` and `effective_role` are unchanged since
/// b422add).
#[allow(dead_code)]
mod b422add_oracle {
    use crate::delivery::decide::paste_role::EditFacts;
    use crate::delivery::decide::target::{classify_role, effective_role};

    /// Containers that hold a document's caret (Word/Pages body, WebKit
    /// compose, web editors): paste-only with caret evidence.
    const PASTE_ONLY_CONTAINERS: &[&str] = &["AXWebArea", "AXGroup", "AXScrollArea", "AXDocument"];

    /// Spreadsheet grids and tables: a ⌘V into a selected cell (not in edit
    /// mode) replaces it, so these stay Copy.
    const GRID_ROLES: &[&str] = &[
        "AXTable",
        "AXGrid",
        "AXCell",
        "AXLayoutArea",
        "AXLayoutItem",
        "AXOutline",
        "AXRow",
        "AXColumn",
        "AXList",
        "AXBrowser",
    ];

    /// Standard roles never edited by pasting, whatever they report settable.
    /// Any role not listed here, in `GRID_ROLES` or in `PASTE_ONLY_CONTAINERS`
    /// is an unknown custom role.
    const NEVER_PASTE_ROLES: &[&str] = &[
        // Code review list (CR round 1).
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
        // Other standard non-text roles.
        "AXStaticText",
        "AXImage",
        "AXToolbar",
        "AXMenu",
        "AXMenuBar",
        "AXMenuBarItem",
        "AXMenuItem",
        "AXRadioButton",
        "AXProgressIndicator",
        "AXBusyIndicator",
        "AXRelevanceIndicator",
        "AXHandle",
        "AXRuler",
        "AXRulerMarker",
        "AXGrowArea",
        "AXMatte",
        "AXHelpTag",
        "AXDockItem",
        "AXHeading",
        "AXPopover",
        "AXSplitGroup",
        "AXSheet",
        "AXDrawer",
        "AXWindow",
        "AXApplication",
        "AXSystemWide",
    ];

    /// A grid/table selection without editable text focus. A cell editor in
    /// edit mode is an allowlisted text role and stays an AX target, even inside
    /// a grid; `may_paste` still refuses its ⌘V (`fallback::under_grid`).
    pub fn is_grid_selection<S: AsRef<str>>(role: &str, ancestors: &[S]) -> bool {
        if GRID_ROLES.contains(&role) {
            return true;
        }
        classify_role(role).0 != "insertable"
            && ancestors.iter().any(|r| GRID_ROLES.contains(&r.as_ref()))
    }

    pub const GRID_REASON: &str =
        "spreadsheet grid or table selection (no cell in edit mode) — insert skipped";

    /// `classify_role`, plus paste-only targets: one of `PASTE_ONLY_CONTAINERS`
    /// with caret evidence, or an unknown custom role with caret evidence and a
    /// text AXValue; never under a grid. `facts` and `ancestors` are only read
    /// for such roles.
    pub fn classify_target(
        role: &str,
        subrole: Option<&str>,
        facts: impl FnOnce() -> EditFacts,
        ancestors: impl FnOnce() -> Vec<String>,
    ) -> (&'static str, bool, Option<&'static str>) {
        let base = classify_role(effective_role(role, subrole));
        // "unknown": the AXRole itself could not be read (`build_snapshot`).
        if base.0 != "unsupported" || role == "unknown" {
            return base;
        }
        if GRID_ROLES.contains(&role) {
            return ("unsupported", false, Some(GRID_REASON));
        }
        if NEVER_PASTE_ROLES.contains(&role) {
            return base;
        }
        let facts = facts();
        if !facts.caret() {
            return base;
        }
        if !PASTE_ONLY_CONTAINERS.contains(&role) && !facts.text_value {
            return base;
        }
        if is_grid_selection(role, &ancestors()) {
            return ("unsupported", false, Some(GRID_REASON));
        }
        ("insertable", true, None)
    }
}

const CONTAINERS: [&str; 4] = ["AXWebArea", "AXGroup", "AXScrollArea", "AXDocument"];
const CUSTOM: [&str; 3] = ["AXUnknown", "MSOfficeTextCanvas", "unknown"];

fn no_bundle() -> Option<String> {
    panic!("the bundle id must not be looked up")
}

fn no_wide() -> WideFacts {
    panic!("BUS-232 evidence must not be read")
}

fn no_refine() -> Option<&'static str> {
    panic!("refinement must not run")
}

fn bundle(id: &'static str) -> impl FnOnce() -> Option<String> {
    move || Some(id.to_string())
}

/// Every EditFacts combination (16).
fn all_edit_facts() -> Vec<EditFacts> {
    (0..16u8)
        .map(|bits| EditFacts {
            value: bits & 1 != 0,
            selected_text: bits & 2 != 0,
            selected_range: bits & 4 != 0,
            text_value: bits & 8 != 0,
        })
        .collect()
}

fn ancestor_sets() -> Vec<Vec<String>> {
    vec![
        vec![],
        vec!["AXScrollArea".into(), "AXWindow".into()],
        vec!["AXRow".into(), "AXTable".into(), "AXWindow".into()],
        vec!["AXWebArea".into()],
    ]
}

/// Other apps, Keynote, lookalikes, case variants and whitespace.
const NOT_GATED: [&str; 22] = [
    "com.microsoft.Excel",
    "com.microsoft.Outlook",
    "com.microsoft.onenote.mac",
    "com.apple.Keynote",
    "com.apple.iWork.Keynote",
    "com.apple.TextEdit",
    "com.apple.Notes",
    "com.brave.Browser",
    "com.microsoft",
    "com.microsoft.Word.extra",
    "com.microsoft.word",
    "com.microsoft.PowerPoint.extra",
    "com.apple.pages",
    "com.apple.numbers",
    "com.apple.Mail",
    "com.apple.iwork.pages",
    "com.apple.iWork",
    " com.apple.mail",
    "com.apple.mail ",
    "com.apple.Pages\n",
    "com.apple.Numbers.helper",
    "",
];

#[test]
fn only_the_seven_exact_bundle_ids_are_gated() {
    assert_eq!(GATED_BUNDLES.len(), 7);
    for id in GATED_BUNDLES {
        assert!(gated(Some(id)), "{id}");
    }
    for id in NOT_GATED {
        assert!(!gated(Some(id)), "{id:?}");
    }
    assert!(!gated(None));
}

#[test]
fn non_gated_bundles_get_the_unchanged_decision_for_container_and_unknown_roles() {
    for id in NOT_GATED {
        for role in CONTAINERS.iter().chain(CUSTOM.iter()) {
            for facts in all_edit_facts() {
                for ancestors in ancestor_sets() {
                    let before =
                        b422add_oracle::classify_target(role, None, || facts, || ancestors.clone());
                    let got = decide(
                        role,
                        None,
                        bundle(id),
                        || facts,
                        no_wide,
                        || ancestors.clone(),
                        no_refine,
                    );
                    assert_eq!(got.class, before, "{id} {role} {facts:?} {ancestors:?}");
                    assert_eq!(got.path, Some(Path::Old));
                    assert_eq!(got.bundle.as_deref(), Some(id));
                    assert!(got.refined.is_none());
                }
            }
        }
    }
    // No bundle id at all (pid unreadable) is not gated either.
    let got = decide(
        "AXGroup",
        None,
        || None,
        EditFacts::default,
        no_wide,
        Vec::new,
        no_refine,
    );
    assert_eq!(got.path, Some(Path::Old));
}

#[test]
fn roles_outside_the_gate_never_look_up_the_bundle_and_classify_as_before() {
    for role in [
        "AXTextField",
        "AXTextArea",
        "AXComboBox",
        "AXSearchField",
        "AXSecureTextField",
        "AXTable",
        "AXCell",
        "AXLayoutArea",
        "AXButton",
        "AXImage",
        "AXStaticText",
    ] {
        for facts in all_edit_facts() {
            let before = b422add_oracle::classify_target(role, None, || facts, Vec::new);
            let got = decide(
                role,
                None,
                no_bundle,
                || facts,
                no_wide,
                Vec::new,
                no_refine,
            );
            assert_eq!(got.class, before, "{role}");
            assert_eq!(got.path, None, "{role}");
        }
    }
    let secure = decide(
        "AXTextField",
        Some("AXSecureTextField"),
        no_bundle,
        EditFacts::default,
        no_wide,
        Vec::new,
        no_refine,
    );
    assert_eq!((secure.class.0, secure.path), ("secure", None));
}

#[test]
fn gated_apps_try_refinement_first() {
    for id in GATED_BUNDLES {
        for role in CONTAINERS.iter().chain(CUSTOM.iter()) {
            let got = decide(
                role,
                None,
                bundle(id),
                EditFacts::default,
                no_wide,
                Vec::new,
                || Some("child"),
            );
            assert_eq!(got.path, Some(Path::Refine), "{id} {role}");
            assert_eq!(got.refined, Some("child"));
        }
    }
}

#[test]
fn gated_apps_never_refine_under_a_grid() {
    let in_grid = || vec!["AXCell".to_string(), "AXRow".into(), "AXTable".into()];
    let wide = || WideFacts {
        edit: EditFacts {
            selected_range: true,
            ..Default::default()
        },
        range_readable: true,
        ..Default::default()
    };
    let got = decide(
        "AXGroup",
        None,
        bundle("com.apple.iWork.Numbers"),
        EditFacts::default,
        wide,
        in_grid,
        no_refine,
    );
    assert_eq!(got.path, Some(Path::Copy));
    assert_eq!(
        got.class.2,
        Some(crate::delivery::decide::paste_role::GRID_REASON)
    );
}

#[test]
fn gated_apps_paste_only_with_editability_and_caret_otherwise_copy() {
    let editable_caret = || WideFacts {
        editable_ancestor: true,
        insertion_line: true,
        ..Default::default()
    };
    let caret_only = || WideFacts {
        range_readable: true,
        char_count: true,
        ..Default::default()
    };
    for role in CONTAINERS {
        let got = decide(
            role,
            None,
            bundle("com.apple.mail"),
            EditFacts::default,
            editable_caret,
            Vec::new,
            || None::<()>,
        );
        assert_eq!(
            (got.path, got.class),
            (Some(Path::Paste), ("insertable", true, None))
        );
        // A selected slide/shape (readable selection, nothing editable) stays Copy.
        let got = decide(
            role,
            None,
            bundle("com.microsoft.Powerpoint"),
            EditFacts::default,
            caret_only,
            Vec::new,
            || None::<()>,
        );
        assert_eq!(got.path, Some(Path::Copy), "{role}");
        assert!(!got.class.1);
    }
    // An unreadable role never pastes, whatever it reports.
    let got = decide(
        "unknown",
        None,
        bundle("com.microsoft.Word"),
        EditFacts::default,
        editable_caret,
        Vec::new,
        || None::<()>,
    );
    assert_eq!(got.path, Some(Path::Copy));
}

#[test]
fn the_gate_line_has_a_fixed_format_and_labels_only() {
    let mut line = GateLine::new(Path::Refine, true, true, "insertable");
    line.bundle = Some(AxName::new("com.microsoft.Word"));
    line.pid = Some(4242);
    line.role = AxName::new("AXScrollArea");
    line.refine = Some("found:AXTextArea d2 candidates:1 nodes:9 truncated:0 out_of_time:0".into());
    line.refine_ms = 3;
    assert_eq!(
        line.line(),
        "[bus232] path=refine gated=true at=completion bundle=com.microsoft.Word pid=4242 \
         role=AXScrollArea subrole=- kind=insertable \
         refine=[found:AXTextArea d2 candidates:1 nodes:9 truncated:0 out_of_time:0] refine_ms=3"
    );
    let old = GateLine::new(Path::Old, false, false, "some runtime reason text");
    assert_eq!(
        old.line(),
        "[bus232] path=old gated=false at=recheck bundle=- pid=- role=unknown subrole=- \
         kind=other refine=[-] refine_ms=0"
    );
    // Free text in a role or bundle cannot reach the line.
    let mut sneaky = GateLine::new(Path::Copy, true, true, "unsupported");
    sneaky.role = AxName::new("Dear Sophie, my PIN is 4711");
    sneaky.bundle = Some(AxName::new("my secret text"));
    let text = sneaky.line();
    assert!(
        !text.contains("Sophie") && !text.contains("secret"),
        "{text}"
    );
}
