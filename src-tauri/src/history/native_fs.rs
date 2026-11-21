//! Native file operations only. The authenticated format/state machine is shared.
#[cfg(target_os = "macos")]
#[path = "native_fs_macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "native_fs_windows.rs"]
mod platform;
pub(super) use platform::{create_new, lock, open_regular, publish, sync_publication};
