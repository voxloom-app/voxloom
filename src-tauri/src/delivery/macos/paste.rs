//! macOS side of the terminal paste route: preflight facts, NSPasteboard and
//! one ⌘V. All policy and ordering live in `decide::paste`.

use super::ax::AXIsProcessTrusted;
use super::{host, keylayout, pasteboard, typing};
use crate::delivery::decide::paste::{PasteHost, PublicationFailure};

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn IsSecureEventInputEnabled() -> u8;
}

pub struct MacPaste {
    /// The terminal that was frontmost when the paste began.
    pub pid: i32,
}

/// Exact retained app/window/element/session guard supplied by coordinator.
/// Cleanup never invokes the guard, so retirement cannot strand cleanup.
pub struct GuardedMacPaste<F> {
    pub pid: i32,
    pub guard: F,
    pub terminal: bool,
}

fn post_owned(
    pid: i32,
    expected: i64,
    guard: impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    use crate::delivery::decide::paste::pasteboard_policy::before_dispatch;
    let keycode = keylayout::v_keycode();
    typing::post_key_chord_guarded(
        keycode,
        typing::FLAG_COMMAND,
        || before_dispatch(expected, &guard, pasteboard::change_count),
        // Command is down: no AX reads, only single cheap calls.
        || before_dispatch(expected, || still_safe(pid), pasteboard::change_count),
    )
}

/// The last check before V: Secure Keyboard Entry and the frontmost app.
fn still_safe(pid: i32) -> Result<(), String> {
    if unsafe { IsSecureEventInputEnabled() } != 0 {
        return Err("Secure Keyboard Entry is on — paste skipped".into());
    }
    MacPaste { pid }.still_frontmost()
}

impl MacPaste {
    fn still_frontmost(&self) -> Result<(), String> {
        if host::frontmost_pid() == Some(self.pid) {
            Ok(())
        } else {
            Err("frontmost app changed — paste skipped".into())
        }
    }
}

impl PasteHost for MacPaste {
    type Saved = pasteboard::Snapshot;

    fn preflight(&self) -> Result<(), String> {
        if unsafe { AXIsProcessTrusted() } == 0 {
            return Err("Accessibility permission denied at paste — paste skipped".into());
        }
        if !typing::can_post_events() {
            return Err("event-posting permission denied — paste skipped".into());
        }
        if unsafe { IsSecureEventInputEnabled() } != 0 {
            return Err("Secure Keyboard Entry is on — paste skipped".into());
        }
        self.still_frontmost()
    }

    fn snapshot(&self) -> Option<Self::Saved> {
        pasteboard::snapshot()
    }

    fn write_transient(&self, text: &str) -> Result<i64, String> {
        pasteboard::write_transient(text)
    }

    fn publish(&self, text: &str, expected: i64) -> Result<i64, PublicationFailure> {
        pasteboard::publish(text, expected)
    }

    fn post_paste(&self) -> Result<(), String> {
        self.post_paste_owned(self.change_count())
    }

    fn post_paste_owned(&self, expected: i64) -> Result<(), String> {
        post_owned(self.pid, expected, || self.preflight())
    }

    fn change_count(&self) -> i64 {
        pasteboard::change_count()
    }

    fn restore(&self, saved: &Self::Saved) -> Result<(), String> {
        pasteboard::restore(saved)
    }

    fn restore_owned(&self, saved: &Self::Saved, expected: i64) -> Result<(), String> {
        pasteboard::restore_owned(saved, expected)
    }

    fn wait(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

impl<F: Fn() -> Result<(), String>> PasteHost for GuardedMacPaste<F> {
    type Saved = pasteboard::Snapshot;

    fn terminal_policy(&self) -> bool {
        self.terminal
    }

    fn preflight(&self) -> Result<(), String> {
        MacPaste { pid: self.pid }.preflight()?;
        (self.guard)()
    }

    fn snapshot(&self) -> Option<Self::Saved> {
        pasteboard::snapshot()
    }

    fn write_transient(&self, text: &str) -> Result<i64, String> {
        pasteboard::write_transient(text)
    }

    fn publish(&self, text: &str, expected: i64) -> Result<i64, PublicationFailure> {
        pasteboard::publish(text, expected)
    }

    fn post_paste(&self) -> Result<(), String> {
        self.post_paste_owned(self.change_count())
    }

    fn post_paste_owned(&self, expected: i64) -> Result<(), String> {
        post_owned(self.pid, expected, || self.preflight())
    }

    fn change_count(&self) -> i64 {
        pasteboard::change_count()
    }

    fn restore(&self, saved: &Self::Saved) -> Result<(), String> {
        pasteboard::restore(saved)
    }

    fn restore_owned(&self, saved: &Self::Saved, expected: i64) -> Result<(), String> {
        pasteboard::restore_owned(saved, expected)
    }

    fn wait(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}
