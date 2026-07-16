//! Overlay open/close orchestration.
//!
//! Rust is the single source of truth for whether the overlay is logically
//! open. Opening positions + shows the native window, then lets React animate
//! in. Closing lets React animate out first; React then calls the
//! `overlay_hidden` command and the native window is hidden (never destroyed).

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::window_position;

pub const OVERLAY_LABEL: &str = "sonare-overlay";
const EVENT_OPEN: &str = "sonare:open";
const EVENT_CLOSE: &str = "sonare:close";

/// `true` while the overlay is logically open (shown or animating in).
#[derive(Default)]
pub struct OverlayState(Mutex<bool>);

fn set_open(app: &AppHandle, open: bool) {
    *app.state::<OverlayState>().0.lock().unwrap() = open;
}

fn is_open(app: &AppHandle) -> bool {
    *app.state::<OverlayState>().0.lock().unwrap()
}

/// Toggles the overlay; bound to the global shortcut.
pub fn toggle_overlay(app: &AppHandle) {
    log::info!("toggle requested (currently open: {})", is_open(app));
    if is_open(app) {
        close_overlay(app);
    } else {
        open_overlay(app);
    }
}

/// Positions the window on the active monitor, shows it and triggers the
/// React opening animation. Reuses the one existing window every time.
pub fn open_overlay(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        log::error!("overlay window '{OVERLAY_LABEL}' not found");
        return;
    };

    // Positioning failures are non-fatal: the window keeps its last position.
    if let Err(e) = window_position::position_top_center(app, &window) {
        log::warn!("could not position overlay on the active monitor: {e}");
    }

    if let Err(e) = window.show() {
        log::error!("failed to show overlay window: {e}");
        return;
    }
    if let Err(e) = window.set_focus() {
        log::warn!("failed to focus overlay window: {e}");
    }

    set_open(app, true);

    if let Err(e) = app.emit_to(OVERLAY_LABEL, EVENT_OPEN, ()) {
        log::error!("failed to emit open event: {e}");
    }
}

/// Triggers the React closing animation. The native window stays visible
/// until React reports back via `overlay_hidden`.
pub fn close_overlay(app: &AppHandle) {
    set_open(app, false);
    if let Err(e) = app.emit_to(OVERLAY_LABEL, EVENT_CLOSE, ()) {
        log::error!("failed to emit close event: {e}");
    }
}

/// Frontend-initiated close (close button, Escape key).
#[tauri::command]
pub fn request_close(app: AppHandle) {
    close_overlay(&app);
}

/// Called by the frontend once the closing animation has finished.
#[tauri::command]
pub fn overlay_hidden(app: AppHandle) {
    // If the user re-opened the overlay while the closing animation was still
    // running, the state flipped back to open — do not hide the window.
    if is_open(&app) {
        log::debug!("overlay re-opened during closing animation; keeping window visible");
        return;
    }
    log::debug!("closing animation finished; hiding native window");
    match app.get_webview_window(OVERLAY_LABEL) {
        Some(window) => {
            if let Err(e) = window.hide() {
                log::error!("failed to hide overlay window: {e}");
            }
        }
        None => log::error!("overlay window '{OVERLAY_LABEL}' not found while hiding"),
    }
}
