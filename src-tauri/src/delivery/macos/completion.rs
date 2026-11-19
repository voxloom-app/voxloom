//! Real macOS completion observation and retained-target orchestration.
//! No activation, focus restoration, field text, title or tree walks for paste.
use super::{ax::*, focus, host, registry, web_ax};
use crate::delivery::{
    decide::shared_target::{Observation, Targets},
    types::TargetSnapshotDto,
};

/// A create/copy-rule AX/CF object. AX identity uses CFEqual, never pointer or
/// string equality. Stored as usize to permit retained AX handles on workers.
/// All constructors are private; every cloned handle owns its retain.
pub(super) struct Identity(usize);
impl Identity {
    fn owned(value: CFTypeRef) -> Option<Self> {
        (!value.is_null()).then_some(Self(value as usize))
    }
    pub(super) fn raw(&self) -> AXUIElementRef {
        self.0 as AXUIElementRef
    }
}
impl Clone for Identity {
    fn clone(&self) -> Self {
        Self(unsafe { CFRetain(self.0 as CFTypeRef) } as usize)
    }
}
impl Drop for Identity {
    fn drop(&mut self) {
        release(self.0 as CFTypeRef);
    }
}
impl PartialEq for Identity {
    fn eq(&self, other: &Self) -> bool {
        unsafe { CFEqual(self.0 as CFTypeRef, other.0 as CFTypeRef) != 0 }
    }
}

pub(super) static TARGETS: Targets<Identity> = Targets::new();

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn IsSecureEventInputEnabled() -> u8;
}
extern "C" {
    fn arc4random_buf(buffer: *mut std::ffi::c_void, count: usize);
}

pub(super) fn secure_input_enabled() -> bool {
    (unsafe { IsSecureEventInputEnabled() }) != 0
}

fn nonce() -> String {
    let mut bytes = [0u8; 16];
    unsafe {
        arc4random_buf(bytes.as_mut_ptr().cast(), bytes.len());
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Process lifetime plus executable identity. A reused PID cannot authorize an
/// earlier app lifetime. NSRunningApplication is read-only and never activated.
fn process_identity(pid: i32) -> Option<String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    let exe = host::executable_path(pid)?;
    objc2::rc::autoreleasepool(|_| unsafe {
        let app: *mut AnyObject =
            msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
        if app.is_null() {
            return None;
        }
        let date: *mut AnyObject = msg_send![app, launchDate];
        if date.is_null() {
            return None;
        }
        let started: f64 = msg_send![date, timeIntervalSince1970];
        started
            .is_finite()
            .then(|| format!("{exe}:{}", started.to_bits()))
    })
}

pub(super) fn observe() -> Observation<Identity> {
    let trusted = unsafe { AXIsProcessTrusted() } != 0;
    let secure_input = unsafe { IsSecureEventInputEnabled() } != 0;
    let pid = host::frontmost_pid();
    let process = pid.and_then(process_identity);
    let app = trusted
        .then(|| pid.map(|p| unsafe { AXUIElementCreateApplication(p) }))
        .flatten()
        .and_then(|a| Identity::owned(a as CFTypeRef));
    let window = app
        .as_ref()
        .and_then(|a| copy_attr(a.raw(), "AXFocusedWindow").ok())
        .and_then(Identity::owned)
        .filter(|w| {
            element_pid(w.raw()) == pid
                && copy_string_attr(w.raw(), "AXRole").as_deref() == Some("AXWindow")
        });
    let found = if trusted {
        focus::focused_ui_element_once("completion observation").ok()
    } else {
        None
    };
    let (element, name) = match found {
        Some((e, name)) => (Identity::owned(e as CFTypeRef), name),
        None => (None, None),
    };
    let mut snapshot = element
        .as_ref()
        .map(|e| focus::build_snapshot(e.raw(), name, false))
        .unwrap_or_else(|| {
            TargetSnapshotDto::unavailable("Accessibility focus unavailable", focus::now_ms())
        });
    // The focused element's own process, else the frontmost one (as
    // `flag_terminal` does). They differ only for an incoherent observation,
    // which never mints paste authority; the AX route needs the element's pid.
    snapshot.app_pid = snapshot.app_pid.or(pid);
    snapshot.known_terminal = host::terminal_flags(snapshot.app_pid).known;
    let element_in_window = element.as_ref().is_none_or(|e| {
        element_pid(e.raw()) == pid
            && window.as_ref().is_none_or(|w| {
                // An explicitly conflicting window is incoherent. Missing element
                // AXWindow must not disable the existing AX route; paste still
                // independently requires the application's focused window.
                copy_attr(e.raw(), "AXWindow")
                    .ok()
                    .and_then(Identity::owned)
                    .as_ref()
                    .is_none_or(|element_window| element_window == w)
            })
    });
    // Recheck independently after all potentially slow AX/process reads.
    let coherent = element_in_window
        && host::frontmost_pid() == pid
        && pid.and_then(process_identity) == process;
    let trusted = trusted && unsafe { AXIsProcessTrusted() } != 0;
    let secure_input = secure_input || unsafe { IsSecureEventInputEnabled() } != 0;
    Observation {
        pid,
        process,
        window,
        element,
        trusted,
        coherent,
        secure_input,
        snapshot,
        terminal: pid.and_then(host::executable_path).is_some_and(|exe| {
            crate::delivery::decide::known_terminal::is_known_terminal(&exe)
                && !crate::delivery::decide::messages_app::apple_messages_host(&exe)
        }),
        apple_terminal: pid.is_some_and(host::apple_terminal),
    }
}

fn warm(first: &Observation<Identity>) -> (TargetSnapshotDto, Option<Identity>) {
    if !first.trusted || first.secure_input || first.snapshot.kind == "secure" {
        return (first.snapshot.clone(), None);
    }
    // Existing native fields stay pinned to their FIRST identity. Only the
    // established context-guarded cold-web route may discover a late AX field.
    web_ax::reassert(first.pid);
    if first.snapshot.insertable {
        return (first.snapshot.clone(), first.element.clone());
    }
    let initial = first
        .element
        .as_ref()
        .map(|e| (e.clone().into_raw(), first.snapshot.app_name.clone()))
        .ok_or_else(|| "Accessibility focus unavailable".to_string());
    match web_ax::settle_focus("transcription completion", first.pid, initial) {
        Ok((raw, name)) => {
            let owned = Identity::owned(raw as CFTypeRef).unwrap();
            (focus::build_snapshot(raw, name, false), Some(owned))
        }
        Err(_) => (first.snapshot.clone(), None),
    }
}
impl Identity {
    fn into_raw(self) -> AXUIElementRef {
        let raw = self.raw();
        std::mem::forget(self);
        raw
    }
}

pub(super) fn snapshot_target() -> Result<TargetSnapshotDto, String> {
    TARGETS.snapshot(nonce(), observe, warm, registry::clear, |element| {
        element.and_then(|e| registry::register(e.raw()))
    })
}

pub(super) fn retire() {
    TARGETS.retire(registry::clear);
}

#[cfg(test)]
#[path = "completion_tests.rs"]
mod tests;
