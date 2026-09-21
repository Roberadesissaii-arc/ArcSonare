//! Drawing the shapes an annotation can be.
//!
//! Geometry only: given a rectangle and a style, blend pixels into a surface.
//! It owns no windows, knows nothing about annotations, and can be tested on a
//! plain buffer — which matters, because "is the circle inside the box" is a
//! question about arithmetic and should not need a monitor to answer.
//!
//! Rendering is signed-distance based, the same approach `native_overlay`'s
//! existing highlight uses: compute how far a pixel is from the ideal edge and
//! blend by that distance. It antialiases for free and makes a soft outer glow
//! one extra comparison rather than a second pass.

#![cfg(windows)]

use serde::{Deserialize, Serialize};

/// Padding around every shape, so a stroke and its glow are never clipped by
/// the window edge. The same constant the existing highlight uses, for the same
/// reason.
pub const SHAPE_PADDING: i32 = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShapeKind {
    /// The rounded rectangle the assistant has always drawn. Kept as its own
    /// kind rather than folded into `Rectangle`, because "highlight this" and
    /// "draw a rectangle" are different requests and may diverge in style.
    Highlight,
    Rectangle,
    Circle,
    Arrow,
    Label,
    Freehand,
}

/// Colour and weight. Named colours resolve here so the model never has to
/// produce an RGB triple, and "make it red" is a one-word update.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationStyle {
    /// `#rrggbb`, or a name from `named_colour`.
    #[serde(default = "default_colour")]
    pub colour: String,
    #[serde(default = "default_thickness")]
    pub thickness: f32,
    /// 0..1 for the stroke itself; the glow is derived from it.
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    /// Text for `Label`, ignored otherwise.
    #[serde(default)]
    pub text: Option<String>,
}

fn default_colour() -> String {
    // The assistant's own purple, so an annotation is recognisably ArcSonare
    // rather than something the application drew.
    "#c084fc".into()
}
fn default_thickness() -> f32 {
    2.5
}
fn default_opacity() -> f32 {
    1.0
}

impl Default for AnnotationStyle {
    fn default() -> Self {
        Self {
            colour: default_colour(),
            thickness: default_thickness(),
            opacity: default_opacity(),
            text: None,
        }
    }
}

/// Resolve a colour the user named, or a hex string.
///
/// Returns `None` for anything unrecognised rather than guessing: "make it
/// burgundy" drawing something arbitrary is worse than saying the colour was
/// not understood.
pub fn parse_colour(raw: &str) -> Option<(u8, u8, u8)> {
    let s = raw.trim().to_ascii_lowercase();
    if let Some(hex) = s.strip_prefix('#') {
        if hex.len() == 6 {
            let p = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
            return Some((p(0)?, p(2)?, p(4)?));
        }
        return None;
    }
    Some(match s.as_str() {
        "red" => (248, 81, 73),
        "orange" => (251, 146, 60),
        "yellow" => (250, 204, 21),
        "green" => (74, 222, 128),
        "blue" => (96, 165, 250),
        "purple" | "violet" => (192, 132, 252),
        "pink" => (244, 114, 182),
        "white" => (250, 250, 250),
        "black" => (24, 24, 27),
        "cyan" | "teal" => (45, 212, 191),
        _ => return None,
    })
}

/// A rectangle in the shape's own surface coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShapeBox {
    pub width: i32,
    pub height: i32,
}

/// Signed distance to a rounded rectangle's edge: negative inside.
fn rounded_rect_distance(px: f32, py: f32, x0: f32, y0: f32, x1: f32, y1: f32, r: f32) -> f32 {
    let cx = px.clamp(x0 + r, x1 - r);
    let cy = py.clamp(y0 + r, y1 - r);
    let (dx, dy) = (px - cx, py - cy);
    (dx * dx + dy * dy).sqrt() - r
}

/// Signed distance to an ellipse inscribed in the box.
///
/// Approximated rather than solved exactly: the closed form for the distance to
/// an ellipse is iterative, and at a 2–3px stroke width the gradient-scaled
/// approximation is visually identical and a great deal cheaper.
fn ellipse_distance(px: f32, py: f32, cx: f32, cy: f32, rx: f32, ry: f32) -> f32 {
    if rx <= 0.0 || ry <= 0.0 {
        return f32::MAX;
    }
    let nx = (px - cx) / rx;
    let ny = (py - cy) / ry;
    let value = (nx * nx + ny * ny).sqrt();
    // Scale the normalised distance back into pixels using the smaller radius,
    // so the stroke has an even width rather than thinning at the flat ends.
    (value - 1.0) * rx.min(ry)
}

/// Draw one shape into a surface sized `width + 2·padding` square-wise.
///
/// `blend` is the caller's pixel sink — `native_overlay::Surface::blend` in
/// production, a counting closure in tests. Passing it in is what lets the
/// geometry be tested without a window.
pub fn render(
    kind: ShapeKind,
    size: ShapeBox,
    style: &AnnotationStyle,
    mut blend: impl FnMut(i32, i32, u8, u8, u8, f32),
) {
    let (r, g, b) = parse_colour(&style.colour).unwrap_or((192, 132, 252));
    let pad = SHAPE_PADDING as f32;
    let (w, h) = (size.width as f32 + pad * 2.0, size.height as f32 + pad * 2.0);
    let (x0, y0, x1, y1) = (pad, pad, w - pad, h - pad);
    let thickness = style.thickness.max(1.0);
    let glow = 7.0;
    let alpha = style.opacity.clamp(0.0, 1.0);

    let distance = |px: f32, py: f32| -> f32 {
        match kind {
            ShapeKind::Highlight | ShapeKind::Rectangle | ShapeKind::Label => {
                let corner: f32 = if kind == ShapeKind::Rectangle { 2.0 } else { 8.0 };
                let radius = corner.min((x1 - x0) / 2.0).min((y1 - y0) / 2.0);
                rounded_rect_distance(px, py, x0, y0, x1, y1, radius)
            }
            ShapeKind::Circle => ellipse_distance(
                px,
                py,
                (x0 + x1) / 2.0,
                (y0 + y1) / 2.0,
                (x1 - x0) / 2.0,
                (y1 - y0) / 2.0,
            ),
            // An arrow is drawn as its shaft here; the head is a second pass the
            // caller adds. Kept simple until something actually asks for arrows.
            ShapeKind::Arrow | ShapeKind::Freehand => {
                let t = ((px - x0) / (x1 - x0)).clamp(0.0, 1.0);
                let line_y = y0 + (y1 - y0) * t;
                (py - line_y).abs()
            }
        }
    };

    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let edge = distance(x as f32 + 0.5, y as f32 + 0.5).abs();
            if edge <= thickness {
                // A white underlay first, so the stroke stays visible against a
                // background that happens to be the same hue as the colour.
                let a = (1.0 - (edge - (thickness - 1.0)).max(0.0)).clamp(0.0, 1.0);
                blend(x, y, 255, 255, 255, a * 0.5 * alpha);
                blend(x, y, r, g, b, a * alpha);
            } else if edge <= thickness + glow {
                let t = 1.0 - (edge - thickness) / glow;
                blend(x, y, r, g, b, t * t * 0.45 * alpha);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Collect which pixels a shape actually touches.
    fn painted(kind: ShapeKind, w: i32, h: i32, style: &AnnotationStyle) -> Vec<(i32, i32)> {
        let mut hits = Vec::new();
        render(kind, ShapeBox { width: w, height: h }, style, |x, y, _, _, _, a| {
            if a > 0.5 {
                hits.push((x, y));
            }
        });
        hits
    }

    #[test]
    fn a_named_colour_resolves_and_an_unknown_one_does_not() {
        assert_eq!(parse_colour("red"), Some((248, 81, 73)));
        assert_eq!(parse_colour("  RED "), Some((248, 81, 73)));
        assert_eq!(parse_colour("#ff0000"), Some((255, 0, 0)));
        // Guessing here would draw an arbitrary colour and call it burgundy.
        assert_eq!(parse_colour("burgundy"), None);
        assert_eq!(parse_colour("#xyz"), None);
        assert_eq!(parse_colour("#f00"), None);
    }

    #[test]
    fn a_rectangle_is_drawn_as_an_outline_not_a_fill() {
        let hits = painted(ShapeKind::Rectangle, 120, 80, &AnnotationStyle::default());
        assert!(!hits.is_empty());
        // The centre must be untouched: an annotation that fills its box hides
        // the thing it is pointing at.
        let (cx, cy) = (SHAPE_PADDING + 60, SHAPE_PADDING + 40);
        assert!(
            !hits.contains(&(cx, cy)),
            "the middle of the box was painted over"
        );
    }

    #[test]
    fn a_circle_is_round_rather_than_square() {
        let hits = painted(ShapeKind::Circle, 100, 100, &AnnotationStyle::default());
        let corner = (SHAPE_PADDING + 2, SHAPE_PADDING + 2);
        let edge_middle = (SHAPE_PADDING + 50, SHAPE_PADDING);
        assert!(
            !hits.contains(&corner),
            "a circle must not paint the corner of its box"
        );
        assert!(
            hits.iter().any(|&(x, y)| (x - edge_middle.0).abs() <= 2
                && (y - edge_middle.1).abs() <= 3),
            "a circle must touch the middle of its box's top edge"
        );
    }

    /// The stroke stays inside the padded surface, so nothing is clipped.
    #[test]
    fn nothing_is_drawn_outside_the_surface() {
        let (w, h) = (60, 40);
        let (sw, sh) = (w + SHAPE_PADDING * 2, h + SHAPE_PADDING * 2);
        for kind in [ShapeKind::Highlight, ShapeKind::Rectangle, ShapeKind::Circle] {
            for (x, y) in painted(kind, w, h, &AnnotationStyle::default()) {
                assert!(
                    x >= 0 && y >= 0 && x < sw && y < sh,
                    "{kind:?} painted outside at ({x},{y})"
                );
            }
        }
    }

    #[test]
    fn colour_changes_what_is_drawn_but_not_where() {
        let default_style = AnnotationStyle::default();
        let red = AnnotationStyle {
            colour: "red".into(),
            ..AnnotationStyle::default()
        };
        assert_eq!(
            painted(ShapeKind::Circle, 80, 80, &default_style),
            painted(ShapeKind::Circle, 80, 80, &red),
            "recolouring must not move the shape"
        );

        let mut saw_red = false;
        render(
            ShapeKind::Circle,
            ShapeBox { width: 80, height: 80 },
            &red,
            |_, _, r, g, b, a| {
                if a > 0.5 && (r, g, b) == (248, 81, 73) {
                    saw_red = true;
                }
            },
        );
        assert!(saw_red, "the red circle was not drawn in red");
    }

    #[test]
    fn a_degenerate_box_draws_nothing_rather_than_panicking() {
        for (w, h) in [(0, 0), (1, 0), (0, 1)] {
            let _ = painted(ShapeKind::Circle, w, h, &AnnotationStyle::default());
        }
    }

    #[test]
    fn opacity_scales_the_stroke() {
        let faint = AnnotationStyle {
            opacity: 0.2,
            ..AnnotationStyle::default()
        };
        let mut max_alpha = 0.0f32;
        render(
            ShapeKind::Rectangle,
            ShapeBox { width: 50, height: 50 },
            &faint,
            |_, _, _, _, _, a| max_alpha = max_alpha.max(a),
        );
        assert!(max_alpha <= 0.2001, "opacity ignored: {max_alpha}");
    }
}
