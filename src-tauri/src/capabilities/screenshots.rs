//! Screenshot capabilities. Reuses the Screen Context capture backend (xcap)
//! and its storage; every capture is decode-validated before success.

use serde::Deserialize;
use serde_json::json;
use std::path::Path;
use tauri::AppHandle;

use super::applications;
use super::system::window_opaque_id;
use super::types::{ResultBuilder, ToolArtifact, ToolResult, VerificationEvidence};
use crate::screen_context::storage;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureArgs {
    /// active-display | display | window | application | region
    pub target: String,
    #[serde(default)]
    pub display_id: Option<String>,
    #[serde(default)]
    pub window_id: Option<String>,
    #[serde(default)]
    pub application_query: Option<String>,
    #[serde(default)]
    pub region: Option<Region>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Region {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Validate a saved capture: exists, non-empty, decodes, sane dimensions.
fn validate_image(path: &Path) -> Result<(u32, u32, u64), String> {
    let metadata =
        std::fs::metadata(path).map_err(|_| "Capture file was not written.".to_string())?;
    if metadata.len() == 0 {
        return Err("Capture file is empty.".into());
    }
    let image = xcap::image::open(path)
        .map_err(|_| "Capture file does not decode as an image.".to_string())?;
    let (w, h) = (image.width(), image.height());
    if w == 0 || h == 0 {
        return Err("Capture has invalid dimensions.".into());
    }
    Ok((w, h, metadata.len()))
}

fn capture_result_to_tool_result(
    rb: ResultBuilder,
    app: &AppHandle,
    captures: Vec<crate::screen_context::capture::CaptureResult>,
    target_description: String,
) -> ToolResult {
    let Some(capture) = captures.into_iter().next() else {
        return rb.error("capture-failed", "No capture was produced.", true);
    };
    let meta = capture.meta;
    let path = match storage::image_path(app, &meta.id, false) {
        Ok(p) => p,
        Err(e) => return rb.error("capture-storage-failed", e, true),
    };
    match validate_image(&path) {
        Ok((width, height, size)) => {
            let artifact = ToolArtifact {
                id: meta.id.clone(),
                kind: "image".into(),
                display_name: target_description.clone(),
                path: Some(path.to_string_lossy().into_owned()),
                local_url: None, // Frontend fetches via get_capture_data_url(id).
                mime_type: Some("image/png".into()),
                size_bytes: Some(size),
            };
            rb.success_with_artifacts(
                format!("Captured {target_description} ({width}×{height})."),
                json!({
                    "capture_id": meta.id,
                    "image_path": path.to_string_lossy(),
                    "mime_type": "image/png",
                    "width": width,
                    "height": height,
                    "size_bytes": size,
                    "target_description": target_description,
                    "captured_at": meta.created_at,
                }),
                VerificationEvidence::verified_with(
                    "artifact-validated",
                    json!({ "decoded": true, "width": width, "height": height, "size_bytes": size }),
                ),
                vec![artifact],
            )
        }
        Err(e) => rb.error(
            "capture-invalid",
            format!("Capture failed validation: {e}"),
            true,
        ),
    }
}

pub fn capture(app: &AppHandle, args: CaptureArgs) -> ToolResult {
    let rb = ResultBuilder::new("screen.capture");
    match args.target.as_str() {
        "active-display" => {
            match crate::screen_context::capture::capture_screen(
                app.clone(),
                "mouse-monitor".into(),
                None,
            ) {
                Ok(captures) => {
                    capture_result_to_tool_result(rb, app, captures, "the active display".into())
                }
                Err(e) => rb.error("capture-failed", e, true),
            }
        }
        "display" => {
            let target = if args.display_id.is_some() {
                "monitor"
            } else {
                "primary-monitor"
            };
            match crate::screen_context::capture::capture_screen(
                app.clone(),
                target.into(),
                args.display_id.clone(),
            ) {
                Ok(captures) => capture_result_to_tool_result(
                    rb,
                    app,
                    captures,
                    args.display_id
                        .map(|id| format!("display {id}"))
                        .unwrap_or_else(|| "the primary display".into()),
                ),
                Err(e) => rb.error("capture-failed", e, true),
            }
        }
        "window" => {
            if args.window_id.is_some() {
                capture_specific_window(rb, app, args.window_id.as_deref().unwrap_or_default())
            } else {
                match crate::screen_context::capture::capture_screen(
                    app.clone(),
                    "active-window".into(),
                    None,
                ) {
                    Ok(captures) => {
                        capture_result_to_tool_result(rb, app, captures, "the active window".into())
                    }
                    Err(e) => rb.error("capture-failed", e, true),
                }
            }
        }
        "application" => {
            let Some(query) = args
                .application_query
                .as_deref()
                .filter(|q| !q.trim().is_empty())
            else {
                return rb.error("invalid-arguments", "application_query is required.", true);
            };
            capture_application(rb, app, query)
        }
        "region" => {
            let Some(region) = args.region else {
                return rb.error("invalid-arguments", "region is required.", true);
            };
            capture_region(rb, app, region)
        }
        other => rb.error(
            "invalid-arguments",
            format!("Unknown target \"{other}\"."),
            true,
        ),
    }
}

fn save_rgba(
    rb: ResultBuilder,
    app: &AppHandle,
    image: xcap::image::RgbaImage,
    source: &str,
    description: String,
    window_title: Option<String>,
) -> ToolResult {
    let id = format!("cap-{}-{}", storage::now_secs(), std::process::id() % 1000);
    let path = match storage::image_path(app, &id, false) {
        Ok(p) => p,
        Err(e) => return rb.error("capture-storage-failed", e, true),
    };
    let (width, height) = (image.width(), image.height());
    if let Err(e) = image.save(&path) {
        return rb.error(
            "capture-failed",
            format!("Could not save the capture: {e}"),
            true,
        );
    }
    let meta = storage::CaptureMeta {
        id: id.clone(),
        created_at: storage::now_secs(),
        source: source.to_string(),
        monitor_ids: Vec::new(),
        active_window_title: window_title,
        width,
        height,
        annotated: false,
    };
    if let Err(e) = storage::write_meta(app, &meta) {
        return rb.error("capture-storage-failed", e, true);
    }
    storage::apply_retention(app);
    match validate_image(&path) {
        Ok((w, h, size)) => {
            let artifact = ToolArtifact {
                id: id.clone(),
                kind: "image".into(),
                display_name: description.clone(),
                path: Some(path.to_string_lossy().into_owned()),
                local_url: None,
                mime_type: Some("image/png".into()),
                size_bytes: Some(size),
            };
            rb.success_with_artifacts(
                format!("Captured {description} ({w}×{h})."),
                json!({
                    "capture_id": id,
                    "image_path": path.to_string_lossy(),
                    "mime_type": "image/png",
                    "width": w,
                    "height": h,
                    "size_bytes": size,
                    "target_description": description,
                }),
                VerificationEvidence::verified_with(
                    "artifact-validated",
                    json!({ "decoded": true, "width": w, "height": h }),
                ),
                vec![artifact],
            )
        }
        Err(e) => rb.error(
            "capture-invalid",
            format!("Capture failed validation: {e}"),
            true,
        ),
    }
}

fn capture_specific_window(rb: ResultBuilder, app: &AppHandle, opaque_id: &str) -> ToolResult {
    let Some(raw) = super::system::parse_window_id(opaque_id) else {
        return rb.error(
            "invalid-arguments",
            format!("\"{opaque_id}\" is not a window id."),
            true,
        );
    };
    let windows = match xcap::Window::all() {
        Ok(w) => w,
        Err(e) => return rb.error("window-enumeration-failed", e.to_string(), true),
    };
    let Some(window) = windows.into_iter().find(|w| w.id().unwrap_or(0) == raw) else {
        return rb.not_found("That window no longer exists.");
    };
    let title = window.title().unwrap_or_default();
    match window.capture_image() {
        Ok(image) => save_rgba(
            rb,
            app,
            image,
            "capability-window",
            format!("the \"{title}\" window"),
            Some(title.clone()),
        ),
        Err(e) => rb.error(
            "capture-failed",
            format!("Window capture failed (the window may be protected): {e}"),
            true,
        ),
    }
}

fn capture_application(rb: ResultBuilder, app: &AppHandle, query: &str) -> ToolResult {
    // Resolve the app, then find its visible windows.
    let entries = applications::get_index(app, false);
    let own_pid = std::process::id();
    let windows = match xcap::Window::all() {
        Ok(w) => w,
        Err(e) => return rb.error("window-enumeration-failed", e.to_string(), true),
    };
    let normalized_query = applications::normalize_name(query);
    // Preferred process names from the index.
    let index_proc: Option<String> = entries
        .iter()
        .filter(|e| {
            e.normalized_names
                .iter()
                .any(|n| n.contains(&normalized_query))
        })
        .find_map(|e| e.process_name.clone())
        .map(|p| p.to_lowercase().trim_end_matches(".exe").to_string());

    let mut matches: Vec<&xcap::Window> = windows
        .iter()
        .filter(|w| w.pid().unwrap_or(0) != own_pid)
        .filter(|w| !w.is_minimized().unwrap_or(false))
        .filter(|w| {
            let app_name = w.app_name().unwrap_or_default().to_lowercase();
            let app_key = app_name.trim_end_matches(".exe").to_string();
            index_proc.as_ref().map(|k| &app_key == k).unwrap_or(false)
                || applications::normalize_name(&app_name).contains(&normalized_query)
                || applications::normalize_name(&w.title().unwrap_or_default())
                    .contains(&normalized_query)
        })
        .collect();

    if matches.is_empty() {
        return rb.not_found(format!(
            "No visible window matched \"{query}\". Is the app running?"
        ));
    }
    // Prefer the focused window, then the topmost.
    matches.sort_by_key(|w| {
        (
            if w.is_focused().unwrap_or(false) {
                0
            } else {
                1
            },
            -(w.z().unwrap_or(i32::MIN)),
        )
    });
    if matches.len() > 1 && !matches[0].is_focused().unwrap_or(false) {
        let candidates: Vec<serde_json::Value> = matches
            .iter()
            .take(4)
            .map(|w| {
                json!({
                    "window_id": window_opaque_id(w.id().unwrap_or(0)),
                    "title": w.title().unwrap_or_default(),
                })
            })
            .collect();
        return rb.needs_confirmation(
            format!("{} windows match \"{query}\". Which one?", matches.len()),
            json!({ "reason": "ambiguous-window", "candidates": candidates }),
        );
    }
    let window = matches[0];
    let title = window.title().unwrap_or_default();
    match window.capture_image() {
        Ok(image) => save_rgba(
            rb,
            app,
            image,
            "capability-application",
            format!("the {query} window (\"{title}\")"),
            Some(title.clone()),
        ),
        Err(e) => rb.error(
            "capture-failed",
            format!("Window capture failed (the window may be protected): {e}"),
            true,
        ),
    }
}

fn capture_region(rb: ResultBuilder, app: &AppHandle, region: Region) -> ToolResult {
    if region.width == 0 || region.height == 0 || region.width > 10000 || region.height > 10000 {
        return rb.error(
            "invalid-arguments",
            "Region dimensions are out of range.",
            true,
        );
    }
    let monitor = match xcap::Monitor::from_point(region.x, region.y) {
        Ok(m) => m,
        Err(_) => return rb.error("invalid-arguments", "Region is not on any display.", true),
    };
    let image = match monitor.capture_image() {
        Ok(i) => i,
        Err(e) => {
            return rb.error(
                "capture-failed",
                format!("Monitor capture failed: {e}"),
                true,
            )
        }
    };
    // Convert virtual-desktop coords to monitor-local, clamped to bounds.
    let mx = monitor.x().unwrap_or(0);
    let my = monitor.y().unwrap_or(0);
    let local_x = (region.x - mx).max(0) as u32;
    let local_y = (region.y - my).max(0) as u32;
    if local_x >= image.width() || local_y >= image.height() {
        return rb.error(
            "invalid-arguments",
            "Region is outside the display bounds.",
            true,
        );
    }
    let w = region.width.min(image.width() - local_x);
    let h = region.height.min(image.height() - local_y);
    let cropped = xcap::image::imageops::crop_imm(&image, local_x, local_y, w, h).to_image();
    save_rgba(
        rb,
        app,
        cropped,
        "capability-region",
        format!("a {w}×{h} region"),
        None,
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListTargetsArgs {}

pub fn list_capture_targets(_args: ListTargetsArgs) -> ToolResult {
    let rb = ResultBuilder::new("screen.list_capture_targets");
    let displays: Vec<serde_json::Value> = xcap::Monitor::all()
        .map(|ms| {
            ms.iter()
                .map(|m| {
                    json!({
                        "id": m.id().map(|i| i.to_string()).unwrap_or_default(),
                        "name": m.name().unwrap_or_default(),
                        "primary": m.is_primary().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let own_pid = std::process::id();
    let windows: Vec<serde_json::Value> = xcap::Window::all()
        .map(|ws| {
            ws.iter()
                .filter(|w| w.pid().unwrap_or(0) != own_pid)
                .filter(|w| !w.is_minimized().unwrap_or(false))
                .filter(|w| !w.title().unwrap_or_default().is_empty())
                .take(30)
                .map(|w| {
                    json!({
                        "window_id": window_opaque_id(w.id().unwrap_or(0)),
                        "title": w.title().unwrap_or_default(),
                        "process": w.app_name().unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    rb.success(
        format!(
            "{} displays and {} capturable windows.",
            displays.len(),
            windows.len()
        ),
        json!({ "displays": displays, "windows": windows }),
        VerificationEvidence::verified("state-readback"),
    )
}
