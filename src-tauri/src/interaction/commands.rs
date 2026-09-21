//! The seam between the webview and the planner.
//!
//! The frontend says what the user wants; Rust decides how it happens. Strategy
//! selection deliberately does not cross this boundary — a webview that could
//! name its own strategy would be one prompt injection away from choosing the
//! cursor.

use serde_json::json;
use tauri::AppHandle;

use super::executor::{create_execution_plan, execute_plan, ExecutionContext};
use super::request::{
    ActionRequest, ActionResult, ActionStatus, ActionTarget, PlanExecutionDisposition,
    PlannedAction, VerificationResult, VisualExecutionRequest,
};
use super::strategy::{
    ActionIntent, AvailableCapabilities, ExecutionStrategy, VisualMigrationState,
};
use crate::capabilities::applications;

/// What ArcSonare can actually do on this machine, right now.
///
/// Probed rather than declared where probing is possible: an empty application
/// index means "launching by name will not work", and the planner needs to know
/// that before it promises to launch something.
pub fn live_capabilities(app: &AppHandle) -> AvailableCapabilities {
    let mut caps = AvailableCapabilities::with_visual_state(VisualMigrationState::current());
    caps.native_filesystem = dirs::desktop_dir().map(|p| p.is_dir()).unwrap_or(false)
        || dirs::home_dir().map(|p| p.is_dir()).unwrap_or(false);
    caps.application_registry = !applications::get_index(app, false).is_empty();
    // Media keys are a Win32 primitive; nothing to probe.
    caps.media_keys = cfg!(windows);
    // Probed, not declared: a locked session or a shell that has not started
    // leaves the icon list unreadable, and the planner must fall back to vision
    // rather than promise a lookup that will fail.
    #[cfg(windows)]
    {
        caps.desktop_items = crate::capabilities::desktop_items::enumerate_desktop_items()
            .map(|items| !items.is_empty())
            .unwrap_or(false);
    }
    // No adapter, accessibility bridge or browser connection is built. These
    // stay false until one exists — a capability that silently does nothing is
    // worse than an admitted gap, because the planner would pick it.
    caps.application_adapter = false;
    caps.ui_automation = false;
    caps.browser_automation = false;
    caps
}

#[tauri::command]
pub fn get_available_capabilities(app: AppHandle) -> serde_json::Value {
    let caps = live_capabilities(&app);
    let visual = VisualMigrationState::current();
    json!({
        "nativeFilesystem": caps.native_filesystem,
        "nativeApplicationLaunch": caps.application_registry,
        "nativeUrlLaunch": true,
        "nativeWindowControl": cfg!(windows),
        "mediaControl": caps.media_keys,
        "keyboardAutomation": cfg!(windows),
        "applicationAdapter": caps.application_adapter,
        "uiAutomation": caps.ui_automation,
        "browserAutomation": caps.browser_automation,
        "visualInteraction": caps.visual_interaction,
        "visualMigration": {
            "complete": visual.is_complete(),
            "blockingStep": visual.blocking_step(),
        },
    })
}

/// Decide the route without taking it. Used for diagnostics and for UI that
/// wants to say "Opening folder directly…" before anything happens.
#[tauri::command]
pub fn plan_action(app: AppHandle, request: ActionRequest) -> Result<PlannedAction, String> {
    create_execution_plan(&request, &live_capabilities(&app))
        .map_err(|e| format!("{}: {}", e.code(), e.message()))
}

/// Plan an action and say what happens next.
///
/// Three outcomes, kept distinct on purpose: it is done, it needs the assistant
/// loop's eyes, or nothing here can do it. Collapsing the middle case into a
/// failure is what made visual requests look broken rather than delegated.
#[tauri::command]
pub fn plan_and_dispatch_action(
    app: AppHandle,
    request: ActionRequest,
) -> PlanExecutionDisposition {
    let capabilities = live_capabilities(&app);
    let planned = match create_execution_plan(&request, &capabilities) {
        Ok(p) => p,
        Err(e) => {
            return PlanExecutionDisposition::Unsupported(ActionResult {
                #[cfg(windows)]
                display_refusal: None,
                request_id: request.request_id.clone(),
                plan_id: "unplanned".into(),
                intent: request.intent,
                strategy_used: None,
                status: ActionStatus::Failed,
                verification: VerificationResult::not_verifiable(),
                attempts: Vec::new(),
                message: Some(e.message()),
                reason_code: e.code().to_string(),
                tool_result: None,
            })
        }
    };

    // A visual plan is handed back rather than run: the model call belongs to
    // the assistant loop, and Rust keeps everything else.
    if planned.plan.primary_strategy == ExecutionStrategy::VisualInteraction
        && capabilities.visual_interaction
    {
        return PlanExecutionDisposition::RequiresVision(vision_request_for(&request, &planned));
    }

    let ctx = ExecutionContext {
        app: &app,
        capabilities,
    };
    let result = execute_plan(&planned, &request, &ctx);
    if result.status == ActionStatus::Unsupported {
        PlanExecutionDisposition::Unsupported(result)
    } else {
        PlanExecutionDisposition::Executed(result)
    }
}

/// Fill in everything the assistant loop needs, and nothing it gets to choose.
///
/// The verifier is named here, from the fixed set in
/// `display::verification::VisualExpectedOutcome` — the model that will look at
/// the screen has no say in how its own answer gets checked.
fn vision_request_for(request: &ActionRequest, planned: &PlannedAction) -> VisualExecutionRequest {
    // Pointing at something and pressing it are different acts, and only one of
    // them needs proving afterwards.
    let requires_click = planned.plan.intent != ActionIntent::HighlightTarget;
    VisualExecutionRequest {
        correlation_id: format!("corr-{}-{}", request.request_id, planned.plan_id),
        request_id: request.request_id.clone(),
        plan_id: planned.plan_id.clone(),
        intent: planned.plan.intent,
        target_description: describe_visual_target(request),
        requires_click,
        requires_overlay: !requires_click,
        expected_outcome: if requires_click {
            json!({ "kind": "region-changed" })
        } else {
            json!({ "kind": "none" })
        },
        risk_level: planned.plan.risk_level,
    }
}

/// What the assistant loop should look for, in the user's own terms.
fn describe_visual_target(request: &ActionRequest) -> String {
    match &request.target {
        ActionTarget::VisualDescription { description, .. } => description.clone(),
        ActionTarget::Media {
            item_name: Some(name),
            ..
        } => name.clone(),
        ActionTarget::Application { app_name, .. } => app_name.clone(),
        ActionTarget::Path {
            name: Some(name), ..
        } => name.clone(),
        _ => String::new(),
    }
}

/// Plan and carry out one request.
///
/// A planning failure returns a result rather than an error string so callers
/// get the same shape either way and cannot accidentally treat "refused" as
/// "nothing happened".
#[tauri::command]
pub fn plan_and_execute_action(app: AppHandle, request: ActionRequest) -> ActionResult {
    let capabilities = live_capabilities(&app);
    let planned = match create_execution_plan(&request, &capabilities) {
        Ok(p) => p,
        Err(e) => {
            return ActionResult {
                #[cfg(windows)]
                display_refusal: None,
                request_id: request.request_id.clone(),
                plan_id: "unplanned".into(),
                intent: request.intent,
                strategy_used: None,
                status: ActionStatus::Failed,
                verification: VerificationResult::not_verifiable(),
                attempts: Vec::new(),
                message: Some(e.message()),
                reason_code: e.code().to_string(),
                tool_result: None,
            }
        }
    };
    let ctx = ExecutionContext {
        app: &app,
        capabilities,
    };
    execute_plan(&planned, &request, &ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interaction::request::{KnownFolder, RequestSource};

    fn request(intent: ActionIntent, target: ActionTarget) -> ActionRequest {
        ActionRequest {
            request_id: "req-1".into(),
            intent,
            target,
            parameters: serde_json::Value::Null,
            source: RequestSource::Chat,
            confirmation_state: super::super::request::ConfirmationState::NotRequired,
        }
    }

    #[test]
    fn a_visual_target_is_described_in_the_users_own_words() {
        // The assistant loop gets something to look for, never a coordinate.
        let r = request(
            ActionIntent::ClickTarget,
            ActionTarget::VisualDescription {
                description: "the blue Play button".into(),
                display_id: None,
            },
        );
        assert_eq!(describe_visual_target(&r), "the blue Play button");
    }

    #[test]
    fn a_native_target_still_yields_a_usable_description() {
        let r = request(
            ActionIntent::OpenFolder,
            ActionTarget::Path {
                path: None,
                name: Some("ArcSonare".into()),
                known_folder: Some(KnownFolder::Desktop),
            },
        );
        assert_eq!(describe_visual_target(&r), "ArcSonare");
    }

    #[test]
    fn a_disposition_serializes_as_a_tagged_union_the_frontend_can_switch_on() {
        let vision = PlanExecutionDisposition::RequiresVision(VisualExecutionRequest {
            correlation_id: "corr-1".into(),
            request_id: "req-1".into(),
            plan_id: "plan-1".into(),
            intent: ActionIntent::ClickTarget,
            target_description: "the blue button".into(),
            requires_click: true,
            requires_overlay: false,
            expected_outcome: json!({ "kind": "region-changed" }),
            risk_level: super::super::strategy::RiskLevel::Moderate,
        });
        let v = serde_json::to_value(&vision).unwrap();
        assert_eq!(v["disposition"], "requires-vision");
        assert_eq!(v["correlationId"], "corr-1");
        assert_eq!(v["requiresClick"], true);
        // The verifier is named by ArcSonare from a fixed set, never invented
        // by the model that will later look at the screen.
        assert_eq!(v["expectedOutcome"]["kind"], "region-changed");
    }

    fn planned_for(intent: ActionIntent) -> PlannedAction {
        PlannedAction {
            request_id: "req-1".into(),
            plan_id: "plan-1".into(),
            plan: super::super::strategy::plan(intent, &AvailableCapabilities::current()),
        }
    }

    #[test]
    fn a_highlight_request_asks_for_an_overlay_and_no_verifier() {
        // "Show me" changes nothing, so there is nothing to verify and no
        // reason to take the cursor.
        let r = request(
            ActionIntent::HighlightTarget,
            ActionTarget::VisualDescription {
                description: "the ArcSonare folder".into(),
                display_id: None,
            },
        );
        let v = vision_request_for(&r, &planned_for(ActionIntent::HighlightTarget));
        assert!(!v.requires_click);
        assert!(v.requires_overlay);
        assert_eq!(v.expected_outcome["kind"], "none");
    }

    #[test]
    fn a_click_request_always_carries_a_verifier() {
        // A click that nothing checks is a click that reports success blindly.
        let r = request(
            ActionIntent::ClickTarget,
            ActionTarget::VisualDescription {
                description: "the blue button".into(),
                display_id: None,
            },
        );
        let v = vision_request_for(&r, &planned_for(ActionIntent::ClickTarget));
        assert!(v.requires_click);
        assert!(!v.requires_overlay);
        assert_ne!(v.expected_outcome["kind"], "none");
    }

    #[test]
    fn the_correlation_id_ties_the_request_and_the_plan_together() {
        // One id has to survive capture, the model call, execution and
        // verification, or the logs cannot be joined up afterwards.
        let r = request(
            ActionIntent::ClickTarget,
            ActionTarget::VisualDescription {
                description: "x".into(),
                display_id: None,
            },
        );
        let planned = planned_for(ActionIntent::ClickTarget);
        let v = vision_request_for(&r, &planned);
        assert!(v.correlation_id.contains(&r.request_id));
        assert!(v.correlation_id.contains(&planned.plan_id));
        assert_eq!(v.request_id, r.request_id);
        assert_eq!(v.plan_id, planned.plan_id);
    }

    #[test]
    fn a_visual_request_carries_the_plans_risk_level_forward() {
        // The assistant loop must not be able to execute a visual action at a
        // lower bar than the planner set.
        let r = request(
            ActionIntent::ClickTarget,
            ActionTarget::VisualDescription {
                description: "x".into(),
                display_id: None,
            },
        );
        let planned = planned_for(ActionIntent::ClickTarget);
        assert_eq!(
            vision_request_for(&r, &planned).risk_level,
            planned.plan.risk_level
        );
    }
}
