//! Native delivery boundary. macOS retains completion-time destination/session
//! authority independently of AX editability. Other platforms remain honest
//! stubs. Shared paste is unverified Command-V dispatch, not an insertion receipt;
//! AX/web and Apple Terminal Unicode retain their existing verification rules.
//! No focus restoration, synthetic Enter/Tab, or alternate route after a write.

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod decide;
mod types;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

pub use types::{PasteBindingDto, TargetSnapshotDto};

#[cfg(target_os = "macos")]
use macos as platform;

#[cfg(not(target_os = "macos"))]
use stub as platform;

/// Snapshot frontmost app + focused AX element after transcription completes.
/// Async: for Chromium/Electron it re-asserts web accessibility and may wait
/// (bounded, ~2.4 s) for the real field, which must never block the UI thread.
#[tauri::command(async)]
pub fn delivery_snapshot_target() -> Result<TargetSnapshotDto, String> {
    platform::snapshot_target()
}

/// Re-validate intended target at completion time.
/// Async: runs off the main thread so AX calls never stall the UI.
#[tauri::command(async)]
pub fn delivery_validate_target(intended: TargetSnapshotDto) -> Result<TargetSnapshotDto, String> {
    platform::validate_target(intended)
}

/// Insert plain text into the intended target; refuse wrong/secure targets.
/// Async: typing + read-back polling must not block the main/UI thread.
///
/// Only the fixed `delivery-safe-refusal:` prefix grants safe recovery: nothing
/// was dispatched, or read-back proved the field unchanged. Untagged errors
/// remain uncertain at IPC; never infer no mutation from a string's type or an
/// AX error code. Partial dispatch returns an unverified report rather than
/// inviting another transport.
#[tauri::command(async)]
pub fn delivery_insert_text(
    text: String,
    intended: TargetSnapshotDto,
) -> Result<decide::InsertReport, String> {
    platform::insert_text(&text, &intended)
}

/// Retire undispatched completion targets without waiting for insertion cleanup.
#[cfg(target_os = "macos")]
pub fn retire_targets() {
    platform::retire_targets();
}

/// Paste using native retained completion app/window/observable-field authority.
#[tauri::command(async)]
pub fn delivery_paste_target(
    text: String,
    intended: TargetSnapshotDto,
) -> Result<decide::report::PasteReport, String> {
    platform::paste_target(&text, &intended)
}

/// The paste terminal in front right now (pid + app path), taken when
/// dictation starts. None when the frontmost app is not a paste terminal.
/// Cheap: no AX reads, never activates anything.
#[tauri::command(async)]
pub fn delivery_paste_binding() -> Option<PasteBindingDto> {
    platform::paste_binding()
}

/// Source-compatible legacy paste entrypoint. macOS refuses app-only start
/// bindings; callers must supply retained completion authority to paste_target.
/// Async so no platform delivery work can block the UI thread.
#[tauri::command(async)]
pub fn delivery_paste_text(
    text: String,
    bound: PasteBindingDto,
) -> Result<decide::report::PasteReport, String> {
    platform::paste_text(&text, &bound)
}

#[cfg(test)]
mod insert_contract_tests {
    use super::decide::{after_ax, terminal, AfterAx};

    /// Native errors never come after a write (see `delivery_insert_text`).
    #[test]
    fn native_errors_never_follow_a_write() {
        // Terminal typing: an error before any chunk is Err; after one chunk it is Ok(unverified).
        let first = terminal::dispatch("hi", || Ok(()), |_| Err("posting denied".into()));
        assert!(first.is_err());
        let long = "a".repeat(64);
        let mut posted = 0;
        let partial = terminal::dispatch(
            &long,
            || Ok(()),
            |_| {
                posted += 1;
                if posted > 1 {
                    Err("lost focus".into())
                } else {
                    Ok(())
                }
            },
        )
        .expect("a partial write must not be Err");
        assert!(partial.unverified && partial.typed);
        // AX path: Failed (→ Err) only when the read-back shows the field unchanged.
        assert!(matches!(
            after_ax(false, Err("e".into()), "a", Some("a"), "b"),
            AfterAx::Failed(_)
        ));
        assert_eq!(
            after_ax(false, Err("e".into()), "a", Some("ab?"), "b"),
            AfterAx::Unverified
        );
        assert_eq!(
            after_ax(false, Err("e".into()), "a", None, "b"),
            AfterAx::Unverified
        );
    }
}
