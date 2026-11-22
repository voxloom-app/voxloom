//! App command ACL regressions run the REAL generated context on Tauri's mock
//! runtime. Same-named stubs isolate permission routing from OS side effects;
//! the shared-paste macOS probe additionally reaches production preflight.

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The overlay's real window label (capabilities/overlay.json `windows`), so
/// the deny checks below hit the overlay capability, not an unknown window.
const OVERLAY: &str = "dictation-overlay";

#[tauri::command]
fn setup_query_permissions() {}
#[tauri::command]
fn setup_request_permission() {}
#[tauri::command]
fn setup_open_permission_settings() {}
#[tauri::command]
fn setup_model_readiness() {}

#[test]
fn guided_setup_adapters_are_main_only() {
    for command in [
        "setup_query_permissions",
        "setup_request_permission",
        "setup_open_permission_settings",
        "setup_model_readiness",
    ] {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                setup_query_permissions,
                setup_request_permission,
                setup_open_permission_settings,
                setup_model_readiness
            ])
            .build(crate::app_context())
            .unwrap();
        assert_eq!(invoke_command(&app, "main", "index.html", command), Ok(()));
        assert!(invoke_command(&app, "settings", "settings.html", command)
            .unwrap_err()
            .contains("not allowed"));
        assert!(invoke_command(&app, OVERLAY, "overlay.html", command)
            .unwrap_err()
            .contains("not allowed"));
    }
}

#[tauri::command]
fn store_backup(store: String) -> Result<Option<String>, String> {
    Ok(Some(format!("stub-{store}")))
}

#[tauri::command]
fn history_load() {}
#[tauri::command]
fn history_save() {}

#[test]
fn history_storage_commands_remain_main_only() {
    for command in ["history_load", "history_save"] {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![history_load, history_save])
            .build(crate::app_context())
            .unwrap();
        assert_eq!(invoke_command(&app, "main", "index.html", command), Ok(()));
        assert!(invoke_command(&app, "settings", "settings.html", command)
            .unwrap_err()
            .contains("not allowed"));
        assert!(invoke_command(&app, OVERLAY, "overlay.html", command)
            .unwrap_err()
            .contains("not allowed"));
    }
}

#[tauri::command]
fn cleanup_run() {}

#[tauri::command]
fn cleanup_model_status() {}

#[tauri::command]
fn cleanup_prewarm() {}

#[tauri::command]
fn cleanup_prewarm_disarm() {}

#[tauri::command]
fn cleanup_download_model() {}

#[tauri::command]
fn cleanup_cancel_download() {}

#[tauri::command]
fn lone_key_arm() {}

#[tauri::command]
fn lone_key_disarm() {}

#[tauri::command]
fn lone_key_request_access() {}

fn invoke_from(app: &tauri::App<MockRuntime>, label: &str, page: &str) -> Result<(), String> {
    invoke_command(app, label, page, "store_backup")
}

fn invoke_command(
    app: &tauri::App<MockRuntime>,
    label: &str,
    page: &str,
    command: &str,
) -> Result<(), String> {
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
        .build()
        .expect("window");
    let url = window.url().expect("url");
    get_ipc_response(
        &window,
        InvokeRequest {
            cmd: command.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url,
            body: InvokeBody::Json(serde_json::json!({ "store": "settings" })),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|_| ())
    .map_err(|e| format!("{e:?}"))
}

#[test]
fn cleanup_models_are_available_in_settings_but_worker_execution_is_main_only() {
    for command in [
        "cleanup_run",
        "cleanup_prewarm",
        "cleanup_prewarm_disarm",
        "cleanup_model_status",
        "cleanup_download_model",
        "cleanup_cancel_download",
    ] {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                cleanup_run,
                cleanup_prewarm,
                cleanup_prewarm_disarm,
                cleanup_model_status,
                cleanup_download_model,
                cleanup_cancel_download
            ])
            .build(crate::app_context())
            .expect("mock app");
        assert_eq!(invoke_command(&app, "main", "index.html", command), Ok(()));
        let settings = invoke_command(&app, "settings", "settings.html", command);
        if matches!(
            command,
            "cleanup_run" | "cleanup_prewarm" | "cleanup_prewarm_disarm"
        ) {
            assert!(settings.unwrap_err().contains("not allowed"));
        } else {
            assert_eq!(settings, Ok(()));
        }
        assert!(invoke_command(&app, OVERLAY, "overlay.html", command)
            .unwrap_err()
            .contains("not allowed"));
    }
}

#[test]
fn store_backup_is_granted_to_main_only() {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![store_backup])
        .build(crate::app_context())
        .expect("mock app");
    assert_eq!(invoke_from(&app, "main", "index.html"), Ok(()));
    let settings = invoke_from(&app, "settings", "settings.html").unwrap_err();
    assert!(settings.contains("not allowed"), "{settings}");
    let overlay = invoke_from(&app, OVERLAY, "overlay.html").unwrap_err();
    assert!(overlay.contains("not allowed"), "{overlay}");
}

#[tauri::command]
fn stt_prepare() {}
#[tauri::command]
fn stt_transcribe() {}
#[tauri::command]
fn stt_cancel() {}
#[tauri::command]
fn stt_release() {}
#[tauri::command]
fn stt_list_models() {}
#[tauri::command]
fn stt_model_status() {}
#[tauri::command]
fn stt_download_model() {}
#[tauri::command]
fn stt_cancel_download() {}

#[test]
fn stt_execution_is_main_only_and_settings_has_only_inventory() {
    for command in [
        "stt_prepare",
        "stt_transcribe",
        "stt_cancel",
        "stt_release",
        "stt_list_models",
        "stt_model_status",
        "stt_download_model",
        "stt_cancel_download",
    ] {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                stt_prepare,
                stt_transcribe,
                stt_cancel,
                stt_release,
                stt_list_models,
                stt_model_status,
                stt_download_model,
                stt_cancel_download
            ])
            .build(crate::app_context())
            .unwrap();
        assert_eq!(
            invoke_command(&app, "main", "index.html", command),
            Ok(()),
            "{command}"
        );
        let settings = invoke_command(&app, "settings", "settings.html", command);
        if matches!(
            command,
            "stt_prepare" | "stt_transcribe" | "stt_cancel" | "stt_release"
        ) {
            assert!(settings.unwrap_err().contains("not allowed"), "{command}");
        } else {
            assert_eq!(settings, Ok(()), "{command}");
        }
        assert!(
            invoke_command(&app, OVERLAY, "overlay.html", command)
                .unwrap_err()
                .contains("not allowed"),
            "{command}"
        );
    }
}

#[tauri::command]
fn delivery_snapshot_target() {}
#[tauri::command]
fn delivery_validate_target() {}
#[tauri::command]
fn delivery_insert_text() {}
#[tauri::command]
fn delivery_paste_binding() {}
#[tauri::command]
fn delivery_paste_text() {}
#[tauri::command]
fn delivery_paste_target() {}

#[test]
fn delivery_commands_are_main_only() {
    for command in [
        "delivery_snapshot_target",
        "delivery_validate_target",
        "delivery_insert_text",
        "delivery_paste_binding",
        "delivery_paste_text",
        "delivery_paste_target",
    ] {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                delivery_snapshot_target,
                delivery_validate_target,
                delivery_insert_text,
                delivery_paste_binding,
                delivery_paste_text,
                delivery_paste_target
            ])
            .build(crate::app_context())
            .expect("mock app");
        assert_eq!(
            invoke_command(&app, "main", "index.html", command),
            Ok(()),
            "{command} must be reachable from main",
        );
        for (label, page) in [("settings", "settings.html"), (OVERLAY, "overlay.html")] {
            let denied = invoke_command(&app, label, page, command).unwrap_err();
            assert!(
                denied.contains("not allowed"),
                "{label}: {command}: {denied}"
            );
        }
    }
}

#[cfg(target_os = "macos")]
#[test]
fn shared_paste_ipc_reaches_native_preflight_from_main() {
    // Use the production handler and generated app authority. A missing token
    // exits before OS observation, clipboard access or key-event dispatch.
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            crate::delivery::delivery_paste_target
        ])
        .build(crate::app_context())
        .expect("mock app");
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
        .build()
        .expect("main window");
    let response = get_ipc_response(
        &window,
        InvokeRequest {
            cmd: "delivery_paste_target".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: window.url().expect("url"),
            body: InvokeBody::Json(serde_json::json!({
                "text": "synthetic ACL fixture",
                "intended": crate::delivery::TargetSnapshotDto::unavailable("ACL fixture", 1),
            })),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    );
    assert_eq!(
        response.expect_err("missing native authority must refuse before dispatch"),
        serde_json::json!("delivery-safe-refusal:completion token required"),
        "main IPC must reach native preflight, not be rejected by the command ACL",
    );
}

#[test]
fn lone_key_commands_are_main_only() {
    for command in ["lone_key_arm", "lone_key_disarm", "lone_key_request_access"] {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                lone_key_arm,
                lone_key_disarm,
                lone_key_request_access
            ])
            .build(crate::app_context())
            .expect("mock app");
        assert_eq!(invoke_command(&app, "main", "index.html", command), Ok(()));
        for (label, page) in [("settings", "settings.html"), (OVERLAY, "overlay.html")] {
            let denied = invoke_command(&app, label, page, command).unwrap_err();
            assert!(denied.contains("not allowed"), "{label}: {denied}");
        }
    }
}
