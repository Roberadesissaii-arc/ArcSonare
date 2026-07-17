//! Screen Context: monitor enumeration, native capture, per-monitor edge
//! indicator overlays and temporary capture storage.
//!
//! Nothing here talks to an AI model. Captures are local PNG files under the
//! app data directory; the frontend labels analysis honestly as unavailable.

pub mod capture;
pub mod monitors;
pub mod overlay;
pub mod storage;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const STATE_EVENT: &str = "sonare:screen-context-changed";

/// Monitor ids that currently show an edge indicator (empty = inactive).
#[derive(Default)]
pub struct ScreenContextState(pub Mutex<Vec<String>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenContextStatus {
    pub active: bool,
    pub monitor_ids: Vec<String>,
}

pub fn status(app: &AppHandle) -> ScreenContextStatus {
    let ids = app.state::<ScreenContextState>().0.lock().unwrap().clone();
    ScreenContextStatus {
        active: !ids.is_empty(),
        monitor_ids: ids,
    }
}

pub fn broadcast_status(app: &AppHandle) {
    if let Err(e) = app.emit(STATE_EVENT, status(app)) {
        log::error!("failed to broadcast screen-context state: {e}");
    }
}

/// Stops every capture session and removes all edge overlays. Called on user
/// request and unconditionally on application exit.
pub fn stop_all(app: &AppHandle) {
    overlay::remove_all_edge_overlays(app);
    app.state::<ScreenContextState>().0.lock().unwrap().clear();
    broadcast_status(app);
}

use tauri::Manager;

#[tauri::command]
pub fn screen_context_status(app: AppHandle) -> ScreenContextStatus {
    status(&app)
}

/// Shows edge indicators on the given monitors and marks Screen Context
/// active. Replaces any previous session.
#[tauri::command]
pub fn start_screen_context(app: AppHandle, monitor_ids: Vec<String>) -> Result<(), String> {
    if monitor_ids.is_empty() {
        return Err("No monitor selected for Screen Context.".into());
    }
    overlay::remove_all_edge_overlays(&app);
    let shown = overlay::show_edge_overlays(&app, &monitor_ids)?;
    *app.state::<ScreenContextState>().0.lock().unwrap() = shown;
    broadcast_status(&app);
    Ok(())
}

#[tauri::command]
pub fn stop_screen_context(app: AppHandle) {
    stop_all(&app);
}
