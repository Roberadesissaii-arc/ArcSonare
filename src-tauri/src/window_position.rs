//! Monitor-aware window placement with per-monitor DPI handling.

use tauri::{AppHandle, LogicalSize, Monitor, PhysicalPosition, WebviewWindow};

// Overlay geometry in logical pixels. The native window is larger than the
// visible capsule so the CSS drop shadow has room to render; SIDE_PAD must
// match the horizontal padding in overlay.css.
pub const OVERLAY_WINDOW_WIDTH: f64 = 700.0;
pub const OVERLAY_WINDOW_HEIGHT: f64 = 170.0;
const OVERLAY_SIDE_PAD: f64 = 40.0;
const OVERLAY_EDGE_MARGIN: f64 = 24.0;

pub const SETTINGS_WIDTH: f64 = 812.0;
pub const SETTINGS_HEIGHT: f64 = 592.0;

pub const QUICK_MENU_WIDTH: f64 = 300.0;
pub const QUICK_MENU_HEIGHT: f64 = 380.0;

/// Places the overlay against the top edge of the active monitor, honoring
/// the configured horizontal position ("top-center" | "top-left" |
/// "top-right"), negative monitor coordinates and DPI scaling. The capsule's
/// top edge touches the physical top edge of the monitor.
pub fn position_overlay(
    app: &AppHandle,
    window: &WebviewWindow,
    position: &str,
) -> Result<(), String> {
    let monitor = pick_monitor(app, window)?;
    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    let win_w = (OVERLAY_WINDOW_WIDTH * scale).round() as i32;
    let x = match position {
        // The capsule (not the transparent shadow padding) should sit
        // OVERLAY_EDGE_MARGIN from the monitor edge.
        "top-left" => mon_pos.x + ((OVERLAY_EDGE_MARGIN - OVERLAY_SIDE_PAD) * scale).round() as i32,
        "top-right" => {
            mon_pos.x + mon_size.width as i32 - win_w
                + ((OVERLAY_SIDE_PAD - OVERLAY_EDGE_MARGIN) * scale).round() as i32
        }
        _ => mon_pos.x + (mon_size.width as i32 - win_w) / 2,
    };
    let y = mon_pos.y;

    move_and_size(window, x, y, OVERLAY_WINDOW_WIDTH, OVERLAY_WINDOW_HEIGHT)
}

/// Centers a window (by logical size) on the monitor under the cursor.
pub fn center_on_active_monitor(
    app: &AppHandle,
    window: &WebviewWindow,
    logical_w: f64,
    logical_h: f64,
) -> Result<(), String> {
    let monitor = pick_monitor(app, window)?;
    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    let w = (logical_w * scale).round() as i32;
    let h = (logical_h * scale).round() as i32;
    let x = mon_pos.x + (mon_size.width as i32 - w) / 2;
    let y = mon_pos.y + (mon_size.height as i32 - h) / 2;
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
