use super::super::ax::test_support::Owned;
use super::*;
use std::sync::Mutex;

#[test]
fn reserved_publication_protects_real_legacy_cf_slot_and_retains() {
    let targets = Targets::new();
    let slots = Mutex::new(None);
    let generations = Mutex::new(0);
    let a = Owned::string("heap completion identity A fixture");
    let b = Owned::string("heap completion identity B fixture");
    let window = Owned::string("heap completion window fixture");
    let obs = |element: &Owned| Observation {
        pid: Some(7),
        process: Some("fixture-start-1".into()),
        window: Identity::owned(unsafe { CFRetain(window.0) }),
        element: Identity::owned(unsafe { CFRetain(element.0) }),
        trusted: true,
        coherent: true,
        secure_input: false,
        terminal: false,
        apple_terminal: false,
        snapshot: crate::delivery::decide::test_support::target(
            "insertable",
            Some(7),
            Some("legacy"),
        ),
    };
    let first = obs(&a);
    let second = obs(&b);
    let base_a = a.count();
    let base_b = b.count();
    let newer_token = std::cell::RefCell::new(String::new());
    let result = targets.snapshot(
        "a".into(),
        || first.clone(),
        |_| {
            let new = targets
                .snapshot(
                    "b".into(),
                    || second.clone(),
                    |o| (o.snapshot.clone(), o.element.clone()),
                    || registry::clear_in(&slots),
                    |e| registry::register_in(e.unwrap().raw(), &slots, &generations),
                )
                .unwrap();
            *newer_token.borrow_mut() = new.shared_paste_token.unwrap();
            (first.snapshot.clone(), first.element.clone())
        },
        || registry::clear_in(&slots),
        |e| registry::register_in(e.unwrap().raw(), &slots, &generations),
    );
    assert!(result.is_err());
    assert_eq!(
        registry::matching_generation_in(b.0 as AXUIElementRef, &slots),
        Some(1)
    );
    assert_eq!(
        registry::matching_generation_in(a.0 as AXUIElementRef, &slots),
        None
    );
    assert!(targets
        .validate(&newer_token.borrow(), || second.clone())
        .is_ok());
    assert_eq!(a.count(), base_a);
    assert_eq!(
        b.count(),
        base_b + 2,
        "new token and real legacy slot each own a retain"
    );
    targets.retire(|| registry::clear_in(&slots));
    assert_eq!(b.count(), base_b);
    assert!(targets
        .validate(&newer_token.borrow(), || second.clone())
        .is_err());
}

#[test]
fn cf_identity_is_not_pointer_equality() {
    let a = Owned::string("heap CF equal identity fixture");
    let b = Owned::string("heap CF equal identity fixture");
    let ia = Identity::owned(unsafe { CFRetain(a.0) }).unwrap();
    let ib = Identity::owned(unsafe { CFRetain(b.0) }).unwrap();
    assert!(ia == ib);
}
