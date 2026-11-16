use std::cell::Cell;

use super::*;
use crate::delivery::decide::test_support::target;

const SECRET_VALUE: &str = "Dear Sophie, my PIN is 4711";
const SECRET_TITLE: &str = "Q3 Board Deck - CONFIDENTIAL";
const SECRET_WORD: &str = "hunter2secret";

/// A fake AX node carrying the content the probes must never surface.
#[derive(Clone)]
struct Fake {
    role: &'static str,
    pid: i32,
    value: &'static str,
    title: &'static str,
    settable: Settable,
    focused: Option<bool>,
    kids: Vec<Fake>,
}

fn node(role: &'static str, kids: Vec<Fake>) -> Fake {
    Fake {
        role,
        pid: 7,
        value: SECRET_VALUE,
        title: SECRET_TITLE,
        settable: Settable::default(),
        focused: None,
        kids,
    }
}

thread_local! {
    static CHILD_CALLS: Cell<usize> = const { Cell::new(0) };
}

impl ScanNode for Fake {
    fn children(&self, limit: usize) -> Vec<Self> {
        CHILD_CALLS.with(|c| c.set(c.get() + 1));
        self.kids.iter().take(limit).cloned().collect()
    }
    fn same_pid(&self) -> bool {
        self.pid == 7
    }
    fn facts(&self) -> NodeFacts {
        // Only what the macOS probe reads: role, settable bits, AXFocused.
        let _ = (self.value, self.title);
        NodeFacts {
            role: AxName::new(self.role),
            settable: self.settable,
            focused: self.focused,
        }
    }
}

fn never() -> bool {
    false
}

fn sample(children: ChildScan) -> SnapshotDiag {
    SnapshotDiag {
        head: "not-insertable",
        bundle_id: Some(AxName::new("com.microsoft.Word")),
        pid: Some(4242),
        role: AxName::new("AXGroup"),
        subrole: None,
        kind: kind_label("unsupported"),
        reason: reason_label(Some("generic web/container role — insert unverified")),
        settable: Settable {
            value: true,
            ..Default::default()
        },
        presence: PRESENCE_ATTRS
            .iter()
            .map(|a| (*a, AttrRead::Missing(-25205)))
            .collect(),
        flags: FLAG_ATTRS.iter().map(|a| (*a, Some(true))).collect(),
        in_web_content: false,
        grid_ancestor: false,
        ancestors: vec![AxName::new("AXScrollArea"), AxName::new("AXWindow")],
        app_focus: AppFocus::Same,
        children,
        probe_ms: 12,
    }
}

#[test]
fn values_and_titles_in_the_source_never_reach_the_line() {
    let mut editor = node("AXTextArea", vec![]);
    editor.settable = Settable {
        value: true,
        selected_text: true,
        selected_range: true,
        marker_range: false,
    };
    editor.focused = Some(true);
    let root = node(
        "AXGroup",
        vec![
            node("AXScrollArea", vec![editor, node("AXStaticText", vec![])]),
            // A custom role carrying prose is reduced to <invalid>.
            node("Dear Sophie, my PIN is 4711", vec![]),
            // Identifier-shaped content would pass `AxName`; it still never
            // appears, because no probe reads it.
            Fake {
                value: SECRET_WORD,
                title: SECRET_WORD,
                ..node("AXTextField", vec![])
            },
        ],
    );
    let scan = scan_children(&root, never);
    let mut diag = sample(scan);
    diag.subrole = Some(AxName::new(SECRET_TITLE));
    let line = diag.line();
    assert!(line.starts_with("[snapshot] not-insertable "), "{line}");
    // The failure message names the fixture by index only, so a test
    // failure never echoes fixture text into CI logs (CodeQL
    // rust/cleartext-logging).
    for (i, needle) in [
        SECRET_VALUE,
        SECRET_TITLE,
        SECRET_WORD,
        "PIN",
        "4711",
        "CONFIDENTIAL",
        "Dear",
    ]
    .into_iter()
    .enumerate()
    {
        assert!(!line.contains(needle), "fixture #{i} leaked into the line");
    }
    assert!(line.contains("d2 AXTextArea s1110 f1 x1"), "{line}");
    assert!(line.contains("<invalid>"), "{line}");
}

#[test]
fn ax_names_keep_identifiers_only() {
    for ok in ["AXTextArea", "com.apple.iWork.Pages", "AXWebArea", "x-1_2"] {
        assert_eq!(AxName::new(ok).as_str(), ok);
    }
    for bad in ["", "two words", "a\nb", "quote\"", "é", &"A".repeat(65)] {
        assert_eq!(AxName::new(bad).as_str(), "<invalid>", "{bad:?}");
    }
}

#[test]
fn reasons_and_kinds_are_static_labels_only() {
    assert_eq!(reason_label(None), "-");
    assert_eq!(
        reason_label(Some("unsupported or unknown AX role")),
        "unsupported or unknown AX role"
    );
    assert_eq!(
        reason_label(Some(crate::delivery::decide::paste_role::GRID_REASON)),
        crate::delivery::decide::paste_role::GRID_REASON
    );
    assert_eq!(reason_label(Some(SECRET_VALUE)), "other");
    assert_eq!(
        reason_label(Some("Accessibility focus unavailable at x")),
        "other"
    );
    assert_eq!(kind_label("unsupported"), "unsupported");
    assert_eq!(kind_label(SECRET_VALUE), "other");
}

#[test]
fn scan_is_capped_at_depth_two() {
    let deep = node(
        "AXGroup",
        vec![node(
            "AXGroup",
            vec![node("AXGroup", vec![node("AXTextArea", vec![])])],
        )],
    );
    let scan = scan_children(&deep, never);
    let depths: Vec<u8> = scan.nodes.iter().map(|(d, _)| *d).collect();
    assert_eq!(depths, vec![1, 2]);
    assert!(!scan
        .nodes
        .iter()
        .any(|(_, f)| f.role.as_str() == "AXTextArea"));
    assert!(!scan.truncated);
}

#[test]
fn scan_is_capped_at_64_nodes_and_stops_asking_for_children() {
    let wide = |n: usize| {
        (0..n)
            .map(|_| node("AXGroup", vec![node("AXCell", vec![])]))
            .collect()
    };
    CHILD_CALLS.with(|c| c.set(0));
    let scan = scan_children(&node("AXGroup", wide(200)), never);
    assert_eq!(scan.nodes.len(), MAX_NODES);
    assert!(scan.truncated);
    // Root only: no room is left for any depth-2 node.
    assert_eq!(CHILD_CALLS.with(Cell::get), 1);

    let scan = scan_children(&node("AXGroup", wide(40)), never);
    assert_eq!(scan.nodes.len(), MAX_NODES);
    assert!(scan.truncated);

    let scan = scan_children(&node("AXGroup", wide(32)), never);
    assert_eq!(scan.nodes.len(), 64);
    assert!(!scan.truncated);
}

#[test]
fn other_pid_children_are_counted_never_described_or_descended() {
    let mut foreign = node("AXTextArea", vec![node("AXTextField", vec![])]);
    foreign.pid = 99;
    let scan = scan_children(
        &node("AXGroup", vec![foreign, node("AXGroup", vec![])]),
        never,
    );
    assert_eq!(scan.other_pid, 1);
    assert_eq!(scan.nodes.len(), 1);
    assert_eq!(scan.nodes[0].1.role.as_str(), "AXGroup");
}

#[test]
fn scan_stops_when_out_of_time() {
    let scan = scan_children(&node("AXGroup", vec![node("AXGroup", vec![])]), || true);
    assert!(scan.out_of_time);
    assert!(scan.nodes.is_empty());
    let calls = Cell::new(0);
    let scan = scan_children(
        &node(
            "AXGroup",
            vec![node("AXGroup", vec![]), node("AXGroup", vec![])],
        ),
        || {
            calls.set(calls.get() + 1);
            calls.get() > 2
        },
    );
    assert!(scan.out_of_time);
    assert_eq!(scan.nodes.len(), 1);
}

#[test]
fn child_groups_aggregate_and_cap() {
    let roles: Vec<Fake> = (0..20)
        .map(|i| {
            node(
                [
                    "AXA0", "AXA1", "AXA2", "AXA3", "AXA4", "AXA5", "AXA6", "AXA7", "AXA8", "AXA9",
                    "AXB0", "AXB1", "AXB2", "AXB3", "AXB4", "AXB5", "AXB6", "AXB7", "AXB8", "AXB9",
                ][i],
                vec![],
            )
        })
        .chain((0..3).map(|_| node("AXA0", vec![])))
        .collect();
    let label = scan_children(&node("AXGroup", roles), never).label();
    assert!(
        label.starts_with("n:23 other_pid:0 truncated:0 out_of_time:0 ["),
        "{label}"
    );
    assert!(label.contains("d1 AXA0 s0000 f? x4"), "{label}");
    assert!(label.ends_with("; +4 groups]"), "{label}");
}

#[test]
fn line_has_every_field_and_presence_is_never_a_value() {
    let mut diag = sample(ChildScan::default());
    diag.presence[0].1 = AttrRead::Present;
    diag.ancestors = (0..10).map(|_| AxName::new("AXGroup")).collect();
    let line = diag.line();
    assert!(
        line.starts_with("[snapshot] not-insertable bundle="),
        "{line}"
    );
    diag.head = "paste-only";
    assert!(diag.line().starts_with("[snapshot] paste-only bundle="));
    for field in [
        "bundle=com.microsoft.Word",
        "pid=4242",
        "role=AXGroup",
        "subrole=-",
        "kind=unsupported",
        "reason=\"generic web/container role — insert unverified\"",
        "settable=[value=1 selected_text=0 range=0 marker=0]",
        "AXSelectedTextRange=1",
        "AXInsertionPointLineNumber=-25205",
        "AXNumberOfCharacters=-25205",
        "flags=[AXEditable=1 AXEnabled=1 AXFocused=1]",
        "in_web_content=0",
        "grid_ancestor=0",
        ",+2]",
        "app_focus=same",
        "children=n:0 other_pid:0 truncated:0 out_of_time:0 []",
        "probe_ms=12",
    ] {
        assert!(line.contains(field), "missing {field}: {line}");
    }
}

#[test]
fn logs_only_the_copy_path_snapshot() {
    let mut copy = target("unsupported", Some(7), Some("7:AXGroup:#1"));
    copy.element_role = Some("AXGroup".into());
    assert!(should_log(&copy));
    assert!(!should_log(&target("insertable", Some(7), Some("x"))));
    assert!(!should_log(&target("unavailable", None, None)));
    assert!(!should_log(&target("secure", Some(7), Some("x"))));
    let mut paste_route = copy.clone();
    paste_route.paste_terminal = true;
    assert!(!should_log(&paste_route));
    let mut no_element = copy;
    no_element.element_role = None;
    assert!(!should_log(&no_element));
}
