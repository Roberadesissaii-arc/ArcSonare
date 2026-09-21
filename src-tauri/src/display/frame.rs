//! Frames own their display. Nothing downstream gets to guess.
//!
//! Root cause RC2 was that a screenshot recorded its size but not where it came
//! from, so the origin was reconstructed afterwards — by matching the image
//! dimensions against the live monitor list. With two monitors at the same
//! resolution that match is a coin flip, and the click lands on the wrong
//! screen. RC3 was the same failure from the other end: when no origin could be
//! reconstructed, execution fell back to whichever monitor the mouse happened
//! to be on.
//!
//! Both disappear if the display is decided *before* the capture and travels
//! with it. A frame that cannot name its display is not actionable, and saying
//! so is better than picking a monitor and being confidently wrong.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::coordinates::{self, CoordinateSpace, DisplayGeometry, ModelImageTransform, TypedPoint};
use super::topology::DisplayTopology;

/// How long a frame stays actionable. The screen moves on; a coordinate found
/// in a ten-second-old screenshot may point at something that has scrolled away.
const FRAME_TTL_MS: u64 = 30_000;

/// What was captured, and from where. Recorded at capture time, never inferred.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedFrame {
    pub frame_id: String,
    /// Authoritative. Chosen before the capture, not recovered from the image.
    pub display_id: u32,
    pub topology_version: String,
    pub captured_at_ms: u64,
    pub capture_width: u32,
    pub capture_height: u32,
    /// The display's bounds as they were when this was captured.
    pub display_bounds: DisplayGeometry,
    /// How the image was altered before the model saw it, if at all.
    pub preprocessing: Option<ModelImageTransform>,
}

impl CapturedFrame {
    pub fn transform(&self) -> ModelImageTransform {
        self.preprocessing.unwrap_or_else(|| {
            ModelImageTransform::identity(self.capture_width as f64, self.capture_height as f64)
        })
    }

    fn age_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.captured_at_ms)
    }
}

/// Everything that can go wrong between a model answer and a desktop point.
///
/// Each of these used to be a silent fallback. They are now refusals: an action
/// that cannot be placed with certainty must not happen at all.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "code")]
pub enum InteractionError {
    FrameNotFound {
        frame_id: String,
    },
    FrameExpired {
        frame_id: String,
        age_ms: u64,
    },
    FrameDisplayMismatch {
        frame_display: u32,
        target_display: u32,
    },
    TopologyVersionMismatch,
    DisplayNotFound {
        display_id: u32,
    },
    TargetOutOfBounds {
        reason: String,
    },
    InvalidGeometry {
        reason: String,
    },
}

impl std::fmt::Display for InteractionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FrameNotFound { frame_id } => {
                write!(f, "no screenshot is on record for {frame_id}")
            }
            Self::FrameExpired { age_ms, .. } => {
                write!(f, "that screenshot is {age_ms}ms old; the screen may have moved on")
            }
            Self::FrameDisplayMismatch { frame_display, target_display } => write!(
                f,
                "the screenshot came from display {frame_display} but the target claims display {target_display}"
            ),
            Self::TopologyVersionMismatch => {
                write!(f, "the monitor arrangement changed after that screenshot")
            }
            Self::DisplayNotFound { display_id } => {
                write!(f, "display {display_id} is no longer connected")
            }
            Self::TargetOutOfBounds { reason } => write!(f, "{reason}"),
            Self::InvalidGeometry { reason } => write!(f, "{reason}"),
        }
    }
}

/// A model answer, tied to the frame it was found in.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisualTarget {
    pub frame_id: String,
    /// What the caller believes the display is. Cross-checked against the frame.
    pub display_id: u32,
    pub topology_version: String,
    pub coordinate_space: CoordinateSpace,
    /// Point in `coordinate_space`.
    pub x: f64,
    pub y: f64,
    /// Range the model normalises to (Gemini: 1000).
    pub normalized_max: f64,
    pub confidence: Option<f64>,
}

/// A target that survived every check and may now be acted on.
#[derive(Debug, Clone, Serialize)]
pub struct ResolvedDesktopTarget {
    pub frame_id: String,
    pub display_id: u32,
    /// Virtual-desktop physical pixels. May be negative.
    pub x: f64,
    pub y: f64,
    pub confidence: Option<f64>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Frames that are still actionable. Metadata only — no pixels are kept here.
#[derive(Default)]
pub struct FrameRegistry {
    frames: Mutex<HashMap<String, CapturedFrame>>,
}

impl FrameRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, frame: CapturedFrame) {
        let mut frames = self.frames.lock().unwrap();
        frames.insert(frame.frame_id.clone(), frame);
        // Opportunistic sweep: this is the only thing that grows, and it is
        // cheap enough to do on the write path rather than run a timer.
        let cutoff = now_ms();
        frames.retain(|_, f| f.age_ms(cutoff) <= FRAME_TTL_MS);
    }

    pub fn get(&self, frame_id: &str) -> Option<CapturedFrame> {
        self.frames.lock().unwrap().get(frame_id).cloned()
    }

    pub fn remove(&self, frame_id: &str) {
        self.frames.lock().unwrap().remove(frame_id);
    }

    pub fn len(&self) -> usize {
        self.frames.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Drop frames from one display, leaving every other display's alone.
    pub fn invalidate_display(&self, display_id: u32) {
        self.frames
            .lock()
            .unwrap()
            .retain(|_, f| f.display_id != display_id);
    }

    /// Drop frames captured under a different monitor arrangement.
    pub fn invalidate_other_topologies(&self, current_version: &str) {
        self.frames
            .lock()
            .unwrap()
            .retain(|_, f| f.topology_version == current_version);
    }
}

/// Turn a model answer into a desktop point, or refuse and say why.
///
/// The display comes from the frame — never from the cursor, never from the
/// primary monitor, never from the image dimensions.
pub fn resolve_visual_target(
    target: &VisualTarget,
    registry: &FrameRegistry,
    topology: &DisplayTopology,
) -> Result<ResolvedDesktopTarget, InteractionError> {
    let frame = registry
        .get(&target.frame_id)
        .ok_or_else(|| InteractionError::FrameNotFound {
            frame_id: target.frame_id.clone(),
        })?;

    let age = frame.age_ms(now_ms());
    if age > FRAME_TTL_MS {
        return Err(InteractionError::FrameExpired {
            frame_id: target.frame_id.clone(),
            age_ms: age,
        });
    }

    // The caller's idea of the display must agree with the frame's. If it does
    // not, something upstream substituted a monitor and this is the last place
    // that can catch it.
    if frame.display_id != target.display_id {
        return Err(InteractionError::FrameDisplayMismatch {
            frame_display: frame.display_id,
            target_display: target.display_id,
        });
    }

    if frame.topology_version != target.topology_version
        || topology.version != frame.topology_version
    {
        return Err(InteractionError::TopologyVersionMismatch);
    }

    // Use the display as it exists *now*, and confirm it still matches what was
    // captured. A monitor that moved invalidates the mapping.
    let display = topology
        .display(frame.display_id)
        .ok_or(InteractionError::DisplayNotFound {
            display_id: frame.display_id,
        })?;

    let point = TypedPoint::new(target.x, target.y, target.coordinate_space);
    if !point.is_finite() {
        return Err(InteractionError::InvalidGeometry {
            reason: "the target coordinate is not a finite number".into(),
        });
    }

    let transform = frame.transform();
    let desktop = match target.coordinate_space {
        CoordinateSpace::ModelNormalized => coordinates::model_to_desktop(
            &point,
            target.normalized_max,
            &transform,
            frame.capture_width as f64,
            frame.capture_height as f64,
            display,
        ),
        CoordinateSpace::CapturePixels => coordinates::capture_to_display_local(
            &point,
            frame.capture_width as f64,
            frame.capture_height as f64,
            display,
        )
        .and_then(|local| coordinates::display_local_to_virtual(&local, display))
        .and_then(|d| {
            if display.contains_virtual(&d) {
                Ok(d)
            } else {
                Err(coordinates::MapError::OutOfDisplay)
            }
        }),
        other => {
            return Err(InteractionError::InvalidGeometry {
                reason: format!("{other:?} is not accepted from a vision target"),
            })
        }
    }
    .map_err(|e| match e {
        coordinates::MapError::OutOfDisplay => InteractionError::TargetOutOfBounds {
            reason: format!(
                "that point is outside display {}, so it will not be clicked",
                display.display_id
            ),
        },
        other => InteractionError::InvalidGeometry {
            reason: other.to_string(),
        },
    })?;

    // Belt and braces: the point must land on the display the frame named, not
    // merely on some display.
    match topology.display_containing(&desktop) {
        Some(d) if d.display_id == frame.display_id => {}
        Some(d) => {
            return Err(InteractionError::FrameDisplayMismatch {
                frame_display: frame.display_id,
                target_display: d.display_id,
            })
        }
        None => {
            return Err(InteractionError::TargetOutOfBounds {
                reason: "that point is not on any connected display".into(),
            })
        }
    }

    Ok(ResolvedDesktopTarget {
        frame_id: frame.frame_id,
        display_id: frame.display_id,
        x: desktop.x,
        y: desktop.y,
        confidence: target.confidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// Two monitors, identical resolution — the case origin-guessing gets wrong.
    fn twins_side_by_side() -> DisplayTopology {
        DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 1920, 1080),
            geom(2, 1920, 0, 1920, 1080),
        ])
    }

    /// Identical resolution, second monitor to the LEFT (negative origin).
    fn twins_left() -> DisplayTopology {
        DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 1920, 1080),
            geom(2, -1920, 0, 1920, 1080),
        ])
    }

    fn frame_for(topology: &DisplayTopology, display_id: u32, id: &str) -> CapturedFrame {
        let d = *topology.display(display_id).unwrap();
        CapturedFrame {
            frame_id: id.to_string(),
            display_id,
            topology_version: topology.version.clone(),
            captured_at_ms: now_ms(),
            capture_width: d.width,
            capture_height: d.height,
            display_bounds: d,
            preprocessing: None,
        }
    }

    fn centre_target(frame: &CapturedFrame) -> VisualTarget {
        VisualTarget {
            frame_id: frame.frame_id.clone(),
            display_id: frame.display_id,
            topology_version: frame.topology_version.clone(),
            coordinate_space: CoordinateSpace::ModelNormalized,
            x: 500.0,
            y: 500.0,
            normalized_max: 1000.0,
            confidence: Some(0.9),
        }
    }

    #[test]
    fn a_frame_from_the_second_twin_resolves_to_the_second_twin() {
        // Both monitors are 1920x1080. Nothing about the image can tell them
        // apart — only the display recorded at capture time can.
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let frame = frame_for(&topo, 2, "frame-b");
        reg.register(frame.clone());

        let out = resolve_visual_target(&centre_target(&frame), &reg, &topo).unwrap();
        assert_eq!(out.display_id, 2);
        assert!((out.x - 2880.0).abs() < 0.001, "x was {}", out.x);
        assert!(out.x > 1920.0, "must land on the right-hand monitor");
    }

    #[test]
    fn the_same_target_on_the_first_twin_stays_on_the_first_twin() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let frame = frame_for(&topo, 1, "frame-a");
        reg.register(frame.clone());

        let out = resolve_visual_target(&centre_target(&frame), &reg, &topo).unwrap();
        assert_eq!(out.display_id, 1);
        assert!((out.x - 960.0).abs() < 0.001, "x was {}", out.x);
    }

    #[test]
    fn identical_twins_produce_different_answers_from_identical_images() {
        // The regression this whole change exists for: same pixels, same size,
        // same model answer — different monitor, because the frame knows.
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let a = frame_for(&topo, 1, "a");
        let b = frame_for(&topo, 2, "b");
        reg.register(a.clone());
        reg.register(b.clone());

        let ra = resolve_visual_target(&centre_target(&a), &reg, &topo).unwrap();
        let rb = resolve_visual_target(&centre_target(&b), &reg, &topo).unwrap();
        assert_ne!(
            ra.x, rb.x,
            "identical captures must not resolve identically"
        );
        assert_eq!((ra.display_id, rb.display_id), (1, 2));
    }

    #[test]
    fn a_twin_to_the_left_keeps_its_negative_origin() {
        let topo = twins_left();
        let reg = FrameRegistry::new();
        let frame = frame_for(&topo, 2, "left");
        reg.register(frame.clone());

        let out = resolve_visual_target(&centre_target(&frame), &reg, &topo).unwrap();
        assert_eq!(out.display_id, 2);
        assert!((out.x - (-960.0)).abs() < 0.001, "x was {}", out.x);
        assert!(out.x < 0.0, "the negative origin must not be clamped");
    }

    #[test]
    fn a_target_naming_a_different_display_than_its_frame_is_refused() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let frame = frame_for(&topo, 2, "frame-b");
        reg.register(frame.clone());

        let mut target = centre_target(&frame);
        target.display_id = 1; // claims the other monitor
        assert_eq!(
            resolve_visual_target(&target, &reg, &topo).unwrap_err(),
            InteractionError::FrameDisplayMismatch {
                frame_display: 2,
                target_display: 1,
            }
        );
    }

    #[test]
    fn a_target_with_no_registered_frame_is_refused_not_guessed() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let orphan = VisualTarget {
            frame_id: "never-registered".into(),
            display_id: 1,
            topology_version: topo.version.clone(),
            coordinate_space: CoordinateSpace::ModelNormalized,
            x: 500.0,
            y: 500.0,
            normalized_max: 1000.0,
            confidence: None,
        };
        assert!(matches!(
            resolve_visual_target(&orphan, &reg, &topo).unwrap_err(),
            InteractionError::FrameNotFound { .. }
        ));
    }

    #[test]
    fn a_frame_captured_under_a_different_arrangement_is_refused() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let mut frame = frame_for(&topo, 2, "stale");
        frame.topology_version = "an-older-arrangement".into();
        reg.register(frame.clone());

        let mut target = centre_target(&frame);
        target.topology_version = "an-older-arrangement".into();
        assert_eq!(
            resolve_visual_target(&target, &reg, &topo).unwrap_err(),
            InteractionError::TopologyVersionMismatch
        );
    }

    #[test]
    fn unplugging_the_display_rejects_rather_than_falling_back() {
        // Display B disappears after the capture. The old behaviour would land
        // this on whatever monitor was left.
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let frame = frame_for(&topo, 2, "frame-b");
        reg.register(frame.clone());
        let target = centre_target(&frame);

        let only_a = DisplayTopology::from_displays(vec![geom(1, 0, 0, 1920, 1080)]);
        let err = resolve_visual_target(&target, &reg, &only_a).unwrap_err();
        // The arrangement changed, so this is caught as a topology mismatch
        // before it can reach a display lookup — either refusal is correct,
        // what matters is that it is not silently retargeted.
        assert!(
            matches!(err, InteractionError::TopologyVersionMismatch)
                || matches!(err, InteractionError::DisplayNotFound { .. }),
            "unexpected error: {err:?}"
        );
    }

    #[test]
    fn an_expired_frame_is_refused() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let mut frame = frame_for(&topo, 1, "old");
        frame.captured_at_ms = now_ms().saturating_sub(FRAME_TTL_MS + 5_000);
        // Insert directly: register() sweeps expired frames on write.
        reg.frames
            .lock()
            .unwrap()
            .insert(frame.frame_id.clone(), frame.clone());

        assert!(matches!(
            resolve_visual_target(&centre_target(&frame), &reg, &topo).unwrap_err(),
            InteractionError::FrameExpired { .. }
        ));
    }

    #[test]
    fn a_non_finite_coordinate_is_refused() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let frame = frame_for(&topo, 1, "f");
        reg.register(frame.clone());
        let mut target = centre_target(&frame);
        target.x = f64::INFINITY;
        assert!(matches!(
            resolve_visual_target(&target, &reg, &topo).unwrap_err(),
            InteractionError::InvalidGeometry { .. }
        ));
    }

    #[test]
    fn a_coordinate_beyond_the_display_is_refused_not_clamped() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let frame = frame_for(&topo, 1, "f");
        reg.register(frame.clone());
        let mut target = centre_target(&frame);
        target.x = 1400.0; // beyond the 0-1000 range
        assert!(matches!(
            resolve_visual_target(&target, &reg, &topo).unwrap_err(),
            InteractionError::TargetOutOfBounds { .. }
        ));
    }

    #[test]
    fn invalidating_one_display_leaves_the_others_alone() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        reg.register(frame_for(&topo, 1, "a"));
        reg.register(frame_for(&topo, 2, "b"));
        reg.invalidate_display(2);
        assert!(reg.get("a").is_some(), "display 1's frame must survive");
        assert!(reg.get("b").is_none(), "display 2's frame must be gone");
    }

    #[test]
    fn a_capture_pixel_target_maps_without_model_normalisation() {
        let topo = twins_side_by_side();
        let reg = FrameRegistry::new();
        let frame = frame_for(&topo, 2, "f");
        reg.register(frame.clone());
        let mut target = centre_target(&frame);
        target.coordinate_space = CoordinateSpace::CapturePixels;
        target.x = 100.0;
        target.y = 50.0;
        let out = resolve_visual_target(&target, &reg, &topo).unwrap();
        assert!((out.x - 2020.0).abs() < 0.001, "x was {}", out.x);
        assert_eq!(out.display_id, 2);
    }
}
