//! Focused-element lookup, snapshots and on-demand web AX enablement.

use std::time::{SystemTime, UNIX_EPOCH};

use super::ax::*;
use super::focus_refine::refine_below;
use super::{host, registry, snapshot_probe, web_ax};
use crate::delivery::decide::container_gate::{decide, Class, GateLine, Path};
use crate::delivery::decide::element_token;
use crate::delivery::decide::focus_settle::{
    needs_settle, settle, settle_target, Observation, Outcome,
};
use crate::delivery::decide::known_terminal::flag_terminal;
use crate::delivery::decide::paste_role::{EditFacts, WideFacts};
use crate::delivery::decide::snapshot_diag::{self, AxName};
use crate::delivery::decide::target::{REASON_FOCUS_UNAVAILABLE, REASON_PERMISSION_DENIED};
use crate::delivery::decide::target_diag::{self, Stage};
use crate::delivery::types::TargetSnapshotDto;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn focus_unavailable_reason(
    stage: &str,
    app_err: AXError,
    focus_err: AXError,
    null: bool,
) -> String {
    let null_suffix = if null { " (null)" } else { "" };
    format!(
        "{REASON_FOCUS_UNAVAILABLE} at {stage} (AX trusted=yes; \
         AXFocusedApplication={app_err}; AXFocusedUIElement={focus_err}{null_suffix})"
    )
}

fn copy_focus(system: AXUIElementRef) -> (AXError, CFTypeRef) {
    let name = cfstr("AXFocusedUIElement");
    let mut focused: CFTypeRef = std::ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(system, name, &mut focused) };
    release(name);
    (err, focused)
}

/// Focused element (caller releases) and app name.
pub(super) fn focused_ui_element_once(
    stage: &str,
) -> Result<(AXUIElementRef, Option<String>), String> {
    let system = system_wide();
    if system.is_null() {
        return Err(format!(
            "{REASON_FOCUS_UNAVAILABLE} at {stage} (AX trusted=yes; system element null)"
        ));
    }
    let app = copy_attr(system, "AXFocusedApplication");
    let app_err = app.err().unwrap_or(AX_OK);
    let app_name = app
        .ok()
        .and_then(|a| copy_string_attr(a as AXUIElementRef, "AXTitle"));
    let (focus_err, focused) = copy_focus(system);
    if let Ok(app) = app {
        release(app);
    }
    release(system as CFTypeRef);
    if focus_err != AX_OK || focused.is_null() {
        let reason = focus_unavailable_reason(stage, app_err, focus_err, focused.is_null());
        release(focused);
        return Err(reason);
    }
    Ok((focused as AXUIElementRef, app_name))
}

/// Validation and per-chunk insertion guards never wait for web AX; only the
/// completion snapshot (`snapshot_at` with `register`) does.
pub fn focused_ui_element(stage: &str) -> Result<(AXUIElementRef, Option<String>), String> {
    focused_ui_element_once(stage)
}

/// Which edit attributes the focused element lets us set.
pub fn edit_facts(element: AXUIElementRef) -> EditFacts {
    EditFacts {
        value: is_settable(element, "AXValue"),
        selected_text: is_settable(element, "AXSelectedText"),
        selected_range: is_settable(element, "AXSelectedTextRange"),
        text_value: read_value(element).text().is_some(),
    }
}

/// BUS-232 (C) evidence, read only for a container/unknown role in a gated
/// app. Settable bits and readability only; no value is converted to text
/// beyond `edit_facts`' existing AXValue read.
fn wide_facts(element: AXUIElementRef) -> WideFacts {
    WideFacts {
        edit: edit_facts(element),
        editable_ancestor: is_readable(element, "AXEditableAncestor"),
        marker_settable: is_settable(element, "AXSelectedTextMarkerRange"),
        range_readable: reads_range(element, "AXSelectedTextRange"),
        insertion_line: is_readable(element, "AXInsertionPointLineNumber"),
        marker_readable: is_readable(element, "AXSelectedTextMarkerRange"),
        char_count: is_readable(element, "AXNumberOfCharacters"),
    }
}

/// The element to act on, its snapshot, and the BUS-232 path for a
/// container/unknown role (None otherwise). Takes ownership of `element`
/// and returns an owned element: the focused one, or (B, gated apps only)
/// its one focused text child, which is then registered and compared by
/// CFEqual exactly like a directly focused field. Every caller that
/// snapshots focus goes through here, so identity checks see the same
/// refined element. Prints one `[bus232]` line per container/unknown-role
/// decision.
pub fn resolve_focus(
    element: AXUIElementRef,
    app_name: Option<String>,
    register: bool,
) -> (AXUIElementRef, TargetSnapshotDto, Option<Path>) {
    let mut lines = Vec::new();
    let resolved = resolve_focus_quiet(element, app_name, register, &mut lines);
    for line in lines {
        eprintln!("{line}");
    }
    resolved
}

/// `resolve_focus` without printing: the `[bus232]` lines go to `lines`, so
/// a completion that re-reads focus (`settle_completion`) prints the lines
/// of the one snapshot it keeps, not one per read.
fn resolve_focus_quiet(
    element: AXUIElementRef,
    app_name: Option<String>,
    register: bool,
    lines: &mut Vec<String>,
) -> (AXUIElementRef, TargetSnapshotDto, Option<Path>) {
    let role = copy_string_attr(element, "AXRole").unwrap_or_else(|| "unknown".into());
    let pid = element_pid(element);
    let subrole = copy_string_attr(element, "AXSubrole");
    let mut refine_label = None;
    let mut refine_ms = 0;
    let decision = decide(
        &role,
        subrole.as_deref(),
        || pid.and_then(host::bundle_id),
        || edit_facts(element),
        || wide_facts(element),
        || ancestor_roles(element),
        || {
            let (found, ms) = refine_below(element, pid);
            refine_label = Some(found.label());
            refine_ms = ms;
            found.target.map(|(node, _, _)| node.retained())
        },
    );
    let line = |lines: &mut Vec<String>, path: Path, kind: &str| {
        let mut line = GateLine::new(path, path != Path::Old, register, kind);
        line.bundle = decision.bundle.as_deref().map(AxName::new);
        line.pid = pid;
        line.role = AxName::new(&role);
        line.subrole = subrole.as_deref().map(AxName::new);
        line.refine = refine_label.clone();
        line.refine_ms = refine_ms;
        lines.push(line.line());
    };
    if let Some(child) = decision.refined {
        release(element as CFTypeRef);
        let (child, snap, _) = resolve_focus_quiet(child, app_name, register, lines);
        line(lines, Path::Refine, &snap.kind);
        return (child, snap, Some(Path::Refine));
    }
    let snap = build_snapshot(element, app_name, register, &role, pid, decision.class);
    if let Some(path) = decision.path {
        line(lines, path, &snap.kind);
    }
    (element, snap, decision.path)
}

fn build_snapshot(
    element: AXUIElementRef,
    app_name: Option<String>,
    register: bool,
    role: &str,
    pid: Option<i32>,
    (kind, insertable, reason): Class,
) -> TargetSnapshotDto {
    let generation = if register {
        registry::register(element)
    } else {
        registry::matching_generation(element)
    };
    let mut snap = TargetSnapshotDto {
        app_name,
        app_pid: pid,
        captured_at: now_ms(),
        element_id: Some(element_token(pid, role, generation)),
        element_role: Some(role.to_string()),
        insertable,
        kind: kind.into(),
        known_terminal: false,
        paste_terminal: false,
        paste_app: None,
        reason: reason.map(str::to_string),
    };
    if unsafe { AXIsProcessTrusted() } == 0 {
        snap.insertable = false;
        snap.kind = "unavailable".into();
        snap.reason = Some(format!("{REASON_PERMISSION_DENIED} — insert skipped"));
    }
    snap
}

/// A focus read resolved to its element (None when focus was unavailable),
/// snapshot, BUS-232 path and the `[bus232]` lines it would print.
type Resolved = (
    Option<AXUIElementRef>,
    TargetSnapshotDto,
    Option<Path>,
    Vec<String>,
);

type Focus = Result<(AXUIElementRef, Option<String>), String>;

fn resolve_read(focus: Focus, register: bool) -> Resolved {
    match focus {
        Ok((element, app_name)) => {
            let mut lines = Vec::new();
            let (element, snap, path) =
                resolve_focus_quiet(element, app_name, register, &mut lines);
            (Some(element), snap, path, lines)
        }
        Err(msg) => (
            None,
            TargetSnapshotDto::unavailable(&msg, now_ms()),
            None,
            Vec::new(),
        ),
    }
}

fn release_resolved((element, ..): Resolved) {
    if let Some(element) = element {
        release(element as CFTypeRef);
    }
}

/// BUS-223 H4b F2: the first completion read can be unavailable or only a
/// coarse container while the app is still waking its accessibility tree.
/// Re-read (bounded, same pid, `decide::focus_settle`) until the snapshot is
/// usable. Insertable snapshots, terminals and paste-route apps, and
/// Chromium/Electron hosts (their own wait, `web_ax::settle_focus`) are
/// returned as read. Re-reads register like the first read; only the kept
/// snapshot's `[bus232]` lines are printed (`snapshot_from_resolved`), so a
/// completion logs one decision, not one per read.
fn settle_completion(stage: &str, front: Option<i32>, first: Focus) -> Resolved {
    // The clock covers the first read too: its cost sets the expectation
    // for the re-reads (`focus_settle::settle`).
    let started = std::time::Instant::now();
    let first = resolve_read(first, true);
    let snap = &first.1;
    let wanted = needs_settle(
        &snap.kind,
        snap.insertable,
        snap.element_role.as_deref(),
        snap.reason.as_deref(),
    );
    let Some(pid) = settle_target(
        wanted,
        front,
        || host::terminal_flags(front).known,
        |pid| host::web_ax_activation(pid).is_some(),
    ) else {
        return first;
    };
    let mut pending = Some(first);
    let settled = settle(
        pid,
        || {
            let resolved = pending
                .take()
                .unwrap_or_else(|| resolve_read(focused_ui_element_once(stage), true));
            let snap = &resolved.1;
            Observation {
                front: host::frontmost_pid(),
                focus_pid: snap.app_pid,
                kind: snap.kind.clone(),
                insertable: snap.insertable,
                role: snap.element_role.clone(),
                reason: snap.reason.clone(),
                value: resolved,
            }
        },
        |ms| std::thread::sleep(std::time::Duration::from_millis(ms)),
        || started.elapsed().as_millis(),
        release_resolved,
    );
    if settled.outcome != Outcome::Untouched {
        let bundle = host::bundle_id(pid);
        eprintln!("{}", settled.line(pid, bundle.as_deref().map(AxName::new)));
    }
    settled.value
}

/// Snapshot plus the terminal flags (Copy hint, paste route). They also cover
/// unavailable snapshots (no AX focus or permission), where a terminal is the
/// likeliest reason for Copy and the app pid is not known from AX.
pub fn snapshot_at(stage: &str, register: bool) -> TargetSnapshotDto {
    let flag = |snap| flag_terminal(snap, host::frontmost_pid, host::terminal_flags);
    if unsafe { AXIsProcessTrusted() } == 0 {
        return flag(TargetSnapshotDto::unavailable(
            &format!("{REASON_PERMISSION_DENIED} at {stage} — insert skipped"),
            now_ms(),
        ));
    }
    if register {
        // Every completion (= insert attempt) re-asserts the Chromium/Electron
        // web AX attribute: apps can drop it while idle (see
        // docs/decisions/web-ax-reenable.md). Then, if focus is still a web
        // container, wait (bounded) for the real field in the SAME pid, which
        // must stay frontmost throughout.
        let front = host::frontmost_pid();
        web_ax::reassert(front);
        let focus = web_ax::settle_focus(stage, front, focused_ui_element_once(stage));
        let resolved = settle_completion(stage, front, focus);
        return snapshot_from_resolved(resolved, true, flag);
    }
    snapshot_from_resolved(resolve_read(focused_ui_element(stage), false), false, flag)
}

/// `register` marks the completion snapshot (once per delivery): only that
/// one may print the BUS-232 `[snapshot]` diagnostic, after the terminal
/// flags are known and before the element is released: on every Copy
/// fallback (all apps), for a gated app's paste-only (C) target, and for an
/// unavailable focus (BUS-223 H4b F2, `target_diag`).
/// Diagnostic only; the returned snapshot is the same either way.
fn snapshot_from_resolved(
    resolved: Resolved,
    register: bool,
    flag: impl FnOnce(TargetSnapshotDto) -> TargetSnapshotDto,
) -> TargetSnapshotDto {
    let (element, snap, path, lines) = resolved;
    for line in lines {
        eprintln!("{line}");
    }
    let snap = flag(snap);
    if register {
        match element {
            Some(element) if snapshot_diag::should_log(&snap) => {
                snapshot_probe::log_snapshot(element, &snap, "not-insertable");
            }
            Some(element) if path == Some(Path::Paste) => {
                snapshot_probe::log_snapshot(element, &snap, "paste-only");
            }
            _ => {}
        }
        log_unavailable(Stage::Completion, None, &snap);
    }
    if let Some(element) = element {
        release(element as CFTypeRef);
    }
    snap
}

/// `target_diag::line` with the snapshot's bundle id.
pub fn log_unavailable(
    stage: Stage,
    intended: Option<&TargetSnapshotDto>,
    snap: &TargetSnapshotDto,
) {
    let bundle = snap.app_pid.and_then(host::bundle_id);
    let line = target_diag::line(stage, intended, snap, bundle.as_deref().map(AxName::new));
    if let Some(line) = line {
        eprintln!("{line}");
    }
}
