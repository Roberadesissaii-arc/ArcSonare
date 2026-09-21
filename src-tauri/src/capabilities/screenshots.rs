//! Screenshot capabilities.
//!
//! Every capture here chooses its display *first*, then photographs it, then
//! registers a `CapturedFrame` before the result is returned. The frame is the
//! only thing downstream is allowed to use to place a coordinate — which is why
//! this file no longer computes, infers or returns a capture origin. Working out
//! where an image came from after the fact is what put clicks on the wrong
//! monitor; the answer is now recorded at the moment it is known for certain.

use serde::Deserialize;
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

use super::applications;
use super::system::window_opaque_id;
use super::types::{ResultBuilder, ToolArtifact, ToolResult, VerificationEvidence};
use crate::display::frame::CapturedFrame;
use crate::display::runtime::VisualRuntime;
use crate::screen_context::storage;

#[cfg(windows)]
use crate::display::production_capture::{self, DisplaySelector, OwnedCapture};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureArgs {
    /// active-display | display | window | application | region | portion
    pub target: String,
    #[serde(default)]
    pub display_id: Option<String>,
    #[serde(default)]
    pub window_id: Option<String>,
    #[serde(default)]
    pub application_query: Option<String>,
    #[serde(default)]
    pub region: Option<Region>,
    /// Sub-area of a display: `left-half`, `right-half`, `top-half`,
    /// `bottom-half`, `left-third`, `center-third`, `right-third`.
    ///
    /// Exists because a full capture of an ultrawide is mostly empty desktop —
    /// this lets "screenshot the left half" produce a useful image without the
    /// caller needing to know pixel coordinates.
    #[serde(default)]
    pub portion: Option<String>,
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

/// The ownership block every actionable capture returns.
///
/// `frameId` is the handle; everything a caller might otherwise be tempted to
/// recompute — which display, which arrangement, how big the source was — is
/// stated here so it never has to be inferred from the image.
fn ownership_json(frame: &CapturedFrame, image_width: u32, image_height: u32) -> serde_json::Value {
    let b = frame.display_bounds;
    json!({
        "frame_id": frame.frame_id,
        "display_id": frame.display_id.to_string(),
        "topology_version": frame.topology_version,
        "captured_at_ms": frame.captured_at_ms,
        "capture_width": frame.capture_width,
        "capture_height": frame.capture_height,
        "image_width": image_width,
        "image_height": image_height,
        "display_bounds": {
            "x": b.x,
            "y": b.y,
            "width": b.width,
            "height": b.height,
        },
        "scale_factor": b.scale_factor,
        "rotation_degrees": b.rotation,
        "cropped": frame.preprocessing.is_some(),
    })
}

/// Persist the image, register the frame, and describe both.
#[cfg(windows)]
fn finish_capture<R: Runtime>(
    rb: ResultBuilder,
    app: &AppHandle<R>,
    capture: OwnedCapture,
    description: String,
    window_title: Option<String>,
    source: &str,
) -> ToolResult {
    let OwnedCapture { frame, image } = capture;
    // The frame id doubles as the storage id so `get_capture_data_url(frameId)`
    // needs no second lookup table.
    let path = match storage::image_path(app, &frame.frame_id, false) {
        Ok(p) => p,
        Err(e) => return rb.error("capture-storage-failed", e, true),
    };
    let (image_width, image_height) = (image.width(), image.height());
    if let Err(e) = image.save(&path) {
        return rb.error(
            "capture-failed",
            format!("Could not save the capture: {e}"),
            true,
        );
    }
    let meta = storage::CaptureMeta {
        id: frame.frame_id.clone(),
        created_at: storage::now_secs(),
        source: source.to_string(),
        monitor_ids: vec![frame.display_id.to_string()],
        active_window_title: window_title,
        width: image_width,
        height: image_height,
        annotated: false,
    };
    if let Err(e) = storage::write_meta(app, &meta) {
        return rb.error("capture-storage-failed", e, true);
    }
    storage::apply_retention(app);

    match validate_image(&path) {
        Ok((w, h, size)) => {
            // Registered only after the image is proven readable: a frame whose
            // pixels never made it to disk is not something to act on.
            app.state::<VisualRuntime>()
                .frames()
                .register(frame.clone());

            let artifact = ToolArtifact {
                id: frame.frame_id.clone(),
                kind: "image".into(),
                display_name: description.clone(),
                path: Some(path.to_string_lossy().into_owned()),
                local_url: None, // Frontend fetches via get_capture_data_url(id).
                mime_type: Some("image/png".into()),
                size_bytes: Some(size),
            };
            let mut data = ownership_json(&frame, w, h);
            if let Some(obj) = data.as_object_mut() {
                obj.insert("capture_id".into(), json!(frame.frame_id));
                obj.insert("image_path".into(), json!(path.to_string_lossy()));
                obj.insert("mime_type".into(), json!("image/png"));
                obj.insert("width".into(), json!(w));
                obj.insert("height".into(), json!(h));
                obj.insert("size_bytes".into(), json!(size));
                obj.insert("target_description".into(), json!(description));
            }
            rb.success_with_artifacts(
                format!("Captured {description} ({w}×{h})."),
                data,
                VerificationEvidence::verified_with(
                    "artifact-validated",
                    json!({
                        "decoded": true,
                        "width": w,
                        "height": h,
                        "frame_registered": true,
                        "display_id": frame.display_id,
                    }),
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

/// Parse the caller's display argument.
///
/// Two vocabularies reach this: a stable OS display id, and the 1-based ordinal
/// a person means by "my second monitor". They are told apart by looking the id
/// up in the topology first, because an ordinal like "2" is also a plausible id.
#[cfg(windows)]
fn selector_from_arg(
    topology: &crate::display::topology::DisplayTopology,
    display_id: Option<&str>,
) -> Result<DisplaySelector, String> {
    let Some(raw) = display_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(DisplaySelector::Primary);
    };
    if let Ok(id) = raw.parse::<u32>() {
        if topology.display(id).is_some() {
            return Ok(DisplaySelector::Id(id));
        }
        // Fall back to the ordinal reading, ordered left-to-right so it matches
        // the physical arrangement rather than enumeration order.
        let mut ordered = topology.displays.clone();
        ordered.sort_by_key(|d| d.x);
        if id >= 1 && (id as usize) <= ordered.len() {
            return Ok(DisplaySelector::Id(ordered[id as usize - 1].display_id));
        }
        return Err(format!(
            "There {} only {} display{}, so display \"{raw}\" does not exist.",
            if ordered.len() == 1 { "is" } else { "are" },
            ordered.len(),
            if ordered.len() == 1 { "" } else { "s" }
        ));
    }
    Err(format!("\"{raw}\" is not a display id."))
}

#[cfg(windows)]
pub fn capture<R: Runtime>(app: &AppHandle<R>, args: CaptureArgs) -> ToolResult {
    let rb = ResultBuilder::new("screen.capture");
    let runtime = app.state::<VisualRuntime>();
    let topology = match runtime.topology() {
        Ok(t) => t,
        Err(e) => return rb.error("topology-unavailable", e, true),
    };

    match args.target.as_str() {
        // "The screen I'm looking at". Choosing by cursor is a fine way to pick
        // which display to photograph; what it must never do is decide, after
        // the fact, which display an existing photograph came from.
        "active-display" => {
            match production_capture::capture_display(&topology, &DisplaySelector::UnderCursor) {
                Ok(c) => {
                    let d = c.frame.display_id;
                    finish_capture(rb, app, c, format!("display {d}"), None, "monitor")
                }
                Err(e) => rb.error("capture-failed", e, true),
            }
        }
        "display" => {
            let selector = match selector_from_arg(&topology, args.display_id.as_deref()) {
                Ok(s) => s,
                Err(e) => return rb.error("invalid-arguments", e, true),
            };
            match production_capture::capture_display(&topology, &selector) {
                Ok(c) => {
                    let d = c.frame.display_id;
                    finish_capture(rb, app, c, format!("display {d}"), None, "monitor")
                }
                Err(e) => rb.error("capture-failed", e, true),
            }
        }
        "window" => {
            if let Some(id) = args.window_id.as_deref() {
                capture_specific_window(rb, app, &topology, id)
            } else {
                capture_foreground_window(rb, app, &topology)
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
            capture_application(rb, app, &topology, query)
        }
        "region" => {
            let Some(region) = args.region else {
                return rb.error("invalid-arguments", "region is required.", true);
            };
            if region.width == 0
                || region.height == 0
                || region.width > 10000
                || region.height > 10000
            {
                return rb.error(
                    "invalid-arguments",
                    "Region dimensions are out of range.",
                    true,
                );
            }
            match production_capture::capture_region(
                &topology,
                region.x,
                region.y,
                region.width,
                region.height,
            ) {
                Ok(c) => {
                    let (w, h) = (c.image.width(), c.image.height());
                    finish_capture(rb, app, c, format!("a {w}×{h} region"), None, "region")
                }
                Err(e) => rb.error("capture-failed", e, true),
            }
        }
        "portion" => {
            let Some(portion) = args.portion.as_deref() else {
                return rb.error("invalid-arguments", "portion is required.", true);
            };
            let selector = match selector_from_arg(&topology, args.display_id.as_deref()) {
                Ok(s) => s,
                Err(e) => return rb.error("invalid-arguments", e, true),
            };
            let display = match production_capture::resolve_display(&topology, &selector) {
                Ok(d) => d,
                Err(e) => return rb.error("invalid-arguments", e, true),
            };
            let region = match portion_region(portion, &display) {
                Ok(r) => r,
                Err(e) => return rb.error("invalid-arguments", e, true),
            };
            match production_capture::capture_region(
                &topology,
                region.x,
                region.y,
                region.width,
                region.height,
            ) {
                Ok(c) => finish_capture(
                    rb,
                    app,
                    c,
                    format!("the {portion} of display {}", display.display_id),
                    None,
                    "region",
                ),
                Err(e) => rb.error("capture-failed", e, true),
            }
        }
        other => rb.error(
            "invalid-arguments",
            format!("Unknown target \"{other}\"."),
            true,
        ),
    }
}

#[cfg(not(windows))]
pub fn capture(_app: &AppHandle, _args: CaptureArgs) -> ToolResult {
    ResultBuilder::new("screen.capture").unsupported("Screen capture is only available on Windows.")
}

#[cfg(windows)]
fn capture_foreground_window<R: Runtime>(
    rb: ResultBuilder,
    app: &AppHandle<R>,
    topology: &crate::display::topology::DisplayTopology,
) -> ToolResult {
    let own_pid = std::process::id();
    let windows = match xcap::Window::all() {
        Ok(w) => w,
        Err(e) => return rb.error("window-enumeration-failed", e.to_string(), true),
    };
    let mut candidates: Vec<xcap::Window> = windows
        .into_iter()
        .filter(|w| w.pid().unwrap_or(0) != own_pid)
        .filter(|w| !w.is_minimized().unwrap_or(false))
        .collect();
    candidates.sort_by_key(|w| {
        (
            if w.is_focused().unwrap_or(false) {
                0
            } else {
                1
            },
            -(w.z().unwrap_or(i32::MIN)),
        )
    });
    let Some(window) = candidates.first() else {
        return rb.not_found("No capturable window was found.");
    };
    let title = window.title().unwrap_or_default();
    match production_capture::capture_window(topology, window) {
        Ok(c) => finish_capture(
            rb,
            app,
            c,
            "the active window".into(),
            Some(title),
            "active-window",
        ),
        Err(e) => rb.error("capture-failed", e, true),
    }
}

#[cfg(windows)]
fn capture_specific_window<R: Runtime>(
    rb: ResultBuilder,
    app: &AppHandle<R>,
    topology: &crate::display::topology::DisplayTopology,
    opaque_id: &str,
) -> ToolResult {
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
    match production_capture::capture_window(topology, &window) {
        Ok(c) => finish_capture(
            rb,
            app,
            c,
            format!("the \"{title}\" window"),
            Some(title.clone()),
            "capability-window",
        ),
        Err(e) => rb.error("capture-failed", e, true),
    }
}

#[cfg(windows)]
fn capture_application<R: Runtime>(
    rb: ResultBuilder,
    app: &AppHandle<R>,
    topology: &crate::display::topology::DisplayTopology,
    query: &str,
) -> ToolResult {
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
    match production_capture::capture_window(topology, window) {
        Ok(c) => finish_capture(
            rb,
            app,
            c,
            format!("the {query} window (\"{title}\")"),
            Some(title.clone()),
            "capability-application",
        ),
        Err(e) => rb.error("capture-failed", e, true),
    }
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

/// Turn a portion name into desktop-pixel bounds on an already-chosen display.
///
/// The display is a parameter rather than something this looks up, so a portion
/// capture and a full capture of the same screen cannot disagree about which
/// screen that is.
pub(crate) fn portion_region(
    portion: &str,
    display: &crate::display::coordinates::DisplayGeometry,
) -> Result<Region, String> {
    let (mx, my, mw, mh) = (display.x, display.y, display.width, display.height);
    let (x, y, width, height) = match portion {
        "left-half" => (mx, my, mw / 2, mh),
        "right-half" => (mx + (mw / 2) as i32, my, mw - mw / 2, mh),
        "top-half" => (mx, my, mw, mh / 2),
        "bottom-half" => (mx, my + (mh / 2) as i32, mw, mh - mh / 2),
        "left-third" => (mx, my, mw / 3, mh),
        "center-third" | "middle-third" => (mx + (mw / 3) as i32, my, mw / 3, mh),
        "right-third" => (mx + (2 * mw / 3) as i32, my, mw - 2 * (mw / 3), mh),
        other => return Err(format!("Unknown portion \"{other}\".")),
    };
    Ok(Region {
        x,
        y,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::display::coordinates::DisplayGeometry;

    fn display(x: i32, y: i32, w: u32, h: u32) -> DisplayGeometry {
        DisplayGeometry {
            display_id: 1,
            x,
            y,
            width: w,
            height: h,
            scale_factor: 1.0,
            rotation: 0,
        }
    }

    #[test]
    fn a_portion_of_a_negative_origin_display_stays_on_that_display() {
        // The portrait monitor to the left is the case where a zero-origin
        // assumption silently captures the primary screen instead.
        let d = display(-1080, -661, 1080, 1920);
        let r = portion_region("top-half", &d).unwrap();
        assert_eq!((r.x, r.y), (-1080, -661));
        assert_eq!((r.width, r.height), (1080, 960));
    }

    #[test]
    fn halves_and_thirds_cover_the_display_without_overlapping() {
        let d = display(0, 0, 3840, 1080);
        let left = portion_region("left-half", &d).unwrap();
        let right = portion_region("right-half", &d).unwrap();
        assert_eq!(left.x + left.width as i32, right.x);
        assert_eq!(left.width + right.width, 3840);

        let l = portion_region("left-third", &d).unwrap();
        let c = portion_region("center-third", &d).unwrap();
        let r = portion_region("right-third", &d).unwrap();
        assert_eq!(l.x + l.width as i32, c.x);
        assert_eq!(c.x + c.width as i32, r.x);
        assert_eq!(l.width + c.width + r.width, 3840);
    }

    #[test]
    fn an_unknown_portion_is_refused() {
        assert!(portion_region("diagonal-ninth", &display(0, 0, 100, 100)).is_err());
    }
}
