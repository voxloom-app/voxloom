//! Native identity of the completion-time target: the AX element is retained
//! and later focus is compared with CFEqual. Stable across scroll, reflow and
//! resize; distinct for sibling fields that share every attribute.

use std::sync::Mutex;

use super::ax::{release, AXUIElementRef, CFEqual, CFRetain, CFTypeRef};

pub(super) struct Slot {
    generation: u64,
    element: usize, // retained AXUIElementRef (stored as usize for Send)
    claimed: bool,
}

static SLOT: Mutex<Option<Slot>> = Mutex::new(None);
static NEXT: Mutex<u64> = Mutex::new(0);

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;

pub fn clear() {
    clear_in(&SLOT);
}
pub(super) fn clear_in(slots: &Mutex<Option<Slot>>) {
    if let Ok(mut s) = slots.lock() {
        if let Some(old) = s.take() {
            release(old.element as CFTypeRef);
        }
    }
}

/// Retain `element` as the intended target; returns its generation.
pub fn register(element: AXUIElementRef) -> Option<u64> {
    register_in(element, &SLOT, &NEXT)
}

pub(super) fn register_in(
    element: AXUIElementRef,
    slots: &Mutex<Option<Slot>>,
    next: &Mutex<u64>,
) -> Option<u64> {
    let generation = {
        let mut next = next.lock().ok()?;
        *next += 1;
        *next
    };
    // Do not acquire ownership until the slot can accept it (poison fails closed).
    let mut slot = slots.lock().ok()?;
    let retained = unsafe { CFRetain(element as CFTypeRef) };
    if let Some(old) = slot.take() {
        release(old.element as CFTypeRef);
    }
    *slot = Some(Slot {
        generation,
        element: retained as usize,
        claimed: false,
    });
    Some(generation)
}

pub fn claim(element: AXUIElementRef, generation: u64) -> bool {
    claim_in(element, generation, &SLOT)
}
fn claim_in(element: AXUIElementRef, generation: u64, slots: &Mutex<Option<Slot>>) -> bool {
    let Ok(mut slot) = slots.lock() else {
        return false;
    };
    let Some(s) = slot.as_mut() else {
        return false;
    };
    if s.claimed
        || s.generation != generation
        || unsafe { CFEqual(s.element as CFTypeRef, element as CFTypeRef) } == 0
    {
        return false;
    }
    s.claimed = true;
    true
}

/// Generation of the registered element if `element` is that same element.
pub fn matching_generation(element: AXUIElementRef) -> Option<u64> {
    matching_generation_in(element, &SLOT)
}

pub(super) fn matching_generation_in(
    element: AXUIElementRef,
    slots: &Mutex<Option<Slot>>,
) -> Option<u64> {
    let slot = slots.lock().ok()?;
    let s = slot.as_ref()?;
    (unsafe { CFEqual(s.element as CFTypeRef, element as CFTypeRef) } != 0).then_some(s.generation)
}
