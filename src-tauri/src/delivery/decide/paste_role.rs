//! BUS-223: which focused roles outside the AX insert allowlist are
//! paste-only targets (insertable only through the ⌘V fallback;
//! `choose_insert_path` never AX-writes them). An explicit allowlist that
//! needs caret evidence, never a denylist: a settable AXValue alone also
//! marks sliders, steppers, date pickers and other controls.

use super::target::{classify_role, effective_role};

/// Edit attributes of the focused element.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EditFacts {
    /// AXValue settable.
    pub value: bool,
    /// AXSelectedText settable.
    pub selected_text: bool,
    /// AXSelectedTextRange settable.
    pub selected_range: bool,
    /// AXValue reads as text (`ValueStatus::text`).
    pub text_value: bool,
}

impl EditFacts {
    /// Real caret evidence: the selection itself can be set.
    pub fn caret(&self) -> bool {
        self.selected_text || self.selected_range
    }

    pub fn label(&self) -> String {
        let flag = |on: bool| if on { 1 } else { 0 };
        format!(
            "value={} selected_text={} range={} text={}",
            flag(self.value),
            flag(self.selected_text),
            flag(self.selected_range),
            flag(self.text_value)
        )
    }
}

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
    classify_with(
        role,
        subrole,
        |container| {
            let facts = facts();
            facts.caret() && (container || facts.text_value)
        },
        ancestors,
    )
}

/// BUS-232 (C), only for the gated apps (`container_gate`): one editability
/// signal AND one caret signal (DESIGN.md §1 C). An unknown custom role also
/// needs a text AXValue or a readable range. All other exclusions are
/// `classify_target`'s, in the same order.
pub fn classify_gated_target(
    role: &str,
    subrole: Option<&str>,
    facts: impl FnOnce() -> WideFacts,
    ancestors: impl FnOnce() -> Vec<String>,
) -> (&'static str, bool, Option<&'static str>) {
    classify_with(
        role,
        subrole,
        |container| {
            let facts = facts();
            facts.editable()
                && facts.caret()
                && (container || facts.edit.text_value || facts.range_readable)
        },
        ancestors,
    )
}

/// Shared exclusions. `evidence(is_container)` is asked only for a
/// container or an unknown custom role, before any ancestor walk.
fn classify_with(
    role: &str,
    subrole: Option<&str>,
    evidence: impl FnOnce(bool) -> bool,
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
    if !evidence(PASTE_ONLY_CONTAINERS.contains(&role)) {
        return base;
    }
    if is_grid_selection(role, &ancestors()) {
        return ("unsupported", false, Some(GRID_REASON));
    }
    ("insertable", true, None)
}

/// A container or an unknown/custom role (unreadable included): not
/// AX-insertable, not secure, not a grid, not a never-paste control. Only
/// these take the BUS-232 gate (`container_gate`).
pub fn container_or_custom(role: &str, subrole: Option<&str>) -> bool {
    classify_role(effective_role(role, subrole)).0 == "unsupported"
        && !GRID_ROLES.contains(&role)
        && !NEVER_PASTE_ROLES.contains(&role)
}

/// BUS-232 (C) evidence for the gated apps: `EditFacts` plus presence and
/// settable bits of the WebKit/Office caret attributes. Never contents.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WideFacts {
    pub edit: EditFacts,
    /// AXEditableAncestor present (WebKit/Chromium contenteditable).
    pub editable_ancestor: bool,
    /// AXSelectedTextMarkerRange settable (WebKit text markers).
    pub marker_settable: bool,
    /// AXSelectedTextRange reads as a CFRange.
    pub range_readable: bool,
    /// AXInsertionPointLineNumber reads without error.
    pub insertion_line: bool,
    /// AXSelectedTextMarkerRange reads without error.
    pub marker_readable: bool,
    /// AXNumberOfCharacters reads without error.
    pub char_count: bool,
}

impl WideFacts {
    /// The element accepts text edits.
    pub fn editable(&self) -> bool {
        self.edit.selected_text
            || self.edit.selected_range
            || (self.edit.value && self.edit.text_value)
            || self.editable_ancestor
            || self.marker_settable
    }

    /// A caret or selection is exposed. A read-only web area has one too,
    /// so this never qualifies without `editable`.
    pub fn caret(&self) -> bool {
        self.range_readable || self.insertion_line || self.marker_readable || self.char_count
    }
}

#[cfg(test)]
#[path = "paste_role_tests.rs"]
mod tests;
