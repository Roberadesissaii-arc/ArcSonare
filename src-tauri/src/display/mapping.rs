//! Where to put a calibration target, and what the clicks say afterwards.
//!
//! The wizard's job is to check that a point ArcSonare calculates is the point
//! the user's mouse actually reaches. That check is only worth anything if the
//! arithmetic being checked lives somewhere it can be tested without a person
//! and two monitors — so all of it is here, and none of it touches Win32.
//!
//! The correction it fits is deliberately the smallest one that could help. The
//! OS topology is already the authority; if a monitor needs a perspective warp
//! to make sense, something is wrong that a warp would only hide. An affine fit
//! catches the plausible faults — a constant offset from a mis-set origin, a
//! scale error from DPI — and anything it cannot express is reported as error
//! rather than absorbed.

use serde::{Deserialize, Serialize};

/// A point in physical pixels. Which space it is in depends on the field name
/// at the use site — `display_*` is display-local, `desktop_*` is virtual.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalPoint {
    pub x: f64,
    pub y: f64,
}

impl PhysicalPoint {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
    pub fn distance_to(&self, other: &Self) -> f64 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2)).sqrt()
    }
}

/// Where the nine calibration targets go, in reading order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetPosition {
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    Center,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

impl TargetPosition {
    pub const ALL: [TargetPosition; 9] = [
        Self::TopLeft,
        Self::TopCenter,
        Self::TopRight,
        Self::MiddleLeft,
        Self::Center,
        Self::MiddleRight,
        Self::BottomLeft,
        Self::BottomCenter,
        Self::BottomRight,
    ];

    pub fn label(&self) -> &'static str {
        match self {
            Self::TopLeft => "Top left",
            Self::TopCenter => "Top centre",
            Self::TopRight => "Top right",
            Self::MiddleLeft => "Middle left",
            Self::Center => "Centre",
            Self::MiddleRight => "Middle right",
            Self::BottomLeft => "Bottom left",
            Self::BottomCenter => "Bottom centre",
            Self::BottomRight => "Bottom right",
        }
    }

    /// Fractions of the usable area, before the inset is applied.
    fn fractions(&self) -> (f64, f64) {
        let col = match self {
            Self::TopLeft | Self::MiddleLeft | Self::BottomLeft => 0.0,
            Self::TopCenter | Self::Center | Self::BottomCenter => 0.5,
            _ => 1.0,
        };
        let row = match self {
            Self::TopLeft | Self::TopCenter | Self::TopRight => 0.0,
            Self::MiddleLeft | Self::Center | Self::MiddleRight => 0.5,
            _ => 1.0,
        };
        (col, row)
    }
}

/// How far in from the physical edge a target sits, by default.
///
/// The corners are the interesting part of the screen — an origin error shows up
/// there first — but the outermost pixels are unusable: the taskbar covers some,
/// and Windows steals the very corner for Show Desktop, so a click there never
/// reaches the target.
pub const DEFAULT_INSET: f64 = 64.0;
const MIN_INSET: f64 = 16.0;

/// Keep the inset sensible on a small display.
///
/// A 64 px inset on each side of a 1024-wide screen is fine; on a 640-wide
/// portrait strip it would collapse the nine points into three. Capping it at an
/// eighth of the shorter side keeps the spread meaningful.
pub fn inset_for(width: f64, height: f64) -> f64 {
    let shorter = width.min(height);
    DEFAULT_INSET.min(shorter / 8.0).max(MIN_INSET)
}

/// The nine calibration points for a display, in display-local physical pixels.
///
/// Display-local rather than virtual-desktop on purpose: a monitor left of the
/// primary one has a negative virtual origin, and doing the arithmetic in
/// display space means the sign never enters it. Converting to desktop space is
/// one addition, done once, where it can be seen.
pub fn nine_point_targets(width: f64, height: f64) -> Vec<(TargetPosition, PhysicalPoint)> {
    let inset = inset_for(width, height);
    let usable_w = (width - inset * 2.0).max(0.0);
    let usable_h = (height - inset * 2.0).max(0.0);
    TargetPosition::ALL
        .iter()
        .map(|position| {
            let (fx, fy) = position.fractions();
            (
                *position,
                PhysicalPoint::new(inset + usable_w * fx, inset + usable_h * fy),
            )
        })
        .collect()
}

/// Display-local → virtual-desktop. The only place the origin is added.
pub fn to_desktop(point: PhysicalPoint, origin_x: i32, origin_y: i32) -> PhysicalPoint {
    PhysicalPoint::new(point.x + origin_x as f64, point.y + origin_y as f64)
}

/// One measurement: where a target was drawn, and where the cursor really was.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMappingSample {
    pub sample_id: String,
    pub expected_display_point: PhysicalPoint,
    pub expected_desktop_point: PhysicalPoint,
    pub actual_desktop_point: PhysicalPoint,
    pub error_x: f64,
    pub error_y: f64,
    pub error_distance: f64,
    pub captured_at_ms: u64,
    /// True when the click landed on a different monitor than the target.
    pub wrong_display: bool,
    /// True when the click landed outside the target display's bounds.
    pub out_of_bounds: bool,
}

impl DisplayMappingSample {
    pub fn new(
        sample_id: String,
        expected_display_point: PhysicalPoint,
        expected_desktop_point: PhysicalPoint,
        actual_desktop_point: PhysicalPoint,
        captured_at_ms: u64,
        wrong_display: bool,
        out_of_bounds: bool,
    ) -> Self {
        let error_x = actual_desktop_point.x - expected_desktop_point.x;
        let error_y = actual_desktop_point.y - expected_desktop_point.y;
        Self {
            sample_id,
            expected_display_point,
            expected_desktop_point,
            actual_desktop_point,
            error_x,
            error_y,
            error_distance: (error_x * error_x + error_y * error_y).sqrt(),
            captured_at_ms,
            wrong_display,
            out_of_bounds,
        }
    }
}

/// `x' = a·x + b·y + c`, `y' = d·x + e·y + f`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AffineTransform {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl AffineTransform {
    pub const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 0.0,
        e: 1.0,
        f: 0.0,
    };

    pub fn apply(&self, p: PhysicalPoint) -> PhysicalPoint {
        PhysicalPoint::new(
            self.a * p.x + self.b * p.y + self.c,
            self.d * p.x + self.e * p.y + self.f,
        )
    }

    /// Is this close enough to identity that storing it would be noise?
    ///
    /// A correction of a fraction of a pixel is measurement jitter, and baking
    /// jitter into a stored transform makes every later click slightly wrong in
    /// a way that looks deliberate.
    pub fn is_effectively_identity(&self) -> bool {
        const LINEAR_EPSILON: f64 = 0.001;
        const OFFSET_EPSILON: f64 = 0.5;
        (self.a - 1.0).abs() < LINEAR_EPSILON
            && self.b.abs() < LINEAR_EPSILON
            && self.d.abs() < LINEAR_EPSILON
            && (self.e - 1.0).abs() < LINEAR_EPSILON
            && self.c.abs() < OFFSET_EPSILON
            && self.f.abs() < OFFSET_EPSILON
    }

    /// The transform that undoes this one, when one exists.
    pub fn inverse(&self) -> Option<Self> {
        let det = self.a * self.e - self.b * self.d;
        if det.abs() < 1e-12 {
            return None; // degenerate: the fit collapsed a dimension
        }
        Some(Self {
            a: self.e / det,
            b: -self.b / det,
            c: (self.b * self.f - self.e * self.c) / det,
            d: -self.d / det,
            e: self.a / det,
            f: (self.d * self.c - self.a * self.f) / det,
        })
    }
}

/// Least-squares affine fit from expected points to observed points.
///
/// Solves the two independent 3×3 normal-equation systems by Gaussian
/// elimination. Fewer than three non-collinear points cannot determine an
/// affine map, and returns `None` rather than something that fits the data and
/// nothing else.
pub fn fit_affine(pairs: &[(PhysicalPoint, PhysicalPoint)]) -> Option<AffineTransform> {
    if pairs.len() < 3 {
        return None;
    }
    // Normal equations: Aᵀ A · coeffs = Aᵀ b, with rows [x, y, 1].
    let mut ata = [[0.0f64; 3]; 3];
    let mut atx = [0.0f64; 3];
    let mut aty = [0.0f64; 3];
    for (from, to) in pairs {
        let row = [from.x, from.y, 1.0];
        for i in 0..3 {
            for j in 0..3 {
                ata[i][j] += row[i] * row[j];
            }
            atx[i] += row[i] * to.x;
            aty[i] += row[i] * to.y;
        }
    }
    let cx = solve3(ata, atx)?;
    let cy = solve3(ata, aty)?;
    Some(AffineTransform {
        a: cx[0],
        b: cx[1],
        c: cx[2],
        d: cy[0],
        e: cy[1],
        f: cy[2],
    })
}

/// Gaussian elimination with partial pivoting for a 3×3 system.
fn solve3(mut m: [[f64; 3]; 3], mut v: [f64; 3]) -> Option<[f64; 3]> {
    for col in 0..3 {
        // Pivot on the largest remaining magnitude, or the arithmetic loses
        // precision exactly when the points are nearly collinear.
        let pivot = (col..3).max_by(|&i, &j| {
            m[i][col]
                .abs()
                .partial_cmp(&m[j][col].abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
        if m[pivot][col].abs() < 1e-12 {
            return None; // singular: the points do not determine a solution
        }
        m.swap(col, pivot);
        v.swap(col, pivot);
        for row in (col + 1)..3 {
            let factor = m[row][col] / m[col][col];
            for k in col..3 {
                m[row][k] -= factor * m[col][k];
            }
            v[row] -= factor * v[col];
        }
    }
    let mut out = [0.0f64; 3];
    for row in (0..3).rev() {
        let mut sum = v[row];
        for k in (row + 1)..3 {
            sum -= m[row][k] * out[k];
        }
        out[row] = sum / m[row][row];
    }
    Some(out)
}

/// How far out a sample must be, relative to the rest, to be discarded.
const OUTLIER_SIGMA: f64 = 3.0;
/// Scale factor making the median absolute deviation comparable to a standard
/// deviation for normally-distributed data.
const MAD_TO_SIGMA: f64 = 1.4826;
/// Never discard a sample this small, however unusual it looks among very tight
/// ones — three sub-pixel errors and one of two pixels is a good run, not an
/// outlier.
const OUTLIER_FLOOR_PX: f64 = 4.0;

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    }
}

/// Drop samples that are not measuring the same thing as the others.
///
/// A misclick is a real event — the user aimed at the target and hit next to it
/// — and letting one drag the fit would spread that mistake across the whole
/// display. Only clearly-detached samples go, and never so many that the fit
/// stops being evidence: below four survivors this returns everything and lets
/// the thresholds fail the run honestly.
pub fn reject_outliers(samples: &[DisplayMappingSample]) -> Vec<usize> {
    if samples.len() < 4 {
        return Vec::new();
    }
    let distances: Vec<f64> = samples.iter().map(|s| s.error_distance).collect();
    // Median and MAD rather than mean and standard deviation. A single 300px
    // misclick among eight good samples drags the mean up and inflates sigma so
    // far that the outlier sits comfortably inside three of them — the estimator
    // is corrupted by the very sample it is meant to find. The median does not
    // move, so the outlier stays visible.
    let centre = median(&distances);
    let deviations: Vec<f64> = distances.iter().map(|d| (d - centre).abs()).collect();
    let mad = median(&deviations);
    let spread = mad * MAD_TO_SIGMA;
    // A perfectly consistent run has a MAD of zero; the floor keeps that from
    // making every sample an outlier.
    let limit = (centre + OUTLIER_SIGMA * spread).max(centre + OUTLIER_FLOOR_PX);

    let rejected: Vec<usize> = samples
        .iter()
        .enumerate()
        .filter(|(_, s)| s.error_distance > limit)
        .map(|(i, _)| i)
        .collect();
    if samples.len() - rejected.len() < 4 {
        return Vec::new();
    }
    rejected
}

/// What a completed run of samples amounts to.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSummary {
    pub sample_count: usize,
    pub average_error_px: f64,
    pub maximum_error_px: f64,
    pub wrong_display_count: usize,
    pub out_of_bounds_count: usize,
    pub rating: AccuracyRating,
    pub passed: bool,
}

/// What the wizard is actually measuring, and therefore what it may demand.
///
/// The canonical Windows mapping is already verified at 0.00 px by
/// `display_mapping_native_targets` — the arithmetic is not in question. What a
/// person clicking nine rings measures is whether they and ArcSonare agree on
/// the same coordinate system, and that measurement carries irreducible human
/// noise: aiming, hand tremor, and where the eye reads the cursor hotspot.
///
/// Demanding a 4 px average of that is demanding better than a hand can hold.
/// A real run measured 4.2 px average with a 5.4 px maximum, on the correct
/// display, entirely in bounds — a good result that was reported as a failure
/// over 0.2 px. So there are two bars: one that says the geometry is sound, and
/// a stricter one worth reporting when the aim was unusually steady.
pub const EXCELLENT_AVERAGE_PX: f64 = 4.0;
pub const EXCELLENT_MAXIMUM_PX: f64 = 8.0;
pub const VALID_AVERAGE_PX: f64 = 6.0;
pub const VALID_MAXIMUM_PX: f64 = 10.0;

/// Kept as the pass bar, which is now the `Valid` tier.
pub const MAX_AVERAGE_ERROR_PX: f64 = VALID_AVERAGE_PX;
pub const MAX_SINGLE_ERROR_PX: f64 = VALID_MAXIMUM_PX;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccuracyRating {
    /// Steadier than a hand normally manages.
    Excellent,
    /// The geometry is sound. This is a pass.
    Valid,
    Failed,
}

impl AccuracyRating {
    pub fn passed(&self) -> bool {
        !matches!(self, Self::Failed)
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Excellent => "Excellent",
            Self::Valid => "Valid",
            Self::Failed => "Failed",
        }
    }
}

/// Rate a run. A point on the wrong display or off the monitor is never a pass,
/// however small the numbers look — those are not aiming errors.
pub fn rate(
    average: f64,
    maximum: f64,
    wrong_display: usize,
    out_of_bounds: usize,
    sample_count: usize,
) -> AccuracyRating {
    if sample_count == 0 || wrong_display > 0 || out_of_bounds > 0 {
        return AccuracyRating::Failed;
    }
    if average <= EXCELLENT_AVERAGE_PX && maximum <= EXCELLENT_MAXIMUM_PX {
        AccuracyRating::Excellent
    } else if average <= VALID_AVERAGE_PX && maximum <= VALID_MAXIMUM_PX {
        AccuracyRating::Valid
    } else {
        AccuracyRating::Failed
    }
}

/// Score a run against the thresholds.
///
/// Both must hold, and neither counter may be non-zero. An average inside
/// tolerance hides one wild miss, and one wild miss is a click somewhere the
/// user never asked for.
pub fn summarise(samples: &[DisplayMappingSample]) -> ValidationSummary {
    let wrong_display_count = samples.iter().filter(|s| s.wrong_display).count();
    let out_of_bounds_count = samples.iter().filter(|s| s.out_of_bounds).count();
    if samples.is_empty() {
        return ValidationSummary {
            sample_count: 0,
            average_error_px: 0.0,
            maximum_error_px: 0.0,
            wrong_display_count,
            out_of_bounds_count,
            rating: AccuracyRating::Failed,
            passed: false,
        };
    }
    let total: f64 = samples.iter().map(|s| s.error_distance).sum();
    let average = total / samples.len() as f64;
    let maximum = samples
        .iter()
        .map(|s| s.error_distance)
        .fold(0.0_f64, f64::max);
    let rating = rate(
        average,
        maximum,
        wrong_display_count,
        out_of_bounds_count,
        samples.len(),
    );
    ValidationSummary {
        sample_count: samples.len(),
        average_error_px: average,
        maximum_error_px: maximum,
        wrong_display_count,
        out_of_bounds_count,
        rating,
        passed: rating.passed(),
    }
}

/// Apply a display's stored correction to a point, exactly once.
///
/// **Display-local space only.** The correction was fitted from display-local
/// coordinates, so applying it to a virtual-desktop point would add the
/// monitor's origin into the transform's constant term — on the portrait display
/// at (−1080, −661) that is a thousand-pixel error, and it would look like a
/// calibration fault rather than a units mistake.
///
/// Callers convert to display-local, correct, then convert back. That ordering
/// is the documented chain and the only supported one; there is deliberately no
/// variant that takes a desktop point.
pub fn apply_correction_display_local(
    point: PhysicalPoint,
    correction: Option<&AffineTransform>,
) -> PhysicalPoint {
    match correction {
        // Identity is the overwhelmingly common case and must be free of any
        // rounding: a display that needs no correction returns the same point.
        None => point,
        Some(t) => t.apply(point),
    }
}

// ---------------------------------------------------------------------------
// Whether a fitted correction is worth keeping
// ---------------------------------------------------------------------------

/// How much better the candidate must be before it replaces identity.
const MIN_IMPROVEMENT: f64 = 0.20;

/// What a correction fitted from human clicks is allowed to look like.
///
/// The OS mapping is already correct, so any real correction should be tiny. A
/// fit that wants to rescale the display by 5% is fitting something other than
/// geometry, and applying it would be worse than applying nothing.
const MAX_SCALE_DEVIATION: f64 = 0.05;
const MAX_SHEAR: f64 = 0.02;
const MAX_OFFSET_PX: f64 = 50.0;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionDecision {
    /// `None` means identity was kept.
    pub applied: Option<AffineTransform>,
    pub identity_average_px: f64,
    pub candidate_average_px: f64,
    pub identity_maximum_px: f64,
    pub candidate_maximum_px: f64,
    /// Fraction by which the candidate lowered the average. Negative is worse.
    pub improvement: f64,
    pub reason: &'static str,
}

impl CorrectionDecision {
    pub fn identity_retained(reason: &'static str) -> Self {
        Self {
            applied: None,
            identity_average_px: 0.0,
            candidate_average_px: 0.0,
            identity_maximum_px: 0.0,
            candidate_maximum_px: 0.0,
            improvement: 0.0,
            reason,
        }
    }
}

fn plausible(t: &AffineTransform) -> bool {
    (t.a - 1.0).abs() <= MAX_SCALE_DEVIATION
        && (t.e - 1.0).abs() <= MAX_SCALE_DEVIATION
        && t.b.abs() <= MAX_SHEAR
        && t.d.abs() <= MAX_SHEAR
        && t.c.abs() <= MAX_OFFSET_PX
        && t.f.abs() <= MAX_OFFSET_PX
}

/// How much the displacement may vary before it stops being a constant shift.
///
/// A blunt instrument, kept only as a fast path: on a 1920 px-tall display the
/// noise-fitted linear terms of an otherwise-constant correction produce two or
/// three pixels of variation all by themselves, which is enough to slip past a
/// fixed tolerance. `is_translation_like` is the real test.
const CONSTANT_OFFSET_TOLERANCE_PX: f64 = 2.0;

/// Would a plain offset do the same job?
///
/// The decisive question, and one a tolerance in pixels cannot answer. Fit the
/// simplest possible competitor — the mean displacement, no position dependence
/// at all — and score both on the held-out points. If the constant does as well
/// or better, the candidate's extra degrees of freedom are fitting noise, and
/// what remains is a uniform shift: the operator's aim, not the display's
/// geometry.
///
/// Measured on the real portrait run: identity 6.11 px, full affine 2.39 px,
/// translation-only **2.01 px**. The affine was the more complicated model *and*
/// the worse one on points it had not seen.
fn is_translation_like(t: &AffineTransform, samples: &[DisplayMappingSample]) -> bool {
    if samples.len() < 3 {
        return true; // too little evidence to justify anything but a shift
    }
    let mean_dx = samples
        .iter()
        .map(|s| {
            let p = s.expected_desktop_point;
            t.apply(p).x - p.x
        })
        .sum::<f64>()
        / samples.len() as f64;
    let mean_dy = samples
        .iter()
        .map(|s| {
            let p = s.expected_desktop_point;
            t.apply(p).y - p.y
        })
        .sum::<f64>()
        / samples.len() as f64;
    let constant = AffineTransform {
        c: mean_dx,
        f: mean_dy,
        ..AffineTransform::IDENTITY
    };
    let (candidate_average, _) = score(samples, Some(t));
    let (constant_average, _) = score(samples, Some(&constant));
    // Within a hair counts as "no better": an affine that ties a translation has
    // bought nothing for its extra freedom.
    constant_average <= candidate_average * 1.05
}

/// Does this transform just move everything by the same amount?
///
/// Measured as the spread of the displacement it applies across the points that
/// were actually sampled, rather than by reading the coefficients — a scale of
/// 0.99895 sounds like a real scale error but over a 1080 px axis it is barely a
/// pixel, and it is the effect on this display that matters.
fn is_constant_offset(t: &AffineTransform, samples: &[DisplayMappingSample]) -> bool {
    if samples.is_empty() {
        return false;
    }
    let displacements: Vec<(f64, f64)> = samples
        .iter()
        .map(|s| {
            let p = s.expected_desktop_point;
            let moved = t.apply(p);
            (moved.x - p.x, moved.y - p.y)
        })
        .collect();
    let spread = |values: &[f64]| {
        let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        max - min
    };
    let xs: Vec<f64> = displacements.iter().map(|d| d.0).collect();
    let ys: Vec<f64> = displacements.iter().map(|d| d.1).collect();
    spread(&xs) <= CONSTANT_OFFSET_TOLERANCE_PX && spread(&ys) <= CONSTANT_OFFSET_TOLERANCE_PX
}

fn score(samples: &[DisplayMappingSample], t: Option<&AffineTransform>) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let errors: Vec<f64> = samples
        .iter()
        .map(|s| {
            let predicted = match t {
                Some(t) => t.apply(s.expected_desktop_point),
                None => s.expected_desktop_point,
            };
            predicted.distance_to(&s.actual_desktop_point)
        })
        .collect();
    let average = errors.iter().sum::<f64>() / errors.len() as f64;
    let maximum = errors.iter().fold(0.0_f64, |m, e| m.max(*e));
    (average, maximum)
}

/// Decide between identity and a fitted candidate, judged on points the fit
/// never saw.
///
/// A correction fitted from calibration clicks will always reproduce those
/// clicks well — a 0.9 px fit residual proves only that least squares works. The
/// question is whether it helps anywhere else, and the five validation points
/// are the only evidence available for that.
///
/// A real run fitted `x−0.89, 0.99895·y−3.28`: the operator's cursor-tip bias,
/// about to be written into the coordinate system for every future click. That
/// is worth refusing unless it demonstrably helps, because the bias belongs to
/// one person on one day, and the mapping outlives both.
pub fn choose_correction(
    candidate: Option<AffineTransform>,
    validation: &[DisplayMappingSample],
) -> CorrectionDecision {
    let Some(candidate) = candidate else {
        return CorrectionDecision::identity_retained("no correction was fitted");
    };
    if candidate.is_effectively_identity() {
        return CorrectionDecision::identity_retained("the fit was already identity");
    }
    if !plausible(&candidate) {
        return CorrectionDecision::identity_retained(
            "the fitted correction was too large to be geometry",
        );
    }
    if validation.is_empty() {
        return CorrectionDecision::identity_retained(
            "there were no independent points to judge it on",
        );
    }
    // The discriminator cross-validation cannot supply.
    //
    // A hand's aiming bias is *systematic*, not scattered — the same (-1, -3.3)
    // px on every point of a real run — so it generalises to held-out points
    // exactly as a genuine mapping error would, and improves them just as much.
    // Held-out accuracy therefore cannot tell the two apart.
    //
    // What can: `display_mapping_native_targets` independently proves the
    // overlay lands on its point at 0.00 px. There is no origin or scale error
    // for a correction to remove. So a candidate that is merely a constant shift
    // across the whole measured region is measuring where the operator's eye put
    // the cursor, and applying it would bias every future click by one person's
    // aim on one afternoon.
    //
    // A candidate that genuinely varies across the display is a different claim,
    // and is still allowed to prove itself below.
    if is_constant_offset(&candidate, validation) || is_translation_like(&candidate, validation) {
        return CorrectionDecision::identity_retained(
            "the correction is a constant shift, which is cursor-aiming bias — \
             overlay placement is independently verified at 0 px",
        );
    }

    let (identity_average, identity_maximum) = score(validation, None);
    let (candidate_average, candidate_maximum) = score(validation, Some(&candidate));
    let improvement = if identity_average > 0.0 {
        (identity_average - candidate_average) / identity_average
    } else {
        0.0
    };

    let mut decision = CorrectionDecision {
        applied: None,
        identity_average_px: identity_average,
        candidate_average_px: candidate_average,
        identity_maximum_px: identity_maximum,
        candidate_maximum_px: candidate_maximum,
        improvement,
        reason: "",
    };

    if candidate_maximum > identity_maximum {
        decision.reason = "the correction made the worst point worse";
        return decision;
    }
    if improvement < MIN_IMPROVEMENT {
        decision.reason = "the correction did not measurably improve accuracy";
        return decision;
    }
    decision.applied = Some(candidate);
    decision.reason = "the correction improved accuracy on independent points";
    decision
}

/// How many random points a validation run uses.
pub const RANDOM_VALIDATION_POINTS: usize = 5;

/// Random-ish validation targets, well inside the display and away from the
/// calibration points.
///
/// Deterministic from `seed` so a failing run can be replayed exactly. Reusing
/// the nine calibration points would test only that the fit reproduces its own
/// input, which it always does.
pub fn random_validation_targets(
    width: f64,
    height: f64,
    count: usize,
    seed: u64,
) -> Vec<PhysicalPoint> {
    let inset = inset_for(width, height);
    let usable_w = (width - inset * 2.0).max(1.0);
    let usable_h = (height - inset * 2.0).max(1.0);
    let calibration = nine_point_targets(width, height);
    // Far enough from a calibration point that it is a genuinely new position.
    let min_separation = (usable_w.min(usable_h) / 6.0).max(24.0);

    let mut state = seed | 1;
    let mut next = || {
        // xorshift64*: small, deterministic, and good enough to scatter points.
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        (state.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    };

    let mut points = Vec::with_capacity(count);
    let mut attempts = 0;
    while points.len() < count && attempts < count * 200 {
        attempts += 1;
        let candidate = PhysicalPoint::new(inset + next() * usable_w, inset + next() * usable_h);
        let too_close_to_calibration = calibration
            .iter()
            .any(|(_, p)| p.distance_to(&candidate) < min_separation);
        let too_close_to_chosen = points
            .iter()
            .any(|p: &PhysicalPoint| p.distance_to(&candidate) < min_separation);
        if !too_close_to_calibration && !too_close_to_chosen {
            points.push(candidate);
        }
    }
    // A very small display may not fit `count` well-separated points. Returning
    // fewer is honest; the summary counts what was actually measured.
    points
}

#[cfg(test)]
mod tests {
    use super::*;

    const ULTRAWIDE: (f64, f64) = (3840.0, 1080.0);
    const PORTRAIT: (f64, f64) = (1080.0, 1920.0);

    fn sample(expected: PhysicalPoint, actual: PhysicalPoint) -> DisplayMappingSample {
        DisplayMappingSample::new("s".into(), expected, expected, actual, 0, false, false)
    }

    // -----------------------------------------------------------------------
    // Target generation
    // -----------------------------------------------------------------------

    #[test]
    fn there_are_exactly_nine_targets_in_reading_order() {
        let targets = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1);
        assert_eq!(targets.len(), 9);
        assert_eq!(targets[0].0, TargetPosition::TopLeft);
        assert_eq!(targets[4].0, TargetPosition::Center);
        assert_eq!(targets[8].0, TargetPosition::BottomRight);
    }

    #[test]
    fn no_target_sits_on_the_outermost_pixels() {
        // Windows reserves the very corner for Show Desktop, so a click there
        // never reaches the target and the sample would be pure noise.
        for (w, h) in [ULTRAWIDE, PORTRAIT, (1024.0, 768.0)] {
            for (position, p) in nine_point_targets(w, h) {
                assert!(
                    p.x >= MIN_INSET && p.y >= MIN_INSET,
                    "{position:?} at {p:?} is too close to the top-left edge of {w}x{h}"
                );
                assert!(
                    p.x <= w - MIN_INSET && p.y <= h - MIN_INSET,
                    "{position:?} at {p:?} is too close to the bottom-right edge of {w}x{h}"
                );
            }
        }
    }

    #[test]
    fn targets_stay_inside_a_small_display() {
        let (w, h) = (640.0, 480.0);
        let inset = inset_for(w, h);
        assert!(
            inset < DEFAULT_INSET,
            "the inset must shrink with the display"
        );
        for (_, p) in nine_point_targets(w, h) {
            assert!(p.x > 0.0 && p.x < w && p.y > 0.0 && p.y < h);
        }
    }

    #[test]
    fn the_nine_targets_are_all_distinct_positions() {
        let targets = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1);
        for (i, (_, a)) in targets.iter().enumerate() {
            for (_, b) in targets.iter().skip(i + 1) {
                assert!(a.distance_to(b) > 1.0, "two targets coincide at {a:?}");
            }
        }
    }

    #[test]
    fn a_portrait_display_spreads_targets_down_its_long_axis() {
        let targets = nine_point_targets(PORTRAIT.0, PORTRAIT.1);
        let top = targets[0].1;
        let bottom = targets[8].1;
        assert!(
            bottom.y - top.y > PORTRAIT.1 / 2.0,
            "the targets do not span the tall axis"
        );
    }

    /// The second monitor on this machine sits at (-1080, -661).
    #[test]
    fn a_negative_origin_monitor_maps_into_negative_desktop_space() {
        let targets = nine_point_targets(PORTRAIT.0, PORTRAIT.1);
        let (_, local) = targets[0];
        let desktop = to_desktop(local, -1080, -661);
        assert_eq!(desktop.x, local.x - 1080.0);
        assert_eq!(desktop.y, local.y - 661.0);
        assert!(
            desktop.x < 0.0 && desktop.y < 0.0,
            "the top-left target of a monitor left of and above the primary is negative"
        );
    }

    #[test]
    fn the_centre_target_is_the_centre_of_the_display() {
        let targets = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1);
        let centre = targets[4].1;
        assert!((centre.x - ULTRAWIDE.0 / 2.0).abs() < 0.001);
        assert!((centre.y - ULTRAWIDE.1 / 2.0).abs() < 0.001);
    }

    // -----------------------------------------------------------------------
    // Error arithmetic
    // -----------------------------------------------------------------------

    #[test]
    fn an_error_is_reported_per_axis_and_as_a_distance() {
        let s = sample(
            PhysicalPoint::new(100.0, 100.0),
            PhysicalPoint::new(103.0, 104.0),
        );
        assert_eq!((s.error_x, s.error_y), (3.0, 4.0));
        assert!((s.error_distance - 5.0).abs() < 1e-9);
    }

    // -----------------------------------------------------------------------
    // Fitting
    // -----------------------------------------------------------------------

    #[test]
    fn a_perfect_run_fits_the_identity_transform() {
        let pairs: Vec<_> = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1)
            .into_iter()
            .map(|(_, p)| (p, p))
            .collect();
        let fit = fit_affine(&pairs).expect("nine spread points must determine a fit");
        assert!(
            fit.is_effectively_identity(),
            "a display that needs no correction must not be given one: {fit:?}"
        );
    }

    #[test]
    fn a_constant_offset_is_recovered_exactly() {
        let pairs: Vec<_> = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1)
            .into_iter()
            .map(|(_, p)| (p, PhysicalPoint::new(p.x + 12.0, p.y - 7.0)))
            .collect();
        let fit = fit_affine(&pairs).unwrap();
        assert!((fit.c - 12.0).abs() < 1e-6, "x offset: {fit:?}");
        assert!((fit.f + 7.0).abs() < 1e-6, "y offset: {fit:?}");
        assert!(!fit.is_effectively_identity());
    }

    #[test]
    fn a_scale_error_is_recovered() {
        let pairs: Vec<_> = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1)
            .into_iter()
            .map(|(_, p)| (p, PhysicalPoint::new(p.x * 1.25, p.y * 1.25)))
            .collect();
        let fit = fit_affine(&pairs).unwrap();
        assert!((fit.a - 1.25).abs() < 1e-6);
        assert!((fit.e - 1.25).abs() < 1e-6);
    }

    #[test]
    fn a_fit_cannot_be_made_from_two_points() {
        let p = PhysicalPoint::new(0.0, 0.0);
        assert!(fit_affine(&[(p, p), (p, p)]).is_none());
    }

    #[test]
    fn collinear_points_do_not_determine_a_transform() {
        // Every point on one line: infinitely many affine maps fit equally well,
        // and picking one would invent a correction perpendicular to the line.
        let pairs: Vec<_> = (0..9)
            .map(|i| {
                let p = PhysicalPoint::new(i as f64 * 100.0, 500.0);
                (p, p)
            })
            .collect();
        assert!(fit_affine(&pairs).is_none());
    }

    #[test]
    fn a_transform_and_its_inverse_round_trip() {
        let t = AffineTransform {
            a: 1.02,
            b: 0.01,
            c: 12.0,
            d: -0.005,
            e: 0.99,
            f: -7.0,
        };
        let inverse = t.inverse().expect("a well-conditioned transform inverts");
        let p = PhysicalPoint::new(1234.0, 567.0);
        let round_tripped = inverse.apply(t.apply(p));
        assert!(round_tripped.distance_to(&p) < 1e-6);
    }

    #[test]
    fn a_degenerate_transform_has_no_inverse() {
        let flat = AffineTransform {
            a: 0.0,
            b: 0.0,
            c: 0.0,
            d: 0.0,
            e: 0.0,
            f: 0.0,
        };
        assert!(flat.inverse().is_none());
    }

    #[test]
    fn sub_pixel_jitter_is_treated_as_identity() {
        let jittery = AffineTransform {
            a: 1.0000001,
            b: 0.0,
            c: 0.2,
            d: 0.0,
            e: 1.0,
            f: -0.3,
        };
        assert!(
            jittery.is_effectively_identity(),
            "storing measurement noise as a correction makes later clicks worse"
        );
    }

    // -----------------------------------------------------------------------
    // Outliers
    // -----------------------------------------------------------------------

    #[test]
    fn one_wild_misclick_is_rejected() {
        let mut samples: Vec<_> = (0..8)
            .map(|i| {
                let p = PhysicalPoint::new(i as f64 * 100.0, 100.0);
                sample(p, PhysicalPoint::new(p.x + 1.0, p.y))
            })
            .collect();
        let p = PhysicalPoint::new(900.0, 100.0);
        samples.push(sample(p, PhysicalPoint::new(p.x + 300.0, p.y)));
        let rejected = reject_outliers(&samples);
        assert_eq!(
            rejected,
            vec![8],
            "the 300px miss should be the only reject"
        );
    }

    #[test]
    fn a_tight_run_loses_nothing() {
        let samples: Vec<_> = (0..9)
            .map(|i| {
                let p = PhysicalPoint::new(i as f64 * 100.0, 100.0);
                sample(p, PhysicalPoint::new(p.x + 0.5, p.y + 0.5))
            })
            .collect();
        assert!(
            reject_outliers(&samples).is_empty(),
            "a good run must not have samples discarded"
        );
    }

    #[test]
    fn a_uniformly_bad_run_is_not_rescued_by_discarding_samples() {
        // Everything is 40px out: that is a broken mapping, not nine outliers.
        // Throwing them away would turn a clear failure into a clean pass.
        let samples: Vec<_> = (0..9)
            .map(|i| {
                let p = PhysicalPoint::new(i as f64 * 100.0, 100.0);
                sample(p, PhysicalPoint::new(p.x + 40.0, p.y))
            })
            .collect();
        assert!(reject_outliers(&samples).is_empty());
        assert!(!summarise(&samples).passed);
    }

    #[test]
    fn outlier_rejection_never_leaves_too_few_samples_to_mean_anything() {
        let mut samples = vec![
            sample(PhysicalPoint::new(0.0, 0.0), PhysicalPoint::new(0.0, 0.0)),
            sample(PhysicalPoint::new(10.0, 0.0), PhysicalPoint::new(10.0, 0.0)),
        ];
        samples.push(sample(
            PhysicalPoint::new(20.0, 0.0),
            PhysicalPoint::new(920.0, 0.0),
        ));
        samples.push(sample(
            PhysicalPoint::new(30.0, 0.0),
            PhysicalPoint::new(930.0, 0.0),
        ));
        assert!(reject_outliers(&samples).is_empty());
    }

    // -----------------------------------------------------------------------
    // Thresholds
    // -----------------------------------------------------------------------

    #[test]
    fn a_clean_run_passes() {
        let samples: Vec<_> = (0..9)
            .map(|i| {
                let p = PhysicalPoint::new(i as f64 * 100.0, 100.0);
                sample(p, PhysicalPoint::new(p.x + 1.0, p.y + 1.0))
            })
            .collect();
        let summary = summarise(&samples);
        assert!(summary.passed);
        assert!(summary.average_error_px < MAX_AVERAGE_ERROR_PX);
        assert_eq!(summary.sample_count, 9);
    }

    #[test]
    fn a_single_wild_miss_fails_a_run_with_a_good_average() {
        let mut samples: Vec<_> = (0..8)
            .map(|i| {
                let p = PhysicalPoint::new(i as f64 * 100.0, 100.0);
                sample(p, p)
            })
            .collect();
        let p = PhysicalPoint::new(900.0, 100.0);
        samples.push(sample(p, PhysicalPoint::new(p.x + 30.0, p.y)));
        let summary = summarise(&samples);
        assert!(summary.average_error_px <= MAX_AVERAGE_ERROR_PX);
        assert!(summary.maximum_error_px > MAX_SINGLE_ERROR_PX);
        assert!(!summary.passed);
    }

    #[test]
    fn a_click_on_the_wrong_display_fails_the_run_outright() {
        let p = PhysicalPoint::new(100.0, 100.0);
        let mut s = sample(p, p);
        s.wrong_display = true;
        let summary = summarise(&[s]);
        assert_eq!(summary.wrong_display_count, 1);
        assert!(
            !summary.passed,
            "zero error on the wrong monitor is not a pass"
        );
    }

    #[test]
    fn an_out_of_bounds_click_fails_the_run() {
        let p = PhysicalPoint::new(100.0, 100.0);
        let mut s = sample(p, p);
        s.out_of_bounds = true;
        assert!(!summarise(&[s]).passed);
    }

    #[test]
    fn a_run_with_no_samples_is_not_a_pass() {
        assert!(!summarise(&[]).passed);
        assert_eq!(summarise(&[]).rating, AccuracyRating::Failed);
    }

    // -----------------------------------------------------------------------
    // Accuracy tiers
    // -----------------------------------------------------------------------

    /// The measured result that was wrongly reported as a failure.
    #[test]
    fn the_real_four_point_two_run_is_a_pass() {
        let rating = rate(4.16, 5.36, 0, 0, 5);
        assert_eq!(
            rating,
            AccuracyRating::Valid,
            "4.2px average with a 5.4px maximum, on the right display and in \
             bounds, is a good manual run — failing it over 0.16px is measuring \
             the hand, not the geometry"
        );
        assert!(rating.passed());
    }

    #[test]
    fn a_very_steady_run_is_rated_excellent() {
        assert_eq!(rate(1.2, 3.0, 0, 0, 5), AccuracyRating::Excellent);
    }

    #[test]
    fn a_run_past_the_valid_bar_still_fails() {
        assert_eq!(rate(6.1, 9.0, 0, 0, 5), AccuracyRating::Failed);
        assert_eq!(rate(3.0, 10.5, 0, 0, 5), AccuracyRating::Failed);
    }

    /// These are not aiming errors, so no tolerance applies to them.
    #[test]
    fn the_wrong_display_or_out_of_bounds_never_passes() {
        assert_eq!(rate(0.1, 0.2, 1, 0, 5), AccuracyRating::Failed);
        assert_eq!(rate(0.1, 0.2, 0, 1, 5), AccuracyRating::Failed);
    }

    #[test]
    fn the_excellent_bar_is_stricter_than_the_valid_bar() {
        assert!(EXCELLENT_AVERAGE_PX < VALID_AVERAGE_PX);
        assert!(EXCELLENT_MAXIMUM_PX < VALID_MAXIMUM_PX);
    }

    // -----------------------------------------------------------------------
    // Identity versus a fitted correction
    // -----------------------------------------------------------------------

    fn validation_at(offsets: &[(f64, f64)]) -> Vec<DisplayMappingSample> {
        offsets
            .iter()
            .enumerate()
            .map(|(i, (dx, dy))| {
                let expected = PhysicalPoint::new(200.0 + i as f64 * 300.0, 400.0);
                sample(
                    expected,
                    PhysicalPoint::new(expected.x + dx, expected.y + dy),
                )
            })
            .collect()
    }

    /// The transform actually fitted on the real run: the operator's cursor-tip
    /// bias. It reproduced the calibration points to 0.9px and is exactly the
    /// kind of thing that must not be written into the coordinate system.
    #[test]
    fn a_cursor_bias_fitted_from_clicks_is_not_kept_without_evidence() {
        let measured = AffineTransform {
            a: 1.0,
            b: 0.0,
            c: -0.89,
            d: 0.00027,
            e: 0.99895,
            f: -3.28,
        };
        // Scattered human aim, not a repeatable offset.
        let validation = validation_at(&[
            (2.0, -5.0),
            (-4.0, 3.0),
            (1.0, -6.0),
            (-2.0, 4.0),
            (3.0, -2.0),
        ]);
        let decision = choose_correction(Some(measured), &validation);
        assert!(
            decision.applied.is_none(),
            "identity must be retained: {}",
            decision.reason
        );
    }

    /// Points whose x is scaled by `factor` — an error that grows across the
    /// display, which is what a real geometry fault looks like and what a hand's
    /// bias does not.
    fn scaled_validation(factors: &[f64]) -> Vec<DisplayMappingSample> {
        factors
            .iter()
            .enumerate()
            .map(|(i, factor)| {
                let expected = PhysicalPoint::new(200.0 + i as f64 * 300.0, 400.0);
                sample(
                    expected,
                    PhysicalPoint::new(expected.x * factor, expected.y),
                )
            })
            .collect()
    }

    #[test]
    fn a_correction_that_genuinely_helps_is_applied() {
        // A 0.2% scale error: 0.4px at one edge, 2.8px at the other. Only a
        // transform can express that, so it is not aiming bias.
        let validation = scaled_validation(&[1.002; 5]);
        let candidate = AffineTransform {
            a: 1.002,
            ..AffineTransform::IDENTITY
        };
        let decision = choose_correction(Some(candidate), &validation);
        assert!(decision.applied.is_some(), "{}", decision.reason);
        assert!(decision.improvement > 0.9);
        assert!(decision.candidate_average_px < 0.001);
    }

    #[test]
    fn a_correction_that_worsens_the_worst_point_is_refused() {
        // Four points scaled up, one scaled down. The candidate lowers the
        // average but doubles the worst miss.
        let validation = scaled_validation(&[1.004, 1.004, 1.004, 1.004, 0.996]);
        let candidate = AffineTransform {
            a: 1.004,
            ..AffineTransform::IDENTITY
        };
        let decision = choose_correction(Some(candidate), &validation);
        assert!(decision.applied.is_none());
        assert_eq!(decision.reason, "the correction made the worst point worse");
    }

    /// The rule the real run forced into existence.
    ///
    /// A constant shift generalises perfectly to held-out points, so
    /// cross-validation alone accepts it. It is still aiming bias, because the
    /// overlay is independently verified at 0.00 px and there is no origin error
    /// left for a translation to remove.
    #[test]
    fn a_constant_shift_is_refused_however_well_it_cross_validates() {
        let validation = validation_at(&[(-1.0, -3.3); 5]);
        let candidate = AffineTransform {
            c: -1.0,
            f: -3.3,
            ..AffineTransform::IDENTITY
        };
        let decision = choose_correction(Some(candidate), &validation);
        assert!(
            decision.applied.is_none(),
            "a perfect constant fit must still be refused: {}",
            decision.reason
        );
        assert!(decision.reason.contains("cursor-aiming bias"));
    }

    #[test]
    fn an_implausibly_large_correction_is_refused_outright() {
        let candidate = AffineTransform {
            a: 1.4,
            ..AffineTransform::IDENTITY
        };
        let decision = choose_correction(Some(candidate), &validation_at(&[(0.0, 0.0); 5]));
        assert!(decision.applied.is_none());
        assert_eq!(
            decision.reason,
            "the fitted correction was too large to be geometry"
        );
    }

    #[test]
    fn identity_is_kept_when_there_is_nothing_to_judge_a_candidate_on() {
        let candidate = AffineTransform {
            c: 5.0,
            ..AffineTransform::IDENTITY
        };
        assert!(choose_correction(Some(candidate), &[]).applied.is_none());
        assert!(choose_correction(None, &validation_at(&[(0.0, 0.0); 5]))
            .applied
            .is_none());
    }

    /// A fit that reproduces its own input tells us nothing on its own.
    #[test]
    fn a_low_fit_residual_alone_does_not_justify_a_correction() {
        let calibration: Vec<_> = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1)
            .into_iter()
            .map(|(_, p)| (p, PhysicalPoint::new(p.x - 0.9, p.y - 3.3)))
            .collect();
        let fitted = fit_affine(&calibration).unwrap();
        // The fit reproduces its own points almost exactly …
        let residual: f64 = calibration
            .iter()
            .map(|(from, to)| fitted.apply(*from).distance_to(to))
            .sum::<f64>()
            / calibration.len() as f64;
        assert!(residual < 1.0, "residual {residual}");
        // … but scattered aim on fresh points does not reward it.
        let validation = validation_at(&[
            (3.0, -7.0),
            (-5.0, 2.0),
            (0.0, -9.0),
            (4.0, 5.0),
            (-3.0, -1.0),
        ]);
        assert!(choose_correction(Some(fitted), &validation)
            .applied
            .is_none());
    }

    // -----------------------------------------------------------------------
    // Random validation
    // -----------------------------------------------------------------------

    #[test]
    fn random_validation_produces_the_requested_number_of_points() {
        let points =
            random_validation_targets(ULTRAWIDE.0, ULTRAWIDE.1, RANDOM_VALIDATION_POINTS, 42);
        assert_eq!(points.len(), RANDOM_VALIDATION_POINTS);
    }

    #[test]
    fn random_targets_stay_inside_the_display() {
        for (w, h) in [ULTRAWIDE, PORTRAIT] {
            for p in random_validation_targets(w, h, RANDOM_VALIDATION_POINTS, 7) {
                assert!(p.x > 0.0 && p.x < w, "{p:?} escaped {w}x{h}");
                assert!(p.y > 0.0 && p.y < h, "{p:?} escaped {w}x{h}");
            }
        }
    }

    #[test]
    fn random_targets_are_not_the_calibration_points_again() {
        // Re-measuring the fit's own input proves only that least squares works.
        let calibration = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1);
        for p in random_validation_targets(ULTRAWIDE.0, ULTRAWIDE.1, RANDOM_VALIDATION_POINTS, 3) {
            for (position, c) in &calibration {
                assert!(
                    c.distance_to(&p) > 20.0,
                    "{p:?} is effectively the {position:?} calibration point"
                );
            }
        }
    }

    #[test]
    fn the_same_seed_replays_the_same_targets() {
        // A failed run has to be reproducible or its diagnostics are guesswork.
        let a = random_validation_targets(ULTRAWIDE.0, ULTRAWIDE.1, 5, 99);
        let b = random_validation_targets(ULTRAWIDE.0, ULTRAWIDE.1, 5, 99);
        assert_eq!(a, b);
        assert_ne!(
            a,
            random_validation_targets(ULTRAWIDE.0, ULTRAWIDE.1, 5, 100)
        );
    }

    #[test]
    fn a_fitted_correction_reduces_the_error_it_was_fitted_for() {
        // End to end: a display reporting a constant 12,-7 offset should, after
        // fitting, predict fresh points within tolerance.
        let targets = nine_point_targets(ULTRAWIDE.0, ULTRAWIDE.1);
        let pairs: Vec<_> = targets
            .iter()
            .map(|(_, p)| (*p, PhysicalPoint::new(p.x + 12.0, p.y - 7.0)))
            .collect();
        let fit = fit_affine(&pairs).unwrap();

        let checks = random_validation_targets(ULTRAWIDE.0, ULTRAWIDE.1, 5, 11);
        let samples: Vec<_> = checks
            .iter()
            .map(|p| {
                let observed = PhysicalPoint::new(p.x + 12.0, p.y - 7.0);
                sample(fit.apply(*p), observed)
            })
            .collect();
        let summary = summarise(&samples);
        assert!(
            summary.passed,
            "the fitted correction did not generalise: {summary:?}"
        );
    }
}
