use std::cell::Cell;

use super::*;

/// A fake AX node. `value` stands for field contents the walk must never
/// read or report.
#[derive(Clone, Debug)]
struct Fake {
    role: &'static str,
    subrole: Option<&'static str>,
    pid: i32,
    focused: bool,
    value: &'static str,
    kids: Vec<Fake>,
}

const SECRET: &str = "Dear Sophie, my PIN is 4711";

fn node(role: &'static str, kids: Vec<Fake>) -> Fake {
    Fake {
        role,
        subrole: None,
        pid: 7,
        focused: false,
        value: SECRET,
        kids,
    }
}

fn focused(role: &'static str) -> Fake {
    Fake {
        focused: true,
        ..node(role, vec![])
    }
}

thread_local! {
    static CHILD_CALLS: Cell<usize> = const { Cell::new(0) };
}

impl RefineNode for Fake {
    fn children(&self, limit: usize) -> Vec<Self> {
        CHILD_CALLS.with(|c| c.set(c.get() + 1));
        self.kids.iter().take(limit).cloned().collect()
    }
    fn same_pid(&self) -> bool {
        self.pid == 7
    }
    fn role(&self) -> String {
        let _ = self.value;
        self.role.to_string()
    }
    fn subrole(&self) -> Option<String> {
        self.subrole.map(str::to_string)
    }
    fn focused(&self) -> bool {
        self.focused
    }
}

fn never() -> bool {
    false
}

fn chosen(found: &Refinement<Fake>) -> Option<(&'static str, u8)> {
    found.target.as_ref().map(|(n, d, _)| (n.role, *d))
}

#[test]
fn one_focused_text_child_is_chosen_at_depth_one_or_two() {
    let root = node(
        "AXGroup",
        vec![node("AXImage", vec![]), focused("AXTextArea")],
    );
    let found = refine(&root, never);
    assert_eq!(chosen(&found), Some(("AXTextArea", 1)));
    assert_eq!(found.candidates, 1);

    let root = node(
        "AXScrollArea",
        vec![node("AXGroup", vec![focused("AXTextField")])],
    );
    let found = refine(&root, never);
    assert_eq!(chosen(&found), Some(("AXTextField", 2)));
    assert_eq!(
        found.label(),
        "found:AXTextField d2 candidates:1 nodes:2 truncated:0 out_of_time:0"
    );
}

#[test]
fn a_text_child_below_depth_two_is_not_reached() {
    let root = node(
        "AXGroup",
        vec![node(
            "AXGroup",
            vec![node("AXGroup", vec![focused("AXTextArea")])],
        )],
    );
    let found = refine(&root, never);
    assert!(found.target.is_none());
    assert_eq!(found.nodes, 2);
}

#[test]
fn zero_or_several_candidates_refine_nothing() {
    // Unfocused text children: the selected slide/shape case has no caret.
    let root = node(
        "AXGroup",
        vec![node("AXTextArea", vec![]), node("AXTextField", vec![])],
    );
    assert!(refine(&root, never).target.is_none());
    // A focused non-text child (a selected shape or image) is no candidate.
    let root = node("AXGroup", vec![focused("AXGroup"), focused("AXImage")]);
    let found = refine(&root, never);
    assert!(found.target.is_none());
    assert_eq!(found.candidates, 0);
    // Two focused editors: ambiguous, never pick one.
    let root = node(
        "AXGroup",
        vec![focused("AXTextArea"), focused("AXTextArea")],
    );
    let found = refine(&root, never);
    assert!(found.target.is_none());
    assert_eq!(found.candidates, 2);
    assert!(found.label().starts_with("none candidates:2"));
}

#[test]
fn other_pid_children_are_never_chosen_or_descended() {
    let mut remote = focused("AXTextArea");
    remote.pid = 9;
    let mut remote_group = node("AXGroup", vec![focused("AXTextField")]);
    remote_group.pid = 9;
    let root = node("AXGroup", vec![remote, remote_group]);
    let found = refine(&root, never);
    assert!(found.target.is_none());
    assert_eq!(found.nodes, 2);
}

#[test]
fn grid_nodes_are_never_descended() {
    for grid in ["AXTable", "AXGrid", "AXLayoutArea", "AXOutline", "AXList"] {
        let root = node(
            "AXScrollArea",
            vec![node(grid, vec![focused("AXTextField")])],
        );
        let found = refine(&root, never);
        assert!(found.target.is_none(), "{grid}");
        assert_eq!(found.nodes, 1, "{grid}");
    }
    // A container under a grid never refines (Numbers/Pages/Word tables).
    assert!(!may_refine("AXGroup", &["AXCell", "AXRow", "AXTable"]));
    assert!(may_refine("AXGroup", &["AXScrollArea", "AXWindow"]));
}

#[test]
fn a_focused_secure_child_is_the_target_and_reports_secure() {
    let mut password = focused("AXTextField");
    password.subrole = Some("AXSecureTextField");
    let root = node("AXGroup", vec![password]);
    let found = refine(&root, never);
    let (_, _, role) = found
        .target
        .as_ref()
        .expect("secure child is the real focus");
    assert_eq!(role.as_str(), "AXSecureTextField");
}

#[test]
fn the_walk_is_capped_at_64_nodes() {
    let mut kids: Vec<Fake> = (0..70).map(|_| node("AXStaticText", vec![])).collect();
    kids[66] = focused("AXTextArea");
    let root = node("AXGroup", kids);
    let found = refine(&root, never);
    assert!(found.target.is_none());
    assert!(found.truncated);
    assert_eq!(found.nodes, 64);
}

#[test]
fn the_walk_never_asks_for_children_past_the_cap() {
    let wide: Vec<Fake> = (0..64)
        .map(|_| node("AXGroup", vec![focused("AXTextArea")]))
        .collect();
    CHILD_CALLS.with(|c| c.set(0));
    let found = refine(&node("AXGroup", wide), never);
    // Root asked once; no depth-1 node may ask once the queue fills the cap.
    assert_eq!(CHILD_CALLS.with(Cell::get), 1);
    assert!(found.truncated);
    assert!(found.target.is_none());
}

#[test]
fn the_walk_stops_when_out_of_time() {
    let root = node(
        "AXGroup",
        vec![node("AXGroup", vec![]), focused("AXTextArea")],
    );
    let ticks = Cell::new(0);
    let found = refine(&root, || {
        ticks.set(ticks.get() + 1);
        ticks.get() > 1
    });
    assert!(found.out_of_time);
    assert!(found.target.is_none());
    assert_eq!(found.nodes, 1);
}

#[test]
fn the_label_never_carries_contents() {
    let root = node("AXGroup", vec![focused("AXTextArea")]);
    let label = refine(&root, never).label();
    assert!(
        !label.contains("Sophie") && !label.contains("4711"),
        "{label}"
    );
}
