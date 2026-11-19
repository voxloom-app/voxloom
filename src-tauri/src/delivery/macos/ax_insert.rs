//! Caret-aware AXSelectedText insert with exact read-back, the guarded
//! Chromium/Electron retry (`decide::retry`), and verified Unicode typing
//! for unchanged web fields.

use super::ax::{ancestor_roles, copy_string_attr, set_ax_string, AXUIElementRef};
use super::{focus_still_matches, host, typing, web_ax};
use crate::delivery::decide::retry::{
    reprobe_decision, retry_eligible, retry_once, RetryIo, UNREADABLE_BEFORE_RETRY,
};
use crate::delivery::decide::shared_target::refused;
use crate::delivery::decide::{
    after_ax, is_web_content_field, value_confirms_insert, AfterAx, InsertReport,
};
use crate::delivery::types::TargetSnapshotDto;

/// Real AX side effects for the retry.
struct AxRetry<'a> {
    element: AXUIElementRef,
    validated: &'a TargetSnapshotDto,
    text: &'a str,
}

impl RetryIo for AxRetry<'_> {
    fn reassert(&mut self) {
        web_ax::reassert(self.validated.app_pid);
    }
    fn sleep(&mut self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
    fn read(&mut self) -> Option<String> {
        copy_string_attr(self.element, "AXValue")
    }
    fn write(&mut self) -> Result<(), String> {
        focus_still_matches(self.validated)?;
        insert_selected_text_with(self.text, |a, t| set_ax_string(self.element, a, t))
    }
}

pub fn insert_selected(
    element: AXUIElementRef,
    validated: &TargetSnapshotDto,
    before: String,
    text: &str,
) -> Result<InsertReport, String> {
    // Value reads may have blocked or a successor may have armed while queued.
    // Recheck the native retained generation immediately before the AX mutation.
    let ax = insert_selected_text_guarded_with(
        text,
        || focus_still_matches(validated),
        |a, t| set_ax_string(element, a, t),
    )?;
    let after = copy_string_attr(element, "AXValue");
    let role = validated.element_role.clone().unwrap_or_default();
    let has_dom_id = copy_string_attr(element, "AXDOMIdentifier").is_some();
    // Skip the parent walk when the DOM id already proves web content.
    let ancestors = if has_dom_id {
        Vec::new()
    } else {
        ancestor_roles(element)
    };
    // Type only into web fields of hosts known to honor Unicode events.
    let may_type = is_web_content_field(&role, has_dom_id, &ancestors)
        && validated.app_pid.is_some_and(host::unicode_typing_ok);
    let mut outcome = after_ax(may_type, ax.clone(), &before, after.as_deref(), text);
    // Chromium/Electron may have dropped web AX while idle (the tree is then
    // partial, so may_type is false and we land here, not in TypeFallback).
    let web_host = validated
        .app_pid
        .and_then(host::web_ax_activation)
        .is_some();
    if retry_eligible(&ax, &outcome, web_host) {
        let mut io = AxRetry {
            element,
            validated,
            text,
        };
        let retried = retry_once(&ax, &before, text, &mut io);
        outcome = if matches!(retried.after, AfterAx::Failed(_)) && !may_type {
            reprobe_after_retry(retried, validated, &role)
        } else {
            retried.after
        };
        if let AfterAx::Failed(err) = &outcome {
            log_chrome_failure(validated, err);
        }
    }
    settle(outcome, || {
        typing::type_text(
            text,
            || focus_still_matches(validated),
            |so_far| wait_for_insert(element, &before, so_far),
        )
    })
}

/// Errors are safe refusals only when nothing was written: read-back proved
/// the field unchanged, or typing posted no event. A field that became
/// unreadable after an accepted write is not proof, so it stays untagged.
fn settle(
    outcome: AfterAx,
    type_text: impl FnOnce() -> (usize, Result<(), String>),
) -> Result<InsertReport, String> {
    match outcome {
        AfterAx::Inserted => Ok(InsertReport::default()),
        AfterAx::Failed(err) if err == UNREADABLE_BEFORE_RETRY => Err(err),
        AfterAx::Failed(err) => Err(refused(&err)),
        AfterAx::Unverified => unverified(
            false,
            "AX write changed the field but could not be verified".into(),
        ),
        AfterAx::TypeFallback => match type_text() {
            (0, Err(err)) => Err(refused(&err)),
            (_, Err(err)) => unverified(true, format!("{err} (partially typed)")),
            (_, Ok(())) => Ok(InsertReport {
                typed: true,
                ..Default::default()
            }),
        },
    }
}

/// Poll read-back briefly: typed key events are processed asynchronously.
fn wait_for_insert(element: AXUIElementRef, before: &str, text: &str) -> bool {
    for _ in 0..30 {
        if let Some(after) = copy_string_attr(element, "AXValue") {
            if value_confirms_insert(before, &after, text) {
                return true;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    false
}

/// Re-probe web identity on a FRESHLY fetched focused element now that web AX
/// is re-enabled (the pre-retry handle may describe the dropped tree). Fail
/// closed: if focus can't be re-read or no longer matches, stay Failed.
fn reprobe_after_retry(
    retried: crate::delivery::decide::retry::RetryOutcome,
    validated: &TargetSnapshotDto,
    role: &str,
) -> AfterAx {
    let Ok((fresh, _)) = super::focused_ui_element("retry re-probe") else {
        return reprobe_decision(retried, false, false, false);
    };
    let still_ours = focus_still_matches(validated).is_ok();
    if still_ours {
        // Diagnostic only: Chrome can keep fields outside AXWebArea, so the
        // decision no longer depends on this probe.
        let dom_now = copy_string_attr(fresh, "AXDOMIdentifier").is_some();
        let anc_now = if dom_now {
            Vec::new()
        } else {
            ancestor_roles(fresh)
        };
        let web_now = is_web_content_field(role, dom_now, &anc_now);
        eprintln!("[insert] retry re-probe web_field_now={web_now}");
    }
    super::ax::release(fresh as super::ax::CFTypeRef);
    let typing_ok = validated.app_pid.is_some_and(host::unicode_typing_ok);
    reprobe_decision(retried, true, still_ours, typing_ok)
}

/// Diagnostic for Chrome/Electron insert failures (no field contents logged).
fn log_chrome_failure(validated: &TargetSnapshotDto, err: &str) {
    let pid = validated.app_pid.unwrap_or(-1);
    eprintln!(
        "[insert] chromium failure exe={:?} host={:?} err={err}",
        host::executable_path(pid),
        host::web_ax_activation(pid)
    );
}

fn unverified(typed: bool, detail: String) -> Result<InsertReport, String> {
    Ok(InsertReport {
        typed,
        unverified: true,
        detail: Some(detail),
        ..Default::default()
    })
}

/// Outer errors prove the first setter was never called; inner errors retain
/// possible-mutation semantics for read-back and must not be safe-refusal tagged.
fn insert_selected_text_guarded_with(
    text: &str,
    guard: impl FnOnce() -> Result<(), String>,
    set: impl FnOnce(&str, &str) -> Result<(), String>,
) -> Result<Result<(), String>, String> {
    guard().map_err(|e| refused(&e))?;
    Ok(insert_selected_text_with(text, set))
}

fn insert_selected_text_with(
    text: &str,
    set: impl FnOnce(&str, &str) -> Result<(), String>,
) -> Result<(), String> {
    // AXValue replaces the entire field; a failed selected-text set must not
    // try another AX mutation. The caller will use the Copy/Failed policy.
    set("AXSelectedText", text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_field_and_unposted_typing_are_safe_refusals() {
        // Read-back showed the field unchanged, or no key event was posted:
        // nothing was written, so configured Copy/Fail recovery applies.
        let failed = settle(AfterAx::Failed("AX set failed".into()), || {
            panic!("no typing after a failed AX write")
        });
        assert_eq!(failed.unwrap_err(), "delivery-safe-refusal:AX set failed");
        let unposted = settle(AfterAx::TypeFallback, || (0, Err("focus changed".into())));
        assert_eq!(unposted.unwrap_err(), "delivery-safe-refusal:focus changed");
    }

    #[test]
    fn unreadable_field_after_accepted_write_is_not_a_safe_refusal() {
        let err = settle(AfterAx::Failed(UNREADABLE_BEFORE_RETRY.into()), || {
            panic!("no typing")
        })
        .unwrap_err();
        assert!(!err.starts_with(crate::delivery::decide::shared_target::SAFE_REFUSAL));
    }

    #[test]
    fn possible_writes_stay_unverified_reports() {
        let partial = settle(AfterAx::TypeFallback, || (2, Err("focus changed".into())));
        let partial = partial.expect("partial typing is never an Err");
        assert!(partial.typed && partial.unverified);
        let changed = settle(AfterAx::Unverified, || panic!("no typing"));
        assert!(changed.expect("changed field is never an Err").unverified);
        let typed = settle(AfterAx::TypeFallback, || (1, Ok(()))).unwrap();
        assert!(typed.typed && !typed.unverified);
        assert_eq!(
            settle(AfterAx::Inserted, || panic!("no typing")),
            Ok(InsertReport::default())
        );
    }

    #[test]
    fn first_write_guard_refusal_is_safe_without_calling_setter() {
        let mut sets = 0;
        let error = insert_selected_text_guarded_with(
            "dictation",
            || Err("target changed".into()),
            |_, _| {
                sets += 1;
                Ok(())
            },
        )
        .unwrap_err();
        assert_eq!(sets, 0);
        assert_eq!(error, "delivery-safe-refusal:target changed");
    }

    #[test]
    fn guarded_setter_failure_remains_an_untagged_write_result() {
        let mut attrs = Vec::new();
        let write = insert_selected_text_guarded_with(
            "dictation",
            || Ok(()),
            |attr, text| {
                attrs.push((attr.to_string(), text.to_string()));
                Err("AX set failed".into())
            },
        )
        .expect("guard succeeded; setter failure is not a prewrite refusal");
        assert_eq!(write, Err("AX set failed".into()));
        assert_eq!(attrs, [("AXSelectedText".into(), "dictation".into())]);
    }

    #[test]
    fn successful_guard_precedes_the_single_selected_text_write() {
        let calls = std::cell::RefCell::new(Vec::new());
        let result = insert_selected_text_guarded_with(
            "dictation",
            || {
                calls.borrow_mut().push("guard");
                Ok(())
            },
            |attr, text| {
                assert_eq!((attr, text), ("AXSelectedText", "dictation"));
                calls.borrow_mut().push("setter");
                Ok(())
            },
        );
        assert_eq!(result, Ok(Ok(())));
        assert_eq!(calls.into_inner(), ["guard", "setter"]);
    }

    #[test]
    fn selected_text_failure_never_attempts_value_write() {
        let mut attrs = Vec::new();
        let result = insert_selected_text_with("dictation", |attr, text| {
            attrs.push((attr.to_string(), text.to_string()));
            Err("AX set failed".into())
        });
        assert!(result.is_err());
        assert_eq!(attrs, [("AXSelectedText".into(), "dictation".into())]);
    }
}
