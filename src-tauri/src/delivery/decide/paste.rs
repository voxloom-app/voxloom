//! Reusable clipboard transaction for retained editor and terminal targets.
//! Pure orchestration over `PasteHost`; the native adapter supplies clipboard
//! primitives and guarded Command-V. Keep serialization through settlement.
//!
//! Only `delivery-safe-refusal:` errors authorize known-safe recovery. Other
//! errors include uncertain publication/cleanup: NEVER infer no mutation or
//! automatically retry/Copy. `Ok` means paste dispatched, NOT insertion proven.

use super::report::PasteReport;
use super::terminal::check_terminal_text;

#[path = "pasteboard_policy.rs"]
pub mod pasteboard_policy;

/// How long the transcript stays on the clipboard after ⌘V before the user's
/// own clipboard is restored. A terminal reads the pasteboard when it handles
/// the key; one that is slower than this would paste the *restored* contents.
/// That slow-terminal race is known and not handled here (no completion signal
/// exists), so this is a tuning constant.
pub const CLIPBOARD_RESTORE_DELAY_MS: u64 = 1500;

pub use pasteboard_policy::PublicationFailure;

/// Safe refusals from saving the user's clipboard, before anything was written.
/// Unsaved (concealed, oversized): the clipboard is still the user's, so prefer
/// a route that leaves it alone. Changed: a newer copy exists; never Copy over it.
pub const CLIPBOARD_UNSAVED: &str = "delivery-safe-refusal:clipboard-unsaved:";
pub const CLIPBOARD_CHANGED: &str = "delivery-safe-refusal:clipboard-changed:";

pub trait PasteHost {
    /// The user's clipboard, whole (every item and type).
    type Saved;
    /// Trust, event access, security and retained destination authorization.
    /// Must not touch the pasteboard.
    fn preflight(&self) -> Result<(), String>;
    /// None when the clipboard cannot be copied in full.
    fn snapshot(&self) -> Option<Self::Saved>;
    /// Replace the clipboard with `text` (marked transient). Returns the
    /// pasteboard change count right after our write.
    fn write_transient(&self, text: &str) -> Result<i64, String>;
    /// Re-check destination, then post one paste chord. Err = definitely no
    /// text-key dispatch AND completed modifier cleanup. Success only after V.
    fn post_paste(&self) -> Result<(), String>;
    fn change_count(&self) -> i64;
    fn restore(&self, saved: &Self::Saved) -> Result<(), String>;
    fn wait(&self, ms: u64);

    /// Legacy terminal/Messages entry points retain their original policy.
    fn terminal_policy(&self) -> bool {
        true
    }

    /// Native emitter repeats the generation check in its last text-key guard.
    fn post_paste_owned(&self, expected: i64) -> Result<(), String> {
        pasteboard_policy::before_dispatch(expected, || Ok(()), || self.change_count())?;
        self.post_paste()
    }

    /// Native adapters prepare the entire restoration before the last check.
    /// No OS-wide CAS exists; do not overwrite an observed newer generation.
    fn restore_owned(&self, saved: &Self::Saved, expected: i64) -> Result<(), String> {
        if self.change_count() != expected {
            return Err("clipboard changed during paste — left as-is".into());
        }
        self.restore(saved)
    }

    /// Legacy implementations cannot prove whether a failed write mutated the
    /// clipboard. Never restore on that error without an ownership generation.
    fn publish(&self, text: &str, expected: i64) -> Result<i64, PublicationFailure> {
        if self.change_count() != expected {
            return Err(PublicationFailure::Unknown(
                "clipboard changed before publication".into(),
            ));
        }
        self.write_transient(text)
            .map_err(PublicationFailure::Unknown)
    }
}

/// Backward-compatible marker helper. Markers are advisory conventions, not
/// access control. Native publication attaches every marker before mutation.
pub fn require_marker(attached: bool) -> Result<(), String> {
    if attached {
        Ok(())
    } else {
        Err("could not mark the clipboard copy as transient — paste skipped".into())
    }
}

pub fn paste_text<H: PasteHost>(host: &H, text: &str) -> Result<PasteReport, String> {
    let checked = if host.terminal_policy() {
        check_terminal_text(text)
    } else {
        super::check_insert_text(text)
    };
    checked.map_err(|e| format!("delivery-safe-refusal:{e}"))?;
    host.preflight()
        .map_err(|e| format!("delivery-safe-refusal:{e}"))?;
    let before = host.change_count();
    let saved = host.snapshot();
    if host.change_count() != before {
        return Err(format!(
            "{CLIPBOARD_CHANGED}clipboard changed during snapshot — paste skipped"
        ));
    }
    let saved =
        saved.ok_or_else(|| format!("{CLIPBOARD_UNSAVED}prior clipboard could not be saved"))?;
    let ours = match host.publish(text, before) {
        Ok(count) => count,
        Err(PublicationFailure::Untouched(error)) => {
            return Err(format!("delivery-safe-refusal:{error}"));
        }
        Err(PublicationFailure::Owned { generation, reason }) => {
            return match restore_if_unchanged(host, &saved, generation) {
                Ok(()) => Err(format!("delivery-safe-refusal:{reason}")),
                Err(cleanup) => Err(format!("publication failed: {reason}; {cleanup}")),
            };
        }
        Err(PublicationFailure::Unknown(error)) => {
            return Err(format!("clipboard publication uncertain: {error}"));
        }
    };
    if let Err(error) = host.post_paste_owned(ours) {
        return match restore_if_unchanged(host, &saved, ours) {
            Ok(()) => Err(format!("delivery-safe-refusal:{error}")),
            Err(cleanup) => Err(format!(
                "paste refused: {error}; clipboard cleanup incomplete: {cleanup}"
            )),
        };
    }
    host.wait(CLIPBOARD_RESTORE_DELAY_MS);
    Ok(match restore_if_unchanged(host, &saved, ours) {
        Ok(()) => PasteReport {
            clipboard_restored: true,
            restore_skipped_reason: None,
        },
        Err(reason) => PasteReport {
            clipboard_restored: false,
            restore_skipped_reason: Some(reason),
        },
    })
}

/// Put the user's clipboard back only if nothing but us wrote to it since:
/// a change count other than ours means the user (or a clipboard manager)
/// copied something, and that copy must not be clobbered.
fn restore_if_unchanged<H: PasteHost>(host: &H, saved: &H::Saved, ours: i64) -> Result<(), String> {
    if host.change_count() != ours {
        return Err("clipboard changed during paste — left as-is".into());
    }
    host.restore_owned(saved, ours)
        .map_err(|e| format!("restore did not complete: {e}"))
}

#[cfg(test)]
#[path = "paste_tests.rs"]
mod tests;
