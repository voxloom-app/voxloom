//! BUS-223 H4b F2 (diagnostic only): the Copy causes that print no other
//! line. An `unavailable` completion snapshot is skipped by
//! `snapshot_diag::should_log`, and a validation that turns an insertable
//! intended target into `changed` or `unavailable` logs nothing at all.
//! Labels, AX error codes, pids and role names only: reasons are mapped to
//! fixed labels, never copied, and codes are parsed as integers.

use super::snapshot_diag::{kind_label, AxName};
use crate::delivery::types::TargetSnapshotDto;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Completion,
    Validation,
}

/// Voxloom's own reason texts as fixed labels; anything else is "other".
fn reason_label(reason: Option<&str>) -> &'static str {
    const KNOWN: [(&str, &str); 5] = [
        ("Accessibility focus unavailable", "focus-unavailable"),
        ("Accessibility permission denied", "no-permission"),
        ("target identity unavailable", "identity-unavailable"),
        ("target changed (different app)", "different-app"),
        ("target changed (different field)", "different-field"),
    ];
    reason
        .and_then(|r| KNOWN.iter().find(|(prefix, _)| r.starts_with(prefix)))
        .map_or("other", |(_, label)| label)
}

/// The integer after `key=`, only when it ends at a delimiter.
fn code_after(reason: &str, key: &str) -> Option<i32> {
    let rest = &reason[reason.find(key)? + key.len()..];
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '-'))
        .unwrap_or(rest.len());
    let (number, tail) = rest.split_at(end);
    if !(tail.is_empty() || tail.starts_with([';', ')', ' '])) {
        return None;
    }
    number.parse().ok()
}

/// `AXFocusedApplication` and `AXFocusedUIElement` codes of
/// `focus_unavailable_reason`.
fn focus_codes(reason: &str) -> Option<(i32, i32)> {
    Some((
        code_after(reason, "AXFocusedApplication=")?,
        code_after(reason, "AXFocusedUIElement=")?,
    ))
}

fn pid(pid: Option<i32>) -> String {
    pid.map_or_else(|| "-".to_string(), |p| p.to_string())
}

fn role(snap: &TargetSnapshotDto) -> String {
    snap.element_role
        .as_deref()
        .map_or_else(|| "-".to_string(), |r| AxName::new(r).as_str().to_string())
}

/// A line for an `unavailable` completion snapshot (`intended` None) or a
/// validation that turned an insertable `intended` into `current`
/// (`changed` or `unavailable`). None for anything else.
pub fn line(
    stage: Stage,
    intended: Option<&TargetSnapshotDto>,
    current: &TargetSnapshotDto,
    bundle: Option<AxName>,
) -> Option<String> {
    if !matches!(current.kind.as_str(), "unavailable" | "changed") {
        return None;
    }
    let (at, tail) = match (stage, intended) {
        (Stage::Completion, None) => ("completion", String::new()),
        (Stage::Validation, Some(was)) if was.kind == "insertable" => (
            "validation",
            format!(
                " intended_pid={} intended_role={} same_pid={} same_role={} same_element={}",
                pid(was.app_pid),
                role(was),
                u8::from(was.app_pid == current.app_pid),
                u8::from(was.element_role == current.element_role),
                u8::from(was.element_id.is_some() && was.element_id == current.element_id),
            ),
        ),
        _ => return None,
    };
    let reason = current.reason.as_deref();
    let codes = reason
        .and_then(focus_codes)
        .map(|(app, focus)| format!(" ax_codes=app:{app},focus:{focus}"))
        .unwrap_or_default();
    Some(format!(
        "[snapshot] {} at={at} reason={}{codes} pid={} role={} bundle={}{tail}",
        kind_label(&current.kind),
        reason_label(reason),
        pid(current.app_pid),
        role(current),
        bundle.as_ref().map_or("-", AxName::as_str),
    ))
}

#[cfg(test)]
#[path = "target_diag_tests.rs"]
mod tests;
