//! Carrying out a plan, once and honestly.
//!
//! The planner says *which* route to take. This runs it, checks the
//! postcondition, and decides whether the next route in the chain may be tried.
//! The last part matters most: an attempt that may already have changed
//! something must not be followed by another attempt, or "open Spotify" opens it
//! twice when verification merely lagged.
//!
//! Nothing here reaches the visual executor. While the capture-ownership
//! migration is outstanding, a plan that needs the screen returns
//! `VISUAL_INTERACTION_NOT_READY` rather than clicking at a guessed coordinate.

use serde_json::json;
use tauri::AppHandle;

use super::request::{
    ActionRequest, ActionResult, ActionStatus, ActionTarget, ConfirmationState, KnownFolder,
    PlannedAction, PlanningError, StrategyAttempt, VerificationResult,
};
use super::strategy::{
    plan, ActionIntent, AttemptStatus, AvailableCapabilities, ExecutionStrategy, RiskLevel,
};
use crate::capabilities::types::{ToolResult, ToolResultStatus};
use crate::capabilities::{applications, filesystem, web};

/// Windows Settings pages ArcSonare will open, by the words a user actually
/// says. An allowlist rather than "ms-settings:" + whatever the model produced:
/// the URI scheme reaches far more than settings.
const SETTINGS_PAGES: &[(&str, &str, &str)] = &[
    ("wi-fi", "ms-settings:network-wifi", "Wi-Fi settings"),
    ("wifi", "ms-settings:network-wifi", "Wi-Fi settings"),
    ("network", "ms-settings:network", "Network settings"),
    ("bluetooth", "ms-settings:bluetooth", "Bluetooth settings"),
    ("display", "ms-settings:display", "Display settings"),
    ("sound", "ms-settings:sound", "Sound settings"),
    ("audio", "ms-settings:sound", "Sound settings"),
    (
        "notifications",
        "ms-settings:notifications",
        "Notification settings",
    ),
    ("apps", "ms-settings:appsfeatures", "Apps settings"),
    (
        "default apps",
        "ms-settings:defaultapps",
        "Default apps settings",
    ),
    (
        "windows update",
        "ms-settings:windowsupdate",
        "Windows Update",
    ),
    ("update", "ms-settings:windowsupdate", "Windows Update"),
    ("battery", "ms-settings:batterysaver", "Battery settings"),
    ("power", "ms-settings:powersleep", "Power & sleep settings"),
    ("storage", "ms-settings:storagesense", "Storage settings"),
    ("privacy", "ms-settings:privacy", "Privacy settings"),
    (
        "personalization",
        "ms-settings:personalization",
        "Personalization settings",
    ),
    ("themes", "ms-settings:themes", "Theme settings"),
    ("mouse", "ms-settings:mousetouchpad", "Mouse settings"),
    ("keyboard", "ms-settings:keyboard", "Keyboard settings"),
    ("about", "ms-settings:about", "About this PC"),
    ("settings", "ms-settings:", "Windows Settings"),
];

fn resolve_settings_page(page: &str) -> Option<(&'static str, &'static str)> {
    let needle = page.trim().to_lowercase();
    // Only plain words reach the table. Without this, "ms-settings:../.." matches
    // on the substring "settings" and resolves to a real URI — the caller is
    // naming a page, never a URI, so anything URI-shaped is a red flag.
    if needle
        .chars()
        .any(|c| matches!(c, ':' | '/' | '\\' | '?' | '%' | '&' | '.'))
    {
        return None;
    }
    let needle = needle
        .trim_end_matches(" settings")
        .trim_end_matches(" page")
        .trim();
    // Longest key first so "default apps" beats "apps".
    let mut matches: Vec<_> = SETTINGS_PAGES
        .iter()
        .filter(|(key, _, _)| needle == *key || needle.contains(key))
        .collect();
    matches.sort_by_key(|(key, _, _)| std::cmp::Reverse(key.len()));
    matches.first().map(|(_, uri, label)| (*uri, *label))
}

/// Everything an execution needs from the running app.
pub struct ExecutionContext<'a> {
    pub app: &'a AppHandle,
    pub capabilities: AvailableCapabilities,
}

fn new_plan_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!(
        "plan-{}-{}",
        chrono::Local::now().timestamp_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// Validate the request, then ask the planner.
///
/// Target validation happens here rather than inside `plan()` so the planner
/// stays a pure intent→strategy function that is cheap to test exhaustively.
pub fn create_execution_plan(
    request: &ActionRequest,
    capabilities: &AvailableCapabilities,
) -> Result<PlannedAction, PlanningError> {
    validate_target(request)?;
    Ok(PlannedAction {
        request_id: request.request_id.clone(),
        plan_id: new_plan_id(),
        plan: plan(effective_intent(request), capabilities),
    })
}

/// Narrow "show me X" to "show me the Desktop icon X" when the target says so.
///
/// `plan()` is a pure function of intent and capabilities and stays that way;
/// the target shape is read here instead. A named item on the Desktop is a
/// lookup with an exact answer, and routing it through vision is what put a
/// border around four unrelated icons.
fn effective_intent(request: &ActionRequest) -> ActionIntent {
    match (request.intent, &request.target) {
        (
            ActionIntent::HighlightTarget,
            ActionTarget::Path {
                name: Some(name),
                known_folder,
                path,
            },
        ) if !name.trim().is_empty()
            && (*known_folder == Some(KnownFolder::Desktop) || path.is_none()) =>
        {
            ActionIntent::HighlightDesktopItem
        }
        _ => request.intent,
    }
}

fn validate_target(request: &ActionRequest) -> Result<(), PlanningError> {
    let intent = request.intent;
    let mismatch = |detail: &str| PlanningError::TargetMismatch {
        intent,
        detail: detail.into(),
    };
    match (intent, &request.target) {
        (ActionIntent::Unknown, _) => Err(PlanningError::UnroutableIntent(intent)),
        (
            ActionIntent::OpenFolder | ActionIntent::OpenFile | ActionIntent::CreateFolder,
            ActionTarget::Path {
                path,
                name,
                known_folder,
            },
        ) => {
            if path.is_none() && name.is_none() && known_folder.is_none() {
                Err(PlanningError::MissingTarget(intent))
            } else {
                Ok(())
            }
        }
        (ActionIntent::OpenFolder | ActionIntent::OpenFile | ActionIntent::CreateFolder, _) => {
            Err(mismatch("a file or folder is required"))
        }
        (
            ActionIntent::LaunchApplication
            | ActionIntent::FocusApplication
            | ActionIntent::CloseApplication,
            ActionTarget::Application { app_name, .. },
        ) => {
            if app_name.trim().is_empty() {
                Err(PlanningError::MissingTarget(intent))
            } else {
                Ok(())
            }
        }
        (
            ActionIntent::LaunchApplication
            | ActionIntent::FocusApplication
            | ActionIntent::CloseApplication,
            _,
        ) => Err(mismatch("an application name is required")),
        (ActionIntent::OpenUrl, ActionTarget::Url { url }) => {
            if url.trim().is_empty() {
                Err(PlanningError::MissingTarget(intent))
            } else {
                Ok(())
            }
        }
        (ActionIntent::OpenUrl, _) => Err(mismatch("a URL is required")),
        (ActionIntent::OpenSystemSettings, ActionTarget::SystemSettings { .. }) => Ok(()),
        (ActionIntent::OpenSystemSettings, _) => Err(mismatch("a settings page is required")),
        (ActionIntent::MediaControl, ActionTarget::Media { .. }) => Ok(()),
        (ActionIntent::MediaControl, _) => Err(mismatch("a media target is required")),
        // "Show me the books folder" names a thing, not a look. A Path target is
        // the more precise request, so it is accepted rather than rejected for
        // failing to be a visual description.
        (
            ActionIntent::HighlightTarget | ActionIntent::HighlightDesktopItem,
            ActionTarget::Path { path, name, .. },
        ) => {
            if path.is_none() && name.as_ref().map(|n| n.trim().is_empty()).unwrap_or(true) {
                Err(PlanningError::MissingTarget(intent))
            } else {
                Ok(())
            }
        }
        (ActionIntent::HighlightDesktopItem, _) => {
            Err(mismatch("a named Desktop item is required"))
        }
        (
            ActionIntent::HighlightTarget
            | ActionIntent::ClickTarget
            | ActionIntent::SelectListItem,
            ActionTarget::VisualDescription { .. } | ActionTarget::Media { .. },
        ) => Ok(()),
        (
            ActionIntent::HighlightTarget
            | ActionIntent::ClickTarget
            | ActionIntent::SelectListItem,
            _,
        ) => Err(mismatch("a description of what is on screen is required")),
    }
}

/// Run the plan: one attempt per strategy, stopping the moment continuing could
/// repeat a side effect.
pub fn execute_plan(
    planned: &PlannedAction,
    request: &ActionRequest,
    ctx: &ExecutionContext,
) -> ActionResult {
    let mut result = ActionResult {
        #[cfg(windows)]
        display_refusal: None,
        request_id: planned.request_id.clone(),
        plan_id: planned.plan_id.clone(),
        intent: planned.plan.intent,
        strategy_used: None,
        status: ActionStatus::Failed,
        verification: VerificationResult::not_verifiable(),
        attempts: Vec::new(),
        message: None,
        reason_code: planned.plan.rationale_code.to_string(),
        tool_result: None,
    };

    // Risk gate runs before any strategy. A refusal here is a decision, not an
    // obstacle: it must never fall through to a more invasive route.
    if let Some(denial) = risk_refusal(planned.plan.risk_level, request) {
        result.status = ActionStatus::NeedsConfirmation;
        result.reason_code = "CONFIRMATION_REQUIRED".into();
        result.message = Some(denial);
        return result;
    }

    let chain = std::iter::once(planned.plan.primary_strategy)
        .chain(planned.plan.fallback_strategies.iter().copied());

    for strategy in chain {
        let attempt = run_strategy(strategy, request, ctx);
        result.attempts.push(StrategyAttempt {
            strategy,
            status: format!("{:?}", attempt.status),
            summary: attempt.summary.clone(),
        });
        result.strategy_used = Some(strategy);
        result.status = attempt.action_status;
        result.verification = attempt.verification.clone();
        result.message = Some(attempt.summary.clone());
        if let Some(code) = attempt.reason_code {
            result.reason_code = code.to_string();
        }
        result.tool_result = attempt.tool_result.clone();
        #[cfg(windows)]
        {
            result.display_refusal = attempt.display_refusal.clone();
        }

        if !attempt.status.allows_fallback() {
            return result;
        }
    }
    result
}

fn risk_refusal(risk: RiskLevel, request: &ActionRequest) -> Option<String> {
    match risk {
        RiskLevel::Low | RiskLevel::Moderate => None,
        RiskLevel::High | RiskLevel::Destructive => {
            if request.confirmation_state == ConfirmationState::Confirmed {
                None
            } else {
                Some("This needs your explicit approval before ArcSonare will do it.".into())
            }
        }
    }
}

#[derive(Debug)]
struct Attempt {
    status: AttemptStatus,
    action_status: ActionStatus,
    summary: String,
    verification: VerificationResult,
    reason_code: Option<&'static str>,
    tool_result: Option<ToolResult>,
    /// Present only when a display profile refused this. Carried whole so the
    /// code, the display and the recommended action survive to the frontend.
    #[cfg(windows)]
    display_refusal: Option<crate::display::interaction_error::DisplayInteractionError>,
}

fn from_tool_result(result: ToolResult) -> Attempt {
    let (status, action_status) = match result.status {
        ToolResultStatus::Success => {
            // "Accepted but unconfirmed" is a partial completion, and partials
            // are exactly the case where retrying duplicates the side effect.
            if result.evidence.verified {
                (AttemptStatus::Succeeded, ActionStatus::Succeeded)
            } else {
                (AttemptStatus::Failed, ActionStatus::PartiallyCompleted)
            }
        }
        ToolResultStatus::Partial => (AttemptStatus::Failed, ActionStatus::PartiallyCompleted),
        ToolResultStatus::NeedsConfirmation => {
            (AttemptStatus::Failed, ActionStatus::NeedsConfirmation)
        }
        ToolResultStatus::Cancelled => (AttemptStatus::Failed, ActionStatus::Failed),
        ToolResultStatus::Denied => (AttemptStatus::PermissionDenied, ActionStatus::Denied),
        ToolResultStatus::NotFound => (AttemptStatus::TargetNotFound, ActionStatus::NotFound),
        ToolResultStatus::Unsupported => (AttemptStatus::Unsupported, ActionStatus::Unsupported),
        ToolResultStatus::Timeout | ToolResultStatus::Error => {
            (AttemptStatus::Failed, ActionStatus::Failed)
        }
    };
    Attempt {
        status,
        action_status,
        summary: result.summary.clone(),
        verification: VerificationResult {
            verified: result.evidence.verified,
            method: result.evidence.method.clone(),
            details: result.evidence.details.clone(),
        },
        reason_code: None,
        tool_result: Some(result),
        #[cfg(windows)]
        display_refusal: None,
    }
}

fn refusal(
    status: AttemptStatus,
    action_status: ActionStatus,
    reason_code: &'static str,
    summary: impl Into<String>,
) -> Attempt {
    Attempt {
        status,
        action_status,
        summary: summary.into(),
        verification: VerificationResult::not_verifiable(),
        reason_code: Some(reason_code),
        tool_result: None,
        #[cfg(windows)]
        display_refusal: None,
    }
}

/// A typed display refusal, as an attempt the chain must stop at.
///
/// `AttemptStatus::DisplayRefused` rather than `Unavailable`: the fallback for a
/// Desktop highlight is the vision route, on the same monitor the gate just
/// refused, so letting this fall through would answer a refusal with a second
/// visual attempt at the same place.
#[cfg(windows)]
fn display_refusal(e: crate::display::interaction_error::DisplayInteractionError) -> Attempt {
    Attempt {
        status: AttemptStatus::DisplayRefused,
        action_status: ActionStatus::NotReady,
        summary: e.message.clone(),
        verification: VerificationResult::not_verifiable(),
        // The typed code, never a generic one — the whole point of the type.
        reason_code: Some(e.code.as_str()),
        tool_result: None,
        display_refusal: Some(e),
    }
}

fn run_strategy(
    strategy: ExecutionStrategy,
    request: &ActionRequest,
    ctx: &ExecutionContext,
) -> Attempt {
    match strategy {
        ExecutionStrategy::NativeOs | ExecutionStrategy::InternalCapability => {
            run_native(request, ctx)
        }
        // The gate. Identifying the strategy correctly is not permission to run
        // the executor that puts borders on the wrong monitor.
        ExecutionStrategy::VisualInteraction => visual_attempt(&ctx.capabilities),
        ExecutionStrategy::ApplicationAdapter
        | ExecutionStrategy::UiAutomation
        | ExecutionStrategy::BrowserAutomation
        | ExecutionStrategy::KeyboardAutomation => refusal(
            AttemptStatus::Unavailable,
            ActionStatus::Unsupported,
            "STRUCTURED_ACTION_UNAVAILABLE",
            format!("{strategy:?} has no implementation in this build."),
        ),
        ExecutionStrategy::UserConfirmation => refusal(
            AttemptStatus::Failed,
            ActionStatus::NeedsConfirmation,
            "CONFIRMATION_REQUIRED",
            "ArcSonare needs you to confirm before continuing.",
        ),
        ExecutionStrategy::Unsupported => refusal(
            AttemptStatus::Unsupported,
            ActionStatus::Unsupported,
            "STRUCTURED_ACTION_UNAVAILABLE",
            "ArcSonare has no way to do that yet.",
        ),
    }
}

/// Why a screen-based route cannot run yet.
///
/// Kept separate from `run_strategy` so the refusal can be proven without an
/// `AppHandle` — the point of the test is that no executor is reached at all.
fn visual_attempt(capabilities: &AvailableCapabilities) -> Attempt {
    if !capabilities.visual_interaction {
        let step = super::strategy::VisualMigrationState::current()
            .blocking_step()
            .unwrap_or("the visual path is not migrated");
        return refusal(
            AttemptStatus::Unavailable,
            ActionStatus::NotReady,
            "VISUAL_INTERACTION_NOT_READY",
            format!("I can't point at things on screen reliably yet — {step}."),
        );
    }
    // The ownership migration is done, so vision is a usable route — but not
    // from here. Finding something on screen needs a model call, and that lives
    // in the assistant loop, which reaches the same migrated executor through
    // the `screen.click_target` / `screen.highlight_target` capabilities.
    // Saying so is better than this module growing a second, blinder copy.
    refusal(
        AttemptStatus::Unsupported,
        ActionStatus::Unsupported,
        "VISUAL_EXECUTION_VIA_CAPABILITY",
        "Finding things on screen runs through the screen capabilities, not the native planner.",
    )
}

/// Outline one Desktop icon, using the shell's own rectangle for it.
///
/// Refusals are deliberate rather than degraded: a name the shell cannot find is
/// reported as not found, and two names that match equally are reported as
/// ambiguous. Neither falls through to drawing something — a border round the
/// wrong icon is indistinguishable from a border round the right one, so the
/// only safe failure is a visible one.
#[cfg(windows)]
/// Find the Desktop item to outline, or the refusal that replaces it.
///
/// Split from the drawing so the lookup refusals stay testable without an
/// `AppHandle` — the display gate below needs one, and "no such item" should not
/// require a running application to prove it is reported honestly.
fn locate_desktop_item(
    name: &str,
) -> Result<crate::capabilities::desktop_items::DesktopItem, Attempt> {
    use crate::capabilities::desktop_items::{
        enumerate_desktop_items, match_item, DesktopItemKind, MatchFailure,
    };

    let items = match enumerate_desktop_items() {
        Ok(i) => i,
        Err(e) => {
            // Let the visual fallback have a turn; the shell is unreadable.
            return Err(refusal(
                AttemptStatus::Unavailable,
                ActionStatus::NotReady,
                "DESKTOP_LOOKUP_UNAVAILABLE",
                e,
            ));
        }
    };
    match match_item(&items, name, DesktopItemKind::Any) {
        Ok(item) => Ok(item.clone()),
        Err(MatchFailure::Ambiguous(names)) => Err(refusal(
            AttemptStatus::Failed,
            ActionStatus::NeedsConfirmation,
            "AMBIGUOUS_TARGET",
            format!(
                "There are {} Desktop items matching \"{}\": {}. Which one?",
                names.len(),
                name,
                names.join(", ")
            ),
        )),
        Err(MatchFailure::NotFound) => Err(refusal(
            AttemptStatus::TargetNotFound,
            ActionStatus::NotFound,
            "TARGET_NOT_FOUND",
            format!("Nothing on the Desktop is called \"{name}\"."),
        )),
    }
}

fn highlight_desktop_item(app: &AppHandle, name: &str) -> Attempt {
    let found = match locate_desktop_item(name) {
        Ok(item) => item,
        Err(refused) => return refused,
    };

    let bounds = found.bounds;
    // The shell reports icon bounds in final virtual-desktop physical pixels —
    // the same space the overlay draws in. So the profile is consulted only to
    // decide *whether* this display may be drawn on, and the rectangle is passed
    // through untouched. Applying the correction here would be a second offset
    // on a coordinate that was never displaced in the first place.
    //
    // Drawing on an unverified display is a visual action like any other, and
    // the only way to reach the overlay is to hold an `AuthorizedRect`, so this
    // cannot be skipped by forgetting a check.
    let authorized = match crate::display::gate::authorize_desktop_rect(
        app,
        crate::display::side_effects::DesktopRect {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        },
    ) {
        Ok(r) => r,
        Err(e) => {
            return refusal(
                AttemptStatus::Unavailable,
                ActionStatus::NotReady,
                // The typed code travels intact instead of collapsing into one
                // `DISPLAY_NOT_VERIFIED` that the planner cannot act on.
                e.code.as_str(),
                e.message,
            );
        }
    };
    if let Err(e) = {
        use crate::display::side_effects::VisualSideEffects;
        crate::native_overlay::init();
        crate::display::side_effects::NativeSideEffects.show_overlay(authorized)
    } {
        return refusal(
            AttemptStatus::Failed,
            ActionStatus::Failed,
            "OVERLAY_FAILED",
            e,
        );
    }

    // The rectangle came from Windows and the overlay was drawn on exactly it,
    // so the evidence is a state readback rather than a return code.
    let (cx, cy) = bounds.center();
    Attempt {
        status: AttemptStatus::Succeeded,
        action_status: ActionStatus::Succeeded,
        summary: format!("That's “{}” — I've put a border around it.", found.name),
        verification: VerificationResult {
            verified: true,
            method: "shell-list-view".into(),
            details: Some(json!({
                "name": found.name,
                "path": found.path,
                "isFolder": found.is_folder,
                "source": found.source,
                "bounds": bounds,
                "center": [cx, cy],
                "visionCalled": false,
                "screenshotTaken": false,
                "cursorMoved": false,
                "clicked": false,
                "displayProfileChecked": true,
            })),
        },
        reason_code: Some("STRUCTURED_DESKTOP_LOOKUP"),
        tool_result: None,
        #[cfg(windows)]
        display_refusal: None,
    }
}

fn run_native(request: &ActionRequest, ctx: &ExecutionContext) -> Attempt {
    match (effective_intent(request), &request.target) {
        // Ask Windows where the icon is, then outline exactly that rectangle.
        // No capture, no model, no cursor, no click.
        #[cfg(windows)]
        (
            ActionIntent::HighlightDesktopItem,
            ActionTarget::Path {
                name: Some(name), ..
            },
        ) => highlight_desktop_item(ctx.app, name),
        (
            ActionIntent::OpenFolder | ActionIntent::OpenFile,
            ActionTarget::Path {
                path,
                name,
                known_folder,
            },
        ) => match resolve_path(path.as_deref(), name.as_deref(), *known_folder) {
            Ok(resolved) => {
                let result = filesystem::open_item(filesystem::PathArgs {
                    path: resolved.clone(),
                });
                let mut attempt = from_tool_result(result);
                // The shell call returning Ok says nothing about the folder. Its
                // existence does, and it is the postcondition the user cares
                // about, so upgrade the evidence from return-code to a real one.
                if attempt.action_status == ActionStatus::PartiallyCompleted
                    && std::path::Path::new(&resolved).exists()
                {
                    attempt.status = AttemptStatus::Succeeded;
                    attempt.action_status = ActionStatus::Succeeded;
                    attempt.verification = VerificationResult {
                        verified: true,
                        method: "filesystem-postcondition".into(),
                        details: Some(json!({ "path": resolved, "exists": true })),
                    };
                }
                attempt
            }
            Err(e) => e,
        },
        (
            ActionIntent::CreateFolder,
            ActionTarget::Path {
                path,
                name,
                known_folder,
            },
        ) => {
            let Some(new_name) = name.as_deref().filter(|n| !n.trim().is_empty()) else {
                return refusal(
                    AttemptStatus::Failed,
                    ActionStatus::Failed,
                    "MISSING_TARGET",
                    "I need a name for the folder.",
                );
            };
            let parent = match (path.as_deref(), known_folder) {
                (Some(p), _) => p.to_string(),
                (None, Some(folder)) => match filesystem::known_folder_path(folder.as_id()) {
                    Some(p) => p.to_string_lossy().into_owned(),
                    None => {
                        return refusal(
                            AttemptStatus::Failed,
                            ActionStatus::Failed,
                            "MISSING_TARGET",
                            "That folder location could not be resolved.",
                        )
                    }
                },
                (None, None) => {
                    return refusal(
                        AttemptStatus::Failed,
                        ActionStatus::Failed,
                        "MISSING_TARGET",
                        "I need to know where to create it.",
                    )
                }
            };
            from_tool_result(filesystem::create_directory(
                filesystem::CreateDirectoryArgs {
                    parent_path: parent,
                    name: new_name.to_string(),
                    recursive: None,
                    if_exists: None,
                },
            ))
        }
        (ActionIntent::LaunchApplication, ActionTarget::Application { app_name, app_id }) => {
            from_tool_result(applications::open_application(
                ctx.app,
                applications::OpenArgs {
                    query: app_id.is_none().then(|| app_name.clone()),
                    target_id: app_id.clone(),
                    preference: None,
                },
            ))
        }
        (ActionIntent::FocusApplication, ActionTarget::Application { app_name, .. }) => {
            from_tool_result(applications::focus_application(
                ctx.app,
                applications::FocusCloseArgs {
                    query: app_name.clone(),
                },
            ))
        }
        (ActionIntent::CloseApplication, ActionTarget::Application { app_name, .. }) => {
            from_tool_result(applications::close_application(
                ctx.app,
                applications::FocusCloseArgs {
                    query: app_name.clone(),
                },
            ))
        }
        (ActionIntent::OpenUrl, ActionTarget::Url { url }) => {
            from_tool_result(web::open_url(web::OpenUrlArgs { url: url.clone() }))
        }
        (ActionIntent::OpenSystemSettings, ActionTarget::SystemSettings { page }) => {
            let Some((uri, label)) = resolve_settings_page(page) else {
                return refusal(
                    AttemptStatus::TargetNotFound,
                    ActionStatus::NotFound,
                    "UNKNOWN_SETTINGS_PAGE",
                    format!("\"{page}\" isn't a Windows Settings page I can open."),
                );
            };
            match open::that(uri) {
                Ok(()) => Attempt {
                    status: AttemptStatus::Succeeded,
                    action_status: ActionStatus::Succeeded,
                    summary: format!("Opened {label}."),
                    verification: VerificationResult {
                        verified: true,
                        method: "return-code".into(),
                        details: Some(json!({ "uri": uri })),
                    },
                    reason_code: Some("NATIVE_CAPABILITY_AVAILABLE"),
                    tool_result: None,
                    #[cfg(windows)]
                    display_refusal: None,
                },
                Err(e) => refusal(
                    AttemptStatus::Failed,
                    ActionStatus::Failed,
                    "SETTINGS_LAUNCH_FAILED",
                    format!("Windows refused to open {label}: {e}"),
                ),
            }
        }
        (intent, _) => refusal(
            AttemptStatus::Unsupported,
            ActionStatus::Unsupported,
            "STRUCTURED_ACTION_UNAVAILABLE",
            format!("{intent:?} has no native route."),
        ),
    }
}

/// Turn whatever the request carried into one absolute path, or refuse.
///
/// The refusal matters: searching for "ArcSonare" and opening the first of four
/// matches is how a user ends up staring at the wrong folder, so an ambiguous
/// search asks instead of picking.
fn resolve_path(
    path: Option<&str>,
    name: Option<&str>,
    known_folder: Option<super::request::KnownFolder>,
) -> Result<String, Attempt> {
    if let Some(p) = path.filter(|p| !p.trim().is_empty()) {
        let candidate = std::path::Path::new(p);
        if !candidate.exists() {
            return Err(refusal(
                AttemptStatus::TargetNotFound,
                ActionStatus::NotFound,
                "TARGET_NOT_FOUND",
                format!("\"{p}\" doesn't exist."),
            ));
        }
        return Ok(p.to_string());
    }

    let name = name.map(str::trim).filter(|n| !n.is_empty());

    if let Some(folder) = known_folder {
        let Some(base) = filesystem::known_folder_path(folder.as_id()) else {
            return Err(refusal(
                AttemptStatus::TargetNotFound,
                ActionStatus::NotFound,
                "TARGET_NOT_FOUND",
                format!("Windows has no {} folder.", folder.as_id()),
            ));
        };
        let target = match name {
            Some(n) => base.join(n),
            None => base,
        };
        if !target.exists() {
            // Named-but-absent under a known folder is still worth a search: the
            // user may have said "desktop" loosely.
            return match name {
                Some(n) => search_for(n),
                None => Err(refusal(
                    AttemptStatus::TargetNotFound,
                    ActionStatus::NotFound,
                    "TARGET_NOT_FOUND",
                    format!("\"{}\" doesn't exist.", target.display()),
                )),
            };
        }
        return Ok(target.to_string_lossy().into_owned());
    }

    match name {
        Some(n) => search_for(n),
        None => Err(refusal(
            AttemptStatus::Failed,
            ActionStatus::Failed,
            "MISSING_TARGET",
            "I need to know which folder you mean.",
        )),
    }
}

fn search_for(name: &str) -> Result<String, Attempt> {
    let found = filesystem::find(filesystem::FindArgs {
        query: name.to_string(),
        roots: Vec::new(),
        item_type: None,
        extension: None,
        recursive: Some(true),
        max_depth: None,
        limit: Some(5),
    });
    let results = found
        .data
        .as_ref()
        .and_then(|d| d.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let exact: Vec<_> = results
        .iter()
        .filter(|r| {
            r.get("name")
                .and_then(|n| n.as_str())
                .map(|n| n.eq_ignore_ascii_case(name))
                .unwrap_or(false)
        })
        .collect();
    let pool = if exact.is_empty() {
        results.iter().collect::<Vec<_>>()
    } else {
        exact
    };

    match pool.len() {
        0 => Err(refusal(
            AttemptStatus::TargetNotFound,
            ActionStatus::NotFound,
            "TARGET_NOT_FOUND",
            format!("I couldn't find anything called \"{name}\"."),
        )),
        1 => pool[0]
            .get("path")
            .and_then(|p| p.as_str())
            .map(str::to_string)
            .ok_or_else(|| {
                refusal(
                    AttemptStatus::TargetNotFound,
                    ActionStatus::NotFound,
                    "TARGET_NOT_FOUND",
                    format!("I couldn't resolve a path for \"{name}\"."),
                )
            }),
        n => Err(refusal(
            AttemptStatus::Failed,
            ActionStatus::NeedsConfirmation,
            "AMBIGUOUS_TARGET",
            format!("I found {n} things called \"{name}\" — which one did you mean?"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interaction::request::{KnownFolder, RequestSource};

    fn request(intent: ActionIntent, target: ActionTarget) -> ActionRequest {
        ActionRequest {
            request_id: "req-test".into(),
            intent,
            target,
            parameters: serde_json::Value::Null,
            source: RequestSource::Chat,
            confirmation_state: ConfirmationState::NotRequired,
        }
    }

    fn caps() -> AvailableCapabilities {
        AvailableCapabilities::current()
    }

    /// The request the frontend builds for "… the books folder on my Desktop".
    fn books(intent: ActionIntent) -> ActionRequest {
        request(
            intent,
            ActionTarget::Path {
                path: None,
                name: Some("books".into()),
                known_folder: Some(KnownFolder::Desktop),
            },
        )
    }

    /// "Open" and "show me" name the same folder and must not share a route.
    #[test]
    fn open_books_and_show_books_take_different_routes() {
        let open = create_execution_plan(&books(ActionIntent::OpenFolder), &caps()).unwrap();
        let show = create_execution_plan(&books(ActionIntent::HighlightTarget), &caps()).unwrap();

        assert_eq!(open.plan.primary_strategy, ExecutionStrategy::NativeOs);
        assert_eq!(open.plan.intent, ActionIntent::OpenFolder);

        assert_eq!(show.plan.intent, ActionIntent::HighlightDesktopItem);
        assert_eq!(
            show.plan.primary_strategy,
            ExecutionStrategy::InternalCapability
        );
        assert_ne!(open.plan.primary_strategy, show.plan.primary_strategy);
    }

    /// Neither route may photograph the screen or take the pointer.
    #[test]
    fn neither_books_route_needs_the_screen_or_the_cursor() {
        for intent in [ActionIntent::OpenFolder, ActionIntent::HighlightTarget] {
            let planned = create_execution_plan(&books(intent), &caps()).unwrap();
            assert!(
                !planned.plan.requires_screen_capture,
                "{intent:?} asked for a screenshot"
            );
            assert!(
                !planned.plan.requires_cursor,
                "{intent:?} asked for the cursor"
            );
        }
    }

    /// Showing a Desktop item is a lookup; vision is only the fallback.
    #[test]
    fn showing_a_desktop_item_keeps_vision_as_a_fallback_not_the_plan() {
        let planned =
            create_execution_plan(&books(ActionIntent::HighlightTarget), &caps()).unwrap();
        assert_eq!(
            planned.plan.rationale_code,
            "STRUCTURED_DESKTOP_LOOKUP_AVAILABLE"
        );
        assert!(planned
            .plan
            .fallback_strategies
            .contains(&ExecutionStrategy::VisualInteraction));
    }

    /// Without a readable icon list the request still works, via vision.
    #[test]
    fn without_a_shell_icon_list_showing_falls_back_to_vision() {
        let mut degraded = caps();
        degraded.desktop_items = false;
        let planned =
            create_execution_plan(&books(ActionIntent::HighlightTarget), &degraded).unwrap();
        assert_eq!(
            planned.plan.primary_strategy,
            ExecutionStrategy::VisualInteraction
        );
        assert_eq!(
            planned.plan.rationale_code,
            "STRUCTURED_DESKTOP_LOOKUP_UNAVAILABLE"
        );
        assert!(
            !planned.plan.requires_cursor,
            "showing must never take the cursor, even through vision"
        );
    }

    /// "Show me the blue Play button" is still a recognition problem.
    #[test]
    fn a_described_target_is_not_diverted_into_the_desktop_lookup() {
        let planned = create_execution_plan(
            &request(
                ActionIntent::HighlightTarget,
                ActionTarget::VisualDescription {
                    description: "the blue Play button".into(),
                    display_id: None,
                },
            ),
            &caps(),
        )
        .unwrap();
        assert_eq!(planned.plan.intent, ActionIntent::HighlightTarget);
        assert_eq!(
            planned.plan.primary_strategy,
            ExecutionStrategy::VisualInteraction
        );
    }

    #[test]
    fn a_nameless_desktop_highlight_is_refused_rather_than_guessed() {
        let planned = create_execution_plan(
            &request(
                ActionIntent::HighlightTarget,
                ActionTarget::Path {
                    path: None,
                    name: Some("   ".into()),
                    known_folder: Some(KnownFolder::Desktop),
                },
            ),
            &caps(),
        );
        assert!(planned.is_err(), "an empty name must not plan");
    }

    /// A name the Desktop does not have must be said out loud, not approximated.
    #[cfg(windows)]
    #[test]
    fn a_desktop_item_that_is_not_there_is_reported_rather_than_drawn() {
        use crate::capabilities::desktop_items::enumerate_desktop_items;
        if enumerate_desktop_items().is_err() {
            return; // no shell in this session; nothing to assert about
        }
        let attempt = locate_desktop_item("zzz not a real desktop item 9f3a")
            .expect_err("a name that is not there must be refused");
        assert_eq!(attempt.status, AttemptStatus::TargetNotFound);
        assert_eq!(attempt.action_status, ActionStatus::NotFound);
        assert_eq!(attempt.reason_code, Some("TARGET_NOT_FOUND"));
        assert!(
            !attempt.verification.verified,
            "nothing was drawn, so nothing is verified"
        );
    }

    #[test]
    fn opening_a_folder_plans_a_native_route_with_no_screen_or_cursor() {
        let req = request(
            ActionIntent::OpenFolder,
            ActionTarget::Path {
                path: None,
                name: Some("ArcSonare".into()),
                known_folder: Some(KnownFolder::Desktop),
            },
        );
        let planned = create_execution_plan(&req, &caps()).expect("folder request must plan");
        assert_eq!(planned.plan.primary_strategy, ExecutionStrategy::NativeOs);
        assert!(!planned.plan.requires_screen_capture);
        assert!(!planned.plan.requires_cursor);
        assert_eq!(planned.request_id, "req-test");
        assert!(planned.plan_id.starts_with("plan-"));
    }

    #[test]
    fn a_url_request_carrying_a_path_is_refused_before_anything_runs() {
        let req = request(
            ActionIntent::OpenUrl,
            ActionTarget::Path {
                path: Some("C:/Windows".into()),
                name: None,
                known_folder: None,
            },
        );
        let err = create_execution_plan(&req, &caps()).unwrap_err();
        assert_eq!(err.code(), "TARGET_MISMATCH");
    }

    #[test]
    fn a_folder_request_with_nothing_to_open_is_refused() {
        let req = request(
            ActionIntent::OpenFolder,
            ActionTarget::Path {
                path: None,
                name: None,
                known_folder: None,
            },
        );
        assert_eq!(
            create_execution_plan(&req, &caps()).unwrap_err().code(),
            "MISSING_TARGET"
        );
    }

    #[test]
    fn every_native_intent_plans_without_the_cursor_or_a_screenshot() {
        let cases = [
            (
                ActionIntent::OpenFolder,
                ActionTarget::Path {
                    path: None,
                    name: Some("x".into()),
                    known_folder: Some(KnownFolder::Desktop),
                },
            ),
            (
                ActionIntent::LaunchApplication,
                ActionTarget::Application {
                    app_name: "Spotify".into(),
                    app_id: None,
                },
            ),
            (
                ActionIntent::FocusApplication,
                ActionTarget::Application {
                    app_name: "Spotify".into(),
                    app_id: None,
                },
            ),
            (
                ActionIntent::OpenUrl,
                ActionTarget::Url {
                    url: "https://github.com".into(),
                },
            ),
            (
                ActionIntent::OpenSystemSettings,
                ActionTarget::SystemSettings {
                    page: "wi-fi".into(),
                },
            ),
        ];
        for (intent, target) in cases {
            let planned = create_execution_plan(&request(intent, target), &caps()).unwrap();
            assert!(
                !planned.plan.requires_cursor,
                "{intent:?} asked for the cursor"
            );
            assert!(
                !planned.plan.requires_screen_capture,
                "{intent:?} asked for a screenshot"
            );
        }
    }

    #[test]
    fn every_named_settings_page_maps_to_an_ms_settings_uri() {
        for phrase in [
            "Wi-Fi",
            "wifi settings",
            "bluetooth",
            "display settings",
            "sound",
            "notifications",
            "apps",
            "windows update",
        ] {
            let (uri, _) =
                resolve_settings_page(phrase).unwrap_or_else(|| panic!("{phrase} did not resolve"));
            assert!(uri.starts_with("ms-settings:"), "{phrase} → {uri}");
        }
    }

    #[test]
    fn an_unknown_settings_page_is_refused_rather_than_guessed() {
        assert!(resolve_settings_page("quantum tunnelling").is_none());
    }

    #[test]
    fn a_more_specific_settings_phrase_wins_over_a_shorter_one() {
        // "default apps" must not be swallowed by "apps".
        let (uri, _) = resolve_settings_page("default apps").unwrap();
        assert_eq!(uri, "ms-settings:defaultapps");
    }

    #[test]
    fn a_settings_page_never_becomes_an_arbitrary_uri() {
        // The scheme reaches far more than Settings; only the allowlist runs.
        for hostile in ["file:///C:/Windows", "shell:startup", "ms-settings:../.."] {
            assert!(
                resolve_settings_page(hostile).is_none(),
                "{hostile} resolved"
            );
        }
    }

    #[test]
    fn the_native_planner_never_runs_a_visual_action_itself() {
        // Two outcomes are acceptable and both are refusals: not-ready while the
        // gate is shut, delegated once it is open. What must never happen is
        // this module producing a click of its own.
        let attempt = visual_attempt(&caps());
        assert!(
            matches!(
                attempt.reason_code,
                Some("VISUAL_INTERACTION_NOT_READY") | Some("VISUAL_EXECUTION_VIA_CAPABILITY")
            ),
            "{:?}",
            attempt.reason_code
        );
        assert!(attempt.tool_result.is_none(), "no executor may have run");
    }

    #[test]
    fn a_shut_gate_still_names_the_outstanding_step() {
        let mut closed = caps();
        closed.visual_interaction = false;
        let attempt = visual_attempt(&closed);
        assert_eq!(attempt.action_status, ActionStatus::NotReady);
        assert_eq!(attempt.reason_code, Some("VISUAL_INTERACTION_NOT_READY"));
    }

    #[test]
    fn a_show_me_request_plans_visually_and_asks_for_no_cursor() {
        let planned = create_execution_plan(
            &request(
                ActionIntent::HighlightTarget,
                ActionTarget::VisualDescription {
                    description: "the ArcSonare folder".into(),
                    display_id: None,
                },
            ),
            &caps(),
        )
        .unwrap();
        assert_eq!(
            planned.plan.primary_strategy,
            ExecutionStrategy::VisualInteraction
        );
        assert_eq!(planned.plan.rationale_code, "USER_REQUESTED_HIGHLIGHT");
        assert!(
            !planned.plan.requires_cursor,
            "showing where something is must not take over the mouse"
        );
        // Vision is terminal for "show me": there is nothing more invasive to
        // escalate to, so the refusal is the final answer rather than a step.
        assert!(planned.plan.fallback_strategies.is_empty());
    }

    #[test]
    fn an_accepted_but_unconfirmed_launch_is_partial_and_stops_the_chain() {
        // "Windows accepted the launch" is not "Spotify is open". Calling that a
        // success — or retrying it — is how a second instance gets opened.
        use crate::capabilities::types::{ResultBuilder, VerificationEvidence};
        let accepted = ResultBuilder::new("applications.open").success(
            "Opened Spotify.",
            json!({}),
            VerificationEvidence::unverified("return-code"),
        );
        let attempt = from_tool_result(accepted);
        assert_eq!(attempt.action_status, ActionStatus::PartiallyCompleted);
        assert!(
            !attempt.status.allows_fallback(),
            "a possible side effect must never be followed by another attempt"
        );
    }

    /// These touch the real machine, because "it planned correctly" is not the
    /// claim being made — the claim is that on *this* Windows install, opening a
    /// folder resolves to a real path without a screenshot. They resolve and
    /// verify only; nothing is launched, so running the suite opens no windows.
    mod live {
        use super::*;

        #[test]
        fn the_desktop_resolves_without_looking_at_the_screen() {
            let resolved = resolve_path(None, None, Some(KnownFolder::Desktop))
                .expect("this machine must have a Desktop");
            let path = std::path::Path::new(&resolved);
            assert!(path.is_dir(), "{resolved} is not a directory");
            // A redirected (OneDrive) Desktop is still the Desktop; the point is
            // that Windows told us where it is rather than us assuming.
            assert!(
                resolved.to_lowercase().contains("desktop"),
                "unexpected desktop location: {resolved}"
            );
        }

        #[test]
        fn a_named_folder_under_the_desktop_resolves_to_its_real_path() {
            // ArcSonare's own folder lives on this Desktop, which makes it the
            // one target the handoff's "open the ArcSonare folder" test needs.
            let resolved = resolve_path(None, Some("ArcSonare"), Some(KnownFolder::Desktop));
            match resolved {
                Ok(path) => assert!(
                    std::path::Path::new(&path).is_dir(),
                    "{path} resolved but is not a directory"
                ),
                // On a machine without it, the correct behaviour is a refusal —
                // never a silent fallback to some other folder.
                Err(attempt) => assert_eq!(attempt.action_status, ActionStatus::NotFound),
            }
        }

        #[test]
        fn a_folder_that_does_not_exist_is_refused_rather_than_substituted() {
            let err = resolve_path(Some("C:\\definitely-not-a-real-folder-9f3a1c"), None, None)
                .unwrap_err();
            assert_eq!(err.action_status, ActionStatus::NotFound);
            assert!(err.tool_result.is_none(), "nothing may have been opened");
        }
    }

    #[test]
    fn a_target_that_was_never_found_may_still_fall_back() {
        use crate::capabilities::types::ResultBuilder;
        let missing = ResultBuilder::new("applications.open").not_found("No such app.");
        let attempt = from_tool_result(missing);
        assert_eq!(attempt.action_status, ActionStatus::NotFound);
        assert!(attempt.status.allows_fallback());
    }

    #[test]
    fn a_high_risk_request_without_approval_stops_before_any_strategy() {
        let req = ActionRequest {
            confirmation_state: ConfirmationState::Pending,
            ..request(
                ActionIntent::OpenUrl,
                ActionTarget::Url {
                    url: "https://example.com".into(),
                },
            )
        };
        // OpenUrl is Low today; assert the gate itself, independent of routing.
        assert!(risk_refusal(RiskLevel::Low, &req).is_none());
        assert!(risk_refusal(RiskLevel::High, &req).is_some());
        assert!(risk_refusal(RiskLevel::Destructive, &req).is_some());
        let approved = ActionRequest {
            confirmation_state: ConfirmationState::Confirmed,
            ..req
        };
        assert!(risk_refusal(RiskLevel::Destructive, &approved).is_none());
    }
}
