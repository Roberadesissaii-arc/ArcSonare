//! Overlay geometry constants (logical pixels). Adjust here to reshape the capsule.

/// Visible capsule width.
pub const OVERLAY_CAPSULE_WIDTH: f64 = 600.0;
/// Visible capsule height (collapsed).
pub const OVERLAY_CAPSULE_HEIGHT: f64 = 88.0;
/// Transparent shadow gutter on each side (and bottom).
/// Keep at 0 on Windows so the native window matches the capsule exactly —
/// non-zero transparent gutters often paint as a visible gray rectangle.
pub const OVERLAY_SHADOW_GUTTER: f64 = 0.0;
/// Distance from the physical top of the monitor to the top of the native window.
pub const OVERLAY_TOP_OFFSET: f64 = 16.0;

/// Native window width = capsule + left/right gutters.
pub const OVERLAY_WINDOW_WIDTH: f64 = OVERLAY_CAPSULE_WIDTH + OVERLAY_SHADOW_GUTTER * 2.0;
/// Native window height when collapsed = capsule + bottom gutter.
pub const OVERLAY_WINDOW_HEIGHT: f64 = OVERLAY_CAPSULE_HEIGHT + OVERLAY_SHADOW_GUTTER;

/// Minimum / maximum expanded content heights (content only, not including header).
pub const OVERLAY_EXPANDED_MIN: f64 = 180.0;
pub const OVERLAY_EXPANDED_MAX: f64 = 460.0;
