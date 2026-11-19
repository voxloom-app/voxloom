use super::*;
use crate::delivery::decide::paste_role::GRID_REASON;

const FIXTURE: &str = "dictated secret phrase";

#[test]
fn only_an_unavailable_or_coarse_unsupported_snapshot_triggers_a_re_read() {
    // Already insertable: never touched, whatever the role.
    for role in [Some("AXTextArea"), Some("AXScrollArea"), None] {
        assert!(!needs_settle("insertable", true, role, None), "{role:?}");
    }
    // The insertable flag alone is enough, whatever else the snapshot says.
    assert!(!needs_settle("unsupported", true, Some("AXGroup"), None));
    assert!(!needs_settle("unavailable", true, None, None));
    assert!(needs_settle("unavailable", false, None, None));
    for role in [
        "AXSplitGroup",
        "AXGroup",
        "AXScrollArea",
        "AXWindow",
        "AXApplication",
        "AXWebArea",
        "AXDocument",
        "AXTabGroup",
        "unknown",
    ] {
        assert!(
            needs_settle("unsupported", false, Some(role), None),
            "{role}"
        );
    }
    // Controls, grids, secure fields and other outcomes keep their answer.
    for role in ["AXButton", "AXStaticText", "AXTable", "AXCell", "AXImage"] {
        assert!(
            !needs_settle("unsupported", false, Some(role), None),
            "{role}"
        );
    }
    assert!(!needs_settle(
        "unsupported",
        false,
        Some("AXGroup"),
        Some(GRID_REASON)
    ));
    for kind in ["secure", "changed", "closed", "other"] {
        assert!(!needs_settle(kind, false, Some("AXGroup"), None), "{kind}");
    }
    assert!(!needs_settle("unsupported", false, None, None));
}

fn obs(value: u32, kind: &str, insertable: bool, role: Option<&str>) -> Observation<u32> {
    Observation {
        value,
        front: Some(7),
        focus_pid: Some(7),
        kind: kind.into(),
        insertable,
        role: role.map(str::to_string),
        reason: None,
    }
}

fn coarse(value: u32) -> Observation<u32> {
    obs(value, "unsupported", false, Some("AXSplitGroup"))
}

fn found(value: u32) -> Observation<u32> {
    obs(value, "insertable", true, Some("AXScrollArea"))
}

struct Run {
    settled: Settled<u32>,
    observed: u32,
    waits: Vec<u64>,
    discarded: Vec<u32>,
}

use std::cell::RefCell;

fn run(mut script: impl FnMut(u32) -> Observation<u32>, elapsed: impl Fn(u32) -> u128) -> Run {
    let mut observed = 0;
    let waits = RefCell::new(Vec::new());
    let mut discarded = Vec::new();
    let settled = settle(
        7,
        || {
            observed += 1;
            script(observed)
        },
        |ms| waits.borrow_mut().push(ms),
        || elapsed(waits.borrow().len() as u32),
        |value| discarded.push(value),
    );
    Run {
        settled,
        observed,
        waits: waits.into_inner(),
        discarded,
    }
}

#[test]
fn an_insertable_first_snapshot_is_untouched() {
    let r = run(|_| found(1), |_| 0);
    assert_eq!(r.settled.value, 1);
    assert_eq!(r.settled.outcome, Outcome::Untouched);
    assert_eq!((r.observed, r.settled.reads), (1, 1));
    assert!(r.waits.is_empty() && r.discarded.is_empty());
}

#[test]
fn a_re_read_stops_at_the_first_insertable_snapshot_and_drops_the_older_ones() {
    let r = run(|n| if n < 3 { coarse(n) } else { found(n) }, |_| 0);
    assert_eq!(r.settled.value, 3);
    assert_eq!(r.settled.outcome, Outcome::Found);
    assert_eq!((r.observed, r.settled.reads), (3, 3));
    assert_eq!(r.waits, [SETTLE_STEP_MS, SETTLE_STEP_MS]);
    assert_eq!(r.discarded, [1, 2]);
}

#[test]
fn the_wait_is_bounded_to_about_300_ms_in_50_ms_steps() {
    let r = run(coarse, |_| 0);
    assert_eq!(r.settled.outcome, Outcome::Exhausted);
    assert_eq!(r.observed as usize, SETTLE_READS);
    assert_eq!(r.settled.reads, SETTLE_READS);
    assert_eq!(r.waits.len(), SETTLE_READS - 1);
    assert_eq!(r.waits.iter().sum::<u64>(), 300);
    // The last observation is kept (honest reasons); the others are dropped.
    assert_eq!(r.settled.value, SETTLE_READS as u32);
    assert_eq!(r.discarded.len(), SETTLE_READS - 1);
}

#[test]
fn an_unavailable_first_snapshot_is_re_read_too() {
    let r = run(
        |n| {
            if n == 1 {
                Observation {
                    focus_pid: None,
                    role: None,
                    ..obs(n, "unavailable", false, None)
                }
            } else {
                found(n)
            }
        },
        |_| 0,
    );
    assert_eq!((r.settled.outcome, r.settled.value), (Outcome::Found, 2));
}

#[test]
fn a_foreground_or_pid_change_stops_the_re_read_and_keeps_the_earlier_snapshot() {
    let r = run(
        |n| {
            if n == 1 {
                coarse(n)
            } else {
                Observation {
                    front: Some(8),
                    ..found(n)
                }
            }
        },
        |_| 0,
    );
    assert_eq!(r.settled.outcome, Outcome::Aborted("front-changed"));
    assert_eq!((r.settled.value, r.observed, r.settled.reads), (1, 2, 2));
    // The other app's observation is dropped, never used.
    assert_eq!(r.discarded, [2]);

    let r = run(
        |n| {
            if n == 1 {
                coarse(n)
            } else {
                Observation {
                    focus_pid: Some(9),
                    ..found(n)
                }
            }
        },
        |_| 0,
    );
    assert_eq!(r.settled.outcome, Outcome::Aborted("pid-changed"));
    assert_eq!((r.settled.value, r.discarded), (1, vec![2]));
}

#[test]
fn a_first_snapshot_of_another_process_is_not_re_read() {
    let r = run(
        |n| Observation {
            focus_pid: Some(9),
            ..coarse(n)
        },
        |_| 0,
    );
    assert_eq!(r.settled.outcome, Outcome::Untouched);
    assert_eq!(r.observed, 1);
    assert!(r.waits.is_empty());
}

#[test]
fn slow_reads_stop_at_the_time_budget() {
    // Each wait step adds 100 ms of read time.
    let r = run(coarse, |waits| u128::from(waits) * 100);
    assert_eq!(r.settled.outcome, Outcome::Aborted("budget"));
    assert!(r.observed < SETTLE_READS as u32, "{}", r.observed);
    assert_eq!(r.settled.value, r.observed);
}

#[test]
fn the_log_line_holds_only_labels_pids_and_counts() {
    let r = run(|n| if n < 2 { coarse(n) } else { found(n) }, |_| 0);
    let line = r.settled.line(7, Some(AxName::new("com.microsoft.Word")));
    assert_eq!(
        line,
        "[focus] settle bundle=com.microsoft.Word pid=7 reads=2/7 \
         first=unsupported:AXSplitGroup final=insertable:AXScrollArea outcome=found"
    );
    // A role or bundle that is not an identifier (prose, field text) is
    // reduced to <invalid>, and reasons never reach the line.
    let hostile = run(
        |n| Observation {
            reason: Some(FIXTURE.into()),
            ..obs(n, "unavailable", false, Some(FIXTURE))
        },
        |_| 0,
    );
    let line = hostile.settled.line(7, Some(AxName::new(FIXTURE)));
    assert!(
        !line.contains("secret") && !line.contains("dictated"),
        "{line}"
    );
    assert!(line.contains("final=unavailable:<invalid>"), "{line}");
    assert!(line.contains("outcome=exhausted"), "{line}");
    let none = run(coarse, |_| 0).settled.line(7, None);
    assert!(none.contains("bundle=-"), "{none}");
}
