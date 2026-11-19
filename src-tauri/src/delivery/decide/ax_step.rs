//! BUS-223 H4b F1: whether the AXSelectedText write is attempted at all.
//!
//! Journal's body (AXTextArea) takes AXSelectedText without an error and
//! changes nothing, and AXValue reads no-value, so no read-back can ever say
//! so: the write ended as Unverified and never pasted. Excel, Weather,
//! Podcasts and Word show the same silent no-op, but have a readable value,
//! where the strict read-back already catches it. For the unreadable case
//! the write is skipped and the field gets the guarded ⌘V instead.
//!
//! Policy only; the macOS adapter gathers the facts and calls `run_ax_step`.

use super::diag::DeliveryDiag;
use super::fallback::ValueStatus;
use super::paste_role::EditFacts;
use super::report::InsertReport;
use super::target::classify_role;

/// The `ax_write=` log label when the write is skipped.
pub const AX_WRITE_SKIPPED_LABEL: &str = "skipped(selected_text-unsettable)";

/// The refusal reason when the write is skipped; this is the text that can
/// reach the UI (`messages.ts` shows "insert failed: <reason>"). It is the
/// already approved wording for a field that takes no direct insert
/// (`reasonForKind`'s "unsupported field"). The technical cause is the
/// `ax_write=` log label only.
pub const AX_WRITE_SKIPPED_REASON: &str = "unsupported field";

/// What the AX path does for an allowlisted text field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AxStep {
    /// Write AXSelectedText, then verify by read-back (the existing path).
    Write,
    /// Write nothing; the refusal is write-free and `may_paste` decides.
    SkipWrite,
}

/// Facts for `decide_ax_step`. No text or AXValue content: statuses and bits.
#[derive(Clone, Copy, Debug)]
pub struct AxFacts<'a> {
    /// The effective AX role (secure subrole already folded in).
    pub role: &'a str,
    pub edit: EditFacts,
    /// AXEnabled, None when it cannot be read.
    pub enabled: Option<bool>,
    /// AXValue before the AX path.
    pub before: &'a ValueStatus,
    /// Chromium or Electron host: it keeps its own typing route.
    pub web_host: bool,
}

/// Skip the write only when every one of these holds:
/// - the role is an allowlisted text role (`classify_role` insertable),
/// - AXValue is settable and AXSelectedTextRange is settable (a real, live
///   text field: a read-only text area has value-settable=0 and stays Copy),
/// - AXSelectedText is not settable (so an OK write is a silent no-op),
/// - AXValue reads no-value (so a read-back could never tell),
/// - the field is not known to be disabled (AXEnabled=0; unreadable passes),
/// - the host is not Chromium/Electron.
///
/// Accepted residual risk: a field that meets all of this but does take the
/// paste would be pasted once without the write having been tried; the
/// worst case is a ⌘V that changes nothing, with the clipboard restored.
/// Every `may_paste` guard still applies afterwards: secure field, Secure
/// Keyboard Entry, grid, Chromium/web, pid and focus re-check, unchanged
/// field. Never more than one ⌘V per dictation.
pub fn decide_ax_step(facts: &AxFacts) -> AxStep {
    let text_role = classify_role(facts.role).0 == "insertable";
    let skip = text_role
        && facts.edit.value
        && facts.edit.selected_range
        && !facts.edit.selected_text
        && *facts.before == ValueStatus::NoValue
        && facts.enabled != Some(false)
        && !facts.web_host;
    if skip {
        AxStep::SkipWrite
    } else {
        AxStep::Write
    }
}

/// Run the AX step: `write` only for `AxStep::Write`. A skipped write is an
/// `Err` with `AX_WRITE_SKIPPED_REASON` and an untouched attempt, which
/// `after_ax_refusal` treats as write-free.
pub fn run_ax_step(
    step: AxStep,
    write: impl FnOnce(&mut DeliveryDiag) -> Result<InsertReport, String>,
    diag: &mut DeliveryDiag,
) -> Result<InsertReport, String> {
    match step {
        AxStep::Write => write(diag),
        AxStep::SkipWrite => {
            diag.ax_write = AX_WRITE_SKIPPED_LABEL;
            Err(AX_WRITE_SKIPPED_REASON.to_string())
        }
    }
}

#[cfg(test)]
#[path = "ax_step_tests.rs"]
mod tests;
