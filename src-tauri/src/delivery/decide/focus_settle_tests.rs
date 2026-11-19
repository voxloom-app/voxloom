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
        // An unread or custom role is as coarse as a container.
        "AXUnknown",
        "AXSomeCustomRole",
    ] {
        assert!(
            needs_settle("unsupported", false, Some(role), None),
            "{role}"
        );
    }
    // Controls, grids, secure fields and other outcomes keep their answer.
    for role in [
        "AXButton",
        "AXStaticText",
        "AXTable",
        "AXCell",
        "AXImage",
        "AXSlider",
        "AXCheckBox",
        "AXSecureTextField",
        "AXList",
    ] {
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
    /// The clock when the settle returned.
    clock: u128,
}

use std::cell::{Cell, RefCell};

/// Settle against a scripted clock: the first read already cost
/// `first_cost` ms, every later read costs `cost` ms and every wait its
/// own length.
fn run_timed(mut script: impl FnMut(u32) -> Observation<u32>, first_cost: u128, cost: u128) -> Run {
    let mut observed = 0;
    let clock = Cell::new(first_cost);
    let waits = RefCell::new(Vec::new());
    let mut discarded = Vec::new();
    let settled = settle(
        7,
        || {
            observed += 1;
            if observed > 1 {
                clock.set(clock.get() + cost);
            }
            script(observed)
        },
        |ms| {
            waits.borrow_mut().push(ms);
            clock.set(clock.get() + u128::from(ms));
        },
        || clock.get(),
        |value| discarded.push(value),
    );
    Run {
        settled,
        observed,
        waits: waits.into_inner(),
        discarded,
        clock: clock.get(),
    }
}

fn run(script: impl FnMut(u32) -> Observation<u32>) -> Run {
    run_timed(script, 0, 0)
}

#[test]
fn an_insertable_first_snapshot_is_untouched() {
    let r = run(|_| found(1));
    assert_eq!(r.settled.value, 1);
    assert_eq!(r.settled.outcome, Outcome::Untouched);
    assert_eq!((r.observed, r.settled.reads), (1, 1));
    assert!(r.waits.is_empty() && r.discarded.is_empty());
}

#[test]
fn a_re_read_stops_at_the_first_insertable_snapshot_and_drops_the_older_ones() {
    let r = run(|n| if n < 3 { coarse(n) } else { found(n) });
    assert_eq!(r.settled.value, 3);
    assert_eq!(r.settled.outcome, Outcome::Found);
    assert_eq!((r.observed, r.settled.reads), (3, 3));
    assert_eq!(r.waits, [SETTLE_STEP_MS, SETTLE_STEP_MS]);
    assert_eq!(r.discarded, [1, 2]);
}

#[test]
fn the_wait_is_bounded_to_about_300_ms_in_50_ms_steps() {
    let r = run(coarse);
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
    let r = run(|n| {
        if n == 1 {
            Observation {
                focus_pid: None,
                role: None,
                ..obs(n, "unavailable", false, None)
            }
        } else {
            found(n)
        }
    });
    assert_eq!((r.settled.outcome, r.settled.value), (Outcome::Found, 2));
}

#[test]
fn a_foreground_change_stops_the_re_read_and_keeps_the_earlier_snapshot() {
    let r = run(|n| {
        if n == 1 {
            coarse(n)
        } else {
            Observation {
                front: Some(8),
                ..found(n)
            }
        }
    });
    assert_eq!(r.settled.outcome, Outcome::Aborted("front-changed"));
    assert_eq!((r.settled.value, r.observed, r.settled.reads), (1, 2, 2));
    // The other app's observation is dropped, never used.
    assert_eq!(r.discarded, [2]);
}

#[test]
fn a_focused_pid_change_stops_the_re_read_and_keeps_the_earlier_snapshot() {
    let r = run(|n| {
        if n == 1 {
            coarse(n)
        } else {
            Observation {
                focus_pid: Some(9),
                ..found(n)
            }
        }
    });
    assert_eq!(r.settled.outcome, Outcome::Aborted("pid-changed"));
    assert_eq!((r.settled.value, r.discarded), (1, vec![2]));
    assert_eq!(r.observed, 2, "no read after the change");
}

#[test]
fn a_change_after_some_good_reads_still_stops_and_keeps_the_last_same_pid_one() {
    let r = run(|n| match n {
        1 | 2 => coarse(n),
        _ => Observation {
            front: None,
            ..found(n)
        },
    });
    assert_eq!(r.settled.outcome, Outcome::Aborted("front-changed"));
    assert_eq!(r.settled.value, 2);
    assert_eq!(r.discarded, [1, 3]);
}

#[test]
fn a_first_snapshot_of_another_process_is_not_re_read() {
    let r = run(|n| Observation {
        focus_pid: Some(9),
        ..coarse(n)
    });
    assert_eq!(r.settled.outcome, Outcome::Untouched);
    assert_eq!(r.observed, 1);
    assert!(r.waits.is_empty());
}

#[test]
fn an_insertable_first_snapshot_is_never_re_read_or_replaced_in_any_shape() {
    // Whatever the later reads would say, an insertable first read is final:
    // one observation, no wait, nothing discarded.
    for role in [
        Some("AXTextArea"),
        Some("AXTextField"),
        Some("AXScrollArea"),
        None,
    ] {
        let r = run(|n| {
            if n == 1 {
                obs(n, "insertable", true, role)
            } else {
                coarse(n)
            }
        });
        assert_eq!((r.settled.value, r.observed), (1, 1), "{role:?}");
        assert_eq!(r.settled.outcome, Outcome::Untouched);
        assert!(r.waits.is_empty() && r.discarded.is_empty());
    }
    // Even a slow clock cannot make it re-read.
    let r = run_timed(|n| obs(n, "insertable", true, Some("AXTextArea")), 500, 500);
    assert_eq!((r.settled.value, r.observed, r.waits.len()), (1, 1, 0));
}

#[test]
fn the_settle_stays_inside_the_time_budget_for_any_steady_read_cost() {
    // The first read costs what every later one does.
    for cost in [0, 1, 10, 50, 100, 200, 250, 340, 351] {
        let r = run_timed(coarse, cost, cost);
        assert!(
            r.clock <= SETTLE_BUDGET_MS.max(cost),
            "cost {cost}: finished at {}",
            r.clock
        );
        assert!(r.settled.reads >= 1, "the first read always counts");
        // The last snapshot kept is a real one (the last read), not a gap.
        assert_eq!(r.settled.value, r.observed, "cost {cost}");
        assert!(
            matches!(
                r.settled.outcome,
                Outcome::Exhausted | Outcome::Aborted("budget")
            ),
            "cost {cost}: {:?}",
            r.settled.outcome
        );
    }
}

#[test]
fn the_line_carries_the_measured_settle_time() {
    // Copy is later by this much: the Mac checklist reads it from the line.
    let r = run_timed(coarse, 1, 1);
    assert_eq!(r.settled.ms, r.clock);
    let line = r.settled.line(7, None);
    assert!(
        line.ends_with(&format!("settle_ms={}", r.clock)),
        "ms suffix"
    );
    assert!(r.clock > 300 && r.clock <= SETTLE_BUDGET_MS, "about 0.3 s");
}

#[test]
fn a_slow_first_read_leaves_no_room_to_re_read() {
    // A 250 ms first read (a gated container's whole child walk): another
    // like it cannot finish within the budget, so none starts and no sleep
    // is spent.
    let r = run_timed(coarse, 250, 250);
    assert_eq!(r.settled.outcome, Outcome::Aborted("budget"));
    assert_eq!((r.observed, r.settled.value), (1, 1));
    assert!(r.waits.is_empty());
    assert_eq!(r.clock, 250);
}

#[test]
fn slower_reads_mean_fewer_reads_but_never_more_time() {
    let cheap = run_timed(coarse, 1, 1);
    let dear = run_timed(coarse, 100, 100);
    assert_eq!(cheap.settled.outcome, Outcome::Exhausted);
    assert_eq!(cheap.observed as usize, SETTLE_READS);
    assert!(dear.observed < cheap.observed);
    assert!(dear.clock <= SETTLE_BUDGET_MS);
}

#[test]
fn a_read_that_turns_out_slower_than_expected_ends_the_settle_next() {
    // Cheap first read, then a 300 ms one: it is allowed (nothing said it
    // would be slow) but the next read does not start.
    let r = run_timed(coarse, 0, 300);
    assert_eq!(r.settled.outcome, Outcome::Aborted("budget"));
    assert_eq!(r.observed, 2);
    assert_eq!(r.settled.value, 2);
}

#[test]
fn the_log_line_holds_only_labels_pids_and_counts() {
    let r = run(|n| if n < 2 { coarse(n) } else { found(n) });
    let line = r.settled.line(7, Some(AxName::new("com.microsoft.Word")));
    assert_eq!(
        line,
        "[focus] settle bundle=com.microsoft.Word pid=7 reads=2/7 \
         first=unsupported:AXSplitGroup final=insertable:AXScrollArea outcome=found \
         settle_ms=50"
    );
    // A role or bundle that is not an identifier (prose, field text) is
    // reduced to <invalid>, and reasons never reach the line. The messages
    // name the check: the line is built from the hostile fixture.
    let hostile = run(|n| Observation {
        reason: Some(FIXTURE.into()),
        ..obs(n, "unavailable", false, Some(FIXTURE))
    });
    let line = hostile.settled.line(7, Some(AxName::new(FIXTURE)));
    assert!(!line.contains("secret"), "check 1: no fixture word leaked");
    assert!(
        !line.contains("dictated"),
        "check 2: no fixture word leaked"
    );
    assert!(line.contains("final=unavailable:<invalid>"), "check 3");
    assert!(line.contains("outcome=exhausted"), "check 4");
    let none = run(coarse).settled.line(7, None);
    assert!(none.contains("bundle=-"), "bundle placeholder");
}

// -- settle_target: which completions are re-read at all. --

#[test]
fn settle_target_skips_every_case_that_must_keep_its_first_snapshot() {
    let never = |_: i32| -> bool { panic!("probed too early") };
    let probe_free = || -> bool { panic!("probed too early") };
    // Not wanted (an insertable or settled snapshot): nothing else is even
    // asked of the process.
    assert_eq!(settle_target(false, Some(7), probe_free, never), None);
    // No app in front, or a bogus pid.
    assert_eq!(settle_target(true, None, probe_free, never), None);
    assert_eq!(settle_target(true, Some(0), probe_free, never), None);
    assert_eq!(settle_target(true, Some(-1), probe_free, never), None);
    // A known terminal or paste-route app.
    assert_eq!(settle_target(true, Some(7), || true, never), None);
    // A Chromium/Electron host keeps its own wait.
    assert_eq!(settle_target(true, Some(7), || false, |_| true), None);
    // Everything else.
    assert_eq!(settle_target(true, Some(7), || false, |_| false), Some(7));
}

#[test]
fn settle_target_asks_about_the_front_pid() {
    let asked = Cell::new(0);
    let got = settle_target(
        true,
        Some(42),
        || false,
        |pid| {
            asked.set(pid);
            false
        },
    );
    assert_eq!((got, asked.get()), (Some(42), 42));
}
