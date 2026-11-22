//! Durable History / Recent transcript store (`app_data_dir/history.json`).
//! macOS and Windows encrypt at this boundary; other platforms retain JSON.
//! Errors never authorize the frontend to overwrite unreadable data.
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
mod dpapi;
#[cfg(any(target_os = "windows", all(test, target_os = "macos")))]
mod dpapi_blob;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod encrypted;
#[cfg(target_os = "macos")]
mod keychain;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod native_fs;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod plain;

#[cfg(target_os = "macos")]
fn system_keys(_dir: &std::path::Path) -> Result<keychain::SystemKeys, String> {
    keychain::SystemKeys::new()
}
#[cfg(target_os = "windows")]
fn system_keys(dir: &std::path::Path) -> Result<dpapi::SystemKeys, String> {
    dpapi::SystemKeys::new(dir)
}

const HISTORY_FILE_NAME: &str = "history.json";
fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join(HISTORY_FILE_NAME))
}

/// Returns null only for an absent primary after any archival migration.
/// Blocking filesystem and protected-key work never runs on the UI thread.
#[tauri::command]
pub async fn history_load(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = history_path(&app)?;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let dir = path.parent().ok_or("Invalid history directory")?;
            let keys = system_keys(dir)?;
            encrypted::Store::new(dir, &keys).load()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        plain::load(&path)
    })
    .await
    .map_err(|_| "History load worker failed".to_string())?
}

/// macOS/Windows write authenticated whole-document ciphertext, never a
/// plaintext fallback. Frontend schema/retention policy and IPC are unchanged.
#[tauri::command]
pub async fn history_save(app: AppHandle, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = history_path(&app)?;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let dir = path.parent().ok_or("Invalid history directory")?;
            let keys = system_keys(dir)?;
            encrypted::Store::new(dir, &keys).save(&contents)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        plain::save(&path, &contents)
    })
    .await
    .map_err(|_| "History save worker failed".to_string())?
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn backup_history(dir: &std::path::Path) -> Result<Option<PathBuf>, String> {
    if !dir.exists() {
        return Ok(None);
    }
    let keys = system_keys(dir)?;
    encrypted::Store::new(dir, &keys).backup()
}
