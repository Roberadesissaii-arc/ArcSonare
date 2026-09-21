//! Which monitors exist, where they are, and whether that has changed.
//!
//! Previously each caller asked `xcap::Monitor::all()` on its own and picked a
//! monitor by whatever heuristic was handy — matching on image size, or taking
//! the one under the mouse. With two monitors at the same resolution those
//! heuristics choose the wrong screen, and nothing noticed when the arrangement
//! changed between a screenshot and the click that followed it.
//!
//! This reads the monitor list once, stamps it with a version, and hands out
//! the same answer to everyone.

use serde::{Deserialize, Serialize};

use super::coordinates::{CoordinateSpace, DisplayGeometry, TypedPoint};

/// The rectangle enclosing every monitor. Its origin is negative whenever a
/// monitor sits left of or above the primary one, so it is never assumed 0,0.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct VirtualDesktop {
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayTopology {
    pub displays: Vec<DisplayGeometry>,
    pub virtual_desktop: VirtualDesktop,
    /// Changes whenever any monitor's geometry changes. A frame captured under
    /// one version must not be acted on under another.
    pub version: String,
}

impl DisplayTopology {
    /// Build a topology from already-measured geometry.
    ///
    /// Kept separate from the platform read so the arithmetic is testable
    /// without physical monitors.
    pub fn from_displays(displays: Vec<DisplayGeometry>) -> Self {
        let virtual_desktop = Self::enclosing_rect(&displays);
        let version = Self::fingerprint(&displays);
        Self {
            displays,
            virtual_desktop,
            version,
        }
    }

    fn enclosing_rect(displays: &[DisplayGeometry]) -> VirtualDesktop {
        if displays.is_empty() {
            return VirtualDesktop {
                left: 0,
                top: 0,
                width: 0,
                height: 0,
            };
        }
        let left = displays.iter().map(|d| d.x).min().unwrap_or(0);
        let top = displays.iter().map(|d| d.y).min().unwrap_or(0);
        let right = displays
            .iter()
            .map(|d| d.x + d.width as i32)
            .max()
            .unwrap_or(0);
        let bottom = displays
            .iter()
            .map(|d| d.y + d.height as i32)
            .max()
            .unwrap_or(0);
        VirtualDesktop {
            left,
            top,
            width: (right - left).max(0) as u32,
            height: (bottom - top).max(0) as u32,
        }
    }

    /// A version stamp covering everything that would invalidate a mapping.
    ///
    /// Deliberately includes position, size, scale and rotation — moving a
    /// monitor changes the mapping just as much as resizing it does.
    fn fingerprint(displays: &[DisplayGeometry]) -> String {
        let mut parts: Vec<String> = displays
            .iter()
            .map(|d| {
                format!(
                    "{}:{}x{}@{},{}s{:.3}r{}",
                    d.display_id, d.width, d.height, d.x, d.y, d.scale_factor, d.rotation
                )
            })
            .collect();
        // Sorted so the same arrangement always yields the same version,
        // whatever order the platform happened to enumerate in.
        parts.sort();
        parts.join("|")
    }

    pub fn display(&self, id: u32) -> Option<&DisplayGeometry> {
        self.displays.iter().find(|d| d.display_id == id)
    }

    /// Which monitor contains a desktop point, if any.
    ///
    /// Returns `None` rather than the nearest monitor: a point that is not on
    /// any display is a mapping failure, and answering with a neighbour turns
    /// it into a click somewhere the user never asked for.
    pub fn display_containing(&self, p: &TypedPoint) -> Option<&DisplayGeometry> {
        if p.space != CoordinateSpace::VirtualDesktopPhysical || !p.is_finite() {
            return None;
        }
        self.displays.iter().find(|d| d.contains_virtual(p))
    }

    pub fn primary(&self) -> Option<&DisplayGeometry> {
        // The display at the desktop origin is the primary one on Windows.
        self.displays
            .iter()
            .find(|d| d.x == 0 && d.y == 0)
            .or_else(|| self.displays.first())
    }
}

/// Read the live monitor list. Physical pixels, virtual-desktop coordinates.
#[cfg(windows)]
pub fn read_topology() -> Result<DisplayTopology, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Could not list monitors: {e}"))?;
    let mut displays = Vec::new();
    for m in &monitors {
        let (Ok(id), Ok(x), Ok(y), Ok(width), Ok(height)) =
            (m.id(), m.x(), m.y(), m.width(), m.height())
        else {
            continue;
        };
        displays.push(DisplayGeometry {
            display_id: id,
            x,
            y,
            width,
            height,
            scale_factor: m.scale_factor().unwrap_or(1.0) as f64,
            rotation: m.rotation().unwrap_or(0.0) as u16,
        });
    }
    if displays.is_empty() {
        return Err("No monitors were detected.".into());
    }
    Ok(DisplayTopology::from_displays(displays))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(id: u32, x: i32, y: i32, w: u32, h: u32, scale: f64) -> DisplayGeometry {
        DisplayGeometry {
            display_id: id,
            x,
            y,
            width: w,
            height: h,
            scale_factor: scale,
            rotation: 0,
        }
    }

    /// The user's real layout: ultrawide primary, portrait up and to the left.
    fn real_layout() -> DisplayTopology {
        DisplayTopology::from_displays(vec![
            d(1, 0, 0, 3840, 1080, 1.0),
            d(2, -1080, -661, 1080, 1920, 1.0),
        ])
    }

    #[test]
    fn the_virtual_desktop_is_not_assumed_to_start_at_zero() {
        let t = real_layout();
        assert_eq!(t.virtual_desktop.left, -1080);
        assert_eq!(t.virtual_desktop.top, -661);
        assert_eq!(t.virtual_desktop.width, 4920);
        assert_eq!(t.virtual_desktop.height, 1920);
    }

    #[test]
    fn a_monitor_above_and_left_extends_the_desktop_both_ways() {
        let t = DisplayTopology::from_displays(vec![
            d(1, 0, 0, 1920, 1080, 1.0),
            d(2, -1920, -1080, 1920, 1080, 1.0),
        ]);
        assert_eq!(
            (t.virtual_desktop.left, t.virtual_desktop.top),
            (-1920, -1080)
        );
        assert_eq!(
            (t.virtual_desktop.width, t.virtual_desktop.height),
            (3840, 2160)
        );
    }

    #[test]
    fn identical_resolutions_are_still_told_apart() {
        // Matching a capture by image size picks one of these arbitrarily,
        // which is how a click landed on the wrong screen.
        let t = DisplayTopology::from_displays(vec![
            d(1, 0, 0, 1920, 1080, 1.0),
            d(2, 1920, 0, 1920, 1080, 1.0),
        ]);
        let on_second = TypedPoint::new(2000.0, 500.0, CoordinateSpace::VirtualDesktopPhysical);
        assert_eq!(t.display_containing(&on_second).unwrap().display_id, 2);
        let on_first = TypedPoint::new(100.0, 500.0, CoordinateSpace::VirtualDesktopPhysical);
        assert_eq!(t.display_containing(&on_first).unwrap().display_id, 1);
    }

    #[test]
    fn a_point_on_no_monitor_returns_nothing_rather_than_the_nearest() {
        let t = real_layout();
        let nowhere = TypedPoint::new(9999.0, 9999.0, CoordinateSpace::VirtualDesktopPhysical);
        assert!(t.display_containing(&nowhere).is_none());
    }

    #[test]
    fn a_point_in_the_wrong_space_is_not_matched_to_a_monitor() {
        let t = real_layout();
        let local = TypedPoint::new(10.0, 10.0, CoordinateSpace::DisplayLocalPhysical);
        assert!(t.display_containing(&local).is_none());
    }

    #[test]
    fn negative_coordinates_resolve_to_the_portrait_monitor() {
        let t = real_layout();
        let p = TypedPoint::new(-540.0, -300.0, CoordinateSpace::VirtualDesktopPhysical);
        assert_eq!(t.display_containing(&p).unwrap().display_id, 2);
    }

    #[test]
    fn moving_a_monitor_changes_the_version() {
        let before = real_layout().version;
        let after = DisplayTopology::from_displays(vec![
            d(1, 0, 0, 3840, 1080, 1.0),
            d(2, 3840, 0, 1080, 1920, 1.0),
        ])
        .version;
        assert_ne!(before, after, "a moved monitor must invalidate the mapping");
    }

    #[test]
    fn changing_only_the_scale_factor_changes_the_version() {
        let a = DisplayTopology::from_displays(vec![d(1, 0, 0, 3840, 2160, 1.0)]).version;
        let b = DisplayTopology::from_displays(vec![d(1, 0, 0, 3840, 2160, 1.5)]).version;
        assert_ne!(a, b);
    }

    #[test]
    fn enumeration_order_does_not_change_the_version() {
        let a = DisplayTopology::from_displays(vec![
            d(1, 0, 0, 1920, 1080, 1.0),
            d(2, 1920, 0, 1920, 1080, 1.0),
        ])
        .version;
        let b = DisplayTopology::from_displays(vec![
            d(2, 1920, 0, 1920, 1080, 1.0),
            d(1, 0, 0, 1920, 1080, 1.0),
        ])
        .version;
        assert_eq!(a, b, "the same arrangement must produce the same version");
    }

    #[test]
    fn an_empty_topology_does_not_panic() {
        let t = DisplayTopology::from_displays(vec![]);
        assert_eq!(t.virtual_desktop.width, 0);
        assert!(t.primary().is_none());
    }

    #[test]
    fn a_display_is_found_by_id() {
        let t = real_layout();
        assert_eq!(t.display(2).unwrap().height, 1920);
        assert!(t.display(99).is_none());
    }
}

#[cfg(all(test, windows))]
mod live_tests {
    use super::*;

    /// Reads the machine this is running on. Skips cleanly on a headless box.
    #[test]
    fn the_live_topology_is_self_consistent() {
        let Ok(t) = read_topology() else {
            eprintln!("no monitors available; skipping");
            return;
        };
        assert!(!t.displays.is_empty());
        // Every monitor must sit inside the enclosing rectangle.
        for d in &t.displays {
            assert!(
                d.x >= t.virtual_desktop.left,
                "display {} left of desktop",
                d.display_id
            );
            assert!(
                d.y >= t.virtual_desktop.top,
                "display {} above desktop",
                d.display_id
            );
            assert!(d.width > 0 && d.height > 0);
        }
        // The centre of each monitor must resolve back to that same monitor.
        for d in &t.displays {
            let centre = TypedPoint::new(
                d.x as f64 + d.width as f64 / 2.0,
                d.y as f64 + d.height as f64 / 2.0,
                CoordinateSpace::VirtualDesktopPhysical,
            );
            let found = t
                .display_containing(&centre)
                .expect("centre must be on a display");
            assert_eq!(
                found.display_id, d.display_id,
                "centre resolved to the wrong display"
            );
        }
        eprintln!(
            "live topology: {} displays, desktop {}x{} at ({},{})",
            t.displays.len(),
            t.virtual_desktop.width,
            t.virtual_desktop.height,
            t.virtual_desktop.left,
            t.virtual_desktop.top
        );
    }
}
