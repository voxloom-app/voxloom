//! Completion authority. OS observations are injected, ownership and ordering are not.
use std::sync::Mutex;

use super::paste::{CLIPBOARD_CHANGED, CLIPBOARD_UNSAVED};
use super::report::PasteReport;
use crate::delivery::types::TargetSnapshotDto;

pub const SAFE_REFUSAL: &str = "delivery-safe-refusal:";
pub fn refused(reason: &str) -> String {
    format!("{SAFE_REFUSAL}{reason}")
}

#[derive(Clone)]
pub struct Observation<I> {
    pub pid: Option<i32>,
    pub process: Option<String>,
    pub window: Option<I>,
    pub element: Option<I>,
    /// Accessibility trust, read at the start and end of the observation.
    pub trusted: bool,
    /// Element, window and process agreed with the frontmost app throughout
    /// the observation. Only shared paste needs this: a focused field owned by
    /// another process (a non-activating panel such as Spotlight) keeps the
    /// verified AX route, as before shared paste existed.
    pub coherent: bool,
    pub secure_input: bool,
    pub snapshot: TargetSnapshotDto,
    pub terminal: bool,
    pub apple_terminal: bool,
}

impl<I: PartialEq> Observation<I> {
    fn eligible(&self) -> bool {
        self.trusted
            && self.coherent
            && !self.secure_input
            && self.snapshot.kind != "secure"
            && self.pid.is_some_and(|p| p > 0)
            && self.process.is_some()
            && self.window.is_some()
            && !matches!(
                self.snapshot.element_role.as_deref(),
                Some(
                    "AXButton"
                        | "AXMenu"
                        | "AXMenuItem"
                        | "AXToolbar"
                        | "AXImage"
                        | "AXStaticText"
                        | "AXTable"
                        | "AXOutline"
                        | "AXGrid"
                )
            )
    }
    fn matches(&self, now: &Self) -> bool {
        self.eligible()
            && now.eligible()
            && self.pid == now.pid
            && self.process == now.process
            && self.window == now.window
            && self
                .element
                .as_ref()
                .is_none_or(|e| now.element.as_ref() == Some(e))
    }
}

struct Entry<I> {
    token: String,
    target: Observation<I>,
    /// The completion snapshot found an AX-editable field.
    editable: bool,
    claimed: bool,
}
struct State<I> {
    generation: u64,
    entry: Option<Entry<I>>,
    legacy_generation: Option<u64>,
    legacy_claimed: bool,
}
pub struct Targets<I> {
    state: Mutex<State<I>>,
}
impl<I> Default for Targets<I> {
    fn default() -> Self {
        Self::new()
    }
}
impl<I> Targets<I> {
    pub const fn new() -> Self {
        Self {
            state: Mutex::new(State {
                generation: 0,
                entry: None,
                legacy_generation: None,
                legacy_claimed: false,
            }),
        }
    }
    pub fn retire(&self, clear_legacy: impl FnOnce()) {
        // Poison remains fail-closed for future admission, but must not stop
        // revocation of a legacy guard already held by an in-flight writer.
        let mut s = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        s.generation = s.generation.saturating_add(1);
        s.entry = None;
        s.legacy_generation = None;
        s.legacy_claimed = false;
        clear_legacy();
    }
    fn reserve(&self, clear_legacy: impl FnOnce()) -> Result<u64, String> {
        let mut s = self
            .state
            .lock()
            .map_err(|_| refused("target registry unavailable"))?;
        s.generation = s
            .generation
            .checked_add(1)
            .ok_or_else(|| refused("target generation exhausted"))?;
        s.entry = None;
        s.legacy_generation = None;
        s.legacy_claimed = false;
        clear_legacy();
        Ok(s.generation)
    }
}

impl<I: Clone + PartialEq> Targets<I> {
    /// Reserve BEFORE the first OS read/warmup. Legacy publication occurs under
    /// this reservation's lock; no AX reads or warming belong in `publish_legacy`.
    pub fn snapshot(
        &self,
        nonce: String,
        observe: impl Fn() -> Observation<I>,
        warm: impl FnOnce(&Observation<I>) -> (TargetSnapshotDto, Option<I>),
        clear_legacy: impl FnOnce(),
        publish_legacy: impl FnOnce(Option<&I>) -> Option<u64>,
    ) -> Result<TargetSnapshotDto, String> {
        let generation = self.reserve(clear_legacy)?;
        let first = observe();
        let (mut snapshot, legacy) = warm(&first);
        let now = observe();
        let mut s = self
            .state
            .lock()
            .map_err(|_| refused("target registry unavailable"))?;
        if s.generation != generation {
            return Err(refused("completion initialization superseded"));
        }
        let same_scope =
            first.pid == now.pid && first.process == now.process && first.window == now.window;
        if !same_scope
            || !now.trusted
            || now.secure_input
            || now.snapshot.kind == "secure"
            || (first.snapshot.insertable && first.element != now.element)
        {
            let mut refused = TargetSnapshotDto::unavailable(
                "completion destination changed or unavailable",
                snapshot.captured_at,
            );
            refused.app_pid = first.pid;
            return Ok(refused);
        }
        let legacy_generation = publish_legacy(legacy.as_ref());
        s.legacy_generation = legacy_generation;
        s.legacy_claimed = false;
        if let Some(role) = snapshot.element_role.as_deref() {
            snapshot.element_id = Some(super::element_token(
                snapshot.app_pid,
                role,
                legacy_generation,
            ));
        }
        snapshot.paste_terminal = false;
        snapshot.paste_app = None;
        snapshot.shared_paste_token = None;
        if first.matches(&now) && !first.apple_terminal {
            let token = format!("{generation}:{nonce}");
            snapshot.shared_paste_token = Some(token.clone());
            s.entry = Some(Entry {
                token,
                target: first,
                editable: snapshot.insertable,
                claimed: false,
            });
        }
        Ok(snapshot)
    }

    pub fn validate(
        &self,
        token: &str,
        observe: impl FnOnce() -> Observation<I>,
    ) -> Result<Observation<I>, String> {
        let target = {
            let s = self
                .state
                .lock()
                .map_err(|_| refused("target registry unavailable"))?;
            let e = s
                .entry
                .as_ref()
                .filter(|e| e.token == token && !e.claimed)
                .ok_or_else(|| refused("target retired or consumed"))?;
            e.target.clone()
        };
        let observed = observe();
        if !target.matches(&observed) {
            let mut s = self
                .state
                .lock()
                .map_err(|_| refused("target registry unavailable"))?;
            if s.entry.as_ref().is_some_and(|e| e.token == token) {
                s.entry = None;
                s.legacy_generation = None;
                s.legacy_claimed = false;
            }
            return Err(refused("completion destination changed or unavailable"));
        }
        let s = self
            .state
            .lock()
            .map_err(|_| refused("target registry unavailable"))?;
        if !s
            .entry
            .as_ref()
            .is_some_and(|e| e.token == token && !e.claimed)
        {
            return Err(refused("target retired or consumed"));
        }
        Ok(observed)
    }

    /// Share single-use authorization across AX/Unicode and generic paste.
    /// The generation comes from the native CF registry, never the caller DTO.
    pub fn claim_legacy(&self, generation: u64) -> Result<(), String> {
        let mut s = self
            .state
            .lock()
            .map_err(|_| refused("target registry unavailable"))?;
        if s.legacy_generation != Some(generation) || s.legacy_claimed {
            return Err(refused("completion authorization retired or consumed"));
        }
        s.legacy_claimed = true;
        if let Some(e) = s.entry.as_mut() {
            e.claimed = true;
        }
        Ok(())
    }

    /// Own serialization through settlement. Claim once AFTER
    /// acquiring that lock; `guard` remains valid for that exact claim only.
    pub fn deliver(
        &self,
        serial: &Mutex<()>,
        token: &str,
        text: &str,
        observe: impl Fn() -> Observation<I>,
        paste: impl FnOnce(
            i32,
            bool,
            &str,
            &dyn Fn() -> Result<(), String>,
        ) -> Result<PasteReport, String>,
    ) -> Result<PasteReport, String> {
        let _serial = serial
            .lock()
            .map_err(|_| "delivery ownership unavailable; prior cleanup unknown".to_string())?;
        self.validate(token, &observe)?;
        let target = {
            let mut s = self
                .state
                .lock()
                .map_err(|_| refused("target registry unavailable"))?;
            let e = s
                .entry
                .as_mut()
                .filter(|e| e.token == token && !e.claimed)
                .ok_or_else(|| refused("target retired or consumed"))?;
            // Without an editable field (an unlisted terminal, a canvas) a
            // pasted line break or tab can act as a command. Known terminals
            // get the transaction's terminal check; editable fields keep
            // multi-line paste. Refused before the claim: nothing dispatched.
            if !e.target.terminal && !e.editable {
                super::check_typing_text(text).map_err(|err| refused(&err))?;
            }
            e.claimed = true;
            let target = e.target.clone();
            s.legacy_claimed = true;
            target
        };
        let guard = || {
            let now = observe();
            let s = self
                .state
                .lock()
                .map_err(|_| refused("target registry unavailable"))?;
            if !s
                .entry
                .as_ref()
                .is_some_and(|e| e.token == token && e.claimed)
                || !target.matches(&now)
            {
                return Err(refused(
                    "completion destination retired, changed or unavailable",
                ));
            }
            Ok(())
        };
        // Do not wrap transaction errors: only the clipboard owner knows if
        // cleanup completed and a refusal is safe for automatic recovery.
        let result = paste(target.pid.unwrap(), target.terminal, text, &guard);
        if let Err(err) = &result {
            // Refused while saving the clipboard: nothing was written or posted.
            // Release the claim so the verified AX route may still run once.
            if err.starts_with(CLIPBOARD_UNSAVED) || err.starts_with(CLIPBOARD_CHANGED) {
                if let Ok(mut s) = self.state.lock() {
                    if let Some(e) = s.entry.as_mut().filter(|e| e.token == token) {
                        e.claimed = false;
                        s.legacy_claimed = false;
                    }
                }
            }
        }
        result
    }
}

#[cfg(test)]
#[path = "shared_target_tests.rs"]
mod tests;
