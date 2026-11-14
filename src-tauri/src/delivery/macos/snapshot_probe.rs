//! BUS-232 (A): read-only AX probes behind the `[snapshot]` line. Only
//! roles, settable bits, CFBoolean flags, pids and attribute presence are
//! read; no value is ever converted to text, and nothing is set, focused or
//! selected. Policy and formatting live in `decide::snapshot_diag`.

use std::time::Instant;

use super::ax::*;
use super::host;
use crate::delivery::decide::fallback::{in_web_content, under_grid};
use crate::delivery::decide::snapshot_diag::{
    kind_label, reason_label, scan_children, AppFocus, AttrRead, AxName, NodeFacts, ScanNode,
    Settable, SnapshotDiag, BUDGET_MS, FLAG_ATTRS, PRESENCE_ATTRS,
};
use crate::delivery::types::TargetSnapshotDto;

/// A retained element, released on drop.
struct Node {
    element: AXUIElementRef,
    root_pid: Option<i32>,
}

impl Drop for Node {
    fn drop(&mut self) {
        release(self.element as CFTypeRef);
    }
}

fn role_of(element: AXUIElementRef) -> AxName {
    AxName::new(&copy_string_attr(element, "AXRole").unwrap_or_else(|| "unknown".into()))
}

fn settable_of(element: AXUIElementRef) -> Settable {
    Settable::from_probe(|attr| is_settable(element, attr))
}

impl ScanNode for Node {
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

    fn facts(&self) -> NodeFacts {
        NodeFacts {
            role: role_of(self.element),
            settable: settable_of(self.element),
            focused: copy_bool_attr(self.element, "AXFocused"),
        }
    }
}

/// Presence only: the copied value is released without being read.
fn presence(element: AXUIElementRef, attr: &'static str) -> AttrRead {
    match copy_attr(element, attr) {
        Ok(value) => {
            release(value);
            AttrRead::Present
        }
        Err(code) => AttrRead::Missing(code),
    }
}

fn app_focus(element: AXUIElementRef, pid: Option<i32>) -> AppFocus {
    let Some(pid) = pid else {
        return AppFocus::Unreadable;
    };
    let app = unsafe { AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return AppFocus::Unreadable;
    }
    let focus = copy_attr(app, "AXFocusedUIElement");
    release(app as CFTypeRef);
    match focus {
        Ok(focused) => {
            let same = unsafe { CFEqual(focused, element as CFTypeRef) } != 0;
            release(focused);
            if same {
                AppFocus::Same
            } else {
                AppFocus::Different
            }
        }
        Err(_) => AppFocus::Unreadable,
    }
}

/// Probe the (still retained) completion-time element and print one
/// `[snapshot]` line. The caller decides when (`snapshot_diag::should_log`).
pub fn log_snapshot(element: AXUIElementRef, snap: &TargetSnapshotDto) {
    let started = Instant::now();
    let pid = element_pid(element);
    let ancestors = ancestor_roles(element);
    let role = snap.element_role.as_deref().unwrap_or("unknown");
    let has_dom_id = presence(element, "AXDOMIdentifier") == AttrRead::Present;
    let root = Node {
        element: unsafe { CFRetain(element as CFTypeRef) } as AXUIElementRef,
        root_pid: pid,
    };
    let mut diag = SnapshotDiag {
        bundle_id: pid.and_then(host::bundle_id).map(|b| AxName::new(&b)),
        pid,
        role: AxName::new(role),
        subrole: copy_string_attr(element, "AXSubrole").map(|s| AxName::new(&s)),
        kind: kind_label(&snap.kind),
        reason: reason_label(snap.reason.as_deref()),
        settable: settable_of(element),
        presence: PRESENCE_ATTRS
            .iter()
            .map(|attr| (*attr, presence(element, attr)))
            .collect(),
        flags: FLAG_ATTRS
            .iter()
            .map(|attr| (*attr, copy_bool_attr(element, attr)))
            .collect(),
        in_web_content: in_web_content(role, has_dom_id, &ancestors),
        grid_ancestor: under_grid(&ancestors),
        ancestors: ancestors.iter().map(|r| AxName::new(r)).collect(),
        app_focus: app_focus(element, pid),
        children: Default::default(),
        probe_ms: 0,
    };
    diag.children = scan_children(&root, || started.elapsed().as_millis() >= BUDGET_MS);
    drop(root);
    diag.probe_ms = started.elapsed().as_millis();
    eprintln!("{}", diag.line());
}
