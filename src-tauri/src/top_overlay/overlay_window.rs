//! Dynamic overlay window resizing for expanded panels.

use tauri::{AppHandle, LogicalSize, Manager};

use crate::overlay::OVERLAY_LABEL;
use crate::window_position;

use super::monitor_position::{
    OVERLAY_CAPSULE_HEIGHT, OVERLAY_EXPANDED_MAX, OVERLAY_EXPANDED_MIN, OVERLAY_SHADOW_GUTTER,
    OVERLAY_WINDOW_WIDTH,
};

/// Resize the overlay window to fit collapsed or expanded content.
/// `content_height` is the expanded panel height in logical pixels (0 = collapsed).
#[tauri::command]
pub fn resize_overlay(app: AppHandle, content_height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return Err("overlay window not found".into());
    };

    let clamped = if content_height <= 0.0 {
        0.0
    } else {
        content_height.clamp(OVERLAY_EXPANDED_MIN, OVERLAY_EXPANDED_MAX)
    };

    let height = OVERLAY_CAPSULE_HEIGHT + clamped + OVERLAY_SHADOW_GUTTER;
    window
        .set_size(LogicalSize::new(OVERLAY_WINDOW_WIDTH, height))
        .map_err(|e| format!("set_size failed: {e}"))?;

    // Keep horizontal centering / top offset after resize.
    let position = crate::settings::current(&app).overlay_position;
    if let Err(e) = window_position::position_overlay(&app, &window, &position) {
        log::warn!("could not reposition overlay after resize: {e}");
    }
    Ok(())
}
