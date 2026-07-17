//! Window discovery and management. Windows are addressed by opaque ids
//! (`w<hex>`) — raw HWND values are never handed to the model.

use serde::Deserialize;
use serde_json::json;

use super::system::{parse_window_id, window_opaque_id};
use super::types::{ResultBuilder, ToolResult, VerificationEvidence};

#[cfg(windows)]
mod user32 {
    #[link(name = "user32")]
    extern "system" {
        pub fn SetForegroundWindow(hwnd: isize) -> i32;
        pub fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
        pub fn IsWindow(hwnd: isize) -> i32;
        pub fn PostMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> i32;
        pub fn SetWindowPos(
            hwnd: isize,
            insert_after: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }
    pub const SW_MINIMIZE: i32 = 6;
    pub const SW_MAXIMIZE: i32 = 3;
    pub const SW_RESTORE: i32 = 9;
    pub const WM_CLOSE: u32 = 0x0010;
    pub const SWP_NOZORDER: u32 = 0x0004;
    pub const SWP_NOSIZE: u32 = 0x0001;
    pub const SWP_NOMOVE: u32 = 0x0002;
}

#[cfg(windows)]
pub fn focus_hwnd(id: u32) -> bool {
    let hwnd = id as isize;
    unsafe {
        if user32::IsWindow(hwnd) == 0 {
            return false;
        }
        // Restore first so a minimized window actually comes to front.
        user32::ShowWindow(hwnd, user32::SW_RESTORE);
        user32::SetForegroundWindow(hwnd) != 0
    }
}

#[cfg(not(windows))]
pub fn focus_hwnd(_id: u32) -> bool {
    false
}

#[cfg(windows)]
pub fn request_close_hwnd(id: u32) -> bool {
    let hwnd = id as isize;
    unsafe {
        if user32::IsWindow(hwnd) == 0 {
            return false;
        }
        user32::PostMessageW(hwnd, user32::WM_CLOSE, 0, 0) != 0
    }
}

#[cfg(not(windows))]
pub fn request_close_hwnd(_id: u32) -> bool {
    false
}

#[cfg(windows)]
fn show_hwnd(id: u32, cmd: i32) -> bool {
    let hwnd = id as isize;
    unsafe {
        if user32::IsWindow(hwnd) == 0 {
            return false;
        }
        user32::ShowWindow(hwnd, cmd);
        true
    }
}

#[cfg(not(windows))]
fn show_hwnd(_id: u32, _cmd: i32) -> bool {
    false
}

fn describe(w: &xcap::Window) -> serde_json::Value {
    json!({
        "id": window_opaque_id(w.id().unwrap_or(0)),
        "title": w.title().unwrap_or_default(),
        "process_name": w.app_name().unwrap_or_default(),
        "bounds": {
            "x": w.x().unwrap_or(0),
            "y": w.y().unwrap_or(0),
            "width": w.width().unwrap_or(0),
            "height": w.height().unwrap_or(0),
        },
        "visible": !w.is_minimized().unwrap_or(false),
        "minimized": w.is_minimized().unwrap_or(false),
        "maximized": w.is_maximized().unwrap_or(false),
    })
}

fn all_windows() -> Result<Vec<xcap::Window>, String> {
    let own_pid = std::process::id();
    Ok(xcap::Window::all()
        .map_err(|e| format!("Could not enumerate windows: {e}"))?
        .into_iter()
        .filter(|w| w.pid().unwrap_or(0) != own_pid)
        .filter(|w| !w.title().unwrap_or_default().is_empty())
        .collect())
}

fn find_by_opaque_id(id: &str) -> Result<xcap::Window, String> {
    let raw = parse_window_id(id).ok_or_else(|| format!("\"{id}\" is not a valid window id."))?;
    all_windows()?
        .into_iter()
        .find(|w| w.id().unwrap_or(0) == raw)
        .ok_or_else(|| "That window no longer exists.".into())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListWindowsArgs {
    #[serde(default)]
    pub limit: Option<usize>,
}

pub fn list_windows(args: ListWindowsArgs) -> ToolResult {
    let rb = ResultBuilder::new("windows.list");
    match all_windows() {
        Ok(windows) => {
            let limit = args.limit.unwrap_or(50).clamp(1, 200);
            let items: Vec<serde_json::Value> = windows.iter().take(limit).map(describe).collect();
            let count = items.len();
            rb.success(
                format!("{count} open window{}.", if count == 1 { "" } else { "s" }),
                json!({ "windows": items, "count": count }),
                VerificationEvidence::verified("window-detected"),
            )
        }
        Err(e) => rb.error("window-enumeration-failed", e, true),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WindowIdArgs {
    pub window_id: String,
}

pub fn focus_window(args: WindowIdArgs) -> ToolResult {
    let rb = ResultBuilder::new("windows.focus");
    let window = match find_by_opaque_id(&args.window_id) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let title = window.title().unwrap_or_default();
    if focus_hwnd(window.id().unwrap_or(0)) {
        rb.success(
            format!("Focused \"{title}\"."),
            json!({ "window_id": args.window_id, "title": title }),
            VerificationEvidence::verified("window-detected"),
        )
    } else {
        rb.partial(
            format!("Windows did not allow focusing \"{title}\"."),
            json!({ "window_id": args.window_id, "title": title }),
            VerificationEvidence::unverified("window-detected"),
        )
    }
}

fn show_command(
    capability_id: &'static str,
    args: WindowIdArgs,
    cmd: i32,
    verb: &str,
) -> ToolResult {
    let rb = ResultBuilder::new(capability_id);
    let window = match find_by_opaque_id(&args.window_id) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let title = window.title().unwrap_or_default();
    let raw = window.id().unwrap_or(0);
    if !show_hwnd(raw, cmd) {
        return rb.error(
            "window-command-failed",
            format!("Windows rejected the {verb} request for \"{title}\"."),
            true,
        );
    }
    // Readback verification.
    std::thread::sleep(std::time::Duration::from_millis(250));
    let verified = find_by_opaque_id(&args.window_id)
        .map(|w| match verb {
            "minimize" => w.is_minimized().unwrap_or(false),
            "maximize" => w.is_maximized().unwrap_or(false),
            _ => !w.is_minimized().unwrap_or(true),
        })
        .unwrap_or(false);
    let evidence = if verified {
        VerificationEvidence::verified("state-readback")
    } else {
        VerificationEvidence::unverified("state-readback")
    };
    let past = match verb {
        "minimize" => "Minimized",
        "maximize" => "Maximized",
        _ => "Restored",
    };
    let summary = format!("{past} \"{title}\".");
    if verified {
        rb.success(
            summary,
            json!({ "window_id": args.window_id, "title": title }),
            evidence,
        )
    } else {
        rb.partial(
            format!(
                "Sent the {verb} request to \"{title}\", but the new state could not be confirmed."
            ),
            json!({ "window_id": args.window_id, "title": title }),
            evidence,
        )
    }
}

pub fn minimize_window(args: WindowIdArgs) -> ToolResult {
    show_command(
        "windows.minimize",
        args,
        {
            #[cfg(windows)]
            {
                user32::SW_MINIMIZE
            }
            #[cfg(not(windows))]
            {
                0
            }
        },
        "minimize",
    )
}

pub fn maximize_window(args: WindowIdArgs) -> ToolResult {
    show_command(
        "windows.maximize",
        args,
        {
            #[cfg(windows)]
            {
                user32::SW_MAXIMIZE
            }
            #[cfg(not(windows))]
            {
                0
            }
        },
        "maximize",
    )
}

pub fn restore_window(args: WindowIdArgs) -> ToolResult {
    show_command(
        "windows.restore",
        args,
        {
            #[cfg(windows)]
            {
                user32::SW_RESTORE
            }
            #[cfg(not(windows))]
            {
                0
            }
        },
        "restore",
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveResizeArgs {
    pub window_id: String,
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default)]
    pub width: Option<i32>,
    #[serde(default)]
    pub height: Option<i32>,
}

#[cfg(windows)]
pub fn move_resize_window(args: MoveResizeArgs) -> ToolResult {
    let rb = ResultBuilder::new("windows.move_resize");
    let window = match find_by_opaque_id(&args.window_id) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let title = window.title().unwrap_or_default();
    let raw = window.id().unwrap_or(0) as isize;
    let moving = args.x.is_some() || args.y.is_some();
    let sizing = args.width.is_some() || args.height.is_some();
    if !moving && !sizing {
        return rb.error(
            "invalid-arguments",
            "Provide x/y and/or width/height.",
            true,
        );
    }
    if let Some(w) = args.width {
        if !(100..=20000).contains(&w) {
            return rb.error("invalid-arguments", "Width must be 100–20000 px.", true);
        }
    }
    if let Some(h) = args.height {
        if !(100..=20000).contains(&h) {
            return rb.error("invalid-arguments", "Height must be 100–20000 px.", true);
        }
    }
    let x = args.x.unwrap_or_else(|| window.x().unwrap_or(0));
    let y = args.y.unwrap_or_else(|| window.y().unwrap_or(0));
    let w = args
        .width
        .unwrap_or_else(|| window.width().unwrap_or(800) as i32);
    let h = args
        .height
        .unwrap_or_else(|| window.height().unwrap_or(600) as i32);
    let mut flags = user32::SWP_NOZORDER;
    if !moving {
        flags |= user32::SWP_NOMOVE;
    }
    if !sizing {
        flags |= user32::SWP_NOSIZE;
    }
    let ok = unsafe { user32::SetWindowPos(raw, 0, x, y, w, h, flags) };
    if ok == 0 {
        return rb.error(
            "window-command-failed",
            format!("Windows rejected the move/resize for \"{title}\"."),
            true,
        );
    }
    rb.success(
        format!("Repositioned \"{title}\"."),
        json!({ "window_id": args.window_id, "x": x, "y": y, "width": w, "height": h }),
        VerificationEvidence::verified("return-code"),
    )
}

#[cfg(not(windows))]
pub fn move_resize_window(_args: MoveResizeArgs) -> ToolResult {
    ResultBuilder::new("windows.move_resize").unsupported("Windows only.")
}

pub fn close_window(args: WindowIdArgs) -> ToolResult {
    let rb = ResultBuilder::new("windows.close");
    let window = match find_by_opaque_id(&args.window_id) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let title = window.title().unwrap_or_default();
    let raw = window.id().unwrap_or(0);
    if !request_close_hwnd(raw) {
        return rb.error(
            "close-request-failed",
            format!("Windows rejected the close request for \"{title}\"."),
            true,
        );
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        if find_by_opaque_id(&args.window_id).is_err() {
            return rb.success(
                format!("Closed \"{title}\"."),
                json!({ "title": title }),
                VerificationEvidence::verified_with(
                    "window-detected",
                    json!({ "window_absent": true }),
                ),
            );
        }
        if std::time::Instant::now() >= deadline {
            return rb.partial(
                format!("Asked \"{title}\" to close, but it is still open — it may be prompting to save."),
                json!({ "title": title }),
                VerificationEvidence::unverified("window-detected"),
            );
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
}
