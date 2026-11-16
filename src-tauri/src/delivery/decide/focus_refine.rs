//! BUS-232 (B), gated apps only (`container_gate`): when focus is a
//! container or an unknown/custom role, look below it for the real editor.
//! A bounded breadth-first walk (depth ≤ `MAX_DEPTH`, ≤ `MAX_NODES` nodes,
//! same pid only, stopping at `BUDGET_MS`) for children with `AXFocused`
//! true whose role is a text role. Exactly one such child becomes the
//! target and takes the normal AX write with strict read-back. Grid nodes
//! are never descended (BUS-230 scope stays Copy).

use std::collections::VecDeque;

use super::paste_role::is_grid_selection;
use super::snapshot_diag::{AxName, MAX_DEPTH, MAX_NODES};
use super::target::{classify_role, effective_role};

/// One node of the walk. Only roles, subroles, AXFocused and pids are read.
pub trait RefineNode: Sized {
    /// At most `limit` children, in AX order.
    fn children(&self, limit: usize) -> Vec<Self>;
    /// Same pid as the focused element.
    fn same_pid(&self) -> bool;
    /// AXRole, or "unknown" when unreadable.
    fn role(&self) -> String;
    fn subrole(&self) -> Option<String>;
    /// AXFocused is true.
    fn focused(&self) -> bool;
}

/// Outcome of one walk. `target` is set only for exactly one candidate in a
/// complete walk (not truncated, not out of time).
#[derive(Debug)]
pub struct Refinement<N> {
    /// The chosen child, its depth and its effective role.
    pub target: Option<(N, u8, AxName)>,
    /// Focused text (or secure) children seen.
    pub candidates: usize,
    /// Nodes visited (other-pid ones too).
    pub nodes: usize,
    /// Stopped at `MAX_NODES` with nodes left over.
    pub truncated: bool,
    /// Stopped at the time budget.
    pub out_of_time: bool,
}

/// Refinement may run: the focused element is not under a grid. (The role
/// gate is `paste_role::container_or_custom`, checked by the caller.)
pub fn may_refine<S: AsRef<str>>(role: &str, ancestors: &[S]) -> bool {
    !is_grid_selection(role, ancestors)
}

/// A focused child counts when its effective role is AX-insertable or
/// secure. A focused password field is the real target too: it then
/// classifies as secure and stays Copy, never a paste into its container.
fn candidate_role<N: RefineNode>(node: &N) -> Option<String> {
    if !node.focused() {
        return None;
    }
    let role = node.role();
    let subrole = node.subrole();
    let effective = effective_role(&role, subrole.as_deref());
    matches!(classify_role(effective).0, "insertable" | "secure").then(|| effective.to_string())
}

pub fn refine<N: RefineNode>(root: &N, mut out_of_time: impl FnMut() -> bool) -> Refinement<N> {
    let mut found = Refinement {
        target: None,
        candidates: 0,
        nodes: 0,
        truncated: false,
        out_of_time: false,
    };
    let mut queue: VecDeque<(N, u8)> = VecDeque::new();
    enqueue(&mut queue, &mut found, root, 1);
    while let Some((node, depth)) = queue.pop_front() {
        if out_of_time() {
            found.out_of_time = true;
            break;
        }
        found.nodes += 1;
        if !node.same_pid() {
            continue;
        }
        if let Some(role) = candidate_role(&node) {
            found.candidates += 1;
            found.target = (found.candidates == 1).then(|| (node, depth, AxName::new(&role)));
            continue;
        }
        let grid = is_grid_selection(&node.role(), &[] as &[&str]);
        if depth < MAX_DEPTH && !grid {
            enqueue(&mut queue, &mut found, &node, depth + 1);
        }
    }
    // An incomplete walk may have missed a second candidate: never choose.
    if found.candidates != 1 || found.truncated || found.out_of_time {
        found.target = None;
    }
    found
}

/// Queue `parent`'s children within the node cap.
fn enqueue<N: RefineNode>(
    queue: &mut VecDeque<(N, u8)>,
    found: &mut Refinement<N>,
    parent: &N,
    depth: u8,
) {
    let room = MAX_NODES.saturating_sub(found.nodes + queue.len());
    if room == 0 {
        found.truncated = true;
        return;
    }
    let kids = parent.children(room + 1);
    if kids.len() > room {
        found.truncated = true;
    }
    queue.extend(kids.into_iter().take(room).map(|kid| (kid, depth)));
}

impl<N> Refinement<N> {
    /// `found:<role> d<depth>` or `none`, then the walk counters. Labels and
    /// numbers only.
    pub fn label(&self) -> String {
        let head = match &self.target {
            Some((_, depth, role)) => format!("found:{} d{depth}", role.as_str()),
            None => "none".to_string(),
        };
        format!(
            "{head} candidates:{} nodes:{} truncated:{} out_of_time:{}",
            self.candidates,
            self.nodes,
            u8::from(self.truncated),
            u8::from(self.out_of_time)
        )
    }
}

#[cfg(test)]
#[path = "focus_refine_tests.rs"]
mod tests;
