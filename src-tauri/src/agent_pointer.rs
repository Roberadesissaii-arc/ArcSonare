//! Purple agent pointer — always-on-top marker that follows the mouse path
//! when ArcSonare clicks on the user's screen (vision-guided UI control).
//!
//! Drawn natively rather than in a webview: see native_overlay.rs for why.

use tauri::AppHandle;

use crate::native_overlay;

/// Create the overlay windows at startup so the first point is instant.
pub fn prewarm(_app: &AppHandle) {
    #[cfg(windows)]
    native_overlay::init();
}

/// Place the purple pointer so its tip is at screen pixel (x, y).
#[tauri::command]
pub fn agent_pointer_show(_app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    #[cfg(windows)]
    return native_overlay::show_pointer(x, y);
    #[cfg(not(windows))]
    Err("The agent pointer is only available on Windows.".into())
}

#[tauri::command]
pub fn agent_pointer_move(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    agent_pointer_show(app, x, y)
}

#[tauri::command]
pub fn agent_pointer_hide(_app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    native_overlay::hide_pointer();
    Ok(())
}

/// Current cursor position in screen pixels (for animation start).
#[tauri::command]
pub fn agent_cursor_pos() -> Result<(i32, i32), String> {
    cursor_pos()
}

/// Move the system cursor without clicking (for “point to”).
#[tauri::command]
pub fn agent_set_cursor_pos(x: i32, y: i32) -> Result<(), String> {
    set_cursor_pos(x, y)
}

#[cfg(windows)]
fn set_cursor_pos(x: i32, y: i32) -> Result<(), String> {
    #[link(name = "user32")]
    extern "system" {
        fn SetCursorPos(x: i32, y: i32) -> i32;
    }
    let ok = unsafe { SetCursorPos(x, y) };
    if ok == 0 {
        return Err("SetCursorPos failed.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_cursor_pos(_x: i32, _y: i32) -> Result<(), String> {
    Err("SetCursorPos is only available on Windows.".into())
}

#[cfg(windows)]
fn cursor_pos() -> Result<(i32, i32), String> {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(lp_point: *mut Point) -> i32;
    }
    let mut p = Point { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut p) };
    if ok == 0 {
        return Err("GetCursorPos failed.".into());
    }
    Ok((p.x, p.y))
}

#[cfg(not(windows))]
fn cursor_pos() -> Result<(i32, i32), String> {
    Err("Cursor position is only available on Windows.".into())
}
