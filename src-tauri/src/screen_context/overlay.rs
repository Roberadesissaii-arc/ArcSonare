//! Per-monitor edge indicator windows ("ArcSonare is viewing this screen").
//!
//! One transparent, click-through, always-on-top window per selected monitor,
//! exactly matching the monitor's physical bounds (negative coordinates and
//! per-monitor DPI included). The webview renders the violet perimeter; the
//! native window never takes focus, never appears in the taskbar and is
//! excluded from captures so the indicator does not appear in screenshots.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

pub const EDGE_LABEL_PREFIX: &str = "sonare-edge-";

/// Annotation window label (fullscreen drawing surface over a capture).
pub const ANNOTATE_LABEL: &str = "sonare-annotate";

fn edge_label(monitor_id: &str) -> String {
    format!("{EDGE_LABEL_PREFIX}{monitor_id}")
}

#[cfg(windows)]
fn exclude_from_capture(window: &tauri::WebviewWindow) {
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
    }
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    if let Ok(hwnd) = window.hwnd() {
        let ok = unsafe { SetWindowDisplayAffinity(hwnd.0 as isize, WDA_EXCLUDEFROMCAPTURE) };
        if ok == 0 {
            log::debug!("could not exclude '{}' from capture", window.label());
        }
    }
}

#[cfg(not(windows))]
fn exclude_from_capture(_window: &tauri::WebviewWindow) {}

/// Creates (or reuses) an edge indicator window on each requested monitor.
/// Returns the ids that actually got an overlay.
pub fn show_edge_overlays(app: &AppHandle, monitor_ids: &[String]) -> Result<Vec<String>, String> {
    let monitors = super::monitors::all()?;
    let mut shown = Vec::new();

    for id in monitor_ids {
        let Some(info) = monitors.iter().find(|m| &m.id == id) else {
            log::warn!("monitor '{id}' not found; skipping its edge overlay");
            continue;
        };
        let label = edge_label(id);

        let window = match app.get_webview_window(&label) {
            Some(existing) => existing,
            None => {
                match WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
                    .title("ArcSonare Screen Context")
                    .transparent(true)
                    .decorations(false)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .focused(false)
                    .resizable(false)
                    .maximizable(false)
                    .minimizable(false)
                    .visible(false)
                    .build()
                {
                    Ok(w) => w,
                    Err(e) => {
                        log::error!("could not create edge overlay for monitor {id}: {e}");
                        continue;
                    }
                }
            }
        };

        // Match the monitor's physical bounds exactly.
        if let Err(e) = window.set_position(PhysicalPosition::new(info.x, info.y)) {
            log::warn!("edge overlay position failed: {e}");
        }
        if let Err(e) = window.set_size(PhysicalSize::new(info.width, info.height)) {
            log::warn!("edge overlay size failed: {e}");
        }
        // Indicator only: never intercept the mouse or keyboard.
        if let Err(e) = window.set_ignore_cursor_events(true) {
            log::warn!("edge overlay click-through failed: {e}");
        }
        exclude_from_capture(&window);
        if let Err(e) = window.show() {
            log::error!("edge overlay show failed: {e}");
            continue;
        }
        shown.push(id.clone());
    }

    if shown.is_empty() {
        return Err("No edge indicator could be shown on the selected monitors.".into());
    }
    Ok(shown)
}

/// Destroys every edge overlay window.
pub fn remove_all_edge_overlays(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(EDGE_LABEL_PREFIX) {
            if let Err(e) = window.destroy() {
                log::error!("could not destroy edge overlay '{label}': {e}");
                let _ = window.hide();
            }
        }
    }
}

/// Opens the fullscreen annotation window on the monitor a capture came from.
#[tauri::command]
pub fn open_annotation(app: AppHandle, monitor_id: Option<String>) -> Result<(), String> {
    let monitors = super::monitors::all()?;
    let info = match &monitor_id {
        Some(id) => monitors
            .iter()
            .find(|m| &m.id == id)
            .ok_or_else(|| format!("Monitor '{id}' not found."))?,
        None => monitors
            .iter()
            .find(|m| m.is_primary)
            .or_else(|| monitors.first())
            .ok_or("No monitor available.")?,
    };

    let window = match app.get_webview_window(super::overlay::ANNOTATE_LABEL) {
        Some(existing) => existing,
        None => WebviewWindowBuilder::new(
            &app,
            ANNOTATE_LABEL,
            WebviewUrl::App("index.html".into()),
        )
        .title("ArcSonare Annotation")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .visible(false)
        .build()
        .map_err(|e| format!("Could not create the annotation window: {e}"))?,
    };

    window
        .set_position(PhysicalPosition::new(info.x, info.y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(PhysicalSize::new(info.width, info.height))
        .map_err(|e| e.to_string())?;
    // Drawing surface: it must receive mouse and keyboard input.
    let _ = window.set_ignore_cursor_events(false);
    exclude_from_capture(&window);
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_annotation(app: AppHandle) {
    if let Some(window) = app.get_webview_window(ANNOTATE_LABEL) {
        if let Err(e) = window.destroy() {
            log::error!("could not destroy annotation window: {e}");
            let _ = window.hide();
        }
    }
}
