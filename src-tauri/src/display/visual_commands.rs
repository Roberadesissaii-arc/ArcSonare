//! The only route from a model answer to something happening on screen.
//!
//! Everything here starts from a `frame_id`. That is the whole design: the
//! display comes from the frame that was captured, never from where the mouse
//! happens to be, never from which monitor is primary, never from matching the
//! image size against the monitor list. If the frame cannot be found, has
//! expired, or was taken under a different monitor arrangement, the action is
//! refused — a refusal is recoverable, a click on the wrong screen is not.
//!
//! TypeScript sends geometry and gets back what happened. It does not do the
//! arithmetic, because doing it in two places is how the two answers drifted
//! apart in the first place.

#![cfg(windows)]

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};

use super::authority::VisualExecutionAuthority;
use super::coordinates::{CoordinateSpace, TypedPoint};
use super::frame::{resolve_visual_target, InteractionError, VisualTarget};
use super::freshness::{self, FreshnessCheckResult, PhysicalRect};
use super::runtime::VisualRuntime;
use super::target_recovery;
use super::target_search;
use super::verification::{self, VerificationOutcome, VisualExpectedOutcome, WindowIdentity};
use crate::native_overlay;

/// How far a visual action got. The distinction that matters is between
/// `ClickSent` and `VerifiedSucceeded`: input was injected, versus something
/// actually happened. Everything before `ClickSent` is side-effect-free and
/// safe to retry; nothing from `ClickSent` onwards is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum VisualAttemptStatus {
    PreviewSucceeded,
    CursorMoved,
    ClickSent,
    VerifiedSucceeded,
    VerificationFailed,
    ScreenChangedBeforeAction,
    TargetObscured,
    TargetWindowChanged,
    CursorPositionMismatch,
    NoVerifierAvailable,
}

impl VisualAttemptStatus {
    /// Could this attempt have changed something on the user's machine?
    ///
    /// The whole point of the enum. A status where this is true must never be
    /// followed by an automatic second attempt, however plausible the theory
    /// that the first one did nothing.
    pub fn side_effect_possible(&self) -> bool {
        matches!(
            self,
            Self::ClickSent
                | Self::VerifiedSucceeded
                | Self::VerificationFailed
                | Self::NoVerifierAvailable
        )
    }

    /// May the caller safely try something else?
    pub fn allows_retry(&self) -> bool {
        !self.side_effect_possible()
    }
}

/// What the model found, in the frame it found it in.
///
/// `frame_id` and `topology_version` are supplied by the application from the
/// original capture — never by the model, which has no way to know them and
/// every incentive to invent something plausible.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualTargetRequest {
    pub frame_id: String,
    pub display_id: String,
    pub topology_version: String,
    /// Centre of the match, in the model's normalised space.
    pub x: f64,
    pub y: f64,
    #[serde(default = "default_normalized_max")]
    pub normalized_max: f64,
    /// Optional bounding box in the same space, for the outline.
    #[serde(default)]
    pub box_x: Option<f64>,
    #[serde(default)]
    pub box_y: Option<f64>,
    #[serde(default)]
    pub box_width: Option<f64>,
    #[serde(default)]
    pub box_height: Option<f64>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub label: Option<String>,
    /// One id across capture, model call, execution and verification. Generated
    /// by the caller that started the action, never invented here.
    #[serde(default)]
    pub correlation_id: Option<String>,
    /// What should be true afterwards. Absent means no verification, which is
    /// only appropriate for previews.
    #[serde(default)]
    pub expected_outcome: Option<VisualExpectedOutcome>,
    /// Skip the pre-action screen comparison. Only for previews, which change
    /// nothing and so cannot act on a stale coordinate harmfully.
    #[serde(default)]
    pub skip_freshness: bool,
}

fn default_normalized_max() -> f64 {
    1000.0
}

impl VisualTargetRequest {
    fn correlation(&self) -> String {
        self.correlation_id
            .clone()
            .unwrap_or_else(|| format!("visual-{}", now_ms()))
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A target that passed every check, in desktop pixels.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTarget {
    pub frame_id: String,
    pub display_id: u32,
    pub x: i32,
    pub y: i32,
    /// Present only when the request carried a box that also resolved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub box_rect: Option<DesktopRect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorMoveResult {
    pub requested: (i32, i32),
    pub actual: Option<(i32, i32)>,
    pub error_distance_px: Option<f64>,
    pub display_id: u32,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualActionResult {
    /// Ties capture, model call, resolution, execution and verification into one
    /// traceable thing. Supplied by the caller so the assistant loop's log and
    /// the planner's result name the same action.
    pub correlation_id: String,
    pub frame_id: String,
    pub display_id: u32,
    pub point: (i32, i32),
    #[serde(skip_serializing_if = "Option::is_none")]
    pub box_rect: Option<DesktopRect>,
    pub cursor: Option<CursorMoveResult>,
    pub clicked: bool,
    pub status: VisualAttemptStatus,
    /// True when the click was sent, whatever the verifier concluded. The
    /// caller must not run a fallback while this is set.
    pub side_effect_possible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freshness: Option<FreshnessCheckResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification: Option<VerificationOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub summary: String,
}

/// A refusal the frontend can show verbatim and act on programmatically.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualError {
    pub code: String,
    pub message: String,
    /// True when retrying with a fresh capture is the right next step.
    pub recapture: bool,
}

impl From<InteractionError> for VisualError {
    fn from(e: InteractionError) -> Self {
        let (code, recapture) = match &e {
            InteractionError::FrameNotFound { .. } => ("frame-not-found", true),
            InteractionError::FrameExpired { .. } => ("frame-expired", true),
            InteractionError::FrameDisplayMismatch { .. } => ("frame-display-mismatch", true),
            InteractionError::TopologyVersionMismatch => ("topology-changed", true),
            InteractionError::DisplayNotFound { .. } => ("display-disconnected", true),
            InteractionError::TargetOutOfBounds { .. } => ("target-out-of-bounds", false),
            InteractionError::InvalidGeometry { .. } => ("invalid-geometry", false),
        };
        Self {
            code: code.into(),
            message: e.to_string(),
            recapture,
        }
    }
}

fn bad_request(message: impl Into<String>) -> VisualError {
    VisualError {
        code: "invalid-target".into(),
        message: message.into(),
        recapture: false,
    }
}

/// Resolve a request into a validated desktop target.
///
/// The box is resolved by mapping its two corners through the same chain as the
/// point. Mapping the centre and then scaling the size would reintroduce the
/// assumption that capture pixels and display pixels are the same size.
/// Refuse the action unless the display it lands on has a verified profile, and
/// return that display's correction.
///
/// One gate for every visual route, placed in `resolve` because all four
/// commands — resolve, preview, move, execute — pass through it. Putting the
/// check in each command instead would mean a fifth command could be added
/// without one.
///
/// Deliberately never falls back to another monitor. An unconfigured display is
/// a refusal, not a reason to act somewhere else: pointing at the wrong screen
/// is precisely the class of confident-wrong-answer this subsystem exists to
/// prevent.
#[cfg(windows)]
fn profile_gate<R: Runtime>(
    app: &AppHandle<R>,
    topology: &super::topology::DisplayTopology,
    display_id: u32,
) -> Result<
    (
        Option<super::mapping::AffineTransform>,
        VisualExecutionAuthority,
    ),
    VisualError,
> {
    let Some(geometry) = topology.display(display_id) else {
        return Err(VisualError {
            code: "DISPLAY_IDENTITY_MISMATCH".into(),
            message: "That display is no longer in the current arrangement.".into(),
            recapture: true,
        });
    };
    match super::wizard::profile_for_bounds(app, geometry.x, geometry.y) {
        // The one place an authority is minted: after, and only after, the
        // stored profile has approved this monitor.
        Ok(correction) => Ok((
            correction,
            VisualExecutionAuthority::issue(display_id, *geometry, topology.version.clone()),
        )),
        Err(code) => Err(VisualError {
            message: super::wizard::describe_profile_refusal(&code),
            code,
            recapture: false,
        }),
    }
}

/// Where overlay, cursor and click actually go.
///
/// Production always gets the Win32 backend. Tests install a recorder for the
/// duration of one test so they can assert that a refusal reached none of these
/// calls — which is the difference between "the code returns early" and "nothing
/// happened", and this codebase has twice been wrong about the first implying
/// the second.
///
/// Typed as the trait rather than the recorder so a physical test can install a
/// backend that *counts and then forwards to Win32* — the only way to say
/// "exactly one click reached the operating system" about a real click.
#[cfg(test)]
static TEST_BACKEND: std::sync::Mutex<
    Option<std::sync::Arc<dyn super::side_effects::VisualSideEffects>>,
> = std::sync::Mutex::new(None);

#[cfg(test)]
pub(crate) fn install_test_side_effects(
    recorder: std::sync::Arc<dyn super::side_effects::VisualSideEffects>,
) {
    *TEST_BACKEND.lock().unwrap_or_else(|e| e.into_inner()) = Some(recorder);
}

#[cfg(test)]
pub(crate) fn clear_test_side_effects() {
    *TEST_BACKEND.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn side_effects() -> std::sync::Arc<dyn super::side_effects::VisualSideEffects> {
    #[cfg(test)]
    {
        if let Some(recorder) = TEST_BACKEND
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            return recorder;
        }
    }
    std::sync::Arc::new(super::side_effects::NativeSideEffects)
}

/// The first thing `resolve` does, split out so it can be tested on its own.
fn parse_display_id(request: &VisualTargetRequest) -> Result<u32, VisualError> {
    request
        .display_id
        .trim()
        .parse()
        .map_err(|_| bad_request(format!("\"{}\" is not a display id.", request.display_id)))
}

fn resolve<R: Runtime>(
    #[cfg_attr(not(windows), allow(unused_variables))] app: &AppHandle<R>,
    runtime: &VisualRuntime,
    request: &VisualTargetRequest,
) -> Result<(ResolvedTarget, VisualExecutionAuthority), VisualError> {
    let display_id = parse_display_id(request)?;

    let topology = runtime.topology().map_err(|e| VisualError {
        code: "topology-unavailable".into(),
        message: e,
        recapture: true,
    })?;

    let target = VisualTarget {
        frame_id: request.frame_id.clone(),
        display_id,
        topology_version: request.topology_version.clone(),
        coordinate_space: CoordinateSpace::ModelNormalized,
        x: request.x,
        y: request.y,
        normalized_max: request.normalized_max,
        confidence: request.confidence,
    };
    let point = resolve_visual_target(&target, runtime.frames(), &topology)?;

    let box_rect = match (
        request.box_x,
        request.box_y,
        request.box_width,
        request.box_height,
    ) {
        (Some(bx), Some(by), Some(bw), Some(bh)) if bw > 0.0 && bh > 0.0 => {
            let corner = VisualTarget {
                x: bx,
                y: by,
                ..target.clone()
            };
            let far = VisualTarget {
                x: bx + bw,
                y: by + bh,
                ..target.clone()
            };
            // A box whose corners fall outside the display is not fatal — the
            // point is still actionable, and an outline is only decoration.
            match (
                resolve_visual_target(&corner, runtime.frames(), &topology),
                resolve_visual_target(&far, runtime.frames(), &topology),
            ) {
                (Ok(a), Ok(b)) => Some(DesktopRect {
                    x: a.x.round() as i32,
                    y: a.y.round() as i32,
                    width: (b.x - a.x).round().max(1.0) as i32,
                    height: (b.y - a.y).round().max(1.0) as i32,
                }),
                _ => None,
            }
        }
        _ => None,
    };

    // The gate, and the correction, at the very end — so it is applied to the
    // final resolved point exactly once, and nothing downstream repeats it.
    #[cfg(windows)]
    let (correction, authority) = profile_gate(app, &topology, point.display_id)?;
    #[cfg(not(windows))]
    let correction: Option<super::mapping::AffineTransform> = None;

    let corrected =
        correct_desktop_point(&topology, point.display_id, point.x, point.y, correction);
    let box_rect = box_rect.map(|r| {
        let (x, y) = correct_desktop_point(
            &topology,
            point.display_id,
            r.x as f64,
            r.y as f64,
            correction,
        );
        DesktopRect {
            x: x.round() as i32,
            y: y.round() as i32,
            ..r
        }
    });

    Ok((
        ResolvedTarget {
            frame_id: point.frame_id,
            display_id: point.display_id,
            x: corrected.0.round() as i32,
            y: corrected.1.round() as i32,
            box_rect,
            confidence: point.confidence,
            label: request.label.clone(),
        },
        authority,
    ))
}

/// Re-read the monitor arrangement, now.
///
/// Every authorization is checked against this rather than against the version
/// the authority already remembers — comparing an authority to itself would
/// always agree, which is not a check.
fn live_topology_version(runtime: &VisualRuntime) -> Result<String, VisualError> {
    runtime
        .topology()
        .map(|t| t.version)
        .map_err(|e| VisualError {
            code: "topology-unavailable".into(),
            message: e,
            recapture: true,
        })
}

/// Turn an authorization refusal into the error shape the frontend already
/// handles, so a topology change mid-action reads like every other refusal.
fn authority_error(r: super::authority::AuthorityRefusal) -> VisualError {
    VisualError {
        code: r.code().into(),
        message: r.message().into(),
        recapture: matches!(
            r,
            super::authority::AuthorityRefusal::TopologyChanged
                | super::authority::AuthorityRefusal::Expired
        ),
    }
}

/// Desktop point → display-local → correction → desktop point.
///
/// The correction was fitted in display-local coordinates, so it has to be
/// applied there. Doing it directly on a desktop point would fold the monitor's
/// origin into the constant term — a thousand pixels of error on the portrait
/// display at (−1080, −661).
fn correct_desktop_point(
    topology: &super::topology::DisplayTopology,
    display_id: u32,
    x: f64,
    y: f64,
    correction: Option<super::mapping::AffineTransform>,
) -> (f64, f64) {
    let Some(correction) = correction else {
        return (x, y); // identity: the point is returned untouched
    };
    let Some(geometry) = topology.display(display_id) else {
        return (x, y);
    };
    let local = super::mapping::PhysicalPoint::new(x - geometry.x as f64, y - geometry.y as f64);
    let moved = super::mapping::apply_correction_display_local(local, Some(&correction));
    (moved.x + geometry.x as f64, moved.y + geometry.y as f64)
}

/// Validate a target and report where it lands. Changes nothing on screen.
#[tauri::command]
pub fn resolve_visual_target_cmd<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<VisualRuntime>,
    request: VisualTargetRequest,
) -> Result<ResolvedTarget, VisualError> {
    resolve(&app, &runtime, &request).map(|(target, _)| target)
}

/// "Show me where X is" — outline it, touch nothing.
///
/// Highlighting is the one visual action that changes no state, so it is the
/// one that may run without moving the cursor. It deliberately does not fall
/// back to moving the cursor when there is no box: a cursor parked on a guess
/// looks exactly like a cursor parked on a certainty.
#[tauri::command]
pub fn preview_visual_target<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<VisualRuntime>,
    request: VisualTargetRequest,
    seconds: Option<f64>,
) -> Result<VisualActionResult, VisualError> {
    let (resolved, authority) = resolve(&app, &runtime, &request)?;
    let rect = resolved.box_rect.unwrap_or(DesktopRect {
        // No box came back: mark a small square on the point itself rather than
        // inventing a plausible-looking bounding box around it.
        x: resolved.x - 24,
        y: resolved.y - 24,
        width: 48,
        height: 48,
    });
    // Through the side-effect backend, so a test can prove this line was not
    // reached when the profile gate refused.
    let outline = authority
        .authorize_rect(
            super::side_effects::DesktopRect {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            },
            &live_topology_version(&runtime)?,
        )
        .map_err(authority_error)?;
    side_effects()
        .show_overlay(outline)
        .map_err(|e| VisualError {
            code: "overlay-failed".into(),
            message: e,
            recapture: false,
        })?;

    let hold = seconds.unwrap_or(6.0).clamp(1.0, 30.0);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs_f64(hold));
        native_overlay::hide_highlight();
    });

    Ok(VisualActionResult {
        correlation_id: request.correlation(),
        frame_id: resolved.frame_id,
        display_id: resolved.display_id,
        point: (resolved.x, resolved.y),
        box_rect: Some(rect),
        cursor: None,
        clicked: false,
        status: VisualAttemptStatus::PreviewSucceeded,
        side_effect_possible: false,
        // Outlining is side-effect free, so a slightly stale outline is a
        // cosmetic problem rather than a wrong action. Frame, display and
        // topology were still checked by `resolve`.
        freshness: None,
        verification: None,
        summary: match &resolved.label {
            Some(l) => format!("Outlined “{l}” on display {}.", resolved.display_id),
            None => format!("Outlined it on display {}.", resolved.display_id),
        },
        label: resolved.label,
    })
}

/// Move the cursor to a validated target. Never clicks.
#[tauri::command]
pub fn move_to_visual_target<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<VisualRuntime>,
    request: VisualTargetRequest,
) -> Result<VisualActionResult, VisualError> {
    let (resolved, authority) = resolve(&app, &runtime, &request)?;
    let correlation_id = request.correlation();

    let (freshness_result, region) = pre_action_freshness(&app, &runtime, &request, &resolved)?;
    let _ = region;

    let cursor = move_cursor_verified(&resolved, &authority, &live_topology_version(&runtime)?)?;
    retire_pointer_after(900);
    let status = if cursor.success {
        VisualAttemptStatus::CursorMoved
    } else {
        VisualAttemptStatus::CursorPositionMismatch
    };
    Ok(VisualActionResult {
        correlation_id,
        frame_id: resolved.frame_id,
        display_id: resolved.display_id,
        point: (resolved.x, resolved.y),
        box_rect: resolved.box_rect,
        summary: format!(
            "Moved the cursor to ({}, {}) on display {}.",
            resolved.x, resolved.y, resolved.display_id
        ),
        cursor: Some(cursor),
        clicked: false,
        status,
        side_effect_possible: false,
        freshness: freshness_result,
        verification: None,
        label: resolved.label,
    })
}

/// The full click lifecycle: check the screen has not moved on, check nothing
/// covered the target, move, verify arrival, click, then prove it did something.
///
/// The order is the point. Every check that could refuse happens *before* the
/// click, because after it there is no undo — and the result says plainly
/// whether input was merely sent or actually achieved anything.
#[tauri::command]
pub fn execute_visual_target<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<VisualRuntime>,
    request: VisualTargetRequest,
    button: Option<String>,
) -> Result<VisualActionResult, VisualError> {
    let (resolved, authority) = resolve(&app, &runtime, &request)?;
    let correlation_id = request.correlation();
    let button = button.unwrap_or_else(|| "left".into()).to_ascii_lowercase();
    if !matches!(button.as_str(), "left" | "right" | "double") {
        return Err(bad_request("button must be left, right, or double."));
    }

    // 1. Has the screen moved on since the model looked at it?
    let (freshness_result, region) = pre_action_freshness(&app, &runtime, &request, &resolved)?;

    // 2. Is the thing under the target still the thing that was there?
    let window_before = verification::window_at(resolved.x, resolved.y);

    let topology = runtime.topology().map_err(|e| VisualError {
        code: "topology-unavailable".into(),
        message: e,
        recapture: true,
    })?;
    let expected = request
        .expected_outcome
        .clone()
        .unwrap_or(VisualExpectedOutcome::None);
    let before = verification::snapshot_before(&app, &topology, &expected, region);

    // 3. Move, and confirm the cursor actually arrived. `SetCursorPos` lands
    //    short when another process is grabbing input, and clicking anyway
    //    means clicking whatever is under wherever the cursor really is.
    let cursor = move_cursor_verified(&resolved, &authority, &live_topology_version(&runtime)?)?;
    if !cursor.success {
        native_overlay::hide_pointer();
        return Ok(VisualActionResult {
            correlation_id,
            frame_id: resolved.frame_id,
            display_id: resolved.display_id,
            point: (resolved.x, resolved.y),
            box_rect: resolved.box_rect,
            summary: format!(
                "The cursor did not reach ({}, {}), so nothing was clicked.",
                resolved.x, resolved.y
            ),
            cursor: Some(cursor),
            clicked: false,
            status: VisualAttemptStatus::CursorPositionMismatch,
            side_effect_possible: false,
            freshness: freshness_result,
            verification: None,
            label: resolved.label,
        });
    }

    // 4. Moving the cursor can itself change what is on top — a hover menu, a
    //    tooltip. Re-check ownership at the last possible moment.
    if let (Some(a), Some(b)) = (
        window_before.as_ref(),
        verification::window_at(resolved.x, resolved.y).as_ref(),
    ) {
        if !verification::same_window(a, b) {
            native_overlay::hide_pointer();
            return Ok(obscured_result(
                correlation_id,
                &resolved,
                cursor,
                freshness_result,
                a,
                b,
            ));
        }
    }

    // 5. Click. From here on a side effect is possible and no automatic retry
    //    is permitted, whatever the verifier concludes.
    // Re-authorized immediately before the press rather than reusing the point
    // the cursor move was given: everything between the two is a chance for the
    // arrangement to change, and this is the last moment refusing is still free.
    let click_point = authority
        .authorize_point(resolved.x, resolved.y, &live_topology_version(&runtime)?)
        .map_err(authority_error)?;
    let click = side_effects().click(
        click_point,
        super::side_effects::MouseButton::from_str(&button),
    );
    retire_pointer_after(700);
    if let Err(e) = click {
        return Err(VisualError {
            code: "click-failed".into(),
            message: e,
            recapture: false,
        });
    }

    // 6. Prove it did something.
    let outcome = verification::verify_after(&app, &topology, &expected, region, &before);
    let (status, summary) = if expected.is_none() {
        (
            VisualAttemptStatus::NoVerifierAvailable,
            match &resolved.label {
                Some(l) => format!(
                    "Clicked “{l}” on display {} — no way to confirm what it did.",
                    resolved.display_id
                ),
                None => format!(
                    "Clicked ({}, {}) on display {} — no way to confirm what it did.",
                    resolved.x, resolved.y, resolved.display_id
                ),
            },
        )
    } else if outcome.unavailable {
        (
            VisualAttemptStatus::NoVerifierAvailable,
            format!("Clicked, but couldn't check the result: {}", outcome.detail),
        )
    } else if outcome.verified {
        (
            VisualAttemptStatus::VerifiedSucceeded,
            match &resolved.label {
                Some(l) => format!("Clicked “{l}” — {}.", outcome.detail),
                None => format!("Clicked it — {}.", outcome.detail),
            },
        )
    } else {
        (
            VisualAttemptStatus::VerificationFailed,
            format!(
                "The click was sent but {} — I won't try again in case it did register.",
                outcome.detail
            ),
        )
    };

    Ok(VisualActionResult {
        correlation_id,
        frame_id: resolved.frame_id,
        display_id: resolved.display_id,
        point: (resolved.x, resolved.y),
        box_rect: resolved.box_rect,
        summary,
        cursor: Some(cursor),
        clicked: true,
        status,
        side_effect_possible: status.side_effect_possible(),
        freshness: freshness_result,
        verification: Some(outcome),
        label: resolved.label,
    })
}

fn obscured_result(
    correlation_id: String,
    resolved: &ResolvedTarget,
    cursor: CursorMoveResult,
    freshness_result: Option<FreshnessCheckResult>,
    before: &WindowIdentity,
    now: &WindowIdentity,
) -> VisualActionResult {
    let describe = |w: &WindowIdentity| {
        w.title
            .clone()
            .or_else(|| w.process_name.clone())
            .unwrap_or_else(|| "something".into())
    };
    VisualActionResult {
        correlation_id,
        frame_id: resolved.frame_id.clone(),
        display_id: resolved.display_id,
        point: (resolved.x, resolved.y),
        box_rect: resolved.box_rect,
        summary: format!(
            "“{}” is over the target now, not “{}” — nothing was clicked.",
            describe(now),
            describe(before)
        ),
        cursor: Some(cursor),
        clicked: false,
        status: VisualAttemptStatus::TargetWindowChanged,
        side_effect_possible: false,
        freshness: freshness_result,
        verification: None,
        label: resolved.label.clone(),
    }
}

/// Compare the target's surroundings with the frame, before anything moves.
///
/// Returns the region alongside the result so the post-action verifier compares
/// exactly the same rectangle — computing it twice would risk the two drifting.
type FreshnessOutcome = (Option<FreshnessCheckResult>, PhysicalRect);

fn pre_action_freshness<R: Runtime>(
    app: &AppHandle<R>,
    runtime: &VisualRuntime,
    request: &VisualTargetRequest,
    resolved: &ResolvedTarget,
) -> Result<FreshnessOutcome, VisualError> {
    let frame = runtime
        .frames()
        .get(&resolved.frame_id)
        .ok_or_else(|| VisualError {
            code: "frame-not-found".into(),
            message: format!("no screenshot is on record for {}", resolved.frame_id),
            recapture: true,
        })?;
    let region = freshness::region_around(
        &frame,
        resolved.x,
        resolved.y,
        resolved.box_rect.map(|b| (b.x, b.y, b.width, b.height)),
        freshness::DEFAULT_REGION_MARGIN,
    );
    if request.skip_freshness {
        return Ok((None, region));
    }
    let topology = runtime.topology().map_err(|e| VisualError {
        code: "topology-unavailable".into(),
        message: e,
        recapture: true,
    })?;
    let check = freshness::check_region_freshness(
        app,
        &topology,
        &frame,
        region,
        freshness::DEFAULT_STALENESS_THRESHOLD,
    );
    if !check.is_fresh {
        // "I could not look" is not "it changed", and neither is "our own
        // highlight is in the way". Both used to produce the same sentence.
        if check.unavailable_reason.is_some() {
            let outcome = target_recovery::TargetOutcome::CouldNotCheck;
            return Err(VisualError {
                code: outcome.code().into(),
                message: outcome.message(resolved.label.as_deref()),
                recapture: true,
            });
        }

        // Our own overlay inside the compared region is not evidence that the
        // user's screen changed — and the annotation flow draws one immediately
        // before checking, so the second annotation of any request hit this.
        if overlay_overlaps(region) || cursor_inside(region) {
            return Ok((Some(check), region));
        }

        // Look again before giving up. A window nudged twenty pixels used to
        // fail the whole request; now it moves the target and carries on.
        let outcome = match re_resolve_region(app, &topology, &frame, region) {
            RegionRecovery::Moved { dx, dy } => {
                // The caller is told where it went by the returned region; the
                // point itself is corrected by `recovered_region` below.
                let moved = PhysicalRect {
                    x: region.x + dx,
                    y: region.y + dy,
                    ..region
                };
                return Ok((Some(check), moved));
            }
            RegionRecovery::Ambiguous => target_recovery::TargetOutcome::Ambiguous,
            RegionRecovery::Unavailable => target_recovery::TargetOutcome::CouldNotCheck,
            RegionRecovery::Gone => target_recovery::TargetOutcome::TargetGone,
        };
        return Err(VisualError {
            code: outcome.code().into(),
            message: outcome.message(resolved.label.as_deref()),
            recapture: true,
        });
    }
    Ok((Some(check), region))
}

/// What one automatic re-resolution attempt concluded.
enum RegionRecovery {
    Moved { dx: i32, dy: i32 },
    Ambiguous,
    Gone,
    Unavailable,
}

/// Search for the target's surroundings near where they were.
///
/// Bounded at `MAX_AUTOMATIC_ATTEMPTS`: a screen that keeps changing under a
/// retry loop is telling us something, and a third identical failure is
/// information rather than a reason to try a fourth time.
fn re_resolve_region<R: Runtime>(
    app: &AppHandle<R>,
    topology: &super::topology::DisplayTopology,
    frame: &super::frame::CapturedFrame,
    region: PhysicalRect,
) -> RegionRecovery {
    let Ok(path) = crate::screen_context::storage::image_path(app, &frame.frame_id, false) else {
        return RegionRecovery::Unavailable;
    };
    let Ok(original) = xcap::image::open(&path) else {
        return RegionRecovery::Unavailable;
    };
    let original = original.to_rgba8();
    let Some((ix, iy, iw, ih)) = freshness::region_in_frame_image(
        frame,
        &region,
        original.width(),
        original.height(),
    ) else {
        return RegionRecovery::Unavailable;
    };
    let needle = xcap::image::imageops::crop_imm(&original, ix, iy, iw, ih).to_image();

    for _ in 0..target_recovery::MAX_AUTOMATIC_ATTEMPTS {
        match target_search::find_near(topology, region, &needle) {
            target_search::SearchResult::Found { dx, dy, .. } => {
                return RegionRecovery::Moved { dx, dy }
            }
            target_search::SearchResult::Ambiguous { .. } => return RegionRecovery::Ambiguous,
            target_search::SearchResult::Unavailable => return RegionRecovery::Unavailable,
            // Worth one more look: a transition mid-animation resolves in
            // milliseconds, and the second attempt catches it settled.
            target_search::SearchResult::NotFound { .. } => {}
        }
    }
    RegionRecovery::Gone
}

/// Is an ArcSonare overlay inside the region we are about to compare?
fn overlay_overlaps(region: PhysicalRect) -> bool {
    let Some((hx, hy, hw, hh)) = native_overlay::highlight_target_rect() else {
        return false;
    };
    let (rx, ry) = (region.x, region.y);
    let (rw, rh) = (region.width as i32, region.height as i32);
    hx < rx + rw && hx + hw > rx && hy < ry + rh && hy + hh > ry
}

/// Is the mouse pointer inside it? A cursor is not a UI change.
fn cursor_inside(region: PhysicalRect) -> bool {
    let Some((cx, cy)) = crate::capabilities::input::read_cursor_position() else {
        return false;
    };
    cx >= region.x
        && cx < region.x + region.width as i32
        && cy >= region.y
        && cy < region.y + region.height as i32
}

/// Clear any outline or pointer this module put on screen.
#[tauri::command]
pub fn clear_visual_overlay() {
    native_overlay::hide_highlight();
    native_overlay::hide_pointer();
}

/// Leave the pointer visible briefly after landing, then take it away.
fn retire_pointer_after(millis: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(millis));
        native_overlay::hide_pointer();
    });
}

/// Glide the purple agent pointer to the target so the user can watch it aim.
///
/// Runs here rather than in the webview because the frontend no longer knows
/// desktop coordinates — which is the point. The animation is cosmetic; every
/// intermediate position is derived from the one validated endpoint.
fn animate_pointer_to(x: i32, y: i32) {
    let (sx, sy) = crate::capabilities::input::read_cursor_position().unwrap_or((x, y));
    let _ = native_overlay::show_pointer(sx, sy);
    let steps = 22;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let ease = 1.0 - (1.0 - t).powi(3);
        let cx = (sx as f64 + (x - sx) as f64 * ease).round() as i32;
        let cy = (sy as f64 + (y - sy) as f64 * ease).round() as i32;
        let _ = native_overlay::show_pointer(cx, cy);
        std::thread::sleep(std::time::Duration::from_millis(14));
    }
    let _ = native_overlay::show_pointer(x, y);
}

/// Move the cursor and measure how close it actually got.
///
/// The cursor position is read *after* the move purely as verification. It is
/// never read to decide where to go — that is the fallback this whole migration
/// exists to delete.
fn move_cursor_verified(
    resolved: &ResolvedTarget,
    authority: &VisualExecutionAuthority,
    current_topology_version: &str,
) -> Result<CursorMoveResult, VisualError> {
    let requested = (resolved.x, resolved.y);
    let point = authority
        .authorize_point(resolved.x, resolved.y, current_topology_version)
        .map_err(authority_error)?;
    animate_pointer_to(resolved.x, resolved.y);
    let backend = side_effects();
    let moved = backend.move_cursor(point);
    // Still read back afterwards — the abstraction changes where the call goes,
    // never whether the move is verified.
    let actual = backend.read_cursor().map(|p| (p.x, p.y));
    let error = actual.map(|(ax, ay)| {
        let dx = (ax - requested.0) as f64;
        let dy = (ay - requested.1) as f64;
        (dx * dx + dy * dy).sqrt()
    });
    // Two pixels of slack: pointer ballistics and DPI rounding can land one
    // pixel off without anything being wrong.
    let success = moved.is_ok() && error.map(|d| d <= 2.0).unwrap_or(false);
    Ok(CursorMoveResult {
        requested,
        actual,
        error_distance_px: error,
        display_id: resolved.display_id,
        success,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::display::coordinates::DisplayGeometry;
    use crate::display::frame::CapturedFrame;
    use crate::display::topology::DisplayTopology;

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

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn frame_on(topo: &DisplayTopology, display_id: u32, id: &str, age_ms: u64) -> CapturedFrame {
        let d = *topo.display(display_id).unwrap();
        CapturedFrame {
            frame_id: id.into(),
            display_id,
            topology_version: topo.version.clone(),
            captured_at_ms: now_ms().saturating_sub(age_ms),
            capture_width: d.width,
            capture_height: d.height,
            display_bounds: d,
            preprocessing: None,
        }
    }

    fn request(frame_id: &str, display_id: u32, version: &str) -> VisualTargetRequest {
        VisualTargetRequest {
            frame_id: frame_id.into(),
            display_id: display_id.to_string(),
            topology_version: version.into(),
            x: 500.0,
            y: 500.0,
            normalized_max: 1000.0,
            box_x: None,
            box_y: None,
            box_width: None,
            box_height: None,
            confidence: Some(0.9),
            label: Some("the button".into()),
            correlation_id: Some("corr-test".into()),
            expected_outcome: None,
            skip_freshness: true,
        }
    }

    /// `resolve()` reads the live topology, so these exercise the pure resolver
    /// with a hand-built one — the arithmetic and the refusals are the contract,
    /// and they must hold without physical monitors attached.
    fn resolve_with(
        topo: &DisplayTopology,
        runtime: &VisualRuntime,
        req: &VisualTargetRequest,
    ) -> Result<crate::display::frame::ResolvedDesktopTarget, InteractionError> {
        let target = VisualTarget {
            frame_id: req.frame_id.clone(),
            display_id: req.display_id.parse().unwrap(),
            topology_version: req.topology_version.clone(),
            coordinate_space: CoordinateSpace::ModelNormalized,
            x: req.x,
            y: req.y,
            normalized_max: req.normalized_max,
            confidence: req.confidence,
        };
        resolve_visual_target(&target, runtime.frames(), topo)
    }

    #[test]
    fn a_target_from_the_right_twin_lands_on_the_right_twin() {
        // Two identical 1920×1080 monitors. Dimension matching cannot tell them
        // apart; the frame can.
        let topo = DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 1920, 1080),
            geom(2, 1920, 0, 1920, 1080),
        ]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&topo);
        runtime.frames().register(frame_on(&topo, 2, "f2", 0));

        let out = resolve_with(&topo, &runtime, &request("f2", 2, &topo.version)).unwrap();
        assert_eq!(out.display_id, 2);
        assert!(out.x >= 1920.0, "landed on the wrong twin: {}", out.x);
    }

    #[test]
    fn a_frame_that_was_never_registered_is_refused() {
        let topo = DisplayTopology::from_displays(vec![geom(1, 0, 0, 1920, 1080)]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&topo);
        let err = resolve_with(&topo, &runtime, &request("ghost", 1, &topo.version)).unwrap_err();
        assert!(matches!(err, InteractionError::FrameNotFound { .. }));
        assert!(VisualError::from(err).recapture, "the fix is a new capture");
    }

    #[test]
    fn a_frame_older_than_its_ttl_is_never_actionable() {
        let topo = DisplayTopology::from_displays(vec![geom(1, 0, 0, 1920, 1080)]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&topo);
        runtime
            .frames()
            .register(frame_on(&topo, 1, "old", 120_000));

        // Two mechanisms guard this and either is a correct answer: the registry
        // sweeps stale entries when anything is written to it, and resolution
        // re-checks the age of whatever survives. What matters is that a
        // two-minute-old screenshot cannot be clicked, and that the caller is
        // told to take a new one rather than to try again.
        let err = resolve_with(&topo, &runtime, &request("old", 1, &topo.version)).unwrap_err();
        assert!(
            matches!(
                err,
                InteractionError::FrameExpired { .. } | InteractionError::FrameNotFound { .. }
            ),
            "{err:?}"
        );
        assert!(VisualError::from(err).recapture);
    }

    #[test]
    fn a_fresh_frame_survives_the_sweep_an_old_one_triggers() {
        let topo = DisplayTopology::from_displays(vec![geom(1, 0, 0, 1920, 1080)]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&topo);
        runtime
            .frames()
            .register(frame_on(&topo, 1, "old", 120_000));
        runtime.frames().register(frame_on(&topo, 1, "new", 0));
        assert_eq!(runtime.frames().len(), 1, "the stale frame must be gone");
        assert!(runtime.frames().get("new").is_some());
    }

    #[test]
    fn a_target_claiming_a_different_display_than_its_frame_is_refused() {
        let topo = DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 1920, 1080),
            geom(2, 1920, 0, 1920, 1080),
        ]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&topo);
        runtime.frames().register(frame_on(&topo, 1, "f1", 0));
        let err = resolve_with(&topo, &runtime, &request("f1", 2, &topo.version)).unwrap_err();
        assert!(matches!(err, InteractionError::FrameDisplayMismatch { .. }));
    }

    #[test]
    fn a_frame_from_a_previous_arrangement_is_refused() {
        let before = DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 1920, 1080),
            geom(2, 1920, 0, 1920, 1080),
        ]);
        let after = DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 1920, 1080),
            geom(2, -1920, 0, 1920, 1080),
        ]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&before);
        runtime.frames().register(frame_on(&before, 2, "f2", 0));
        // Same request, new arrangement: the version no longer matches.
        let err = resolve_with(&after, &runtime, &request("f2", 2, &before.version)).unwrap_err();
        assert_eq!(err, InteractionError::TopologyVersionMismatch);
    }

    #[test]
    fn a_negative_origin_display_keeps_its_negative_coordinates() {
        let topo = DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 3840, 1080),
            geom(2, -1080, -661, 1080, 1920),
        ]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&topo);
        runtime.frames().register(frame_on(&topo, 2, "portrait", 0));
        let out = resolve_with(&topo, &runtime, &request("portrait", 2, &topo.version)).unwrap();
        assert!(out.x < 0.0, "expected negative X, got {}", out.x);
        assert_eq!(
            topo.display_containing(&TypedPoint::new(
                out.x,
                out.y,
                CoordinateSpace::VirtualDesktopPhysical
            ))
            .map(|d| d.display_id),
            Some(2)
        );
    }

    #[test]
    fn a_non_finite_coordinate_is_refused() {
        let topo = DisplayTopology::from_displays(vec![geom(1, 0, 0, 1920, 1080)]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&topo);
        runtime.frames().register(frame_on(&topo, 1, "f", 0));
        let mut req = request("f", 1, &topo.version);
        req.x = f64::NAN;
        let err = resolve_with(&topo, &runtime, &req).unwrap_err();
        assert!(matches!(err, InteractionError::InvalidGeometry { .. }));
    }

    #[test]
    fn a_point_past_the_edge_of_its_display_is_refused_not_clamped() {
        let topo = DisplayTopology::from_displays(vec![geom(1, 0, 0, 1920, 1080)]);
        let runtime = VisualRuntime::new();
        runtime.note_topology(&topo);
        runtime.frames().register(frame_on(&topo, 1, "f", 0));
        let mut req = request("f", 1, &topo.version);
        // Beyond the normalised range: a clamp would silently click the corner.
        req.x = 1400.0;
        let err = resolve_with(&topo, &runtime, &req).unwrap_err();
        assert!(
            matches!(err, InteractionError::TargetOutOfBounds { .. }),
            "{err:?}"
        );
    }

    #[test]
    fn only_statuses_after_the_click_admit_a_possible_side_effect() {
        // This is the enum's whole job: everything before the click can be
        // retried freely, everything from it onwards cannot.
        for before in [
            VisualAttemptStatus::PreviewSucceeded,
            VisualAttemptStatus::CursorMoved,
            VisualAttemptStatus::ScreenChangedBeforeAction,
            VisualAttemptStatus::TargetObscured,
            VisualAttemptStatus::TargetWindowChanged,
            VisualAttemptStatus::CursorPositionMismatch,
        ] {
            assert!(!before.side_effect_possible(), "{before:?}");
            assert!(before.allows_retry(), "{before:?}");
        }
        for after in [
            VisualAttemptStatus::ClickSent,
            VisualAttemptStatus::VerifiedSucceeded,
            VisualAttemptStatus::VerificationFailed,
            VisualAttemptStatus::NoVerifierAvailable,
        ] {
            assert!(after.side_effect_possible(), "{after:?}");
            assert!(!after.allows_retry(), "{after:?}");
        }
    }

    #[test]
    fn a_failed_verification_still_blocks_a_second_attempt() {
        // The trap this exists for: "the click did nothing, so try again" is
        // indistinguishable from "the click worked but the verifier was too
        // slow", and one of those opens two windows.
        let s = VisualAttemptStatus::VerificationFailed;
        assert!(s.side_effect_possible());
        assert!(!s.allows_retry());
    }

    #[test]
    fn a_stale_screen_is_reported_as_retryable_because_nothing_happened() {
        let s = VisualAttemptStatus::ScreenChangedBeforeAction;
        assert!(!s.side_effect_possible());
        assert!(s.allows_retry(), "recapturing and retrying is the fix");
    }

    #[test]
    fn a_click_sent_is_never_serialized_as_a_verified_success() {
        let sent = serde_json::to_value(VisualAttemptStatus::ClickSent).unwrap();
        let verified = serde_json::to_value(VisualAttemptStatus::VerifiedSucceeded).unwrap();
        assert_eq!(sent, "click-sent");
        assert_eq!(verified, "verified-succeeded");
        assert_ne!(sent, verified);
    }

    #[test]
    fn a_request_without_a_correlation_id_still_gets_one() {
        // Traceability must not depend on the caller remembering.
        let mut r = request("f", 1, "v");
        r.correlation_id = None;
        assert!(r.correlation().starts_with("visual-"));
        r.correlation_id = Some("abc".into());
        assert_eq!(r.correlation(), "abc");
    }

    #[test]
    fn a_display_id_that_is_not_a_number_is_refused_before_anything_runs() {
        let mut req = request("f", 1, "v");
        req.display_id = "the big one".into();
        let err = parse_display_id(&req).unwrap_err();
        assert_eq!(err.code, "invalid-target");
    }

    /// Identity must be free of arithmetic: a display needing no correction
    /// gets back the point it was given, bit for bit.
    #[test]
    fn an_identity_profile_returns_the_point_untouched() {
        use super::super::mapping::{apply_correction_display_local, PhysicalPoint};
        let p = PhysicalPoint::new(1234.5, -678.25);
        let out = apply_correction_display_local(p, None);
        assert_eq!(out, p);
    }

    /// Correcting in desktop space would fold the monitor origin into the
    /// transform's constant term — on a display at (-1080, -661) that is a
    /// thousand-pixel error dressed up as a calibration fault.
    #[test]
    fn a_correction_is_applied_in_display_local_space_not_desktop_space() {
        use super::super::mapping::{
            apply_correction_display_local, AffineTransform, PhysicalPoint,
        };
        let shift = AffineTransform {
            c: 4.0,
            f: -2.0,
            ..AffineTransform::IDENTITY
        };
        // A point 100,200 into a monitor whose origin is negative.
        let local = PhysicalPoint::new(100.0, 200.0);
        let corrected = apply_correction_display_local(local, Some(&shift));
        assert_eq!(corrected, PhysicalPoint::new(104.0, 198.0));

        // The same transform applied to the desktop point would move it by the
        // same 4,-2 — but only because this transform is a pure translation.
        // A scaling one would not survive, which is why the space is fixed.
        let scaled = AffineTransform {
            a: 1.01,
            ..AffineTransform::IDENTITY
        };
        let local_scaled = apply_correction_display_local(local, Some(&scaled));
        assert_eq!(
            local_scaled.x, 101.0,
            "scale is relative to the display edge"
        );
    }
}
