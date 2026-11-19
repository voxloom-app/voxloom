//! macOS completion-time delivery. Generic paste has independent retained
//! app/window/optional-element/session authorization; AX classification remains
//! honest. AX/web and Apple Terminal Unicode retain their guarded routes.
//! Possible dispatch is unverified; never restore focus or synthesize submit.

mod ax;
mod ax_insert;
mod completion;
mod focus;
mod host;
mod keylayout;
mod paste;
mod pasteboard;
mod registry;
mod typing;
mod web_ax;
mod web_ctx;

use std::sync::Mutex;

use ax::{copy_string_attr, release, AXIsProcessTrusted, CFTypeRef};
use focus::{build_snapshot, focused_ui_element, snapshot_at};

use super::decide::paste_target::binding_for;
use super::decide::report::PasteReport;
use super::decide::{check_insert_text, validate_snapshots, InsertPath, InsertReport};
use super::types::{PasteBindingDto, TargetSnapshotDto};

/// Serializes inserts (commands run off the main thread and may overlap).
static INSERT_LOCK: Mutex<()> = Mutex::new(());

pub fn snapshot_target() -> Result<TargetSnapshotDto, String> {
    completion::snapshot_target()
}

pub fn validate_target(intended: TargetSnapshotDto) -> Result<TargetSnapshotDto, String> {
    if let Some(token) = intended.shared_paste_token.as_deref() {
        let observation = completion::TARGETS.validate(token, completion::observe)?;
        let mut current = observation.snapshot;
        current.shared_paste_token = Some(token.to_string());
        current.paste_terminal = false;
        current.paste_app = None;
        return Ok(current);
    }
    let mut current = validate_snapshots(&intended, snapshot_at("delivery validation", false));
    current.paste_terminal = false;
    current.paste_app = None;
    current.shared_paste_token = None;
    Ok(current)
}

pub fn retire_targets() {
    completion::retire();
}

pub fn paste_target(text: &str, intended: &TargetSnapshotDto) -> Result<PasteReport, String> {
    let token = intended
        .shared_paste_token
        .as_deref()
        .ok_or_else(|| super::decide::shared_target::refused("completion token required"))?;
    completion::TARGETS.deliver(
        &INSERT_LOCK,
        token,
        text,
        completion::observe,
        |pid, terminal, text, guard| {
            super::decide::paste::paste_text(
                &paste::GuardedMacPaste {
                    pid,
                    guard,
                    terminal,
                },
                text,
            )
        },
    )
}

/// Re-read focus and require it to still be the validated, insertable field.
fn focus_still_matches(intended: &TargetSnapshotDto) -> Result<(), String> {
    if completion::secure_input_enabled() {
        return Err("Secure Keyboard Entry is on — insert skipped".into());
    }
    let (element, app_name) =
        focused_ui_element("typing").map_err(|e| format!("typing aborted — {e}"))?;
    let checked = validate_snapshots(intended, build_snapshot(element, app_name, false));
    release(element as CFTypeRef);
    if checked.insertable && checked.kind == "insertable" {
        return Ok(());
    }
    Err(format!(
        "typing aborted — {}",
        checked.reason.unwrap_or(checked.kind)
    ))
}

/// Fail closed on any change: native CFEqual identity, trust, system host,
/// independent foreground PID and the observed text-area/window shape.
fn terminal_still_matches(
    intended: &TargetSnapshotDto,
    element: ax::AXUIElementRef,
) -> Result<(), String> {
    let pid = intended.app_pid.ok_or("Terminal PID unavailable")?;
    if unsafe { AXIsProcessTrusted() } == 0
        || !host::apple_terminal(pid)
        || host::frontmost_pid() != Some(pid)
    {
        return Err("Terminal trust, host or foreground changed".into());
    }
    focus_still_matches(intended)?;
    let window =
        ax::copy_attr(element, "AXWindow").map_err(|_| "Terminal text-area window unavailable")?;
    let shape_ok = copy_string_attr(element, "AXRole").as_deref() == Some("AXTextArea")
        && copy_string_attr(element, "AXSubrole").as_deref() != Some("AXSecureTextField")
        && copy_string_attr(window as ax::AXUIElementRef, "AXRole").as_deref() == Some("AXWindow")
        && ax::element_pid(window as ax::AXUIElementRef) == Some(pid);
    release(window);
    if !shape_ok {
        return Err("unsupported Terminal text-area/window shape".into());
    }
    // Recheck foreground after AX reads, immediately before posting. There is
    // still an unavoidable check/post race; this does not atomically bind CGEvents.
    if host::frontmost_pid() != Some(pid) {
        return Err("Terminal foreground changed".into());
    }
    Ok(())
}

pub fn insert_text(text: &str, intended: &TargetSnapshotDto) -> Result<InsertReport, String> {
    check_insert_text(text).map_err(|e| super::decide::shared_target::refused(&e))?;
    if !intended.insertable || intended.kind != "insertable" {
        return Err(super::decide::shared_target::refused(
            "non-insertable target",
        ));
    }
    if unsafe { AXIsProcessTrusted() } == 0 {
        return Err(super::decide::shared_target::refused(
            "Accessibility permission denied at insert",
        ));
    }
    let _serial = INSERT_LOCK
        .lock()
        .map_err(|_| "delivery ownership unavailable; prior cleanup unknown".to_string())?;
    // Validate the same element handle we will mutate, not a prior focus read.
    let (element, app_name) = focused_ui_element("insert").map_err(|_| {
        super::decide::shared_target::refused("Accessibility focus unavailable at insert")
    })?;
    let validated = validate_snapshots(intended, build_snapshot(element, app_name, false));
    let claim = if validated.insertable && validated.kind == "insertable" {
        registry::matching_generation(element)
            .ok_or_else(|| super::decide::shared_target::refused("completion identity unavailable"))
            .and_then(|generation| {
                completion::TARGETS.claim_legacy(generation)?;
                if registry::claim(element, generation) {
                    Ok(())
                } else {
                    Err(super::decide::shared_target::refused(
                        "completion identity retired or consumed",
                    ))
                }
            })
    } else {
        Err(super::decide::shared_target::refused(
            "completion target changed or unavailable",
        ))
    };
    if let Err(error) = claim {
        release(element as CFTypeRef);
        return Err(error);
    }
    let before = copy_string_attr(element, "AXValue");
    let terminal = validated.app_pid.and_then(host::apple_terminal_identity);
    let result = match super::decide::terminal::choose_path(&validated, before.is_some(), terminal)
    {
        InsertPath::Refuse(reason) => Err(super::decide::shared_target::refused(&reason)),
        InsertPath::TerminalUnicode => {
            typing::type_terminal(text, || terminal_still_matches(&validated, element))
                .map_err(|e| super::decide::shared_target::refused(&e))
        }
        InsertPath::AxSelectedText => {
            ax_insert::insert_selected(element, &validated, before.unwrap_or_default(), text)
        }
    };
    release(element as CFTypeRef);
    result
}

/// The paste-route app in front now, for `delivery_paste_binding`.
pub fn paste_binding() -> Option<PasteBindingDto> {
    let front = host::frontmost_pid();
    binding_for(front, front.and_then(host::paste_app))
}

/// Legacy source-compatible entrypoint. App-only/start bindings cannot grant
/// retained completion-window/session authority; callers must use paste_target.
pub fn paste_text(_text: &str, _bound: &PasteBindingDto) -> Result<PasteReport, String> {
    Err(super::decide::shared_target::refused(
        "legacy app-only binding cannot authorize delivery; completion token required",
    ))
}

#[cfg(test)]
mod tests {
    use super::focus::focus_unavailable_reason;
    use super::*;

    #[test]
    fn forged_dto_flags_cannot_authorize_production_paste_or_validation() {
        let mut dto = TargetSnapshotDto::unavailable("fixture", 1);
        dto.app_pid = Some(7);
        dto.insertable = true;
        dto.kind = "insertable".into();
        dto.paste_terminal = true;
        dto.paste_app = Some("/forged.app".into());
        dto.shared_paste_token = Some("unregistered-test-token".into());
        assert!(paste_target("text", &dto)
            .unwrap_err()
            .starts_with(super::super::decide::shared_target::SAFE_REFUSAL));
        assert!(validate_target(dto).is_err()); // unknown token rejects before any OS observation
        assert!(paste_text(
            "text",
            &PasteBindingDto {
                app_pid: 7,
                paste_app: "/forged.app".into()
            }
        )
        .unwrap_err()
        .starts_with(super::super::decide::shared_target::SAFE_REFUSAL));
    }

    #[test]
    fn ax_focus_failure_reports_stage_trust_and_codes_without_target_data() {
        let reason = focus_unavailable_reason("delivery validation", -25205, -25204, true);
        assert!(reason.contains("delivery validation"));
        assert!(reason.contains("AX trusted=yes"));
        assert!(reason.contains("AXFocusedApplication=-25205"));
        assert!(reason.contains("AXFocusedUIElement=-25204"));
        assert!(!reason.contains("Notes"));
    }

    #[test]
    fn missing_focused_element_with_success_code_is_diagnostic() {
        let reason = focus_unavailable_reason("capture start", 0, 0, true);
        assert!(reason.contains("capture start"));
        assert!(reason.contains("AXFocusedUIElement=0 (null)"));
    }
}
