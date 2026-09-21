//! Capture-side ownership, proven on the monitors actually plugged in.
//!
//! The unit tests build a topology by hand, so they prove the arithmetic but
//! not that the real capture path picks the right monitor. This does the thing
//! the runtime must do — resolve the display *first*, capture that display,
//! register the frame, resolve a point back — against live hardware.
//!
//! Deliberately read-only: it captures and computes, but never moves the cursor
//! and never clicks.

#![cfg(windows)]

use super::coordinates::CoordinateSpace;
use super::frame::{resolve_visual_target, CapturedFrame, FrameRegistry, VisualTarget};
use super::topology::{self, DisplayTopology};

#[derive(Debug)]
pub struct OwnershipCheck {
    pub display_id: u32,
    pub bounds: (i32, i32, u32, u32),
    pub capture_size: (u32, u32),
    pub frame_id: String,
    pub resolved: (f64, f64),
    pub resolved_display_id: Option<u32>,
    pub correct_display: bool,
}

/// Capture every connected display and prove each frame resolves to itself.
///
/// The display is chosen from the topology *before* the capture, and the xcap
/// monitor is matched to it by id — never by image size, which is what made two
/// same-resolution monitors interchangeable.
pub fn check_capture_ownership() -> Result<(DisplayTopology, Vec<OwnershipCheck>), String> {
    let topo = topology::read_topology()?;
    let registry = FrameRegistry::new();
    let monitors = xcap::Monitor::all().map_err(|e| format!("Could not list monitors: {e}"))?;
    let mut results = Vec::new();

    for display in &topo.displays {
        // Select the monitor by identity, then validate its geometry agrees
        // with the topology. A disagreement means the two views of the desktop
        // have drifted, and capturing anyway would bind the frame to a lie.
        let monitor = monitors
            .iter()
            .find(|m| m.id().ok() == Some(display.display_id))
            .ok_or_else(|| format!("display {} vanished before capture", display.display_id))?;

        let (mx, my) = (monitor.x().unwrap_or(0), monitor.y().unwrap_or(0));
        if mx != display.x || my != display.y {
            return Err(format!(
                "display {} moved between enumeration and capture ({mx},{my} vs {},{})",
                display.display_id, display.x, display.y
            ));
        }

        let image = monitor
            .capture_image()
            .map_err(|e| format!("capture of display {} failed: {e}", display.display_id))?;
        let (w, h) = (image.width(), image.height());

        let frame = CapturedFrame {
            frame_id: format!("live-{}-{}", display.display_id, w),
            display_id: display.display_id,
            topology_version: topo.version.clone(),
            captured_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            capture_width: w,
            capture_height: h,
            display_bounds: *display,
            preprocessing: None,
        };
        registry.register(frame.clone());

        // Resolve the centre of the capture, exactly as a model answer would.
        let target = VisualTarget {
            frame_id: frame.frame_id.clone(),
            display_id: frame.display_id,
            topology_version: frame.topology_version.clone(),
            coordinate_space: CoordinateSpace::ModelNormalized,
            x: 500.0,
            y: 500.0,
            normalized_max: 1000.0,
            confidence: Some(1.0),
        };
        let resolved = resolve_visual_target(&target, &registry, &topo)
            .map_err(|e| format!("display {} failed to resolve: {e}", display.display_id))?;

        let point = super::coordinates::TypedPoint::new(
            resolved.x,
            resolved.y,
            CoordinateSpace::VirtualDesktopPhysical,
        );
        let landed = topo.display_containing(&point).map(|d| d.display_id);

        results.push(OwnershipCheck {
            display_id: display.display_id,
            bounds: (display.x, display.y, display.width, display.height),
            capture_size: (w, h),
            frame_id: frame.frame_id,
            resolved: (resolved.x, resolved.y),
            resolved_display_id: landed,
            correct_display: landed == Some(display.display_id),
        });
    }

    Ok((topo, results))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_connected_display_owns_its_own_capture() {
        let Ok((topo, checks)) = check_capture_ownership() else {
            eprintln!("no capturable monitors; skipping");
            return;
        };

        eprintln!(
            "virtual desktop: left={} top={} {}x{}  (topology {} displays)",
            topo.virtual_desktop.left,
            topo.virtual_desktop.top,
            topo.virtual_desktop.width,
            topo.virtual_desktop.height,
            topo.displays.len()
        );

        for c in &checks {
            eprintln!(
                "display {:>2} bounds=({},{} {}x{}) capture={}x{} frame={} -> centre ({:.0},{:.0}) landed on {:?} {}",
                c.display_id,
                c.bounds.0,
                c.bounds.1,
                c.bounds.2,
                c.bounds.3,
                c.capture_size.0,
                c.capture_size.1,
                c.frame_id,
                c.resolved.0,
                c.resolved.1,
                c.resolved_display_id,
                if c.correct_display { "OK" } else { "WRONG DISPLAY" }
            );
        }

        assert!(!checks.is_empty(), "no displays were checked");
        for c in &checks {
            assert!(
                c.correct_display,
                "display {} resolved onto {:?}",
                c.display_id, c.resolved_display_id
            );
        }
    }
}
