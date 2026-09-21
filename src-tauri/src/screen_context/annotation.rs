//! A circle the user drew is a noun, not a verb.
//!
//! `annotations/` is ArcSonare drawing *at* the user — highlights it places,
//! with ids it owns. This is the opposite direction: the user drawing at
//! ArcSonare, to say "this one". The two never shared code because they never
//! shared a meaning, and conflating them would make "circle the download
//! button" and "what is this?" the same request.
//!
//! The rule that makes a drawn shape safe:
//!
//!   a completed annotation is a *reference*, never an instruction.
//!
//! Circling a download button and saying nothing must do nothing. The verb
//! arrives separately — "what is this?", "download this", "explain this" — and
//! it is the verb that decides what happens to the thing the circle names. A
//! system that clicks what you circle is a system you cannot point at anything
//! with.
//!
//! The second rule is about what gets photographed. The annotation is drawn on
//! ArcSonare's own overlay; the thing being referred to is in the application
//! underneath. So the capture is of the *underlying window* — not the desktop,
//! which drags in the other monitor and ArcSonare's own ink, and not a tight
//! crop of the stroke, which leaves a logo with no page around it to identify
//! it by.

use serde::{Deserialize, Serialize};

use super::latest::CaptureRegion;

/// How long after the last movement a stroke is considered finished, when no
/// pointer-up arrived.
///
/// A pen lifted off a tablet does not always produce one, and waiting forever
/// for it means the user draws a circle and nothing ever happens. Short enough
/// to feel immediate, long enough not to cut a slow deliberate circle in half.
pub const STROKE_IDLE_TIMEOUT_MS: u64 = 400;

/// How much page to keep around the marked thing.
///
/// A circle drawn tightly around a logo crops to a logo, and a logo out of
/// context is exactly as identifiable as its pixels — which is to say, often
/// not at all. Twelve percent keeps the wordmark and the heading next to it.
pub const DEFAULT_CONTEXT_PADDING: f32 = 0.12;

/// A point in physical desktop pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDesktopPoint {
    pub x: i32,
    pub y: i32,
}

/// What the user drew.
///
/// Classified from the geometry rather than from a mode the user had to pick
/// first: nobody selects "circle tool" before pointing at something.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnnotationShape {
    Circle,
    Rectangle,
    Underline,
    Arrow,
    Freehand,
}

/// How the stroke was decided to be over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompletionReason {
    PointerUp,
    /// The path came back to where it started.
    StrokeClosed,
    IdleTimeout,
    /// The user pressed a Done control.
    Explicit,
}

/// One completed user annotation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenAnnotation {
    pub annotation_id: String,
    pub correlation_id: String,
    /// The frame captured *because* this annotation completed.
    pub frame_id: String,
    /// The window underneath the annotation's centre — the thing being pointed
    /// at, not the overlay the ink is on.
    pub source_window: Option<isize>,
    pub display_id: u32,
    pub points: Vec<PhysicalDesktopPoint>,
    pub bounding_rect: CaptureRegion,
    pub shape: AnnotationShape,
    pub completion: CompletionReason,
    pub completed_at_ms: u64,
}

/// A stroke being drawn.
#[derive(Debug, Clone, Default)]
pub struct StrokeBuilder {
    points: Vec<PhysicalDesktopPoint>,
    last_move_ms: u64,
}

impl StrokeBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, x: i32, y: i32, at_ms: u64) {
        self.points.push(PhysicalDesktopPoint { x, y });
        self.last_move_ms = at_ms;
    }

    pub fn points(&self) -> &[PhysicalDesktopPoint] {
        &self.points
    }

    pub fn is_empty(&self) -> bool {
        self.points.len() < 2
    }

    /// Whether the stroke is finished, and why.
    ///
    /// Three ways in, checked in order of certainty. A pointer-up is a fact; a
    /// closed loop is a strong signal; an idle timeout is a decision made
    /// because waiting longer helps nobody.
    pub fn completion(&self, pointer_up: bool, now_ms: u64) -> Option<CompletionReason> {
        if self.is_empty() {
            return None;
        }
        if pointer_up {
            return Some(CompletionReason::PointerUp);
        }
        if self.is_closed() {
            return Some(CompletionReason::StrokeClosed);
        }
        if now_ms.saturating_sub(self.last_move_ms) >= STROKE_IDLE_TIMEOUT_MS {
            return Some(CompletionReason::IdleTimeout);
        }
        None
    }

    /// Whether the path returned near its start, having actually gone somewhere.
    ///
    /// The distance travelled matters: three points in a jitter around one spot
    /// are "close to the start" and are not a circle.
    fn is_closed(&self) -> bool {
        let Some((first, last)) = self.points.first().zip(self.points.last()) else {
            return false;
        };
        let rect = bounding_rect(&self.points);
        let span = rect.width.max(rect.height) as i64;
        if span < 24 {
            return false;
        }
        let dx = (last.x - first.x) as i64;
        let dy = (last.y - first.y) as i64;
        let gap_sq = dx * dx + dy * dy;
        let tolerance = (span / 5).max(8);
        gap_sq <= tolerance * tolerance && self.points.len() >= 8
    }

    pub fn take(&mut self) -> Vec<PhysicalDesktopPoint> {
        std::mem::take(&mut self.points)
    }
}

/// The smallest rectangle containing every point.
///
/// Always at least 1×1: a zero-size region cannot be cropped, and returning one
/// pushes the failure into the capture code where it is much harder to read.
pub fn bounding_rect(points: &[PhysicalDesktopPoint]) -> CaptureRegion {
    if points.is_empty() {
        return CaptureRegion {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
    }
    let min_x = points.iter().map(|p| p.x).min().unwrap();
    let max_x = points.iter().map(|p| p.x).max().unwrap();
    let min_y = points.iter().map(|p| p.y).min().unwrap();
    let max_y = points.iter().map(|p| p.y).max().unwrap();
    CaptureRegion {
        x: min_x,
        y: min_y,
        width: (max_x - min_x).max(1) as u32,
        height: (max_y - min_y).max(1) as u32,
    }
}

/// The centre of a region, which is where the underlying window is looked up.
pub fn centre(rect: &CaptureRegion) -> PhysicalDesktopPoint {
    PhysicalDesktopPoint {
        x: rect.x + rect.width as i32 / 2,
        y: rect.y + rect.height as i32 / 2,
    }
}

/// What shape the stroke is, from its geometry.
///
/// Deliberately coarse. The shape only affects how the region is padded and how
/// the result is described; getting "circle" and "freehand" confused costs
/// nothing, whereas asking the user to pick a tool first costs the gesture.
pub fn classify(points: &[PhysicalDesktopPoint]) -> AnnotationShape {
    if points.len() < 3 {
        return AnnotationShape::Freehand;
    }
    let rect = bounding_rect(points);
    let w = rect.width as f32;
    let h = rect.height as f32;

    // Closedness is decided first, and it wins.
    //
    // It has to: the tail of any closed loop points back along its own start,
    // which is precisely the arrowhead test. Checking for an arrow first made
    // every circle an arrow — the ring returns to where it began, so its last
    // fifth reverses exactly as an arrowhead does.
    let first = points[0];
    let last = points[points.len() - 1];
    let span = w.max(h);
    let gap = (((last.x - first.x) as f32).powi(2) + ((last.y - first.y) as f32).powi(2)).sqrt();
    let closed = span >= 24.0 && gap <= (span / 5.0).max(8.0) && points.len() >= 8;

    if closed {
        // The path hugs the bounding box's corners → drawn as a box. An ellipse
        // inscribed in the same box reaches none of them, because its extremes
        // are at the edge midpoints.
        return if corner_occupancy(points, &rect) >= 3 {
            AnnotationShape::Rectangle
        } else {
            AnnotationShape::Circle
        };
    }

    // Open. Very flat and mostly one direction: a line under something.
    if h <= 12.0 || (w / h.max(1.0)) >= 6.0 {
        return if looks_like_arrow(points) {
            AnnotationShape::Arrow
        } else {
            AnnotationShape::Underline
        };
    }
    if looks_like_arrow(points) {
        return AnnotationShape::Arrow;
    }
    AnnotationShape::Freehand
}

/// How many corners of the bounding box the path actually visits.
///
/// A rectangle drawn by hand reaches all four; an ellipse inscribed in the same
/// box reaches none, because its extremes are at the edge midpoints.
fn corner_occupancy(points: &[PhysicalDesktopPoint], rect: &CaptureRegion) -> usize {
    let near = (rect.width.min(rect.height) as f32 * 0.22).max(4.0);
    let corners = [
        (rect.x, rect.y),
        (rect.x + rect.width as i32, rect.y),
        (rect.x, rect.y + rect.height as i32),
        (rect.x + rect.width as i32, rect.y + rect.height as i32),
    ];
    corners
        .iter()
        .filter(|(cx, cy)| {
            points.iter().any(|p| {
                let dx = (p.x - cx) as f32;
                let dy = (p.y - cy) as f32;
                (dx * dx + dy * dy).sqrt() <= near
            })
        })
        .count()
}

/// A stroke that goes out and comes back on itself at the end — an arrowhead.
fn looks_like_arrow(points: &[PhysicalDesktopPoint]) -> bool {
    if points.len() < 6 {
        return false;
    }
    // The last fifth of the path reverses direction relative to the shaft.
    let split = points.len() * 4 / 5;
    let shaft = (
        (points[split].x - points[0].x) as f32,
        (points[split].y - points[0].y) as f32,
    );
    let head = (
        (points[points.len() - 1].x - points[split].x) as f32,
        (points[points.len() - 1].y - points[split].y) as f32,
    );
    let shaft_len = (shaft.0 * shaft.0 + shaft.1 * shaft.1).sqrt();
    let head_len = (head.0 * head.0 + head.1 * head.1).sqrt();
    if shaft_len < 24.0 || head_len < 6.0 {
        return false;
    }
    let dot = (shaft.0 * head.0 + shaft.1 * head.1) / (shaft_len * head_len);
    // Pointing meaningfully back the way it came.
    dot < -0.45
}

/// Turn a desktop-space annotation into a crop of the window's capture.
///
/// Three conversions, each of which has been a bug somewhere in this codebase:
/// desktop → window-local, then padded, then clamped back inside the capture.
/// Doing them in the other order produces a rectangle that is inside the window
/// but outside the image, which crops to nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationCrop {
    /// Where to cut, in the capture's own pixel space (origin at its top-left).
    pub local: CaptureRegion,
    /// The same region back in desktop pixels, for drawing and for the trace.
    pub desktop: CaptureRegion,
}

/// Map an annotation onto the window capture it belongs to.
///
/// `capture_region` is where the captured window sits on the desktop. Returns
/// `None` when the annotation does not overlap it at all — which means the user
/// drew on something else, and guessing would point at the wrong thing.
pub fn crop_for(
    annotation_rect: &CaptureRegion,
    capture_region: &CaptureRegion,
    padding: f32,
) -> Option<AnnotationCrop> {
    // Padded first, in desktop space, then clamped to the window.
    let padded = annotation_rect.padded(padding, capture_region);
    let desktop = capture_region.clamp(&padded)?;
    Some(AnnotationCrop {
        local: CaptureRegion {
            x: desktop.x - capture_region.x,
            y: desktop.y - capture_region.y,
            width: desktop.width,
            height: desktop.height,
        },
        desktop,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(x: i32, y: i32) -> PhysicalDesktopPoint {
        PhysicalDesktopPoint { x, y }
    }

    /// Points around an ellipse, the way a hand-drawn circle actually lands.
    fn ellipse(cx: i32, cy: i32, rx: i32, ry: i32, n: usize) -> Vec<PhysicalDesktopPoint> {
        (0..=n)
            .map(|i| {
                let t = (i as f32 / n as f32) * std::f32::consts::TAU;
                pt(
                    cx + (rx as f32 * t.cos()).round() as i32,
                    cy + (ry as f32 * t.sin()).round() as i32,
                )
            })
            .collect()
    }

    fn rectangle_path(x: i32, y: i32, w: i32, h: i32) -> Vec<PhysicalDesktopPoint> {
        let mut p = Vec::new();
        for i in 0..=10 {
            p.push(pt(x + w * i / 10, y));
        }
        for i in 0..=10 {
            p.push(pt(x + w, y + h * i / 10));
        }
        for i in 0..=10 {
            p.push(pt(x + w - w * i / 10, y + h));
        }
        for i in 0..=10 {
            p.push(pt(x, y + h - h * i / 10));
        }
        p
    }

    // --- geometry ---------------------------------------------------------

    #[test]
    fn a_circle_bounds_the_thing_it_encloses() {
        let rect = bounding_rect(&ellipse(500, 400, 120, 60, 40));
        assert_eq!(rect.x, 380);
        assert_eq!(rect.y, 340);
        assert_eq!(rect.width, 240);
        assert_eq!(rect.height, 120);
        assert_eq!(centre(&rect), pt(500, 400));
    }

    #[test]
    fn a_freehand_scribble_still_produces_a_usable_rectangle() {
        let points = vec![pt(10, 10), pt(90, 40), pt(30, 95), pt(70, 12)];
        let rect = bounding_rect(&points);
        assert_eq!((rect.x, rect.y, rect.width, rect.height), (10, 10, 80, 85));
    }

    #[test]
    fn a_degenerate_stroke_is_never_zero_sized() {
        let rect = bounding_rect(&[pt(5, 5), pt(5, 5)]);
        assert!(rect.width >= 1 && rect.height >= 1);
    }

    // --- classification ---------------------------------------------------

    #[test]
    fn a_ring_reads_as_a_circle() {
        assert_eq!(classify(&ellipse(500, 400, 120, 60, 40)), AnnotationShape::Circle);
    }

    #[test]
    fn a_box_reads_as_a_rectangle() {
        assert_eq!(
            classify(&rectangle_path(100, 100, 300, 200)),
            AnnotationShape::Rectangle,
        );
    }

    #[test]
    fn a_flat_line_reads_as_an_underline() {
        let line: Vec<_> = (0..20).map(|i| pt(100 + i * 10, 400)).collect();
        assert_eq!(classify(&line), AnnotationShape::Underline);
    }

    #[test]
    fn a_stroke_that_doubles_back_reads_as_an_arrow() {
        let mut points: Vec<_> = (0..16).map(|i| pt(100 + i * 20, 300 + i * 12)).collect();
        // Arrowhead: back along the shaft.
        for i in 1..6 {
            points.push(pt(400 - i * 14, 480 - i * 9));
        }
        assert_eq!(classify(&points), AnnotationShape::Arrow);
    }

    #[test]
    fn an_open_squiggle_reads_as_freehand() {
        let points = vec![
            pt(100, 100),
            pt(160, 180),
            pt(120, 260),
            pt(220, 300),
            pt(300, 220),
        ];
        assert_eq!(classify(&points), AnnotationShape::Freehand);
    }

    // --- completion -------------------------------------------------------

    #[test]
    fn lifting_the_pointer_completes_the_stroke() {
        let mut s = StrokeBuilder::new();
        s.push(10, 10, 0);
        s.push(60, 60, 20);
        assert_eq!(s.completion(true, 30), Some(CompletionReason::PointerUp));
    }

    #[test]
    fn closing_the_loop_completes_the_stroke_without_a_pointer_up() {
        let mut s = StrokeBuilder::new();
        for (i, p) in ellipse(300, 300, 80, 80, 24).into_iter().enumerate() {
            s.push(p.x, p.y, i as u64 * 10);
        }
        assert_eq!(s.completion(false, 250), Some(CompletionReason::StrokeClosed));
    }

    #[test]
    fn a_stroke_that_stops_moving_completes_on_its_own() {
        let mut s = StrokeBuilder::new();
        s.push(10, 10, 0);
        s.push(200, 90, 100);
        assert_eq!(s.completion(false, 99), None, "still drawing");
        assert_eq!(
            s.completion(false, 100 + STROKE_IDLE_TIMEOUT_MS),
            Some(CompletionReason::IdleTimeout),
            "waiting forever for a pointer-up that never comes is not an option",
        );
    }

    #[test]
    fn a_single_point_is_not_a_stroke() {
        let mut s = StrokeBuilder::new();
        s.push(10, 10, 0);
        assert_eq!(s.completion(true, 5_000), None);
    }

    /// A jitter that never went anywhere is not a closed circle.
    #[test]
    fn a_tremor_does_not_count_as_a_closed_loop() {
        let mut s = StrokeBuilder::new();
        for i in 0..12 {
            s.push(300 + (i % 3), 300 + (i % 2), i as u64 * 5);
        }
        assert_ne!(s.completion(false, 60), Some(CompletionReason::StrokeClosed));
    }

    // --- cropping ---------------------------------------------------------

    /// The LightBurn case: a circle round the logo on a browser window that is
    /// not at the desktop origin.
    #[test]
    fn a_circle_maps_into_the_windows_own_pixels() {
        // Browser window at (100, 80), 1400×900.
        let capture = CaptureRegion {
            x: 100,
            y: 80,
            width: 1400,
            height: 900,
        };
        // Circle round the logo near the top-left of the page.
        let circle = bounding_rect(&ellipse(300, 200, 90, 40, 32));
        let crop = crop_for(&circle, &capture, DEFAULT_CONTEXT_PADDING).expect("overlaps");

        assert_eq!(
            crop.local.x,
            crop.desktop.x - capture.x,
            "window-local, not desktop",
        );
        assert_eq!(crop.local.y, crop.desktop.y - capture.y);
        assert!(
            crop.local.x >= 0 && crop.local.y >= 0,
            "a negative local origin crops nothing",
        );
        assert!(crop.local.x + crop.local.width as i32 <= capture.width as i32);
        assert!(crop.local.y + crop.local.height as i32 <= capture.height as i32);
        assert!(
            crop.desktop.width > circle.width,
            "the crop keeps page context around the mark",
        );
    }

    /// The padding must actually be padding — a crop that is only the ink is
    /// unidentifiable, which was the whole reason for the rule.
    #[test]
    fn the_crop_is_never_just_the_stroke() {
        let capture = CaptureRegion {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let tight = CaptureRegion {
            x: 900,
            y: 500,
            width: 60,
            height: 24,
        };
        let crop = crop_for(&tight, &capture, DEFAULT_CONTEXT_PADDING).unwrap();
        assert!(crop.desktop.width >= tight.width + 8);
        assert!(crop.desktop.height >= tight.height + 4);
    }

    #[test]
    fn a_negative_origin_monitor_crops_correctly() {
        // Window on the monitor to the left of primary.
        let capture = CaptureRegion {
            x: -1920,
            y: 0,
            width: 1600,
            height: 900,
        };
        let circle = bounding_rect(&ellipse(-1500, 300, 100, 60, 32));
        let crop = crop_for(&circle, &capture, DEFAULT_CONTEXT_PADDING).unwrap();
        assert!(crop.local.x >= 0, "local coordinates are never negative");
        assert!(crop.local.x + crop.local.width as i32 <= capture.width as i32);
        assert_eq!(crop.desktop.x, capture.x + crop.local.x);
    }

    /// Drawing over one monitor must not crop out of a capture of another.
    #[test]
    fn an_annotation_on_a_different_window_does_not_crop() {
        let capture = CaptureRegion {
            x: 0,
            y: 0,
            width: 800,
            height: 600,
        };
        let elsewhere = CaptureRegion {
            x: 3000,
            y: 200,
            width: 100,
            height: 100,
        };
        assert!(crop_for(&elsewhere, &capture, DEFAULT_CONTEXT_PADDING).is_none());
    }

    /// A circle at the very edge of the window pads inwards rather than
    /// producing a rectangle that hangs off the image.
    #[test]
    fn an_edge_annotation_stays_inside_the_capture() {
        let capture = CaptureRegion {
            x: 100,
            y: 100,
            width: 800,
            height: 600,
        };
        let corner = CaptureRegion {
            x: 100,
            y: 100,
            width: 80,
            height: 40,
        };
        let crop = crop_for(&corner, &capture, 0.5).unwrap();
        assert_eq!(crop.local.x, 0);
        assert_eq!(crop.local.y, 0);
        assert!(crop.local.width <= capture.width);
    }
}
