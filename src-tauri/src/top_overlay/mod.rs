//! Safe top-overlay native actions: window sizing, desktop app launch, URL open.

pub mod app_registry;
pub mod launcher;
pub mod monitor_position;
pub mod overlay_window;
pub mod web_launcher;

pub use app_registry::APP_REGISTRY;
pub use launcher::launch_application;
pub use web_launcher::{open_approved_url, open_web_search};

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Command text queued from the main window before the overlay opens.
#[derive(Default)]
pub struct PendingOverlayCommand(pub Mutex<Option<String>>);

/// Queue a transcript to run when the overlay opens (cross-window safe).
#[tauri::command]
pub fn overlay_queue_command(app: AppHandle, transcript: String) {
    let trimmed = transcript.trim().to_string();
    if trimmed.is_empty() {
        return;
    }
    *app.state::<PendingOverlayCommand>().0.lock().unwrap() = Some(trimmed);
}

/// Take (and clear) any pending overlay command.
#[tauri::command]
pub fn overlay_take_pending_command(app: AppHandle) -> Option<String> {
    app.state::<PendingOverlayCommand>().0.lock().unwrap().take()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActionResult {
    pub ok: bool,
    pub action: String,
    pub target: String,
    pub method: Option<String>,
    pub message: String,
}

/// Launch a registered desktop application by id. Never accepts raw shell input.
#[tauri::command]
pub fn overlay_launch_app(app_id: String) -> Result<OverlayActionResult, String> {
    match launch_application(&app_id) {
        Ok(result) => Ok(OverlayActionResult {
            ok: true,
            action: "launch-app".into(),
            target: app_id,
            method: Some(result.method),
            message: result.message,
        }),
        Err(message) => Ok(OverlayActionResult {
            ok: false,
            action: "launch-app".into(),
            target: app_id,
            method: None,
            message,
        }),
    }
}

/// Open an approved http(s) URL in the default browser.
#[tauri::command]
pub fn overlay_open_url(url: String) -> Result<OverlayActionResult, String> {
    match open_approved_url(&url) {
        Ok(()) => Ok(OverlayActionResult {
            ok: true,
            action: "open-url".into(),
            target: url,
            method: Some("browser".into()),
            message: "Opened in default browser".into(),
        }),
        Err(message) => Ok(OverlayActionResult {
            ok: false,
            action: "open-url".into(),
            target: url,
            method: None,
            message,
        }),
    }
}

/// Open a web search for a query string via the configured search URL template.
#[tauri::command]
pub fn overlay_web_search(query: String) -> Result<OverlayActionResult, String> {
    match open_web_search(&query) {
        Ok(url) => Ok(OverlayActionResult {
            ok: true,
            action: "web-search".into(),
            target: url,
            method: Some("browser".into()),
            message: "Search opened in default browser".into(),
        }),
        Err(message) => Ok(OverlayActionResult {
            ok: false,
            action: "web-search".into(),
            target: query,
            method: None,
            message,
        }),
    }
}

/// Resolve and open a registered service (desktop preferred, then web fallback).
#[tauri::command]
pub fn overlay_open_service(service_id: String) -> Result<OverlayActionResult, String> {
    let Some(entry) = APP_REGISTRY.iter().find(|e| e.id == service_id) else {
        return Ok(OverlayActionResult {
            ok: false,
            action: "open-service".into(),
            target: service_id,
            method: None,
            message: "Unknown service".into(),
        });
    };

    if entry.can_open_desktop {
        if let Ok(result) = launch_application(entry.id) {
            return Ok(OverlayActionResult {
                ok: true,
                action: "open-service".into(),
                target: service_id,
                method: Some(result.method),
                message: result.message,
            });
        }
    }

    if let Some(url) = entry.web_url {
        return match open_approved_url(url) {
            Ok(()) => Ok(OverlayActionResult {
                ok: true,
                action: "open-service".into(),
                target: service_id,
                method: Some("web-fallback".into()),
                message: format!("{} opened in browser", entry.display_name),
            }),
            Err(message) => Ok(OverlayActionResult {
                ok: false,
                action: "open-service".into(),
                target: service_id,
                method: None,
                message,
            }),
        };
    }

    Ok(OverlayActionResult {
        ok: false,
        action: "open-service".into(),
        target: service_id,
        method: None,
        message: format!("{} is not available on this system", entry.display_name),
    })
}
