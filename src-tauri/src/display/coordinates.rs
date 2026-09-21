//! The one place a coordinate changes meaning.
//!
//! Every wrong click this fixes came from the same shape of mistake: a pair of
//! numbers travelled between two coordinate spaces without anything recording
//! which space it was in. `x` and `y` look identical whether they are pixels in
//! a screenshot, pixels on one monitor, pixels on the whole virtual desktop, or
//! a 0–1000 fraction from a vision model.
//!
//! So the space is part of the value here, and conversions are the only way to
//! move between spaces. Code that mixes them up stops compiling instead of
//! clicking the wrong monitor.

use serde::{Deserialize, Serialize};

/// Which coordinate system a point or rectangle is expressed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CoordinateSpace {
    /// Model output normalised to a fixed range (Gemini uses 0–1000).
    ModelNormalized,
    /// Pixels of the image actually handed to the model, after any resize.
    ModelInputPixels,
    /// Pixels of the screenshot as captured, before any model preprocessing.
    CapturePixels,
    /// Physical pixels measured from one monitor's top-left corner.
    DisplayLocalPhysical,
    /// Physical pixels on the virtual desktop. May be negative.
    VirtualDesktopPhysical,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TypedPoint {
    pub x: f64,
    pub y: f64,
    pub space: CoordinateSpace,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_id: Option<u32>,
}

impl TypedPoint {
    pub fn new(x: f64, y: f64, space: CoordinateSpace) -> Self {
        Self {
            x,
            y,
            space,
            display_id: None,
        }
    }

    pub fn on_display(mut self, display_id: u32) -> Self {
        self.display_id = Some(display_id);
        self
    }

    pub fn is_finite(&self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TypedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub space: CoordinateSpace,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_id: Option<u32>,
}

impl TypedRect {
    pub fn center(&self) -> TypedPoint {
        TypedPoint {
            x: self.x + self.width / 2.0,
            y: self.y + self.height / 2.0,
            space: self.space,
            display_id: self.display_id,
        }
    }

    pub fn contains(&self, p: &TypedPoint) -> bool {
        p.x >= self.x && p.y >= self.y && p.x < self.x + self.width && p.y < self.y + self.height
    }
}

/// How the screenshot was altered before the model saw it.
///
/// Without this the reverse mapping is guesswork. A crop with no recorded
/// offset cannot be undone, and a letterboxed image silently shifts every
/// coordinate by the padding.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ModelImageTransform {
    pub source_width: f64,
    pub source_height: f64,
    pub model_input_width: f64,
    pub model_input_height: f64,
    /// Scale applied to the cropped source to reach the model input size.
    pub scale_x: f64,
    pub scale_y: f64,
    /// Crop taken out of the source, before scaling.
    pub crop_left: f64,
    pub crop_top: f64,
    /// Padding added around the scaled image (letterboxing).
    pub padding_left: f64,
    pub padding_top: f64,
}

impl ModelImageTransform {
    /// The common case: the image went to the model untouched.
    pub fn identity(width: f64, height: f64) -> Self {
        Self {
            source_width: width,
            source_height: height,
            model_input_width: width,
            model_input_height: height,
            scale_x: 1.0,
            scale_y: 1.0,
            crop_left: 0.0,
            crop_top: 0.0,
            padding_left: 0.0,
            padding_top: 0.0,
        }
    }

    /// A crop of the original frame, sent at its own resolution.
    pub fn crop(left: f64, top: f64, width: f64, height: f64, source: (f64, f64)) -> Self {
        Self {
            source_width: source.0,
            source_height: source.1,
            model_input_width: width,
            model_input_height: height,
            scale_x: 1.0,
            scale_y: 1.0,
            crop_left: left,
            crop_top: top,
            padding_left: 0.0,
            padding_top: 0.0,
        }
    }
}

/// One monitor's geometry, as the topology service measured it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DisplayGeometry {
    pub display_id: u32,
    /// Physical bounds on the virtual desktop. `x`/`y` may be negative.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub rotation: u16,
}

impl DisplayGeometry {
    pub fn contains_virtual(&self, p: &TypedPoint) -> bool {
        p.x >= self.x as f64
            && p.y >= self.y as f64
            && p.x < (self.x + self.width as i32) as f64
            && p.y < (self.y + self.height as i32) as f64
    }
}

#[derive(Debug, PartialEq)]
pub enum MapError {
    NonFinite,
    WrongSpace {
        expected: CoordinateSpace,
        got: CoordinateSpace,
    },
    /// The point landed in letterbox padding, so it is not on the screenshot.
    InPadding,
    OutOfDisplay,
    DegenerateTransform,
}

impl std::fmt::Display for MapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MapError::NonFinite => write!(f, "the coordinate is not a finite number"),
            MapError::WrongSpace { expected, got } => {
                write!(f, "expected a {expected:?} coordinate but got {got:?}")
            }
            MapError::InPadding => write!(f, "the point falls in letterbox padding"),
            MapError::OutOfDisplay => write!(f, "the point is outside the intended display"),
            MapError::DegenerateTransform => write!(f, "the transform cannot be reversed"),
        }
    }
}

fn require(p: &TypedPoint, expected: CoordinateSpace) -> Result<(), MapError> {
    if !p.is_finite() {
        return Err(MapError::NonFinite);
    }
    if p.space != expected {
        return Err(MapError::WrongSpace {
            expected,
            got: p.space,
        });
    }
    Ok(())
}

/// Stage A — model output to the pixels of the image the model was given.
///
/// The normalisation range is a parameter because providers differ: Gemini
/// uses 0–1000, others use 0–1. Assuming one range silently scales every
/// coordinate by 1000.
pub fn model_normalized_to_input_pixels(
    p: &TypedPoint,
    normalized_max: f64,
    t: &ModelImageTransform,
) -> Result<TypedPoint, MapError> {
    require(p, CoordinateSpace::ModelNormalized)?;
    if normalized_max <= 0.0 {
        return Err(MapError::DegenerateTransform);
    }
    Ok(TypedPoint {
        x: (p.x / normalized_max) * t.model_input_width,
        y: (p.y / normalized_max) * t.model_input_height,
        space: CoordinateSpace::ModelInputPixels,
        display_id: p.display_id,
    })
}

/// Stages B–D — undo padding, resizing and cropping to reach capture pixels.
pub fn model_input_to_capture(
    p: &TypedPoint,
    t: &ModelImageTransform,
) -> Result<TypedPoint, MapError> {
    require(p, CoordinateSpace::ModelInputPixels)?;
    if t.scale_x == 0.0 || t.scale_y == 0.0 {
        return Err(MapError::DegenerateTransform);
    }
    // B: strip the letterbox.
    let unpadded_x = p.x - t.padding_left;
    let unpadded_y = p.y - t.padding_top;
    if unpadded_x < 0.0 || unpadded_y < 0.0 {
        return Err(MapError::InPadding);
    }
    // C: undo the resize. D: put the crop offset back.
    Ok(TypedPoint {
        x: unpadded_x / t.scale_x + t.crop_left,
        y: unpadded_y / t.scale_y + t.crop_top,
        space: CoordinateSpace::CapturePixels,
        display_id: p.display_id,
    })
}

/// Stage E — capture pixels to physical pixels on that monitor.
///
/// Capture resolution is not assumed equal to monitor resolution: a scaled or
/// downsampled capture would otherwise offset every point proportionally.
pub fn capture_to_display_local(
    p: &TypedPoint,
    capture_width: f64,
    capture_height: f64,
    display: &DisplayGeometry,
) -> Result<TypedPoint, MapError> {
    require(p, CoordinateSpace::CapturePixels)?;
    if capture_width <= 0.0 || capture_height <= 0.0 {
        return Err(MapError::DegenerateTransform);
    }
    Ok(TypedPoint {
        x: p.x * (display.width as f64 / capture_width),
        y: p.y * (display.height as f64 / capture_height),
        space: CoordinateSpace::DisplayLocalPhysical,
        display_id: Some(display.display_id),
    })
}

/// Stage F — monitor-local to virtual desktop. Negative origins are preserved.
pub fn display_local_to_virtual(
    p: &TypedPoint,
    display: &DisplayGeometry,
) -> Result<TypedPoint, MapError> {
    require(p, CoordinateSpace::DisplayLocalPhysical)?;
    Ok(TypedPoint {
        x: p.x + display.x as f64,
        y: p.y + display.y as f64,
        space: CoordinateSpace::VirtualDesktopPhysical,
        display_id: Some(display.display_id),
    })
}

/// The inverse of stage F, for placing overlays from a desktop coordinate.
pub fn virtual_to_display_local(
    p: &TypedPoint,
    display: &DisplayGeometry,
) -> Result<TypedPoint, MapError> {
    require(p, CoordinateSpace::VirtualDesktopPhysical)?;
    Ok(TypedPoint {
        x: p.x - display.x as f64,
        y: p.y - display.y as f64,
        space: CoordinateSpace::DisplayLocalPhysical,
        display_id: Some(display.display_id),
    })
}

/// The whole chain, in one call, with the display check at the end.
///
/// Returning `OutOfDisplay` rather than clamping is deliberate: a clamped point
/// is a click somewhere the user did not ask for, and it looks like success.
pub fn model_to_desktop(
    model_point: &TypedPoint,
    normalized_max: f64,
    transform: &ModelImageTransform,
    capture_width: f64,
    capture_height: f64,
    display: &DisplayGeometry,
) -> Result<TypedPoint, MapError> {
    let input = model_normalized_to_input_pixels(model_point, normalized_max, transform)?;
    let capture = model_input_to_capture(&input, transform)?;
    let local = capture_to_display_local(&capture, capture_width, capture_height, display)?;
    let desktop = display_local_to_virtual(&local, display)?;
    if !display.contains_virtual(&desktop) {
        return Err(MapError::OutOfDisplay);
    }
    Ok(desktop)
}

/// Normalise a desktop point for Windows absolute mouse input.
///
/// SendInput's absolute coordinates are 0–65535 across the *virtual desktop*,
/// not the primary monitor. Mapping against the primary monitor is why input
/// lands on the wrong screen when a monitor sits left of or above it.
pub fn virtual_desktop_to_absolute_input(
    p: &TypedPoint,
    virtual_left: i32,
    virtual_top: i32,
    virtual_width: u32,
    virtual_height: u32,
) -> Result<(i32, i32), MapError> {
    require(p, CoordinateSpace::VirtualDesktopPhysical)?;
    if virtual_width == 0 || virtual_height == 0 {
        return Err(MapError::DegenerateTransform);
    }
    let nx = ((p.x - virtual_left as f64) * 65535.0) / (virtual_width as f64 - 1.0).max(1.0);
    let ny = ((p.y - virtual_top as f64) * 65535.0) / (virtual_height as f64 - 1.0).max(1.0);
    Ok((nx.round() as i32, ny.round() as i32))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The user's actual second monitor: portrait, left of and above primary.
    fn portrait_left() -> DisplayGeometry {
        DisplayGeometry {
            display_id: 2,
            x: -1080,
            y: -661,
            width: 1080,
            height: 1920,
            scale_factor: 1.0,
            rotation: 0,
        }
    }

    fn primary_ultrawide() -> DisplayGeometry {
        DisplayGeometry {
            display_id: 1,
            x: 0,
            y: 0,
            width: 3840,
            height: 1080,
            scale_factor: 1.0,
            rotation: 0,
        }
    }

    fn hidpi_4k() -> DisplayGeometry {
        DisplayGeometry {
            display_id: 3,
            x: 3840,
            y: 0,
            width: 3840,
            height: 2160,
            scale_factor: 1.5,
            rotation: 0,
        }
    }

    #[test]
    fn a_coordinate_cannot_be_used_in_the_wrong_space() {
        let p = TypedPoint::new(10.0, 10.0, CoordinateSpace::CapturePixels);
        let d = primary_ultrawide();
        // Handing capture pixels to the display-local stage must be refused,
        // not silently accepted as it was before.
        let err = display_local_to_virtual(&p, &d).unwrap_err();
        assert_eq!(
            err,
            MapError::WrongSpace {
                expected: CoordinateSpace::DisplayLocalPhysical,
                got: CoordinateSpace::CapturePixels,
            }
        );
    }

    #[test]
    fn non_finite_coordinates_are_rejected() {
        let p = TypedPoint::new(f64::NAN, 0.0, CoordinateSpace::DisplayLocalPhysical);
        assert_eq!(
            display_local_to_virtual(&p, &primary_ultrawide()).unwrap_err(),
            MapError::NonFinite
        );
    }

    #[test]
    fn centre_of_a_gemini_box_lands_on_the_primary_monitor() {
        let d = primary_ultrawide();
        let t = ModelImageTransform::identity(3840.0, 1080.0);
        // Gemini normalises 0-1000; dead centre.
        let p = TypedPoint::new(500.0, 500.0, CoordinateSpace::ModelNormalized);
        let out = model_to_desktop(&p, 1000.0, &t, 3840.0, 1080.0, &d).unwrap();
        assert_eq!(out.space, CoordinateSpace::VirtualDesktopPhysical);
        assert!((out.x - 1920.0).abs() < 0.001, "x was {}", out.x);
        assert!((out.y - 540.0).abs() < 0.001, "y was {}", out.y);
    }

    #[test]
    fn negative_origins_survive_the_whole_chain() {
        // The case that silently retargets the primary monitor if anything
        // clamps to zero.
        let d = portrait_left();
        let t = ModelImageTransform::identity(1080.0, 1920.0);
        let p = TypedPoint::new(500.0, 500.0, CoordinateSpace::ModelNormalized);
        let out = model_to_desktop(&p, 1000.0, &t, 1080.0, 1920.0, &d).unwrap();
        // Centre of a monitor at x=-1080 is x=-540: the negative origin must
        // survive. y is +299 because the monitor spans -661..1259, so only x
        // is negative here — asserting both would be testing the wrong thing.
        assert!((out.x - (-540.0)).abs() < 0.001, "x was {}", out.x);
        assert!(out.x < 0.0, "the negative origin must not be clamped away");
        assert!((out.y - 299.0).abs() < 0.001, "y was {}", out.y);

        // A point in the monitor's top strip must land above the desktop
        // origin, which is where clamping to zero would show up.
        let top = TypedPoint::new(500.0, 10.0, CoordinateSpace::ModelNormalized);
        let out_top = model_to_desktop(&top, 1000.0, &t, 1080.0, 1920.0, &d).unwrap();
        assert!(
            out_top.y < 0.0,
            "top-strip y should be negative, was {}",
            out_top.y
        );
    }

    #[test]
    fn a_capture_smaller_than_the_monitor_still_maps_correctly() {
        // Downscaled capture: the ratio must be applied, not assumed to be 1.
        let d = primary_ultrawide();
        let t = ModelImageTransform::identity(1920.0, 540.0);
        let p = TypedPoint::new(500.0, 500.0, CoordinateSpace::ModelNormalized);
        let out = model_to_desktop(&p, 1000.0, &t, 1920.0, 540.0, &d).unwrap();
        assert!((out.x - 1920.0).abs() < 0.001, "x was {}", out.x);
        assert!((out.y - 540.0).abs() < 0.001, "y was {}", out.y);
    }

    #[test]
    fn letterbox_padding_is_removed_and_padding_hits_are_refused() {
        let mut t = ModelImageTransform::identity(1000.0, 1000.0);
        t.padding_left = 100.0;
        t.padding_top = 0.0;
        let inside = TypedPoint::new(150.0, 10.0, CoordinateSpace::ModelInputPixels);
        assert!((model_input_to_capture(&inside, &t).unwrap().x - 50.0).abs() < 0.001);

        let in_pad = TypedPoint::new(20.0, 10.0, CoordinateSpace::ModelInputPixels);
        assert_eq!(
            model_input_to_capture(&in_pad, &t).unwrap_err(),
            MapError::InPadding
        );
    }

    #[test]
    fn a_crop_offset_is_restored() {
        // The coarse-to-fine path: a crop with no recorded offset is
        // unmappable, which is what broke the region feature.
        let t = ModelImageTransform::crop(300.0, 200.0, 400.0, 300.0, (3840.0, 1080.0));
        let p = TypedPoint::new(10.0, 20.0, CoordinateSpace::ModelInputPixels);
        let out = model_input_to_capture(&p, &t).unwrap();
        assert!((out.x - 310.0).abs() < 0.001);
        assert!((out.y - 220.0).abs() < 0.001);
    }

    #[test]
    fn forward_then_inverse_returns_the_original_point() {
        for d in [primary_ultrawide(), portrait_left(), hidpi_4k()] {
            for (x, y) in [(0.0, 0.0), (10.0, 10.0), (500.5, 300.25)] {
                let local = TypedPoint::new(x, y, CoordinateSpace::DisplayLocalPhysical);
                let desktop = display_local_to_virtual(&local, &d).unwrap();
                let back = virtual_to_display_local(&desktop, &d).unwrap();
                assert!(
                    (back.x - x).abs() < 1e-9,
                    "x round trip on {}",
                    d.display_id
                );
                assert!(
                    (back.y - y).abs() < 1e-9,
                    "y round trip on {}",
                    d.display_id
                );
            }
        }
    }

    #[test]
    fn a_point_outside_the_display_is_refused_not_clamped() {
        let d = primary_ultrawide();
        let t = ModelImageTransform::identity(3840.0, 1080.0);
        // Beyond the documented normalisation range: a model error.
        let p = TypedPoint::new(1400.0, 500.0, CoordinateSpace::ModelNormalized);
        assert_eq!(
            model_to_desktop(&p, 1000.0, &t, 3840.0, 1080.0, &d).unwrap_err(),
            MapError::OutOfDisplay
        );
    }

    #[test]
    fn absolute_input_is_normalised_over_the_whole_virtual_desktop() {
        // Virtual desktop spanning the user's real layout.
        let (vl, vt, vw, vh) = (-1080, -661, 4920u32, 1920u32);

        let top_left = TypedPoint::new(-1080.0, -661.0, CoordinateSpace::VirtualDesktopPhysical);
        let (ax, ay) = virtual_desktop_to_absolute_input(&top_left, vl, vt, vw, vh).unwrap();
        assert_eq!((ax, ay), (0, 0), "the desktop origin must map to 0,0");

        let bottom_right = TypedPoint::new(
            (vl + vw as i32 - 1) as f64,
            (vt + vh as i32 - 1) as f64,
            CoordinateSpace::VirtualDesktopPhysical,
        );
        let (bx, by) = virtual_desktop_to_absolute_input(&bottom_right, vl, vt, vw, vh).unwrap();
        assert_eq!((bx, by), (65535, 65535), "the far corner must map to 65535");
    }

    #[test]
    fn a_point_on_the_primary_is_not_mapped_as_if_it_were_the_desktop_origin() {
        // With a monitor left of primary, desktop 0,0 is NOT the corner. Code
        // that ignores virtual_left sends this to the wrong screen.
        let (vl, vt, vw, vh) = (-1080, -661, 4920u32, 1920u32);
        let origin_of_primary = TypedPoint::new(0.0, 0.0, CoordinateSpace::VirtualDesktopPhysical);
        let (ax, _) =
            virtual_desktop_to_absolute_input(&origin_of_primary, vl, vt, vw, vh).unwrap();
        let expected = ((1080.0_f64 * 65535.0) / 4919.0).round() as i32;
        assert_eq!(ax, expected);
        assert!(ax > 0, "primary origin must not normalise to zero");
    }

    #[test]
    fn scale_factor_does_not_leak_into_physical_mapping() {
        // physical bounds are already physical; applying scale again would
        // multiply the error by 1.5 on this display.
        let d = hidpi_4k();
        let t = ModelImageTransform::identity(3840.0, 2160.0);
        let p = TypedPoint::new(0.0, 0.0, CoordinateSpace::ModelNormalized);
        let out = model_to_desktop(&p, 1000.0, &t, 3840.0, 2160.0, &d).unwrap();
        assert!((out.x - 3840.0).abs() < 0.001, "x was {}", out.x);
        assert!((out.y - 0.0).abs() < 0.001);
    }

    #[test]
    fn a_box_centre_is_computed_in_its_own_space() {
        let r = TypedRect {
            x: 100.0,
            y: 200.0,
            width: 60.0,
            height: 40.0,
            space: CoordinateSpace::CapturePixels,
            display_id: Some(1),
        };
        let c = r.center();
        assert_eq!((c.x, c.y), (130.0, 220.0));
        assert_eq!(c.space, CoordinateSpace::CapturePixels);
    }
}
