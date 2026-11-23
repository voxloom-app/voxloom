//! BUS-229: a prewarm only serves a dictation of the model it loads. A
//! dictation of the other model never takes the load over (it would answer
//! with the wrong model) and ends it, so two models never load side by side.

use super::prewarm::{all_reaped, dictation, idle, prewarm_worker, spawns};
use super::*;
use crate::cleanup::test_support::wait_until;
use std::time::{Duration, Instant};

const OTHER_MODEL: &str = "other-model";

fn never() -> bool {
    false
}

#[test]
fn a_dictation_of_another_model_runs_its_own_worker_and_ends_the_load() {
    // A 1 s load and a 5 s warm-up: left alone it would idle until ~6 s.
    let (path, log) = prewarm_worker("prewarm-other-model", 1.0, 5.0);
    let supervisor = WorkerSupervisor::new(path);
    assert!(supervisor
        .reserve_prewarm(OTHER_MODEL)
        .unwrap()
        .start(model_file("prewarm-other-model"), never));
    let started = Instant::now();
    assert_eq!(dictation(&supervisor, "other-model-run").unwrap(), "fresh");
    assert!(wait_until(Duration::from_secs(5), || idle(&supervisor)));
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "the load was ended"
    );
    // The killed load may not have lived long enough to log its spawn.
    assert!(wait_until(Duration::from_secs(5), || all_reaped(&log)));
}

#[test]
fn a_dictation_of_the_same_model_still_takes_the_load_over() {
    let (path, log) = prewarm_worker("prewarm-same-model", 0.3, 5.0);
    let supervisor = WorkerSupervisor::new(path);
    assert!(supervisor
        .reserve_prewarm(MODEL_ID)
        .unwrap()
        .start(model_file("prewarm-same-model"), never));
    assert_eq!(dictation(&supervisor, "same-model-run").unwrap(), "reused");
    assert!(wait_until(Duration::from_secs(5), || idle(&supervisor)));
    assert_eq!(spawns(&log), 1);
}
