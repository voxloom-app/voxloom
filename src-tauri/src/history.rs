//! Durable History / Recent transcript store (`app_data_dir/history.json`).
//! macOS encrypts at this native boundary; Windows/Linux retain existing JSON
//! storage. Errors never authorize the frontend to overwrite unreadable data.
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
mod encrypted;
#[cfg(target_os = "macos")]
mod keychain;
#[cfg(not(target_os = "macos"))]
mod plain;

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
/// Blocking filesystem and Keychain work never runs on the UI thread.
#[tauri::command]
pub async fn history_load(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = history_path(&app)?;
        #[cfg(target_os = "macos")]
        {
            let keys = keychain::SystemKeys::new()?;
            encrypted::Store::new(path.parent().ok_or("Invalid history directory")?, &keys).load()
        }
        #[cfg(not(target_os = "macos"))]
        plain::load(&path)
    })
    .await
    .map_err(|_| "History load worker failed".to_string())?
}

/// macOS writes authenticated whole-document ciphertext, without a plaintext
/// fallback. Frontend schema/retention policy and IPC names remain unchanged.
#[tauri::command]
pub async fn history_save(app: AppHandle, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = history_path(&app)?;
        #[cfg(target_os = "macos")]
        {
            let keys = keychain::SystemKeys::new()?;
            encrypted::Store::new(path.parent().ok_or("Invalid history directory")?, &keys)
                .save(&contents)
        }
        #[cfg(not(target_os = "macos"))]
        plain::save(&path, &contents)
    })
    .await
    .map_err(|_| "History save worker failed".to_string())?
}

#[cfg(target_os = "macos")]
pub(crate) fn backup_history(dir: &std::path::Path) -> Result<Option<PathBuf>, String> {
    if !dir.exists() {
        return Ok(None);
    }
    let keys = keychain::SystemKeys::new()?;
    encrypted::Store::new(dir, &keys).backup()
}
