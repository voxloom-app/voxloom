//! BUS-223 H4b F2: a bounded re-read of focus at completion. The first read
//! of an app's focus can be unavailable or only a coarse container (Word:
//! AXSplitGroup, then AXScrollArea, then AXTextArea; SwitchHosts and
//! PowerPoint: nothing logged) while later reads find the real field.
//! Smoke at 7aed283: the first insert after launch Copied, later ones worked.
//!
//! Policy only. A snapshot that is already insertable is never re-read. The
//! re-read stops after `SETTLE_READS` reads (~300 ms in `SETTLE_STEP_MS`
//! steps), at the time budget, or as soon as the frontmost app or the
//! focused process is no longer `pid`. `validate_snapshots` is untouched:
//! this only decides which completion snapshot becomes the intended target.

use super::paste_role::GRID_REASON;
use super::snapshot_diag::{kind_label, AxName};
use super::web_ax::{wait_for_focus_within, Read};

/// The first read plus up to six re-reads.
pub const SETTLE_READS: usize = 7;
pub const SETTLE_STEP_MS: u64 = 50;
/// Re-reads of a gated container can each walk children (≤250 ms): stop
/// starting new reads once this much time has passed.
pub const SETTLE_BUDGET_MS: u128 = 350;

/// Coarse, non-insertable roles a not-yet-ready window or document exposes.
/// Controls, grids and secure fields are real answers and not listed.
const COARSE_ROLES: &[&str] = &[
    "AXApplication",
    "AXWindow",
    "AXSplitGroup",
    "AXGroup",
    "AXScrollArea",
    "AXWebArea",
    "AXDocument",
    "AXTabGroup",
    "unknown",
];

/// Whether a completion snapshot may improve on a re-read.
pub fn needs_settle(
    kind: &str,
    insertable: bool,
    role: Option<&str>,
    reason: Option<&str>,
) -> bool {
    if insertable {
        return false;
    }
    match kind {
        "unavailable" => true,
        "unsupported" => {
            reason != Some(GRID_REASON) && role.is_some_and(|r| COARSE_ROLES.contains(&r))
        }
        _ => false,
    }
}

/// One focus read, resolved to a snapshot's facts. `value` is whatever the
/// caller keeps for it (the element and snapshot). Facts only, never text.
pub struct Observation<T> {
    pub value: T,
    /// Frontmost pid at this read.
    pub front: Option<i32>,
    /// Pid of the focused element, None when focus was unavailable.
    pub focus_pid: Option<i32>,
    pub kind: String,
    pub insertable: bool,
    pub role: Option<String>,
    pub reason: Option<String>,
}

impl<T> Observation<T> {
    fn needs_settle(&self) -> bool {
        needs_settle(
            &self.kind,
            self.insertable,
            self.role.as_deref(),
            self.reason.as_deref(),
        )
    }

    fn label(&self) -> Label {
        Label {
            kind: kind_label(&self.kind),
            role: self.role.as_deref().map(AxName::new),
        }
    }
}

#[derive(Clone, Debug)]
struct Label {
    kind: &'static str,
    role: Option<AxName>,
}

impl Label {
    fn text(&self) -> String {
        format!(
            "{}:{}",
            self.kind,
            self.role.as_ref().map_or("-", AxName::as_str)
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The first snapshot needed no re-read.
    Untouched,
    /// A re-read produced a snapshot that needs no more.
    Found,
    /// Still unsettled after `SETTLE_READS` reads.
    Exhausted,
    /// Stopped early: front-changed, pid-changed or budget.
    Aborted(&'static str),
}

pub struct Settled<T> {
    /// The snapshot to use: the last one from the same pid.
    pub value: T,
    /// Reads made, an aborted one included.
    pub reads: usize,
    pub outcome: Outcome,
    first: Label,
    last: Label,
}

impl<T> Settled<T> {
    /// `[focus] settle ...`: roles, kinds, pid, bundle id and counts only.
    pub fn line(&self, pid: i32, bundle: Option<AxName>) -> String {
        let outcome = match self.outcome {
            Outcome::Untouched => "untouched".to_string(),
            Outcome::Found => "found".to_string(),
            Outcome::Exhausted => "exhausted".to_string(),
            Outcome::Aborted(why) => format!("aborted({why})"),
        };
        format!(
            "[focus] settle bundle={} pid={pid} reads={}/{SETTLE_READS} first={} final={} \
             outcome={outcome}",
            bundle.as_ref().map_or("-", AxName::as_str),
            self.reads,
            self.first.text(),
            self.last.text(),
        )
    }
}

/// Observe focus until its snapshot needs no more settling, or a bound hits.
/// `observe` makes one read (the first may already be in hand), `wait` sleeps
/// a step, `elapsed_ms` is the time since the first read, and `discard`
/// receives every superseded `value` so the caller can release it.
pub fn settle<T>(
    pid: i32,
    mut observe: impl FnMut() -> Observation<T>,
    mut wait: impl FnMut(u64),
    mut elapsed_ms: impl FnMut() -> u128,
    mut discard: impl FnMut(T),
) -> Settled<T> {
    let mut kept: Option<T> = None;
    let mut labels: Option<(Label, Label)> = None;
    let mut untouched = false;
    let mut reads = 0;
    let result = wait_for_focus_within(
        SETTLE_READS,
        || {
            if reads > 0 && elapsed_ms() >= SETTLE_BUDGET_MS {
                return Read::Abort(Some("budget"));
            }
            let seen = observe();
            reads += 1;
            if reads == 1 {
                let label = seen.label();
                labels = Some((label.clone(), label));
                // Another process's focus, or a snapshot that is fine: as is.
                untouched = seen.front != Some(pid)
                    || seen.focus_pid.is_some_and(|p| p != pid)
                    || !seen.needs_settle();
                let done = untouched;
                kept = Some(seen.value);
                return if done {
                    Read::Found(())
                } else {
                    Read::Retry(None)
                };
            }
            if seen.front != Some(pid) {
                discard(seen.value);
                return Read::Abort(Some("front-changed"));
            }
            if seen.focus_pid.is_some_and(|p| p != pid) {
                discard(seen.value);
                return Read::Abort(Some("pid-changed"));
            }
            let (label, needs) = (seen.label(), seen.needs_settle());
            if let Some(old) = kept.replace(seen.value) {
                discard(old);
            }
            if let Some((_, last)) = labels.as_mut() {
                *last = label;
            }
            if needs {
                Read::Retry(None)
            } else {
                Read::Found(())
            }
        },
        || wait(SETTLE_STEP_MS),
    );
    let outcome = match result {
        Ok(()) if untouched => Outcome::Untouched,
        Ok(()) => Outcome::Found,
        Err(None) => Outcome::Exhausted,
        Err(Some(why)) => Outcome::Aborted(why),
    };
    let (first, last) = labels.expect("the first read always runs");
    Settled {
        value: kept.expect("the first read always runs"),
        reads,
        outcome,
        first,
        last,
    }
}

#[cfg(test)]
#[path = "focus_settle_tests.rs"]
mod tests;
