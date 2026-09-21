//! The one door into the visual side-effect backend.
//!
//! `visual_commands` reaches an `AuthorizedRect` by resolving a frame. Two
//! production routes have no frame and never did — the frontend's outline
//! command, and the structured Desktop highlight, both of which already know
//! their rectangle in final desktop pixels. Until now they called
//! `require_verified_display_at` and then `native_overlay::show_highlight`
//! directly: correct, but correct by discipline, and a `String` refusal at the
//! end of it.
//!
//! This gives them the same authority `visual_commands` gets, from the same
//! profile gate, with a typed refusal — and takes away the reason to call the
//! overlay directly.
//!
//! ## Coordinate contract
//!
//! Everything here takes **final virtual-desktop physical pixels**. The caller
//! has already arrived at the exact rectangle it means: the Shell list-view
//! reports icon bounds in that space, and the frontend's outline comes from a
//! resolved visual target which `visual_commands` has *already* corrected. So
//! nothing in this module applies a profile correction. Applying one here would
//! be the double-correction bug — a second offset on a coordinate that was
//! already moved, which on the portrait display at (−1080, −661) is exactly the
//! class of error the correction exists to remove.
//!
//! The profile is consulted only to decide *whether* the display may be drawn
//! on, never to move the rectangle.

#![cfg(windows)]

use tauri::{AppHandle, Runtime};

use super::authority::{AuthorizedPoint, AuthorizedRect, VisualExecutionAuthority};
use super::identity::MonitorIdentity;
use super::interaction_error::{
    DisplayInteractionError, DisplayInteractionErrorCode, DisplayInteractionErrorDetails,
    GeometrySnapshot,
};
use super::side_effects::DesktopRect;

/// Which monitor contains a point.
///
/// Never the nearest, never the primary, never clamped. A point on no monitor is
/// its own refusal — the fallbacks are precisely what put clicks on the wrong
/// screen.
fn containing(identities: &[MonitorIdentity], x: i32, y: i32) -> Option<&MonitorIdentity> {
    identities
        .iter()
        .find(|i| x >= i.x && y >= i.y && x < i.x + i.width as i32 && y < i.y + i.height as i32)
}

/// The monitor as it is now.
///
/// `MonitorIdentity` carries the hardware identity and the bounds; scale and
/// rotation live on the topology's geometry, so they are looked up separately
/// and default to the unrotated 1.0 case when the topology cannot be read.
fn snapshot(i: &MonitorIdentity) -> GeometrySnapshot {
    let (scale_factor, rotation_degrees) = super::topology::read_topology()
        .ok()
        .and_then(|t| {
            t.displays
                .iter()
                .find(|d| d.x == i.x && d.y == i.y)
                .map(|d| (d.scale_factor, d.rotation as i32))
        })
        .unwrap_or((1.0, 0));
    GeometrySnapshot {
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
        scale_factor,
        rotation_degrees,
    }
}

/// Fill in what the UI needs to explain the refusal, from the store.
///
/// Best-effort: a refusal must still be returned when the store cannot be read,
/// because failing to explain a refusal is not a reason to allow the action.
fn enrich<R: Runtime>(
    app: &AppHandle<R>,
    identity: &MonitorIdentity,
    mut error: DisplayInteractionError,
) -> DisplayInteractionError {
    let key = identity.stable_key();
    let mut details = DisplayInteractionErrorDetails {
        display_name: (!identity.friendly_name.is_empty()).then(|| identity.friendly_name.clone()),
        current_geometry: Some(snapshot(identity)),
        ..Default::default()
    };

    if let Ok(dir) = super::wizard::config_dir_for_gate(app) {
        let stored = super::profile_store::load_from(&dir).0;
        if let Some(p) = stored.get(&key) {
            details.saved_geometry = Some(GeometrySnapshot {
                x: p.physical_bounds.x,
                y: p.physical_bounds.y,
                width: p.physical_bounds.width,
                height: p.physical_bounds.height,
                scale_factor: p.scale_factor,
                rotation_degrees: p.rotation_degrees,
            });
            details.average_error_px = Some(p.average_error_px);
            details.maximum_error_px = Some(p.maximum_error_px);
            details.last_checked_ms = Some(p.validated_at_ms);
            if details.display_name.is_none() {
                details.display_name = p.friendly_name.clone();
            }
            // The same three comparisons the gate enforces, so what the user
            // is shown and what refused the action cannot drift apart.
            details.changed_properties = super::wizard::changed_properties(p, identity);
        }
    }

    error.stable_identity = Some(key);
    error.display_id = (!identity.friendly_name.is_empty())
        .then(|| identity.friendly_name.clone())
        .or(error.display_id.take());
    error.details = Some(details);
    error
}

/// The gate, for a caller that already has a final desktop coordinate.
///
/// Returns an authority covering the monitor the point is on, or a typed
/// refusal. Everything downstream needs the authority to do anything, so a
/// refusal here reaches no native call by construction rather than by ordering.
fn authority_at<R: Runtime>(
    app: &AppHandle<R>,
    x: i32,
    y: i32,
) -> Result<VisualExecutionAuthority, DisplayInteractionError> {
    let identities = super::identity::enumerate_monitor_identities().map_err(|_| {
        DisplayInteractionError::new(DisplayInteractionErrorCode::DisplayIdentityMismatch)
    })?;
    let Some(identity) = containing(&identities, x, y) else {
        return Err(DisplayInteractionError::new(
            DisplayInteractionErrorCode::TargetOutsideConnectedDisplay,
        ));
    };

    // The same gate `visual_commands` uses. Not a second implementation: the
    // decision comes from `evaluate_profile_gate` either way.
    if let Err(code) = super::wizard::profile_gate_for_identity(app, identity) {
        return Err(enrich(
            app,
            identity,
            DisplayInteractionError::from_gate_code(code),
        ));
    }

    let topology = super::topology::read_topology().map_err(|_| {
        DisplayInteractionError::new(DisplayInteractionErrorCode::DisplayIdentityMismatch)
    })?;
    // The runtime display id for this monitor, so the authority's bounds match
    // what the topology says rather than what the identity enumeration says.
    let geometry = topology
        .displays
        .iter()
        .find(|d| d.x == identity.x && d.y == identity.y)
        .copied()
        .ok_or_else(|| {
            enrich(
                app,
                identity,
                DisplayInteractionError::new(DisplayInteractionErrorCode::DisplayIdentityMismatch),
            )
        })?;

    Ok(VisualExecutionAuthority::issue(
        geometry.display_id,
        geometry,
        topology.version,
    ))
}

/// Authorize a rectangle that is already in final desktop pixels.
///
/// The rectangle is gated on the display containing its **centre**, because a
/// rectangle belongs to where it is rather than where it starts — an icon whose
/// top-left corner sits one pixel onto a neighbouring monitor is still on the
/// monitor it is drawn on.
pub fn authorize_desktop_rect<R: Runtime>(
    app: &AppHandle<R>,
    rect: DesktopRect,
) -> Result<AuthorizedRect, DisplayInteractionError> {
    if rect.width <= 0 || rect.height <= 0 {
        return Err(DisplayInteractionError::new(
            DisplayInteractionErrorCode::TargetOutsideConnectedDisplay,
        ));
    }
    let (cx, cy) = (rect.x + rect.width / 2, rect.y + rect.height / 2);
    let authority = authority_at(app, cx, cy)?;
    let version = authority.topology_version().to_string();
    authority
        .authorize_rect(rect, &version)
        .map_err(DisplayInteractionError::from)
}

/// Authorize a point that is already in final desktop pixels.
pub fn authorize_desktop_point<R: Runtime>(
    app: &AppHandle<R>,
    x: i32,
    y: i32,
) -> Result<AuthorizedPoint, DisplayInteractionError> {
    let authority = authority_at(app, x, y)?;
    let version = authority.topology_version().to_string();
    authority
        .authorize_point(x, y, &version)
        .map_err(DisplayInteractionError::from)
}
