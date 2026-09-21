//! One registry, one topology, shared by every visual command.
//!
//! The failure this removes is subtle: each command used to call
//! `xcap::Monitor::all()` for itself, so a screenshot and the click that
//! followed it could be reasoning about two different monitor arrangements
//! without either noticing. Reading the topology through here stamps every
//! answer with the same version, and drops frames captured under an older one
//! the moment the arrangement changes.

use std::sync::Mutex;

use super::frame::FrameRegistry;
use super::topology::DisplayTopology;

/// Application-owned visual state. Registered once as Tauri managed state so
/// capture, overlay, cursor and click all see the same frames.
#[derive(Default)]
pub struct VisualRuntime {
    frames: FrameRegistry,
    /// The arrangement seen on the last read. Used only to notice a change.
    last_version: Mutex<Option<String>>,
}

impl VisualRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn frames(&self) -> &FrameRegistry {
        &self.frames
    }

    /// The live monitor arrangement, with stale frames already discarded.
    ///
    /// Invalidation happens on read rather than on a monitor-change event
    /// because the event is the thing most likely to be missed — a laptop
    /// waking with the dock detached fires nothing useful. Comparing versions
    /// costs a string compare and cannot be missed.
    #[cfg(windows)]
    pub fn topology(&self) -> Result<DisplayTopology, String> {
        let topo = super::topology::read_topology()?;
        self.note_topology(&topo);
        Ok(topo)
    }

    #[cfg(not(windows))]
    pub fn topology(&self) -> Result<DisplayTopology, String> {
        Err("Display topology is only available on Windows.".into())
    }

    /// Record the current arrangement, dropping frames from any other one.
    pub fn note_topology(&self, topo: &DisplayTopology) {
        let mut last = self.last_version.lock().unwrap();
        if last.as_deref() != Some(topo.version.as_str()) {
            self.frames.invalidate_other_topologies(&topo.version);
            *last = Some(topo.version.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::display::coordinates::DisplayGeometry;
    use crate::display::frame::CapturedFrame;

    fn geom(id: u32, x: i32) -> DisplayGeometry {
        DisplayGeometry {
            display_id: id,
            x,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            rotation: 0,
        }
    }

    fn frame(id: &str, display_id: u32, version: &str) -> CapturedFrame {
        CapturedFrame {
            frame_id: id.into(),
            display_id,
            topology_version: version.into(),
            captured_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            capture_width: 1920,
            capture_height: 1080,
            display_bounds: geom(display_id, 0),
            preprocessing: None,
        }
    }

    #[test]
    fn rearranging_the_monitors_discards_frames_captured_before_it() {
        let runtime = VisualRuntime::new();
        let before = DisplayTopology::from_displays(vec![geom(1, 0), geom(2, 1920)]);
        runtime.note_topology(&before);
        runtime.frames().register(frame("f1", 1, &before.version));
        assert_eq!(runtime.frames().len(), 1);

        // The second monitor moves to the left of the first.
        let after = DisplayTopology::from_displays(vec![geom(1, 0), geom(2, -1920)]);
        assert_ne!(before.version, after.version);
        runtime.note_topology(&after);
        assert!(
            runtime.frames().is_empty(),
            "a frame captured under the old arrangement must not survive it"
        );
    }

    #[test]
    fn an_unchanged_arrangement_keeps_its_frames() {
        let runtime = VisualRuntime::new();
        let topo = DisplayTopology::from_displays(vec![geom(1, 0), geom(2, 1920)]);
        runtime.note_topology(&topo);
        runtime.frames().register(frame("f1", 1, &topo.version));
        runtime.note_topology(&topo);
        runtime.note_topology(&topo);
        assert_eq!(runtime.frames().len(), 1);
    }
}
