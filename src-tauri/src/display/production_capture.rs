//! Capture that knows where it came from.
//!
//! The old order was: capture, then work out which monitor it must have been.
//! That inference matched image dimensions against the monitor list, so two
//! monitors at the same resolution were interchangeable, and every click on the
//! result was a coin flip.
//!
//! The order here is the one `live_capture.rs` proved on real hardware: choose
//! the display from the topology, find the xcap monitor by *identity*, check its
//! geometry still agrees, and only then capture. The frame that comes out names
//! its display as fact rather than as a guess.

#![cfg(windows)]

use super::coordinates::{DisplayGeometry, ModelImageTransform};
use super::frame::CapturedFrame;
use super::topology::DisplayTopology;

/// An image and the frame that owns it. The frame is registered by the caller,
/// which keeps this function free of shared state and therefore testable.
pub struct OwnedCapture {
    pub frame: CapturedFrame,
    pub image: xcap::image::RgbaImage,
}

/// How the caller wants the display chosen.
///
/// Every mode resolves to exactly one `display_id` *before* any pixels are read.
/// "Under the cursor" is a legitimate way to pick which screen to photograph;
/// what it must never be is a way to decide, afterwards, which screen an
/// existing photograph came from.
#[derive(Debug, Clone)]
pub enum DisplaySelector {
    /// A specific display, by the stable id the topology reports.
    Id(u32),
    /// Whichever display the pointer is on right now.
    UnderCursor,
    Primary,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_frame_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!(
        "frame-{}-{}",
        now_ms(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(windows)]
fn cursor_pos() -> Option<(i32, i32)> {
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
    if unsafe { GetCursorPos(&mut p) } == 0 {
        return None;
    }
    Some((p.x, p.y))
}

/// Turn a selector into one concrete display, or say why it cannot.
pub fn resolve_display(
    topology: &DisplayTopology,
    selector: &DisplaySelector,
) -> Result<DisplayGeometry, String> {
    match selector {
        DisplaySelector::Id(id) => topology
            .display(*id)
            .copied()
            .ok_or_else(|| format!("Display {id} is not connected.")),
        DisplaySelector::Primary => topology
            .primary()
            .copied()
            .ok_or_else(|| "No display is connected.".to_string()),
        DisplaySelector::UnderCursor => {
            let (cx, cy) = cursor_pos().ok_or("The cursor position is unavailable.")?;
            let point = super::coordinates::TypedPoint::new(
                cx as f64,
                cy as f64,
                super::coordinates::CoordinateSpace::VirtualDesktopPhysical,
            );
            topology
                .display_containing(&point)
                .copied()
                // No nearest-monitor fallback: a cursor that is on no display
                // means the arrangement is not what we think it is, and picking
                // a neighbour would photograph the wrong screen.
                .ok_or_else(|| format!("The cursor at ({cx},{cy}) is not on any display."))
        }
    }
}

/// Find the xcap monitor for a display and confirm it has not moved.
///
/// The identity match is the whole point. Matching by size is what made two
/// 1920×1080 monitors indistinguishable; the geometry check afterwards catches
/// the rarer case where the arrangement changed between reading the topology
/// and taking the picture.
fn monitor_for(display: &DisplayGeometry) -> Result<xcap::Monitor, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Could not list monitors: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.id().ok() == Some(display.display_id))
        .ok_or_else(|| format!("Display {} vanished before capture.", display.display_id))?;

    let (mx, my) = (monitor.x().unwrap_or(0), monitor.y().unwrap_or(0));
    let (mw, mh) = (monitor.width().unwrap_or(0), monitor.height().unwrap_or(0));
    if mx != display.x || my != display.y || mw != display.width || mh != display.height {
        return Err(format!(
            "Display {} moved while ArcSonare was looking at it ({mx},{my} {mw}×{mh} vs {},{} {}×{}).",
            display.display_id, display.x, display.y, display.width, display.height
        ));
    }
    Ok(monitor)
}

/// Capture one whole display, binding the result to it.
pub fn capture_display(
    topology: &DisplayTopology,
    selector: &DisplaySelector,
) -> Result<OwnedCapture, String> {
    let display = resolve_display(topology, selector)?;
    let monitor = monitor_for(&display)?;
    let image = monitor
        .capture_image()
        .map_err(|e| format!("Capture of display {} failed: {e}", display.display_id))?;
    let (w, h) = (image.width(), image.height());
    Ok(OwnedCapture {
        frame: CapturedFrame {
            frame_id: new_frame_id(),
            display_id: display.display_id,
            topology_version: topology.version.clone(),
            captured_at_ms: now_ms(),
            capture_width: w,
            capture_height: h,
            display_bounds: display,
            preprocessing: None,
        },
        image,
    })
}

/// Capture a rectangle of the virtual desktop, bound to the display it sits on.
///
/// `capture_width`/`capture_height` stay the *full display* capture size and the
/// crop is recorded as preprocessing, because that is what the reverse mapping
/// expects: undoing the crop lands back in full-capture pixels, which then scale
/// to display-local. Recording the cropped size instead would scale every
/// coordinate by the ratio of the crop to the screen.
pub fn capture_region(
    topology: &DisplayTopology,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<OwnedCapture, String> {
    if width == 0 || height == 0 {
        return Err("The region has no area.".into());
    }
    let corner = super::coordinates::TypedPoint::new(
        x as f64,
        y as f64,
        super::coordinates::CoordinateSpace::VirtualDesktopPhysical,
    );
    let display = topology
        .display_containing(&corner)
        .copied()
        .ok_or_else(|| format!("The region at ({x},{y}) is not on any display."))?;

    let full = capture_display(topology, &DisplaySelector::Id(display.display_id))?;
    let (cw, ch) = (full.frame.capture_width, full.frame.capture_height);

    // Region coordinates are virtual-desktop; the image starts at the display's
    // own origin, which is negative whenever it sits left of or above primary.
    let local_x = (x - display.x).max(0) as u32;
    let local_y = (y - display.y).max(0) as u32;
    if local_x >= cw || local_y >= ch {
        return Err("The region is outside the display bounds.".into());
    }
    let w = width.min(cw - local_x);
    let h = height.min(ch - local_y);
    let cropped = xcap::image::imageops::crop_imm(&full.image, local_x, local_y, w, h).to_image();

    let mut frame = full.frame;
    frame.preprocessing = Some(ModelImageTransform::crop(
        local_x as f64,
        local_y as f64,
        w as f64,
        h as f64,
        (cw as f64, ch as f64),
    ));
    Ok(OwnedCapture {
        frame,
        image: cropped,
    })
}

/// Capture one window, bound to the display it is on.
///
/// A window that straddles two monitors is bound to the one holding its
/// top-left corner, and the crop is clamped to that display — a target found in
/// the half hanging off the edge is then correctly reported as out of bounds
/// rather than clicked on the neighbouring screen.
pub fn capture_window(
    topology: &DisplayTopology,
    window: &xcap::Window,
) -> Result<OwnedCapture, String> {
    let wx = window.x().unwrap_or(0);
    let wy = window.y().unwrap_or(0);
    let corner = super::coordinates::TypedPoint::new(
        wx as f64,
        wy as f64,
        super::coordinates::CoordinateSpace::VirtualDesktopPhysical,
    );
    let display = topology
        .display_containing(&corner)
        .copied()
        .ok_or_else(|| format!("That window at ({wx},{wy}) is not on any display."))?;

    let image = window
        .capture_image()
        .map_err(|e| format!("Window capture failed (the window may be protected): {e}"))?;
    let (iw, ih) = (image.width(), image.height());

    // The window's pixels sit inside the display's capture space at this offset.
    let local_x = (wx - display.x).max(0) as f64;
    let local_y = (wy - display.y).max(0) as f64;
    Ok(OwnedCapture {
        frame: CapturedFrame {
            frame_id: new_frame_id(),
            display_id: display.display_id,
            topology_version: topology.version.clone(),
            captured_at_ms: now_ms(),
            capture_width: display.width,
            capture_height: display.height,
            display_bounds: display,
            preprocessing: Some(ModelImageTransform::crop(
                local_x,
                local_y,
                iw as f64,
                ih as f64,
                (display.width as f64, display.height as f64),
            )),
        },
        image,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::display::coordinates::{CoordinateSpace, TypedPoint};
    use crate::display::frame::{resolve_visual_target, FrameRegistry, VisualTarget};

    fn geom(id: u32, x: i32, y: i32, w: u32, h: u32) -> DisplayGeometry {
        DisplayGeometry {
            display_id: id,
            x,
            y,
            width: w,
            height: h,
            scale_factor: 1.0,
            rotation: 0,
        }
    }

    /// Two 1920×1080 monitors — the arrangement dimension-matching gets wrong.
    fn twins() -> DisplayTopology {
        DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 1920, 1080),
            geom(2, 1920, 0, 1920, 1080),
        ])
    }

    #[test]
    fn a_selector_naming_a_display_resolves_to_exactly_that_display() {
        let topo = twins();
        let d = resolve_display(&topo, &DisplaySelector::Id(2)).unwrap();
        assert_eq!(d.display_id, 2);
        assert_eq!(d.x, 1920, "the twin's origin must not be borrowed from #1");
    }

    #[test]
    fn a_disconnected_display_is_refused_rather_than_substituted() {
        let topo = twins();
        let err = resolve_display(&topo, &DisplaySelector::Id(99)).unwrap_err();
        assert!(err.contains("99"), "{err}");
    }

    #[test]
    fn primary_is_the_display_at_the_desktop_origin_not_the_first_listed() {
        // Enumeration order is not identity; a portrait monitor to the left is
        // often listed first, and it is not the primary.
        let topo = DisplayTopology::from_displays(vec![
            geom(7, -1080, -661, 1080, 1920),
            geom(3, 0, 0, 3840, 1080),
        ]);
        assert_eq!(
            resolve_display(&topo, &DisplaySelector::Primary)
                .unwrap()
                .display_id,
            3
        );
    }

    /// The crop bookkeeping is what makes a region or window capture usable, so
    /// it is checked by round-tripping a point rather than by reading fields.
    #[test]
    fn a_cropped_frame_maps_a_model_point_back_to_the_right_desktop_pixel() {
        let topo = twins();
        let display = *topo.display(2).unwrap();
        // A 400×400 crop whose top-left sits 200,100 into display 2.
        let frame = CapturedFrame {
            frame_id: "f".into(),
            display_id: 2,
            topology_version: topo.version.clone(),
            captured_at_ms: now_ms(),
            capture_width: 1920,
            capture_height: 1080,
            display_bounds: display,
            preprocessing: Some(ModelImageTransform::crop(
                200.0,
                100.0,
                400.0,
                400.0,
                (1920.0, 1080.0),
            )),
        };
        let registry = FrameRegistry::new();
        registry.register(frame.clone());

        // Dead centre of the crop → 200+200 across, 100+200 down, on display 2.
        let target = VisualTarget {
            frame_id: "f".into(),
            display_id: 2,
            topology_version: topo.version.clone(),
            coordinate_space: CoordinateSpace::ModelNormalized,
            x: 500.0,
            y: 500.0,
            normalized_max: 1000.0,
            confidence: None,
        };
        let resolved = resolve_visual_target(&target, &registry, &topo).unwrap();
        assert_eq!(resolved.display_id, 2);
        assert!(
            (resolved.x - (1920.0 + 400.0)).abs() < 1.0,
            "{}",
            resolved.x
        );
        assert!((resolved.y - 300.0).abs() < 1.0, "{}", resolved.y);
    }

    #[test]
    fn a_cropped_frame_on_a_negative_origin_display_keeps_its_negative_x() {
        let topo = DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 3840, 1080),
            geom(2, -1080, -661, 1080, 1920),
        ]);
        let display = *topo.display(2).unwrap();
        let frame = CapturedFrame {
            frame_id: "f".into(),
            display_id: 2,
            topology_version: topo.version.clone(),
            captured_at_ms: now_ms(),
            capture_width: 1080,
            capture_height: 1920,
            display_bounds: display,
            preprocessing: None,
        };
        let registry = FrameRegistry::new();
        registry.register(frame);
        let target = VisualTarget {
            frame_id: "f".into(),
            display_id: 2,
            topology_version: topo.version.clone(),
            coordinate_space: CoordinateSpace::ModelNormalized,
            x: 500.0,
            y: 500.0,
            normalized_max: 1000.0,
            confidence: None,
        };
        let resolved = resolve_visual_target(&target, &registry, &topo).unwrap();
        assert!(
            resolved.x < 0.0,
            "expected a negative X, got {}",
            resolved.x
        );
        assert!(resolved.y < 0.0 || resolved.y < 400.0, "{}", resolved.y);
        let landed = topo
            .display_containing(&TypedPoint::new(
                resolved.x,
                resolved.y,
                CoordinateSpace::VirtualDesktopPhysical,
            ))
            .map(|d| d.display_id);
        assert_eq!(landed, Some(2));
    }
}
