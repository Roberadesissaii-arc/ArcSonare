//! Is the screen still what the model looked at?
//!
//! A coordinate can be arithmetically perfect and still wrong. The model saw a
//! screenshot; by the time the cursor gets there the window may have scrolled,
//! a dialog may have opened over it, or the whole app may have moved. The frame
//! TTL catches "very old", but thirty seconds is a long time in a UI and a
//! frame two seconds old can already be stale.
//!
//! So before a click, the region around the target is photographed again and
//! compared with the same region of the original frame. Different enough means
//! refuse — and refuse *before* the cursor moves, because a cursor that has
//! already travelled to a stale coordinate has told the user a lie about what
//! is about to happen.

#![cfg(windows)]

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::frame::CapturedFrame;
use super::production_capture;
use super::topology::DisplayTopology;

/// How much of the region may change before the target is considered stale.
///
/// 0.12 on a 0–1 normalised mean-absolute-difference: comfortably above the
/// noise of a blinking cursor, a hover highlight or subpixel text rendering,
/// comfortably below a window moving, scrolling, or something opening on top.
/// Tuned to be forgiving — a false "stale" costs one recapture, a false "fresh"
/// costs a click in the wrong place.
pub const DEFAULT_STALENESS_THRESHOLD: f32 = 0.12;
/// Margin added around the target before comparing, in physical pixels. Big
/// enough to include the control's border and immediate surroundings, small
/// enough that unrelated movement elsewhere on screen does not trip it.
pub const DEFAULT_REGION_MARGIN: i32 = 16;
/// Both regions are reduced to this before comparison. Small enough to be fast
/// and to ignore antialiasing, large enough to notice a control moving.
const COMPARE_SIZE: u32 = 32;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessCheckResult {
    pub frame_id: String,
    pub display_id: String,
    pub checked_region: PhysicalRect,
    /// 1.0 is identical, 0.0 is maximally different.
    pub similarity_score: f32,
    pub threshold: f32,
    pub is_fresh: bool,
    pub checked_at_ms: u64,
    /// Set when the check could not run at all, as opposed to running and
    /// failing. The two must not be confused: "I could not look" is not
    /// "it changed".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Downscale to a fixed grey grid and average the absolute differences.
///
/// Deliberately crude. A perceptual hash or SSIM would be more discriminating,
/// but this needs to answer one question — "is roughly the same thing still
/// here?" — with no new dependency and in a few milliseconds.
pub fn similarity(a: &xcap::image::RgbaImage, b: &xcap::image::RgbaImage) -> f32 {
    let grid = |img: &xcap::image::RgbaImage| -> Vec<f32> {
        let small = xcap::image::imageops::resize(
            img,
            COMPARE_SIZE,
            COMPARE_SIZE,
            xcap::image::imageops::FilterType::Triangle,
        );
        small
            .pixels()
            .map(|p| {
                // Rec. 601 luma: closer to perceived brightness than a flat mean,
                // so a colour change of equal magnitude counts sensibly.
                let [r, g, bl, _] = p.0;
                (0.299 * r as f32 + 0.587 * g as f32 + 0.114 * bl as f32) / 255.0
            })
            .collect()
    };
    let (ga, gb) = (grid(a), grid(b));
    if ga.is_empty() || ga.len() != gb.len() {
        return 0.0;
    }
    let total: f32 = ga.iter().zip(gb.iter()).map(|(x, y)| (x - y).abs()).sum();
    1.0 - (total / ga.len() as f32).clamp(0.0, 1.0)
}

/// The region to compare, given a target point or box on a frame's display.
///
/// Clamped to the frame's own display and never allowed to wander onto a
/// neighbour: a comparison region that straddles two monitors would compare
/// pixels the target has nothing to do with.
pub fn region_around(
    frame: &CapturedFrame,
    x: i32,
    y: i32,
    box_rect: Option<(i32, i32, i32, i32)>,
    margin: i32,
) -> PhysicalRect {
    let d = frame.display_bounds;
    let (rx, ry, rw, rh) = match box_rect {
        Some((bx, by, bw, bh)) if bw > 0 && bh > 0 => (bx, by, bw, bh),
        // No box: a square centred on the point, big enough to include a
        // typical control rather than just the pixel under the cursor.
        _ => (x - 32, y - 32, 64, 64),
    };
    let left = (rx - margin).max(d.x);
    let top = (ry - margin).max(d.y);
    let right = (rx + rw + margin).min(d.x + d.width as i32);
    let bottom = (ry + rh + margin).min(d.y + d.height as i32);
    PhysicalRect {
        x: left,
        y: top,
        width: (right - left).max(1) as u32,
        height: (bottom - top).max(1) as u32,
    }
}

/// Where a desktop rectangle sits inside the frame's saved image.
///
/// Undoes the two things that separate the image from the desktop: the
/// display's origin, and any crop taken when the frame was captured. Returns
/// `None` when the rectangle is not inside the image at all — a window capture
/// only covers the window, and asking about something outside it is a question
/// the image cannot answer.
pub fn region_in_frame_image(
    frame: &CapturedFrame,
    region: &PhysicalRect,
    image_width: u32,
    image_height: u32,
) -> Option<(u32, u32, u32, u32)> {
    let d = frame.display_bounds;
    if frame.capture_width == 0 || frame.capture_height == 0 {
        return None;
    }
    // Desktop → display-local → capture pixels.
    let sx = frame.capture_width as f64 / d.width.max(1) as f64;
    let sy = frame.capture_height as f64 / d.height.max(1) as f64;
    let mut cx = (region.x - d.x) as f64 * sx;
    let mut cy = (region.y - d.y) as f64 * sy;
    let mut cw = region.width as f64 * sx;
    let mut ch = region.height as f64 * sy;

    // Capture pixels → image pixels, undoing the crop.
    if let Some(t) = frame.preprocessing {
        cx -= t.crop_left;
        cy -= t.crop_top;
    }
    // Clip to the image rather than refusing outright: a target near the edge
    // of a window capture is still comparable on the part that exists.
    if cx < 0.0 {
        cw += cx;
        cx = 0.0;
    }
    if cy < 0.0 {
        ch += cy;
        cy = 0.0;
    }
    let x = cx.round() as i64;
    let y = cy.round() as i64;
    let w = cw.round() as i64;
    let h = ch.round() as i64;
    if x >= image_width as i64 || y >= image_height as i64 || w <= 0 || h <= 0 {
        return None;
    }
    let w = w.min(image_width as i64 - x);
    let h = h.min(image_height as i64 - y);
    if w <= 0 || h <= 0 {
        return None;
    }
    Some((x as u32, y as u32, w as u32, h as u32))
}

/// Compare the target's surroundings now against how they looked when captured.
pub fn check_region_freshness<R: Runtime>(
    app: &AppHandle<R>,
    topology: &DisplayTopology,
    frame: &CapturedFrame,
    region: PhysicalRect,
    threshold: f32,
) -> FreshnessCheckResult {
    let mut result = FreshnessCheckResult {
        frame_id: frame.frame_id.clone(),
        display_id: frame.display_id.to_string(),
        checked_region: region,
        similarity_score: 0.0,
        threshold,
        is_fresh: false,
        checked_at_ms: now_ms(),
        unavailable_reason: None,
    };

    let path = match crate::screen_context::storage::image_path(app, &frame.frame_id, false) {
        Ok(p) => p,
        Err(e) => {
            result.unavailable_reason = Some(format!("the original screenshot is missing: {e}"));
            return result;
        }
    };
    let original = match xcap::image::open(&path) {
        Ok(i) => i.to_rgba8(),
        Err(e) => {
            result.unavailable_reason = Some(format!("the original screenshot is unreadable: {e}"));
            return result;
        }
    };
    let Some((ix, iy, iw, ih)) =
        region_in_frame_image(frame, &region, original.width(), original.height())
    else {
        result.unavailable_reason =
            Some("the target is outside the captured image, so it cannot be compared".into());
        return result;
    };
    let before = xcap::image::imageops::crop_imm(&original, ix, iy, iw, ih).to_image();

    let after = match production_capture::capture_region(
        topology,
        region.x,
        region.y,
        region.width,
        region.height,
    ) {
        Ok(c) => c.image,
        Err(e) => {
            result.unavailable_reason = Some(format!("could not re-check the screen: {e}"));
            return result;
        }
    };

    result.similarity_score = similarity(&before, &after);
    result.is_fresh = result.similarity_score >= 1.0 - threshold;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::display::coordinates::{DisplayGeometry, ModelImageTransform};
    use xcap::image::{Rgba, RgbaImage};

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

    fn frame_on(d: DisplayGeometry, crop: Option<ModelImageTransform>) -> CapturedFrame {
        CapturedFrame {
            frame_id: "f".into(),
            display_id: d.display_id,
            topology_version: "v".into(),
            captured_at_ms: now_ms(),
            capture_width: d.width,
            capture_height: d.height,
            display_bounds: d,
            preprocessing: crop,
        }
    }

    fn solid(w: u32, h: u32, v: u8) -> RgbaImage {
        RgbaImage::from_pixel(w, h, Rgba([v, v, v, 255]))
    }

    #[test]
    fn an_unchanged_region_is_identical() {
        let a = solid(64, 64, 120);
        assert!((similarity(&a, &a.clone()) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn a_completely_different_region_scores_near_zero() {
        let black = solid(64, 64, 0);
        let white = solid(64, 64, 255);
        assert!(similarity(&black, &white) < 0.05);
    }

    #[test]
    fn a_small_visual_change_still_counts_as_fresh() {
        // A hover highlight or a blinking caret: a few percent of the region.
        let mut a = solid(64, 64, 120);
        for y in 0..64 {
            for x in 0..3 {
                a.put_pixel(x, y, Rgba([255, 255, 255, 255]));
            }
        }
        let b = solid(64, 64, 120);
        let score = similarity(&a, &b);
        assert!(
            score >= 1.0 - DEFAULT_STALENESS_THRESHOLD,
            "a caret should not read as stale: {score}"
        );
    }

    #[test]
    fn a_window_moving_away_counts_as_stale() {
        // Half the region replaced: what "the dialog is gone" looks like.
        let mut a = solid(64, 64, 30);
        for y in 0..64 {
            for x in 0..32 {
                a.put_pixel(x, y, Rgba([230, 230, 230, 255]));
            }
        }
        let b = solid(64, 64, 30);
        let score = similarity(&a, &b);
        assert!(
            score < 1.0 - DEFAULT_STALENESS_THRESHOLD,
            "a window vanishing should read as stale: {score}"
        );
    }

    #[test]
    fn the_compared_region_never_leaves_its_own_display() {
        // The portrait monitor to the left: a margin applied naively would push
        // the region onto the primary screen and compare unrelated pixels.
        let d = geom(2, -1080, -661, 1080, 1920);
        let frame = frame_on(d, None);
        let r = region_around(&frame, -1075, -658, None, DEFAULT_REGION_MARGIN);
        assert!(r.x >= d.x, "region started left of its display: {}", r.x);
        assert!(r.y >= d.y, "region started above its display: {}", r.y);
        assert!(r.x + r.width as i32 <= d.x + d.width as i32);
        assert!(r.y + r.height as i32 <= d.y + d.height as i32);
    }

    #[test]
    fn a_box_target_is_compared_with_a_margin_around_it() {
        let d = geom(1, 0, 0, 1920, 1080);
        let frame = frame_on(d, None);
        let r = region_around(&frame, 500, 500, Some((400, 450, 200, 100)), 16);
        assert_eq!((r.x, r.y), (384, 434));
        assert_eq!((r.width, r.height), (232, 132));
    }

    #[test]
    fn a_desktop_region_maps_into_the_frames_own_image() {
        let d = geom(1, 0, 0, 1920, 1080);
        let frame = frame_on(d, None);
        let region = PhysicalRect {
            x: 100,
            y: 200,
            width: 50,
            height: 60,
        };
        assert_eq!(
            region_in_frame_image(&frame, &region, 1920, 1080),
            Some((100, 200, 50, 60))
        );
    }

    #[test]
    fn a_cropped_frame_has_its_crop_undone_before_comparing() {
        // A window capture: the image starts 200,100 into the display, so a
        // desktop point at 300,250 is at 100,150 in the image.
        let d = geom(1, 0, 0, 1920, 1080);
        let frame = frame_on(
            d,
            Some(ModelImageTransform::crop(
                200.0,
                100.0,
                400.0,
                400.0,
                (1920.0, 1080.0),
            )),
        );
        let region = PhysicalRect {
            x: 300,
            y: 250,
            width: 40,
            height: 40,
        };
        assert_eq!(
            region_in_frame_image(&frame, &region, 400, 400),
            Some((100, 150, 40, 40))
        );
    }

    #[test]
    fn a_region_outside_a_window_capture_cannot_be_compared() {
        // Asking about the desktop behind a window capture: the image simply
        // does not contain the answer, and inventing one would be worse.
        let d = geom(1, 0, 0, 1920, 1080);
        let frame = frame_on(
            d,
            Some(ModelImageTransform::crop(
                200.0,
                100.0,
                400.0,
                400.0,
                (1920.0, 1080.0),
            )),
        );
        let far = PhysicalRect {
            x: 1500,
            y: 900,
            width: 40,
            height: 40,
        };
        assert_eq!(region_in_frame_image(&frame, &far, 400, 400), None);
    }

    #[test]
    fn a_negative_origin_display_maps_into_its_image_without_going_negative() {
        let d = geom(2, -1080, -661, 1080, 1920);
        let frame = frame_on(d, None);
        let region = PhysicalRect {
            x: -1000,
            y: -600,
            width: 50,
            height: 50,
        };
        assert_eq!(
            region_in_frame_image(&frame, &region, 1080, 1920),
            Some((80, 61, 50, 50))
        );
    }
}
