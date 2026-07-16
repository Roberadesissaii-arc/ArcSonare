//! Monitor-aware top-center positioning with per-monitor DPI handling.

use tauri::{AppHandle, LogicalSize, Monitor, PhysicalPosition, WebviewWindow};

/// Overlay size in logical (DPI-independent) pixels; matches tauri.conf.json.
const OVERLAY_WIDTH: f64 = 440.0;
const OVERLAY_HEIGHT: f64 = 90.0;
/// Gap between the top edge of the monitor and the overlay, in logical pixels.
const TOP_MARGIN: f64 = 12.0;

/// Moves the overlay to the top-center of the monitor under the mouse cursor
/// (falling back to the primary monitor), accounting for monitors with
/// negative coordinates and per-monitor DPI scale factors.
pub fn position_top_center(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let monitor = pick_monitor(app, window)?;
    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    let width_px = (OVERLAY_WIDTH * scale).round() as i32;
    let x = mon_pos.x + (mon_size.width as i32 - width_px) / 2;
    let y = mon_pos.y + (TOP_MARGIN * scale).round() as i32;

    // Move first so the window adopts the target monitor's DPI, then apply
    // the logical size (Windows may rescale on the monitor change), then
    // anchor the final position.
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;
    window
        .set_size(LogicalSize::new(OVERLAY_WIDTH, OVERLAY_HEIGHT))
        .map_err(|e| format!("set_size failed: {e}"))?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;

    Ok(())
}

/// Prefers the monitor containing the mouse cursor; falls back to the primary
/// monitor, then to whichever monitor the window currently occupies.
fn pick_monitor(app: &AppHandle, window: &WebviewWindow) -> Result<Monitor, String> {
    if let Ok(cursor) = app.cursor_position() {
        if let Ok(monitors) = window.available_monitors() {
            for monitor in monitors {
                let pos = monitor.position();
                let size = monitor.size();
                let contains_x =
                    cursor.x >= pos.x as f64 && cursor.x < (pos.x + size.width as i32) as f64;
                let contains_y =
                    cursor.y >= pos.y as f64 && cursor.y < (pos.y + size.height as i32) as f64;
                if contains_x && contains_y {
                    return Ok(monitor);
                }
            }
        }
        log::debug!("cursor not inside any known monitor; falling back to primary");
    } else {
        log::debug!("cursor position unavailable; falling back to primary monitor");
    }

    if let Ok(Some(primary)) = window.primary_monitor() {
        return Ok(primary);
    }
    if let Ok(Some(current)) = window.current_monitor() {
        return Ok(current);
    }
    Err("no monitor could be determined".into())
}
