//! Data & Privacy support: local data location, storage usage and the
//! Windows test notification.

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataUsage {
    pub data_dir: String,
    pub settings_bytes: u64,
    pub captures_bytes: u64,
}

fn file_size(path: &std::path::Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

#[tauri::command]
pub fn get_data_usage(app: AppHandle) -> Result<DataUsage, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config directory unavailable: {e}"))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("data directory unavailable: {e}"))?;
    Ok(DataUsage {
        data_dir: data_dir.display().to_string(),
        settings_bytes: file_size(&config_dir.join("settings.json")),
        captures_bytes: crate::screen_context::storage::dir_size_bytes(&app),
    })
}

/// Opens the ArcSonare data folder in Windows Explorer.
#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("data directory unavailable: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create data folder: {e}"))?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("could not open Explorer: {e}"))?;
    Ok(())
}

/// Opens the Windows microphone privacy settings page.
#[tauri::command]
pub fn open_microphone_privacy_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "ms-settings:privacy-microphone"])
        .spawn()
        .map_err(|e| format!("could not open Windows settings: {e}"))?;
    Ok(())
}

/// Sends a native Windows notification (Data & Privacy / Notifications test).
#[tauri::command]
pub fn send_test_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(if title.is_empty() {
            "ArcSonare".into()
        } else {
            title
        })
        .body(body)
        .show()
        .map_err(|e| format!("Windows did not accept the notification: {e}"))
}
