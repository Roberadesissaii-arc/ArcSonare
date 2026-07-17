//! Monitor-aware window placement with per-monitor DPI handling.

use tauri::{AppHandle, LogicalSize, Monitor, PhysicalPosition, WebviewWindow};

use crate::top_overlay::monitor_position::{
    OVERLAY_SHADOW_GUTTER, OVERLAY_TOP_OFFSET, OVERLAY_WINDOW_HEIGHT, OVERLAY_WINDOW_WIDTH,
};

pub const QUICK_MENU_WIDTH: f64 = 300.0;
pub const QUICK_MENU_HEIGHT: f64 = 420.0;

const OVERLAY_EDGE_MARGIN: f64 = 24.0;

/// Places the overlay below the top edge of the active monitor (≈16px),
/// horizontally centered (or left/right per settings), honoring negative
/// monitor coordinates and DPI scaling.
pub fn position_overlay(
    app: &AppHandle,
    window: &WebviewWindow,
    position: &str,
) -> Result<(), String> {
    let monitor = pick_monitor(app, window)?;
    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    // Use the window's current logical height so expanded panels stay anchored.
    let logical_h = window
        .inner_size()
        .ok()
        .map(|s| s.height as f64 / scale)
        .filter(|h| *h > 0.0)
        .unwrap_or(OVERLAY_WINDOW_HEIGHT);
    let logical_w = OVERLAY_WINDOW_WIDTH;

    let win_w = (logical_w * scale).round() as i32;
    let x = match position {
        "top-left" => {
            mon_pos.x + ((OVERLAY_EDGE_MARGIN - OVERLAY_SHADOW_GUTTER) * scale).round() as i32
        }
        "top-right" => {
            mon_pos.x + mon_size.width as i32 - win_w
                + ((OVERLAY_SHADOW_GUTTER - OVERLAY_EDGE_MARGIN) * scale).round() as i32
        }
        _ => mon_pos.x + (mon_size.width as i32 - win_w) / 2,
    };
    let y = mon_pos.y + (OVERLAY_TOP_OFFSET * scale).round() as i32;

    move_and_size(window, x, y, logical_w, logical_h)
}

/// Places the quick menu near the tray click position (the Windows
/// notification area), clamped inside the monitor that contains the cursor.
pub fn position_quick_menu(
    app: &AppHandle,
    window: &WebviewWindow,
    cursor: PhysicalPosition<f64>,
) -> Result<(), String> {
    let monitor = pick_monitor(app, window)?;
    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    let w = (QUICK_MENU_WIDTH * scale).round() as i32;
    let h = (QUICK_MENU_HEIGHT * scale).round() as i32;
    let margin = (8.0 * scale).round() as i32;

    let min_x = mon_pos.x + margin;
    let max_x = mon_pos.x + mon_size.width as i32 - w - margin;
    let x = ((cursor.x as i32) - w / 2).clamp(min_x, max_x.max(min_x));

    // Open upward from the taskbar; never above the monitor's top edge.
    let y_above = (cursor.y as i32) - h - (12.0 * scale).round() as i32;
    let y = y_above.max(mon_pos.y + margin);

    move_and_size(window, x, y, QUICK_MENU_WIDTH, QUICK_MENU_HEIGHT)
}

/// Moves first so the window adopts the target monitor's DPI, then applies
/// the logical size (Windows may rescale on the monitor change), then anchors
/// the final position.
fn move_and_size(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    logical_w: f64,
    logical_h: f64,
) -> Result<(), String> {
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;
    window
        .set_size(LogicalSize::new(logical_w, logical_h))
        .map_err(|e| format!("set_size failed: {e}"))?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;
    Ok(())
}

/// Prefers the monitor containing the mouse cursor; falls back to the
/// monitor containing the overlay window, then the primary monitor.
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
        log::debug!("cursor not inside any known monitor; falling back");
    } else {
        log::debug!("cursor position unavailable; falling back");
    }

    // Prefer the monitor currently hosting the window (often the foreground).
    if let Ok(Some(current)) = window.current_monitor() {
        return Ok(current);
    }
    if let Ok(Some(primary)) = window.primary_monitor() {
        return Ok(primary);
    }
    Err("no monitor could be determined".into())
}
