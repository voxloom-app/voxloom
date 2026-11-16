//! BUS-232 (A): one diagnostic `[snapshot]` line when the completion-time
//! target is not insertable (the Copy path, before any native insert). It
//! records what the focused element exposes so Word, PowerPoint, Mail,
//! Numbers and Pages can be designed for from evidence. Diagnostic only: it
//! never changes the snapshot or any delivery decision.
//!
//! Privacy is structural. The line is built only from `AxName` (an AX role,
//! subrole or bundle id, reduced to identifier characters), `&'static str`
//! labels and attribute names, bools and numbers. Nothing here accepts a
//! free-form string, so dictated text, AXValue, AXSelectedText, AXTitle,
//! AXDescription, AXPlaceholderValue, AXHelp or any other content cannot
//! reach it. The macOS probes (`macos/snapshot_probe.rs`) only read roles,
//! settable bits, booleans, pids and attribute presence.

use std::collections::{BTreeMap, VecDeque};

use super::target::classify_role;
use crate::delivery::types::TargetSnapshotDto;

/// Child scan depth below the focused element.
pub const MAX_DEPTH: u8 = 2;
/// Child scan node cap (every visited node counts, other-pid ones too).
pub const MAX_NODES: usize = 64;
/// The probes stop (and say so) once they have taken this long.
pub const BUDGET_MS: u128 = 250;
/// Ancestor roles printed (nearest first).
pub const MAX_ANCESTORS: usize = 8;
/// Distinct child groups printed; the rest are counted.
pub const MAX_CHILD_GROUPS: usize = 16;
const NAME_MAX: usize = 64;

/// Settable bits probed on the focused element and on each scanned child.
pub const SETTABLE_ATTRS: [&str; 4] = [
    "AXValue",
    "AXSelectedText",
    "AXSelectedTextRange",
    "AXSelectedTextMarkerRange",
];

/// Caret/editability attributes probed for presence only: the value is
/// copied, its type is never inspected, and it is released unread.
pub const PRESENCE_ATTRS: &[&str] = &[
    "AXSelectedTextRange",
    "AXSelectedTextRanges",
    "AXInsertionPointLineNumber",
    "AXNumberOfCharacters",
    "AXVisibleCharacterRange",
    "AXSelectedTextMarkerRange",
    "AXEditableAncestor",
    "AXHighestEditableAncestor",
];

/// Boolean flags read as CFBoolean (anything else reads as unknown).
pub const FLAG_ATTRS: &[&str] = &["AXEditable", "AXEnabled", "AXFocused"];

/// An AX role, subrole or bundle identifier. Only identifier characters
/// survive, so an app cannot smuggle prose through a custom role.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct AxName(String);

impl AxName {
    pub fn new(raw: &str) -> Self {
        let ok = !raw.is_empty()
            && raw.len() <= NAME_MAX
            && raw
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
        Self(if ok {
            raw.to_string()
        } else {
            "<invalid>".into()
        })
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// `SETTABLE_ATTRS`, in order.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct Settable {
    pub value: bool,
    pub selected_text: bool,
    pub selected_range: bool,
    pub marker_range: bool,
}

impl Settable {
    pub fn from_probe(mut settable: impl FnMut(&'static str) -> bool) -> Self {
        let [value, text, range, marker] = SETTABLE_ATTRS;
        Self {
            value: settable(value),
            selected_text: settable(text),
            selected_range: settable(range),
            marker_range: settable(marker),
        }
    }

    fn bits(&self) -> String {
        [
            self.value,
            self.selected_text,
            self.selected_range,
            self.marker_range,
        ]
        .iter()
        .map(|&on| if on { '1' } else { '0' })
        .collect()
    }

    fn label(&self) -> String {
        format!(
            "value={} selected_text={} range={} marker={}",
            bit(self.value),
            bit(self.selected_text),
            bit(self.selected_range),
            bit(self.marker_range)
        )
    }
}

/// Whether an attribute could be copied: present, or the AX error code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttrRead {
    Present,
    Missing(i32),
}

/// The app element's own AXFocusedUIElement vs. the system-wide focus.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AppFocus {
    Same,
    Different,
    #[default]
    Unreadable,
}

/// What a scanned child may report: a role, settable bits and AXFocused.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct NodeFacts {
    pub role: AxName,
    pub settable: Settable,
    pub focused: Option<bool>,
}

/// One node of the bounded child scan.
pub trait ScanNode: Sized {
    /// At most `limit` children, in AX order.
    fn children(&self, limit: usize) -> Vec<Self>;
    /// Same pid as the focused element.
    fn same_pid(&self) -> bool;
    fn facts(&self) -> NodeFacts;
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChildScan {
    /// (depth, facts) for every same-pid node visited.
    pub nodes: Vec<(u8, NodeFacts)>,
    pub other_pid: usize,
    /// Stopped at `MAX_NODES` with nodes left over.
    pub truncated: bool,
    /// Stopped at `BUDGET_MS`.
    pub out_of_time: bool,
}

/// Breadth-first over the focused element's children: depth ≤ `MAX_DEPTH`,
/// ≤ `MAX_NODES` nodes, same pid only (other-pid nodes are counted, never
/// described or descended), stopping when `out_of_time` says so.
pub fn scan_children<N: ScanNode>(root: &N, mut out_of_time: impl FnMut() -> bool) -> ChildScan {
    let mut scan = ChildScan::default();
    let mut queue: VecDeque<(N, u8)> = VecDeque::new();
    let mut visited = 0usize;
    if out_of_time() {
        scan.out_of_time = true;
        return scan;
    }
    enqueue(&mut queue, visited, &mut scan, root, 1);
    while let Some((node, depth)) = queue.pop_front() {
        if out_of_time() {
            scan.out_of_time = true;
            break;
        }
        visited += 1;
        if !node.same_pid() {
            scan.other_pid += 1;
            continue;
        }
        scan.nodes.push((depth, node.facts()));
        if depth < MAX_DEPTH {
            enqueue(&mut queue, visited, &mut scan, &node, depth + 1);
        }
    }
    scan
}

/// Queue `parent`'s children within the node cap (asking for one more to
/// notice truncation).
fn enqueue<N: ScanNode>(
    queue: &mut VecDeque<(N, u8)>,
    visited: usize,
    scan: &mut ChildScan,
    parent: &N,
    depth: u8,
) {
    let room = MAX_NODES.saturating_sub(visited + queue.len());
    if room == 0 {
        // Never ask for children once the cap is reached.
        scan.truncated = true;
        return;
    }
    let kids = parent.children(room + 1);
    if kids.len() > room {
        scan.truncated = true;
    }
    queue.extend(kids.into_iter().take(room).map(|kid| (kid, depth)));
}

/// Everything the `[snapshot]` line may contain. No field takes free text.
#[derive(Clone, Debug)]
pub struct SnapshotDiag {
    /// `not-insertable` (the Copy path) or `paste-only` (BUS-232 C).
    pub head: &'static str,
    pub bundle_id: Option<AxName>,
    pub pid: Option<i32>,
    pub role: AxName,
    pub subrole: Option<AxName>,
    pub kind: &'static str,
    pub reason: &'static str,
    pub settable: Settable,
    pub presence: Vec<(&'static str, AttrRead)>,
    pub flags: Vec<(&'static str, Option<bool>)>,
    pub in_web_content: bool,
    pub grid_ancestor: bool,
    /// Nearest first (`ax::ancestor_roles`).
    pub ancestors: Vec<AxName>,
    pub app_focus: AppFocus,
    pub children: ChildScan,
    pub probe_ms: u128,
}

fn bit(on: bool) -> u8 {
    u8::from(on)
}

fn tri(flag: Option<bool>) -> &'static str {
    match flag {
        Some(true) => "1",
        Some(false) => "0",
        None => "?",
    }
}

fn opt_name(name: &Option<AxName>) -> &str {
    name.as_ref().map_or("-", AxName::as_str)
}

impl ChildScan {
    /// `n:<same-pid nodes> other_pid:<n> truncated:<0|1> out_of_time:<0|1>
    /// [d<depth> <role> s<settable bits> f<focused> x<count>; ...]`.
    pub fn label(&self) -> String {
        let mut groups: BTreeMap<(u8, &NodeFacts), usize> = BTreeMap::new();
        for (depth, facts) in &self.nodes {
            *groups.entry((*depth, facts)).or_default() += 1;
        }
        let shown: Vec<String> = groups
            .iter()
            .take(MAX_CHILD_GROUPS)
            .map(|((depth, f), count)| {
                format!(
                    "d{depth} {} s{} f{} x{count}",
                    f.role.as_str(),
                    f.settable.bits(),
                    tri(f.focused)
                )
            })
            .collect();
        let more = groups.len().saturating_sub(MAX_CHILD_GROUPS);
        let more = if more > 0 {
            format!("; +{more} groups")
        } else {
            String::new()
        };
        format!(
            "n:{} other_pid:{} truncated:{} out_of_time:{} [{}{more}]",
            self.nodes.len(),
            self.other_pid,
            bit(self.truncated),
            bit(self.out_of_time),
            shown.join("; ")
        )
    }
}

impl SnapshotDiag {
    pub fn line(&self) -> String {
        let presence: Vec<String> = self
            .presence
            .iter()
            .map(|(name, read)| match read {
                AttrRead::Present => format!("{name}=1"),
                AttrRead::Missing(code) => format!("{name}={code}"),
            })
            .collect();
        let flags: Vec<String> = self
            .flags
            .iter()
            .map(|(name, flag)| format!("{name}={}", tri(*flag)))
            .collect();
        let ancestors: Vec<&str> = self
            .ancestors
            .iter()
            .take(MAX_ANCESTORS)
            .map(AxName::as_str)
            .collect();
        let more = self.ancestors.len().saturating_sub(MAX_ANCESTORS);
        let app_focus = match self.app_focus {
            AppFocus::Same => "same",
            AppFocus::Different => "different",
            AppFocus::Unreadable => "unreadable",
        };
        format!(
            "[snapshot] {} bundle={} pid={} role={} subrole={} kind={} reason={:?} \
             settable=[{}] attrs=[{}] flags=[{}] in_web_content={} grid_ancestor={} \
             ancestors=[{}{}] app_focus={} children={} probe_ms={}",
            self.head,
            opt_name(&self.bundle_id),
            self.pid.map_or_else(|| "-".to_string(), |p| p.to_string()),
            self.role.as_str(),
            opt_name(&self.subrole),
            self.kind,
            self.reason,
            self.settable.label(),
            presence.join(" "),
            flags.join(" "),
            bit(self.in_web_content),
            bit(self.grid_ancestor),
            ancestors.join(","),
            if more > 0 {
                format!(",+{more}")
            } else {
                String::new()
            },
            app_focus,
            self.children.label(),
            self.probe_ms,
        )
    }
}

/// Snapshot kinds as static labels (anything else reads as "other").
pub fn kind_label(kind: &str) -> &'static str {
    [
        "insertable",
        "unsupported",
        "secure",
        "unavailable",
        "closed",
        "changed",
    ]
    .into_iter()
    .find(|k| *k == kind)
    .unwrap_or("other")
}

/// Voxloom's own classification reasons as static labels. Other reasons
/// (which may carry runtime detail) read as "other".
pub fn reason_label(reason: Option<&str>) -> &'static str {
    let Some(reason) = reason else {
        return "-";
    };
    // One role per `classify_role` reason arm ("" hits the unknown arm).
    let mut known = ["AXSecureTextField", "AXWebArea", "AXStaticText", ""]
        .into_iter()
        .filter_map(|role| classify_role(role).2)
        .chain([super::paste_role::GRID_REASON]);
    known.find(|r| *r == reason).unwrap_or("other")
}

/// Log only for the completion snapshot that ends up on the Copy path: an AX
/// element was read, it is not insertable, it is not a secure field, and the
/// paste route (known terminals, Messages) does not take it.
pub fn should_log(snap: &TargetSnapshotDto) -> bool {
    !snap.insertable
        && snap.element_role.is_some()
        && !matches!(snap.kind.as_str(), "insertable" | "unavailable" | "secure")
        && !snap.paste_terminal
}

#[cfg(test)]
#[path = "snapshot_diag_tests.rs"]
mod tests;
