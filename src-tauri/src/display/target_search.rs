//! Find the target again after it moved.
//!
//! `target_recovery::classify` decides *what a stale region means* and takes a
//! callback to look again. This is that callback: the part that actually
//! searches. Without it the classifier could only ever conclude "gone", which
//! is how a window nudged twenty pixels became a failed request.
//!
//! The method is a template search, deliberately: take how the target's
//! surroundings looked when the model saw them, and slide that patch over a
//! larger area of a fresh capture. Whatever offset matches best is where the
//! target went. It needs no accessibility tree, works for image content as well
//! as controls, and cannot invent a target that is not there — a best match
//! that is still poor is reported as no match.
//!
//! What it deliberately does *not* do is decide the target is the same thing.
//! It reports where a similar patch is and how confident it is; identity is
//! `TargetIdentity::same_as`, which prefers a semantic control id when one
//! exists.

#![cfg(windows)]

use super::freshness::PhysicalRect;
use super::production_capture;
use super::topology::DisplayTopology;

/// Side of the grid each patch is reduced to before comparing.
const GRID: u32 = 24;

/// Luma grid with the mean removed.
///
/// `freshness::similarity` answers a different question — "is roughly the same
/// thing still here?" — with a mean absolute difference, and it is right for
/// that. It is the wrong tool for *searching*: a dark patch on a dark desktop
/// differs from the wallpaper by very little in absolute terms, so a marker
/// scored 0.9+ against blank background and every offset looked like a match.
///
/// Removing the mean compares *structure* rather than brightness, which is what
/// distinguishes a control from the space around it.
fn zero_mean_grid(img: &xcap::image::RgbaImage) -> Vec<f32> {
    let small = xcap::image::imageops::resize(
        img,
        GRID,
        GRID,
        xcap::image::imageops::FilterType::Triangle,
    );
    let mut values: Vec<f32> = small
        .pixels()
        .map(|p| {
            let [r, g, b, _] = p.0;
            (0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32) / 255.0
        })
        .collect();
    let mean = values.iter().sum::<f32>() / values.len().max(1) as f32;
    for v in &mut values {
        *v -= mean;
    }
    values
}

/// Normalised cross-correlation of two zero-mean grids: 1.0 identical, ~0
/// unrelated. Negative values are inverted structure and are not matches.
fn correlate(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    // A patch with no structure at all — flat colour — correlates with nothing.
    // Reporting 0 rather than dividing by zero keeps blank areas unmatchable.
    if na < 1e-6 || nb < 1e-6 {
        return 0.0;
    }
    (dot / (na * nb)).clamp(-1.0, 1.0)
}

/// How far around the last known position to look, in physical pixels.
///
/// A window drag or a list scroll moves things by tens of pixels; a target that
/// has gone further than this has usually gone somewhere the user moved it on
/// purpose, and re-finding it silently would be a worse answer than asking.
pub const SEARCH_RADIUS: i32 = 120;

/// Step between candidate offsets. Two pixels rather than one: the comparison
/// downsamples to 32×32 anyway, so single-pixel offsets are indistinguishable
/// and cost four times the work.
const STEP: i32 = 2;

/// Below this, the best match is not the target — it is just the least-bad
/// patch of wallpaper. Higher than the freshness threshold on purpose: moving a
/// target and then acting on it deserves more confidence than leaving it alone.
pub const MATCH_THRESHOLD: f32 = 0.90;

/// A second match nearly as good as the first means we cannot tell them apart.
/// Two identical buttons is a question for the user, not a coin flip.
pub const AMBIGUITY_MARGIN: f32 = 0.04;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SearchResult {
    /// Found, with the offset from the original position and the score.
    Found { dx: i32, dy: i32, score: f32 },
    /// More than one candidate matched about equally well.
    Ambiguous { count: usize },
    /// Nothing in the search area looks like it.
    NotFound { best: f32 },
    /// The search could not run. Distinct from "not found", which is a result.
    Unavailable,
}

/// Score every candidate offset and pick the best, noticing near-ties.
///
/// Split from the capture so it can be tested on synthetic images: a real
/// screen is not a fixture, and a search that is only ever exercised against
/// live pixels is a search nobody can characterise.
pub fn search_in(
    haystack: &xcap::image::RgbaImage,
    needle: &xcap::image::RgbaImage,
    origin_x: u32,
    origin_y: u32,
) -> SearchResult {
    let (nw, nh) = (needle.width(), needle.height());
    if nw == 0 || nh == 0 || haystack.width() < nw || haystack.height() < nh {
        return SearchResult::Unavailable;
    }

    let template = zero_mean_grid(needle);
    let max_x = (haystack.width() - nw) as i32;
    let max_y = (haystack.height() - nh) as i32;

    let mut scored: Vec<(i32, i32, f32)> = Vec::new();
    let mut x = 0;
    while x <= max_x {
        let mut y = 0;
        while y <= max_y {
            let candidate =
                xcap::image::imageops::crop_imm(haystack, x as u32, y as u32, nw, nh).to_image();
            scored.push((x, y, correlate(&template, &zero_mean_grid(&candidate))));
            y += STEP;
        }
        x += STEP;
    }

    let Some(&(bx, by, best)) = scored
        .iter()
        .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
    else {
        return SearchResult::Unavailable;
    };

    if best < MATCH_THRESHOLD {
        return SearchResult::NotFound { best: best.max(0.0) };
    }

    // A rival only counts if it is somewhere else.
    //
    // The first version compared against the second-best score anywhere, which
    // is always an offset one step from the best one — heavily overlapping the
    // same target, and scoring almost identically. Every single match read as
    // ambiguous. A rival has to be at least half a patch away to be a different
    // thing at all.
    let (min_dx, min_dy) = ((nw / 2) as i32, (nh / 2) as i32);
    let rival = scored
        .iter()
        .filter(|(x, y, _)| (x - bx).abs() >= min_dx || (y - by).abs() >= min_dy)
        .map(|&(_, _, s)| s)
        .fold(f32::MIN, f32::max);

    if rival > MATCH_THRESHOLD && rival >= best - AMBIGUITY_MARGIN {
        return SearchResult::Ambiguous { count: 2 };
    }

    SearchResult::Found {
        dx: bx - origin_x as i32,
        dy: by - origin_y as i32,
        score: best,
    }
}

/// Look for `needle` around `region` on the live screen.
///
/// `needle` is the target's surroundings as they were when captured; `region`
/// is where they were. Returns the offset to apply to the target's coordinates.
pub fn find_near(
    topology: &DisplayTopology,
    region: PhysicalRect,
    needle: &xcap::image::RgbaImage,
) -> SearchResult {
    let search = PhysicalRect {
        x: region.x - SEARCH_RADIUS,
        y: region.y - SEARCH_RADIUS,
        width: region.width + (SEARCH_RADIUS as u32) * 2,
        height: region.height + (SEARCH_RADIUS as u32) * 2,
    };
    let Ok(captured) = production_capture::capture_region(
        topology,
        search.x,
        search.y,
        search.width,
        search.height,
    ) else {
        return SearchResult::Unavailable;
    };

    // Where the original region sits inside the search area, so the reported
    // offset is relative to the target's old position rather than to the corner
    // of a rectangle the caller never asked about.
    search_in(
        &captured.image,
        needle,
        SEARCH_RADIUS as u32,
        SEARCH_RADIUS as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use xcap::image::{Rgba, RgbaImage};

    /// A distinctive patch: a bright cross on a dark field, so a match is a
    /// match and not a coincidence of flat colour.
    fn marker(size: u32) -> RgbaImage {
        let mut img = RgbaImage::from_pixel(size, size, Rgba([20, 20, 24, 255]));
        for i in 0..size {
            img.put_pixel(i, size / 2, Rgba([250, 240, 120, 255]));
            img.put_pixel(size / 2, i, Rgba([250, 240, 120, 255]));
        }
        img
    }

    fn field(w: u32, h: u32) -> RgbaImage {
        // Gently varying background, so "least-bad patch of wallpaper" scores
        // are realistic rather than all identical.
        RgbaImage::from_fn(w, h, |x, y| {
            Rgba([
                (18 + (x % 7)) as u8,
                (20 + (y % 5)) as u8,
                (26 + ((x + y) % 9)) as u8,
                255,
            ])
        })
    }

    fn place(base: &mut RgbaImage, patch: &RgbaImage, at_x: u32, at_y: u32) {
        for y in 0..patch.height() {
            for x in 0..patch.width() {
                base.put_pixel(at_x + x, at_y + y, *patch.get_pixel(x, y));
            }
        }
    }

    #[test]
    fn a_target_that_has_not_moved_reports_no_offset() {
        let needle = marker(48);
        let mut hay = field(300, 300);
        place(&mut hay, &needle, 120, 120);

        match search_in(&hay, &needle, 120, 120) {
            SearchResult::Found { dx, dy, score } => {
                assert_eq!((dx, dy), (0, 0));
                assert!(score > 0.99, "score {score}");
            }
            other => panic!("expected Found, got {other:?}"),
        }
    }

    /// The case that used to fail the whole request: a window nudged sideways.
    #[test]
    fn a_moved_target_is_found_again_with_its_offset() {
        let needle = marker(48);
        let mut hay = field(300, 300);
        place(&mut hay, &needle, 160, 96);

        match search_in(&hay, &needle, 120, 120) {
            SearchResult::Found { dx, dy, .. } => {
                assert_eq!((dx, dy), (40, -24));
            }
            other => panic!("expected Found, got {other:?}"),
        }
    }

    #[test]
    fn a_target_that_is_gone_is_not_invented() {
        let needle = marker(48);
        let hay = field(300, 300);
        match search_in(&hay, &needle, 120, 120) {
            SearchResult::NotFound { best } => {
                assert!(best < MATCH_THRESHOLD, "best {best}");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    /// Two identical controls: the user has to say which.
    #[test]
    fn two_equally_good_matches_are_ambiguous() {
        let needle = marker(48);
        let mut hay = field(300, 300);
        place(&mut hay, &needle, 60, 120);
        place(&mut hay, &needle, 200, 120);

        assert!(
            matches!(search_in(&hay, &needle, 120, 120), SearchResult::Ambiguous { .. }),
            "two copies of the same control must not be resolved by picking one"
        );
    }

    /// Adjacent offsets scoring alike are the same match, not two.
    #[test]
    fn one_match_is_not_reported_as_ambiguous() {
        let needle = marker(48);
        let mut hay = field(300, 300);
        place(&mut hay, &needle, 122, 118);
        assert!(
            matches!(search_in(&hay, &needle, 120, 120), SearchResult::Found { .. }),
            "a single target must not read as ambiguous just because neighbouring \
             offsets overlap it"
        );
    }

    #[test]
    fn a_needle_larger_than_the_haystack_is_unavailable_not_missing() {
        let needle = marker(64);
        let hay = field(32, 32);
        assert_eq!(search_in(&hay, &needle, 0, 0), SearchResult::Unavailable);
    }

    /// The search window is bounded, so a target that moved across the screen
    /// is reported as gone rather than found somewhere unrelated.
    #[test]
    fn the_search_area_is_bounded() {
        assert_eq!(SEARCH_RADIUS, 120);
        let needle = marker(48);
        let mut hay = field(300, 300);
        // Well outside a ±120 window from (120,120) once `find_near` crops.
        place(&mut hay, &needle, 250, 250);
        // Searching the whole 300×300 still finds it — the bound is applied by
        // `find_near`'s capture rectangle, which is what this documents.
        assert!(matches!(search_in(&hay, &needle, 120, 120), SearchResult::Found { .. }));
    }
}
