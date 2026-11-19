//! AppKit primitives for the shared clipboard transaction. Policy is exercised
//! with injected primitives in `pasteboard_policy`; tests never open the real
//! pasteboard. Snapshot pins original items until every representation is read.

use std::ffi::{c_void, CString};

use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};

use crate::delivery::decide::paste::pasteboard_policy::{self as policy, Reader, Writer};
use crate::delivery::decide::paste::PublicationFailure;
pub use policy::Snapshot;

struct AppKitBoard(*mut AnyObject);

impl AppKitBoard {
    unsafe fn general() -> Result<Self, String> {
        let pb: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
        if pb.is_null() {
            Err("pasteboard unavailable".into())
        } else {
            Ok(Self(pb))
        }
    }
}

unsafe fn ns_string(s: &str) -> Result<Retained<AnyObject>, String> {
    let s = CString::new(s).map_err(|_| "pasteboard type contains NUL")?;
    let value: Option<Retained<AnyObject>> =
        msg_send![class!(NSString), stringWithUTF8String: s.as_ptr()];
    value.ok_or_else(|| "pasteboard type unavailable".into())
}

unsafe fn ns_data(bytes: &[u8]) -> Result<Retained<AnyObject>, String> {
    let data: Option<Retained<AnyObject>> = msg_send![class!(NSData), dataWithBytes: bytes.as_ptr().cast::<c_void>(), length: bytes.len()];
    data.ok_or_else(|| "pasteboard data allocation failed".into())
}

impl Reader for AppKitBoard {
    type Item = Retained<AnyObject>;

    fn generation(&self) -> i64 {
        unsafe {
            let count: isize = msg_send![self.0, changeCount];
            count as i64
        }
    }

    fn items(&self, limit: usize) -> Result<Vec<Self::Item>, String> {
        unsafe {
            // SDK explicitly documents nil as a retrieval error, not empty.
            let items: Option<Retained<AnyObject>> = msg_send![self.0, pasteboardItems];
            let items = items.ok_or("pasteboard item read failed")?;
            let count: usize = msg_send![&*items, count];
            if count > limit {
                return Err("too many clipboard items".into());
            }
            let mut pinned = Vec::with_capacity(count);
            for i in 0..count {
                let item: Option<Retained<AnyObject>> = msg_send![&*items, objectAtIndex: i];
                pinned.push(item.ok_or("pasteboard item unavailable")?);
            }
            Ok(pinned)
        }
    }

    fn types(&self, item: &Self::Item, limit: usize) -> Result<Vec<String>, String> {
        unsafe {
            let types: Option<Retained<AnyObject>> = msg_send![&**item, types];
            let types = types.ok_or("pasteboard types unavailable")?;
            let count: usize = msg_send![&*types, count];
            if count > limit {
                return Err("too many clipboard types".into());
            }
            let mut names = Vec::with_capacity(count);
            for i in 0..count {
                let ty: Option<Retained<AnyObject>> = msg_send![&*types, objectAtIndex: i];
                let ty = ty.ok_or("pasteboard type unavailable")?;
                let len: usize = msg_send![&*ty, lengthOfBytesUsingEncoding: 4usize]; // NSUTF8StringEncoding
                if len == 0 || len > policy::MAX_TYPE_NAME_BYTES {
                    return Err("pasteboard type name exceeds limit".into());
                }
                let name: *const u8 = msg_send![&*ty, UTF8String];
                if name.is_null() {
                    return Err("pasteboard type name unavailable".into());
                }
                let bytes = std::slice::from_raw_parts(name, len);
                names.push(
                    std::str::from_utf8(bytes)
                        .map_err(|_| "invalid pasteboard type")?
                        .to_owned(),
                );
            }
            Ok(names)
        }
    }

    fn data(&self, item: &Self::Item, ty: &str, remaining: usize) -> Result<Vec<u8>, String> {
        unsafe {
            // Read from the retained original object, NEVER re-fetch an index.
            let ty = ns_string(ty)?;
            let data: Option<Retained<AnyObject>> = msg_send![&**item, dataForType: &*ty];
            let data = data.ok_or("pasteboard representation unavailable")?;
            let len: usize = msg_send![&*data, length];
            // Refuse over-budget data before asking/copying its byte buffer.
            if len > remaining {
                return Err("clipboard exceeds byte limit".into());
            }
            let bytes: *const c_void = msg_send![&*data, bytes];
            policy::validate_data_extent(len, !bytes.is_null(), remaining)?;
            if len == 0 {
                Ok(Vec::new())
            } else {
                Ok(std::slice::from_raw_parts(bytes.cast::<u8>(), len).to_vec())
            }
        }
    }
}

impl Writer for AppKitBoard {
    type Prepared = Retained<AnyObject>; // NSArray owns all fully populated items

    fn prepare(&self, saved: &[Vec<(String, Vec<u8>)>]) -> Result<Self::Prepared, String> {
        unsafe {
            let mut items = Vec::<Retained<AnyObject>>::with_capacity(saved.len());
            for entries in saved {
                let item: Option<Retained<AnyObject>> = msg_send![class!(NSPasteboardItem), new];
                let item = item.ok_or("pasteboard item allocation failed")?;
                for (ty, bytes) in entries {
                    let ty = ns_string(ty)?;
                    let data = ns_data(bytes)?;
                    let ok: Bool = msg_send![&*item, setData: &*data, forType: &*ty];
                    if !ok.as_bool() {
                        return Err("pasteboard refused a prepared type or transient marker".into());
                    }
                }
                items.push(item);
            }
            let ptrs: Vec<*const AnyObject> =
                items.iter().map(|i| &**i as *const AnyObject).collect();
            let array: Option<Retained<AnyObject>> =
                msg_send![class!(NSArray), arrayWithObjects: ptrs.as_ptr(), count: ptrs.len()];
            array.ok_or_else(|| "pasteboard item array allocation failed".into())
        }
    }

    fn generation(&self) -> i64 {
        Reader::generation(self)
    }

    fn clear(&self, local_only: bool) -> i64 {
        unsafe {
            let count: isize = if local_only {
                // Available since macOS 10.12. Advisory OS policy, not secrecy.
                msg_send![self.0, prepareForNewContentsWithOptions: 1usize]
            } else {
                msg_send![self.0, clearContents]
            };
            count as i64
        }
    }

    fn write(&self, prepared: &Self::Prepared) -> bool {
        unsafe {
            let ok: Bool = msg_send![self.0, writeObjects: &**prepared];
            ok.as_bool()
        }
    }
}

pub fn change_count() -> i64 {
    autoreleasepool(|_| unsafe { AppKitBoard::general().map_or(-1, |b| Reader::generation(&b)) })
}

pub fn snapshot() -> Option<Snapshot> {
    autoreleasepool(|_| unsafe { policy::capture(&AppKitBoard::general().ok()?).ok() })
}

pub fn publish(text: &str, expected: i64) -> Result<i64, PublicationFailure> {
    if text.len() > policy::MAX_BYTES || text.contains('\0') {
        return Err(PublicationFailure::Untouched(
            "clipboard transcript exceeds limit or contains NUL".into(),
        ));
    }
    autoreleasepool(|_| unsafe {
        let board = AppKitBoard::general().map_err(PublicationFailure::Untouched)?;
        // All four types are attached before publication. Managers need not
        // honor these conventions; no absolute history/privacy guarantee.
        policy::replace(&board, expected, &policy::transient_items(text), true)
    })
}

/// Legacy API, conservative string error. The common transaction uses publish
/// to retain typed failure stages and ownership evidence.
pub fn write_transient(text: &str) -> Result<i64, String> {
    publish(text, change_count())
        .map_err(|failure| format!("clipboard publication failed: {failure:?}"))
}

pub fn restore_owned(saved: &Snapshot, expected: i64) -> Result<(), String> {
    autoreleasepool(|_| unsafe {
        let board = AppKitBoard::general()?;
        // Rebuild before clear; keep restored bytes local too. The prior OS
        // sharing options are not readable through this API.
        policy::replace(&board, expected, &saved.items, true)
            .map(|_| ())
            .map_err(|failure| format!("clipboard restoration failed: {failure:?}"))
    })
}

pub fn restore(saved: &Snapshot) -> Result<(), String> {
    restore_owned(saved, change_count())
}

#[cfg(test)]
#[path = "pasteboard_native_tests.rs"]
mod tests;
