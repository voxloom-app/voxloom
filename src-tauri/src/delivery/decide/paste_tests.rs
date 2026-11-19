use super::*;
use std::cell::{Cell, RefCell};

/// Records every call. `Saved` is the clipboard text; the fake pasteboard
/// bumps its change count on each write, like NSPasteboard.
struct Fake {
    calls: RefCell<Vec<String>>,
    board: RefCell<String>,
    count: Cell<i64>,
    can_snapshot: bool,
    preflight_err: Option<&'static str>,
    write_err: bool,
    /// The transient marker could not be attached (the real glue fails before
    /// touching the pasteboard).
    marker_err: bool,
    post_err: bool,
    restore_err: bool,
    /// Simulates the user copying something while ⌘V is being handled.
    user_copies_during_wait: Option<&'static str>,
    copy_during_snapshot: bool,
    copy_during_post: bool,
    terminal: bool,
    publication_stage: u8,
    now_ms: Cell<u64>,
    v_dispatched_at: Cell<Option<u64>>,
    restore_at: Cell<Option<u64>>,
    slow_guard_ms: u64,
}

impl Fake {
    fn new(prior: &str) -> Self {
        Self {
            calls: RefCell::default(),
            board: RefCell::new(prior.into()),
            count: Cell::new(10),
            can_snapshot: true,
            preflight_err: None,
            write_err: false,
            marker_err: false,
            post_err: false,
            restore_err: false,
            user_copies_during_wait: None,
            copy_during_snapshot: false,
            copy_during_post: false,
            terminal: true,
            publication_stage: 0,
            now_ms: Cell::new(0),
            v_dispatched_at: Cell::new(None),
            restore_at: Cell::new(None),
            slow_guard_ms: 0,
        }
    }
    fn log(&self, call: &str) {
        self.calls.borrow_mut().push(call.into());
    }
    fn calls(&self) -> Vec<String> {
        self.calls.borrow().clone()
    }
    fn write(&self, text: &str) {
        *self.board.borrow_mut() = text.into();
        self.count.set(self.count.get() + 1);
    }
}

impl PasteHost for Fake {
    type Saved = String;
    fn terminal_policy(&self) -> bool {
        self.terminal
    }
    fn preflight(&self) -> Result<(), String> {
        self.log("preflight");
        self.preflight_err.map_or(Ok(()), |e| Err(e.into()))
    }
    fn snapshot(&self) -> Option<String> {
        self.log("snapshot");
        let saved = self.can_snapshot.then(|| self.board.borrow().clone());
        if self.copy_during_snapshot {
            self.write("new copy");
        }
        saved
    }
    fn write_transient(&self, text: &str) -> Result<i64, String> {
        self.log("write");
        if self.marker_err {
            require_marker(false)?;
        }
        self.write(text);
        if self.write_err {
            return Err("pasteboard write failed".into());
        }
        Ok(self.count.get())
    }
    fn post_paste(&self) -> Result<(), String> {
        self.log("post");
        // Command-down is not text dispatch. Model a slow target guard here.
        self.now_ms.set(self.now_ms.get() + self.slow_guard_ms);
        if self.copy_during_post {
            self.write("new copy");
        }
        if self.post_err {
            return Err("frontmost app changed".into());
        }
        self.v_dispatched_at.set(Some(self.now_ms.get()));
        Ok(())
    }
    fn publish(&self, text: &str, expected: i64) -> Result<i64, PublicationFailure> {
        if self.publication_stage == 1 {
            return Err(PublicationFailure::Untouched("preparation refused".into()));
        }
        assert_eq!(self.count.get(), expected);
        let generation = self
            .write_transient(text)
            .map_err(PublicationFailure::Unknown)?;
        if self.publication_stage == 2 {
            return Err(PublicationFailure::Owned {
                generation,
                reason: "partial publication".into(),
            });
        }
        if self.publication_stage == 3 {
            self.write("new copy");
            return Err(PublicationFailure::Unknown("publication raced".into()));
        }
        if self.publication_stage == 4 {
            self.write("new copy");
        }
        Ok(generation)
    }
    fn change_count(&self) -> i64 {
        self.count.get()
    }
    fn restore(&self, saved: &String) -> Result<(), String> {
        self.log("restore");
        self.restore_at.set(Some(self.now_ms.get()));
        if self.restore_err {
            return Err("pasteboard busy".into());
        }
        self.write(saved);
        Ok(())
    }
    fn wait(&self, ms: u64) {
        self.log(&format!("wait {ms}"));
        self.now_ms.set(self.now_ms.get() + ms);
        if let Some(text) = self.user_copies_during_wait {
            self.write(text);
        }
    }
}

#[test]
fn pastes_then_restores_the_prior_clipboard_after_the_delay() {
    let host = Fake::new("my notes");
    let report = paste_text(&host, "hello world").unwrap();
    assert_eq!(
        host.calls(),
        [
            "preflight",
            "snapshot",
            "write",
            "post",
            "wait 1500",
            "restore"
        ]
    );
    assert_eq!(CLIPBOARD_RESTORE_DELAY_MS, 1500);
    assert_eq!(*host.board.borrow(), "my notes");
    assert_eq!(
        report,
        PasteReport {
            clipboard_restored: true,
            restore_skipped_reason: None
        }
    );
}

#[test]
fn snapshot_generation_change_refuses_without_overwriting_new_copy() {
    let mut host = Fake::new("old");
    host.copy_during_snapshot = true;
    assert!(paste_text(&host, "transcript").is_err());
    assert_eq!(host.calls(), ["preflight", "snapshot"]);
    assert_eq!(*host.board.borrow(), "new copy");
}

#[test]
fn editor_payload_allows_multiline_and_tabs_without_terminal_limit() {
    let mut host = Fake::new("old");
    host.terminal = false;
    let text = format!("first\nsecond\t日本語🙂{}", "x".repeat(4097));
    assert!(paste_text(&host, &text).unwrap().clipboard_restored);
    assert!(host.calls().contains(&"post".to_string()));
}

#[test]
fn full_grace_begins_after_text_dispatch_not_command_down_or_slow_guard() {
    let mut host = Fake::new("old");
    host.slow_guard_ms = 900;
    assert!(paste_text(&host, "hello").unwrap().clipboard_restored);
    let text_at = host.v_dispatched_at.get().unwrap();
    assert_eq!(text_at, 900);
    assert!(host.restore_at.get().unwrap() >= text_at + 1500);
}

#[test]
fn identical_text_recopied_during_grace_is_still_a_new_owner() {
    let mut host = Fake::new("old");
    host.user_copies_during_wait = Some("hello");
    assert!(!paste_text(&host, "hello").unwrap().clipboard_restored);
    assert_eq!(*host.board.borrow(), "hello");
    assert!(!host.calls().contains(&"restore".into()));
}

#[test]
fn an_empty_prior_clipboard_is_restored_too() {
    let host = Fake::new("");
    assert!(paste_text(&host, "hi").unwrap().clipboard_restored);
    assert_eq!(*host.board.borrow(), "");
}

#[test]
fn a_copy_made_meanwhile_is_never_clobbered() {
    let mut host = Fake::new("my notes");
    host.user_copies_during_wait = Some("fresh copy");
    let report = paste_text(&host, "hello").unwrap();
    assert!(!report.clipboard_restored);
    assert_eq!(
        report.restore_skipped_reason.as_deref(),
        Some("clipboard changed during paste — left as-is")
    );
    assert!(!host.calls().contains(&"restore".to_string()));
    assert_eq!(*host.board.borrow(), "fresh copy");
}

#[test]
fn an_unsavable_clipboard_refuses_before_mutation() {
    let mut host = Fake::new("my notes");
    host.can_snapshot = false;
    let error = paste_text(&host, "hello").unwrap_err();
    assert!(error.starts_with("delivery-safe-refusal:"));
    assert_eq!(host.calls(), ["preflight", "snapshot"]);
    assert_eq!(*host.board.borrow(), "my notes");
}

#[test]
fn clipboard_refusals_say_whether_a_newer_copy_exists() {
    // Concealed or oversized: never touched, still the user's clipboard.
    let mut host = Fake::new("secret");
    host.can_snapshot = false;
    let error = paste_text(&host, "hello").unwrap_err();
    assert!(error.starts_with(CLIPBOARD_UNSAVED), "{error}");
    // A copy landed while saving, whether or not the save completed.
    for can_snapshot in [true, false] {
        let mut host = Fake::new("old");
        host.can_snapshot = can_snapshot;
        host.copy_during_snapshot = true;
        let error = paste_text(&host, "hello").unwrap_err();
        assert!(error.starts_with(CLIPBOARD_CHANGED), "{error}");
        assert_eq!(host.calls(), ["preflight", "snapshot"]);
        assert_eq!(*host.board.borrow(), "new copy");
    }
}

#[test]
fn a_failed_restore_is_reported_not_hidden() {
    let mut host = Fake::new("my notes");
    host.restore_err = true;
    let report = paste_text(&host, "hello").unwrap();
    assert!(!report.clipboard_restored);
    assert_eq!(
        report.restore_skipped_reason.as_deref(),
        Some("restore did not complete: pasteboard busy")
    );
}

#[test]
fn unsafe_text_is_refused_before_anything_happens() {
    for text in [
        "",
        "a\nb",
        "a\rb",
        "tab\there",
        "a\u{2028}b",
        "a\u{0}b",
        "esc\u{1b}",
    ] {
        let host = Fake::new("my notes");
        assert!(paste_text(&host, text).is_err(), "{text:?}");
        assert!(host.calls().is_empty(), "{text:?}: {:?}", host.calls());
    }
    let host = Fake::new("x");
    assert!(paste_text(&host, &"a".repeat(4097)).is_err());
    assert!(host.calls().is_empty());
}

#[test]
fn a_failed_preflight_never_touches_the_clipboard() {
    let mut host = Fake::new("my notes");
    host.preflight_err = Some("Secure Keyboard Entry is on — paste skipped");
    let error = paste_text(&host, "hello").unwrap_err();
    assert!(error.contains("Secure Keyboard Entry"));
    assert_eq!(host.calls(), ["preflight"]);
    assert_eq!(host.count.get(), 10);
}

#[test]
fn a_failed_post_is_an_error_and_puts_the_clipboard_back() {
    let mut host = Fake::new("my notes");
    host.post_err = true;
    assert_eq!(
        paste_text(&host, "hello").unwrap_err(),
        "delivery-safe-refusal:frontmost app changed"
    );
    assert_eq!(*host.board.borrow(), "my notes");
    assert!(!host.calls().iter().any(|c| c.starts_with("wait")));
}

#[test]
fn post_refusal_is_not_safe_when_cleanup_fails_or_ownership_is_lost() {
    for newer_copy in [false, true] {
        let mut host = Fake::new("old");
        host.post_err = true;
        host.restore_err = !newer_copy;
        host.copy_during_post = newer_copy;
        let error = paste_text(&host, "hello").unwrap_err();
        assert!(!error.starts_with("delivery-safe-refusal:"));
        assert!(error.contains("clipboard"), "{error}");
        if newer_copy {
            assert_eq!(*host.board.borrow(), "new copy");
            assert!(!host.calls().contains(&"restore".to_string()));
        }
    }
}

#[test]
fn newer_copy_after_publication_refuses_before_dispatch() {
    let mut host = Fake::new("old");
    host.publication_stage = 4;
    assert!(paste_text(&host, "hello").is_err());
    assert!(!host.calls().contains(&"post".to_string()));
    assert!(!host.calls().contains(&"restore".to_string()));
    assert_eq!(*host.board.borrow(), "new copy");
}

#[test]
fn typed_publication_stage_controls_cleanup_and_safe_refusal() {
    for stage in 1..=3 {
        for cleanup_fails in [false, true] {
            let mut host = Fake::new("old");
            host.publication_stage = stage;
            host.restore_err = cleanup_fails;
            let error = paste_text(&host, "hello").unwrap_err();
            assert_eq!(
                error.starts_with("delivery-safe-refusal:"),
                stage == 1 || (stage == 2 && !cleanup_fails)
            );
            assert_eq!(host.calls().contains(&"restore".to_string()), stage == 2);
            assert!(!host.calls().contains(&"post".to_string()));
            if stage == 3 {
                assert_eq!(*host.board.borrow(), "new copy");
            }
        }
    }
}

#[test]
fn an_unknown_write_failure_does_not_guess_ownership_or_restore() {
    let mut host = Fake::new("my notes");
    host.write_err = true;
    let error = paste_text(&host, "hello").unwrap_err();
    assert!(!error.starts_with("delivery-safe-refusal:"));
    assert!(!host.calls().contains(&"post".to_string()));
    assert!(!host.calls().contains(&"restore".to_string()));
    assert_eq!(*host.board.borrow(), "hello");
}

#[test]
fn a_transcript_that_cannot_be_marked_transient_is_never_pasted() {
    assert!(require_marker(true).is_ok());
    let mut host = Fake::new("my notes");
    host.marker_err = true;
    let error = paste_text(&host, "hello").unwrap_err();
    assert!(
        error.contains("transient") && error.ends_with("paste skipped"),
        "{error}"
    );
    // No ⌘V, no wait, and the user's clipboard is exactly what it was.
    assert!(!host.calls().contains(&"post".to_string()));
    assert!(!host.calls().iter().any(|c| c.starts_with("wait")));
    assert_eq!(*host.board.borrow(), "my notes");
}
