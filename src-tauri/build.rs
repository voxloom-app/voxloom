// App command ACL: with an app manifest, each window may only invoke the
// commands its capability allows (`allow-<command>`, underscores → hyphens).
// main: everything; settings: settings + model management + the mic test;
// overlay: none.
const COMMANDS: &[&str] = &[
    "setup_query_permissions",
    "setup_request_permission",
    "setup_open_permission_settings",
    "setup_model_readiness",
    "dictation_cancel_arm",
    "dictation_cancel_finish",
    "dictation_cancel_end",
    "capture_cancel",
    "capture_list_devices",
    "capture_query_permission",
    "capture_request_permission",
    "capture_start",
    "capture_status",
    "capture_stop",
    "cleanup_session_open",
    "cleanup_session_dispose",
    "cleanup_acquire",
    "cleanup_cancel",
    "cleanup_release",
    "cleanup_run",
    "cleanup_prewarm",
    "cleanup_prewarm_disarm",
    "cleanup_model_status",
    "cleanup_download_model",
    "cleanup_cancel_download",
    "delivery_insert_text",
    "delivery_paste_binding",
    "delivery_paste_text",
    "delivery_snapshot_target",
    "delivery_validate_target",
    "dictionary_load",
    "dictionary_save",
    "history_load",
    "history_save",
    "hold_release_arm",
    "hold_release_disarm",
    "lone_key_arm",
    "lone_key_disarm",
    "lone_key_request_access",
    "overlay_ensure",
    "overlay_hide",
    "overlay_show",
    "settings_load",
    "settings_request_onboarding",
    "settings_save",
    "settings_window_open",
    "store_backup",
    "stt_cancel_download",
    "stt_download_model",
    "stt_list_models",
    "stt_model_status",
    "stt_transcribe",
    "stt_prepare",
    "stt_cancel",
    "stt_release",
];

fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    let attributes = if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // tauri-build's resource is linked into app binaries, not the lib's
        // unit-test executable. Both need Common Controls v6 for TaskDialogIndirect.
        // Use the same manifest for every artifact rather than disabling native tests.
        let manifest = std::path::PathBuf::from(
            std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is required"),
        )
        .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
    } else {
        attributes
    };
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
