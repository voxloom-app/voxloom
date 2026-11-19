//! The current layout's keycode for V, via Text Input Sources. TIS must run
//! on the main thread (it asserts the main queue on recent macOS), so the
//! lookup hops there; the delivery command itself runs on a worker thread.
//! Command-aware current-layout scan adapted from Handy input.rs (MIT),
//! cjpais/Handy 4807c21a7bb9a3bf2d52578a9b541e165b6bc8b9.
//! Copyright (c) 2025 CJ Pais. See bundled third-party notices.

use std::ffi::c_void;

use dispatch2::DispatchQueue;

use crate::delivery::decide::paste_key::{keycode_for_v, KEYCODE_ANSI_V};

type CFTypeRef = *const c_void;

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn TISCopyCurrentKeyboardLayoutInputSource() -> CFTypeRef;
    fn TISGetInputSourceProperty(source: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    static kTISPropertyUnicodeKeyLayoutData: CFTypeRef;
    fn LMGetKbdType() -> u8;
    #[allow(clippy::too_many_arguments)]
    fn UCKeyTranslate(
        layout: *const c_void,
        virtual_key_code: u16,
        key_action: u16,
        modifier_key_state: u32,
        keyboard_type: u32,
        options: u32,
        dead_key_state: *mut u32,
        max_len: usize,
        actual_len: *mut usize,
        out: *mut u16,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDataGetBytePtr(data: CFTypeRef) -> *const u8;
    fn CFRelease(cf: CFTypeRef);
}

extern "C" {
    fn pthread_main_np() -> i32;
}

const KEY_ACTION_DISPLAY: u16 = 3;
/// cmdKey (0x0100) >> 8, as UCKeyTranslate expects.
const MODIFIER_COMMAND: u32 = 1;
const NO_DEAD_KEYS: u32 = 1;

/// Keycode that produces ⌘V in the current layout; ANSI V when unreadable.
pub fn v_keycode() -> u16 {
    // SAFETY: plain libSystem call.
    if unsafe { pthread_main_np() } != 0 {
        return lookup();
    }
    let mut key = KEYCODE_ANSI_V;
    DispatchQueue::main().exec_sync(|| key = lookup());
    key
}

fn lookup() -> u16 {
    // SAFETY: the layout data is owned by `source`, which outlives its use.
    unsafe {
        let source = TISCopyCurrentKeyboardLayoutInputSource();
        if source.is_null() {
            return KEYCODE_ANSI_V;
        }
        let data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
        let key = if data.is_null() || CFDataGetBytePtr(data).is_null() {
            KEYCODE_ANSI_V
        } else {
            let layout = CFDataGetBytePtr(data).cast::<c_void>();
            let keyboard = u32::from(LMGetKbdType());
            keycode_for_v(|code| translate(layout, code, keyboard))
        };
        CFRelease(source);
        key
    }
}

fn translate_with(
    code: u16,
    keyboard: u32,
    translate: impl FnOnce(u16, u16, u32, u32) -> Option<String>,
) -> Option<String> {
    translate(code, KEY_ACTION_DISPLAY, MODIFIER_COMMAND, keyboard)
}

unsafe fn translate(layout: *const c_void, code: u16, keyboard: u32) -> Option<String> {
    translate_with(code, keyboard, |code, action, modifiers, keyboard| {
        let mut dead = 0u32;
        let mut out = [0u16; 4];
        let mut len = 0usize;
        let status = UCKeyTranslate(
            layout,
            code,
            action,
            modifiers,
            keyboard,
            NO_DEAD_KEYS,
            &mut dead,
            out.len(),
            &mut len,
            out.as_mut_ptr(),
        );
        (status == 0 && len > 0).then(|| String::from_utf16_lossy(&out[..len.min(out.len())]))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_layout_scan_uses_display_action_not_keydown() {
        let result = translate_with(44, 40, |code, action, modifiers, keyboard| {
            assert_eq!((code, action, modifiers, keyboard), (44, 3, 1, 40));
            Some("v".into())
        });
        assert_eq!(result.as_deref(), Some("v"));
    }
}
