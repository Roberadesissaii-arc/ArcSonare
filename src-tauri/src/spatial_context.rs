//! Draw-on-screen spatial context.
//!
//! "Analyse a screenshot" and "look HERE in this screenshot" are different
//! problems. The model can do the first perfectly well and has no way to do the
//! second, so the user ends up cropping and annotating by hand. Arming draw
//! mode turns the cursor red, lets them circle a region, and hands that region
//! over as the context for the next request.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DrawnRegion {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Arm draw mode. The next drag marks a region; right-click cancels.
#[tauri::command]
pub fn spatial_arm_draw() -> Result<(), String> {
    #[cfg(windows)]
    return crate::native_overlay::arm_draw();
    #[cfg(not(windows))]
    Err("Drawing on screen is only available on Windows.".into())
}

/// Collect the region from the last completed stroke, if any.
///
/// Taking it clears it: a region left lying around would silently attach
/// itself to some later, unrelated question.
#[tauri::command]
pub fn spatial_take_region() -> Option<DrawnRegion> {
    #[cfg(windows)]
    {
        crate::native_overlay::take_drawn_region().map(|(x, y, width, height)| DrawnRegion {
            x,
            y,
            width,
            height,
        })
    }
    #[cfg(not(windows))]
    None
}

#[tauri::command]
pub fn spatial_is_armed() -> bool {
    #[cfg(windows)]
    return crate::native_overlay::is_draw_armed();
    #[cfg(not(windows))]
    false
}

/// Paint a stroke without a mouse, so the drawing path can be verified.
#[tauri::command]
pub fn spatial_test_stroke(points: Vec<(i32, i32)>) -> Option<DrawnRegion> {
    #[cfg(windows)]
    {
        crate::native_overlay::test_stroke(points).map(|(x, y, width, height)| DrawnRegion {
            x,
            y,
            width,
            height,
        })
    }
    #[cfg(not(windows))]
    None
}
