//! Native capture of monitors and the active foreground window.

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use xcap::{Monitor, Window};

use super::storage::{self, CaptureMeta};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub meta: CaptureMeta,
}

fn new_capture_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!(
        "cap-{}-{}",
        storage::now_secs(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// Windows: hide/show our own windows from screen capture around a grab.
/// WDA_EXCLUDEFROMCAPTURE requires Windows 10 2004+; failure is non-fatal.
#[cfg(windows)]
fn set_own_windows_capture_affinity(app: &AppHandle, exclude: bool) {
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
    }
    const WDA_NONE: u32 = 0x0;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    let affinity = if exclude {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    for (_, window) in app.webview_windows() {
        if let Ok(hwnd) = window.hwnd() {
            let ok = unsafe { SetWindowDisplayAffinity(hwnd.0 as isize, affinity) };
            if ok == 0 {
                log::debug!("SetWindowDisplayAffinity failed for '{}'", window.label());
            }
        }
    }
}

#[cfg(not(windows))]
fn set_own_windows_capture_affinity(_app: &AppHandle, _exclude: bool) {}

fn save_image(
    app: &AppHandle,
    image: xcap::image::RgbaImage,
    source: &str,
    monitor_ids: Vec<String>,
    active_window_title: Option<String>,
) -> Result<CaptureResult, String> {
    let id = new_capture_id();
    let (width, height) = (image.width(), image.height());
    let path = storage::image_path(app, &id, false)?;
    image
        .save(&path)
        .map_err(|e| format!("Could not save the capture: {e}"))?;
    let meta = CaptureMeta {
        id,
        created_at: storage::now_secs(),
        source: source.to_string(),
        monitor_ids,
        active_window_title,
        width,
        height,
        annotated: false,
    };
    storage::write_meta(app, &meta)?;
    storage::apply_retention(app);
    Ok(CaptureResult { meta })
}

fn capture_monitor_image(monitor: &Monitor) -> Result<xcap::image::RgbaImage, String> {
    monitor
        .capture_image()
        .map_err(|e| format!("Monitor capture failed: {e}"))
}

/// Finds the foreground window that does not belong to ArcSonare.
fn foreground_window() -> Result<Window, String> {
    let windows = Window::all().map_err(|e| format!("Could not enumerate windows: {e}"))?;
    let own_pid = std::process::id();
    let mut focused: Option<Window> = None;
    let mut topmost: Option<(i32, Window)> = None;
    for window in windows {
        let pid = window.pid().unwrap_or(0);
        if pid == own_pid {
            continue;
        }
        if window.is_minimized().unwrap_or(false) {
            continue;
        }
        if window.is_focused().unwrap_or(false) {
            focused = Some(window);
            break;
        }
        let z = window.z().unwrap_or(i32::MIN);
        if topmost.as_ref().map(|(tz, _)| z > *tz).unwrap_or(true) {
            topmost = Some((z, window));
        }
    }
    focused
        .or(topmost.map(|(_, w)| w))
        .ok_or_else(|| "No capturable window was found.".into())
}

/// Captures the configured target. `target` is one of:
/// "monitor" (requires monitor_id), "mouse-monitor", "primary-monitor",
/// "all-monitors", "active-window".
#[tauri::command]
pub fn capture_screen(
    app: AppHandle,
    target: String,
    monitor_id: Option<String>,
) -> Result<Vec<CaptureResult>, String> {
    let settings = crate::settings::current(&app);
    let retention_none = settings
        .prefs
        .get("screenContext")
        .and_then(|v| v.get("privacy"))
        .and_then(|v| v.get("retention"))
        .and_then(|v| v.as_str())
        == Some("none");
    let hide_own = settings.pref_bool("screenContext.hideArcSonareWindows", true);

    if hide_own {
        set_own_windows_capture_affinity(&app, true);
    }
    let result = capture_inner(&app, &target, monitor_id);
    if hide_own {
        set_own_windows_capture_affinity(&app, false);
    }

    // "Do not save" retention: the file exists only for the immediate
    // annotation/preview flow and is flagged for deletion after processing.
    if retention_none {
        log::info!("retention is 'none' — captures will be deleted after processing");
    }
    result
}

fn capture_inner(
    app: &AppHandle,
    target: &str,
    monitor_id: Option<String>,
) -> Result<Vec<CaptureResult>, String> {
    match target {
        "monitor" => {
            let id = monitor_id.ok_or("monitor target requires a monitor id")?;
            let monitor = super::monitors::by_id(&id)?;
            let image = capture_monitor_image(&monitor)?;
            Ok(vec![save_image(app, image, "monitor", vec![id], None)?])
        }
        "mouse-monitor" => {
            let pos = app
                .cursor_position()
                .map_err(|e| format!("Cursor position unavailable: {e}"))?;
            let monitor = Monitor::from_point(pos.x as i32, pos.y as i32)
                .map_err(|e| format!("No monitor at the cursor position: {e}"))?;
            let id = monitor.id().map(|i| i.to_string()).unwrap_or_default();
            let image = capture_monitor_image(&monitor)?;
            Ok(vec![save_image(app, image, "monitor", vec![id], None)?])
        }
        "primary-monitor" => {
            let monitors =
                Monitor::all().map_err(|e| format!("Could not enumerate monitors: {e}"))?;
            let monitor = monitors
                .into_iter()
                .find(|m| m.is_primary().unwrap_or(false))
                .ok_or("No primary monitor found.")?;
            let id = monitor.id().map(|i| i.to_string()).unwrap_or_default();
            let image = capture_monitor_image(&monitor)?;
            Ok(vec![save_image(app, image, "monitor", vec![id], None)?])
        }
        "all-monitors" => {
            let monitors =
                Monitor::all().map_err(|e| format!("Could not enumerate monitors: {e}"))?;
            let mut results = Vec::new();
            for monitor in monitors {
                let id = monitor.id().map(|i| i.to_string()).unwrap_or_default();
                let image = capture_monitor_image(&monitor)?;
                results.push(save_image(app, image, "multi-monitor", vec![id], None)?);
            }
            Ok(results)
        }
        "active-window" => {
            let window = foreground_window()?;
            let title = window.title().ok();
            let image = window
                .capture_image()
                .map_err(|e| format!("Window capture failed: {e}"))?;
            Ok(vec![save_image(
                app,
                image,
                "active-window",
                Vec::new(),
                title,
            )?])
        }
        other => Err(format!("Unknown capture target '{other}'.")),
    }
}

/// Returns a capture (or its annotated variant) as a PNG data URL for
/// rendering inside the app — the CSP allows `img-src data:`.
/// A capture cropped to one region, for "what is this?" about something the
/// user drew around.
///
/// The crop is what makes the question answerable: handing over the whole
/// screen and describing the region in words leaves the model to find it, which
/// is the guessing this feature exists to remove. A margin is kept so the
/// surroundings still give context.
/// `id` is the frame id of a registered capture. The image's position on the
/// desktop is read from that frame rather than passed in: an origin supplied by
/// the caller is an origin that was inferred somewhere, and inferring it is what
/// put crops — and the clicks that followed them — on the wrong monitor.
#[tauri::command]
pub fn get_capture_region_data_url(
    app: AppHandle,
    id: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<String, String> {
    use tauri::Manager;

    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid capture id.".into());
    }
    if width <= 0 || height <= 0 {
        return Err("The drawn region has no area.".into());
    }
    let frame = app
        .state::<crate::display::runtime::VisualRuntime>()
        .frames()
        .get(&id)
        .ok_or("That screenshot is no longer on record — take a new one.")?;
    let (origin_x, origin_y) = (frame.display_bounds.x, frame.display_bounds.y);

    let path = storage::image_path(&app, &id, false)?;
    let img = image::open(&path).map_err(|e| format!("Capture not readable: {e}"))?;
    let (iw, ih) = (img.width() as i32, img.height() as i32);

    let margin = 24;
    let lx = (x - origin_x - margin).clamp(0, iw.saturating_sub(1));
    let ly = (y - origin_y - margin).clamp(0, ih.saturating_sub(1));
    let lw = (width + margin * 2).min(iw - lx).max(1);
    let lh = (height + margin * 2).min(ih - ly).max(1);

    let cropped = img.crop_imm(lx as u32, ly as u32, lw as u32, lh as u32);
    let mut buf = std::io::Cursor::new(Vec::new());
    cropped
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("Could not encode the region: {e}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    Ok(format!("data:image/png;base64,{encoded}"))
}

#[tauri::command]
pub fn get_capture_data_url(app: AppHandle, id: String, annotated: bool) -> Result<String, String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid capture id.".into());
    }
    let path = storage::image_path(&app, &id, annotated)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Capture not available: {e}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
}
