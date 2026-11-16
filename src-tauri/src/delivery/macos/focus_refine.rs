//! BUS-232 (B): the AX side of the focus refinement walk. Read-only: only
//! roles, subroles, AXFocused and pids are read; nothing is set, focused or
//! selected. Policy lives in `decide::focus_refine`.

use std::time::Instant;

use super::ax::*;
use crate::delivery::decide::focus_refine::{refine, RefineNode, Refinement};
use crate::delivery::decide::snapshot_diag::BUDGET_MS;

/// A retained element, released on drop.
pub(super) struct Node {
    element: AXUIElementRef,
    root_pid: Option<i32>,
}

impl Drop for Node {
    fn drop(&mut self) {
        release(self.element as CFTypeRef);
    }
}

impl Node {
    /// A +1 reference to the element (caller releases).
    pub(super) fn retained(&self) -> AXUIElementRef {
        unsafe { CFRetain(self.element as CFTypeRef) as AXUIElementRef }
    }
}

impl RefineNode for Node {
    fn children(&self, limit: usize) -> Vec<Self> {
        copy_children(self.element, limit)
            .into_iter()
            .map(|element| Node {
                element,
                root_pid: self.root_pid,
            })
            .collect()
    }

    fn same_pid(&self) -> bool {
        self.root_pid.is_some() && element_pid(self.element) == self.root_pid
    }

    fn role(&self) -> String {
        copy_string_attr(self.element, "AXRole").unwrap_or_else(|| "unknown".into())
    }

    fn subrole(&self) -> Option<String> {
        copy_string_attr(self.element, "AXSubrole")
    }

    fn focused(&self) -> bool {
        copy_bool_attr(self.element, "AXFocused") == Some(true)
    }
}

/// Walk below `element` (not consumed) within the snapshot probe budget.
pub(super) fn refine_below(element: AXUIElementRef, pid: Option<i32>) -> (Refinement<Node>, u128) {
    let started = Instant::now();
    let root = Node {
        element: unsafe { CFRetain(element as CFTypeRef) } as AXUIElementRef,
        root_pid: pid,
    };
    let found = refine(&root, || started.elapsed().as_millis() >= BUDGET_MS);
    (found, started.elapsed().as_millis())
}
