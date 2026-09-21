//! Purple outline drawn around whatever the vision model matched.
//!
//! The pointer alone shows *where* ArcSonare is about to click but not *what*
//! it thinks it found. Outlining the matched box makes a bad match visible
//! before the click lands instead of after.
//!
//! Drawn natively rather than in a webview: see native_overlay.rs for why.
//!
//! ## Why this does not call the overlay
//!
//! An outline is a claim about a place on a screen, so it answers to the same
//! gate as a click. This used to check the gate and then call
//! `native_overlay::show_highlight` — correct, but only because someone
//! remembered to write the check. Now the only way to reach the overlay is to
//! hold an `AuthorizedRect`, which only the profile gate issues. Deleting the
//! gate call no longer produces a working command that draws on an unverified
//! display; it produces a compile error.
//!
//! The payload is four integers. It cannot carry an authority, cannot construct
//! one, and has no field that skips the check — there is nothing to forge.

#![cfg(windows)]

use tauri::AppHandle;

use crate::display::gate;
use crate::display::interaction_error::DisplayInteractionError;
use crate::display::side_effects::{DesktopRect, NativeSideEffects, VisualSideEffects};

/// Outline a region given in virtual-desktop physical pixels.
///
/// The rectangle arrives final: the frontend gets it from a resolved visual
/// target, which `visual_commands` has already corrected. No correction is
/// applied here — doing it twice is its own bug.
#[tauri::command]
pub fn agent_highlight_show(
    app: AppHandle,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), DisplayInteractionError> {
    let authorized = gate::authorize_desktop_rect(
        &app,
        DesktopRect {
            x,
            y,
            width,
            height,
        },
    )?;
    crate::native_overlay::init();
    NativeSideEffects.show_overlay(authorized).map_err(|e| {
        // The gate said yes and the draw still failed: a native problem, not a
        // permission one. Reported with the overlay's own words rather than
        // dressed up as a display refusal the user could act on.
        let mut err = DisplayInteractionError::new(
            crate::display::interaction_error::DisplayInteractionErrorCode::DisplayIdentityMismatch,
        );
        err.message = e;
        err
    })
}

/// Cleanup stays unauthorized on purpose.
///
/// Hiding an outline removes something from the screen rather than putting
/// something on it, and it has to remain callable on every refusal path —
/// including the paths where no authority was ever issued.
#[tauri::command]
pub fn agent_highlight_hide(_app: AppHandle) -> Result<(), String> {
    crate::native_overlay::hide_highlight();
    Ok(())
}
