//! What the user asked for, as data rather than as a sentence.
//!
//! The model's job ends at "they want the ArcSonare folder opened". Turning that
//! into a shell call is ArcSonare's job, and it needs a typed request to do it —
//! not a free-form command string, which is both unauditable and the obvious
//! injection surface.

use serde::{Deserialize, Serialize};

use super::strategy::{ActionIntent, ExecutionStrategy};
use crate::capabilities::types::ToolResult;

/// Windows locations ArcSonare can resolve without asking the user or the model
/// to spell out a path (which they get wrong, especially when it is redirected
/// to OneDrive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum KnownFolder {
    Desktop,
    Documents,
    Downloads,
    Pictures,
    Videos,
    Music,
    Home,
}

impl KnownFolder {
    /// The id `filesystem::known_folder_path` understands.
    pub fn as_id(&self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Documents => "documents",
            Self::Downloads => "downloads",
            Self::Pictures => "pictures",
            Self::Videos => "videos",
            Self::Music => "music",
            Self::Home => "home",
        }
    }
}

/// The thing to act on. One variant per shape of target, so an intent can be
/// checked against its target at plan time instead of failing halfway through
/// execution.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ActionTarget {
    /// A file or folder. Any of the three may be absent; the executor resolves
    /// what it can and refuses rather than guessing between matches.
    #[serde(rename_all = "camelCase")]
    Path {
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        known_folder: Option<KnownFolder>,
    },
    #[serde(rename_all = "camelCase")]
    Application {
        app_name: String,
        #[serde(default)]
        app_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Url {
        url: String,
    },
    /// A Windows Settings page, by plain name ("wi-fi", "bluetooth").
    #[serde(rename_all = "camelCase")]
    SystemSettings {
        page: String,
    },
    #[serde(rename_all = "camelCase")]
    Window {
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        process_name: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Media {
        #[serde(default)]
        application: Option<String>,
        #[serde(default)]
        item_name: Option<String>,
        #[serde(default)]
        ordinal: Option<u32>,
    },
    /// Something only describable by how it looks. Requires the visual path.
    #[serde(rename_all = "camelCase")]
    VisualDescription {
        description: String,
        #[serde(default)]
        display_id: Option<String>,
    },
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequestSource {
    Chat,
    Voice,
    Overlay,
    Internal,
}

/// Whether the user has already approved this. Risk enforcement reads it; a
/// request cannot promote itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConfirmationState {
    NotRequired,
    Pending,
    Confirmed,
    Rejected,
}

impl Default for ConfirmationState {
    fn default() -> Self {
        Self::NotRequired
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub request_id: String,
    pub intent: ActionIntent,
    pub target: ActionTarget,
    /// Strategy-specific extras (e.g. media command). Never a shell string.
    #[serde(default)]
    pub parameters: serde_json::Value,
    pub source: RequestSource,
    #[serde(default)]
    pub confirmation_state: ConfirmationState,
}

/// A plan bound to the request that produced it.
///
/// `strategy::plan()` deliberately knows nothing about request identity — it is
/// a pure function of intent and capabilities. Identity is attached here so a
/// result can be traced back to exactly one decision.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedAction {
    pub request_id: String,
    pub plan_id: String,
    #[serde(flatten)]
    pub plan: super::strategy::ExecutionPlan,
}

/// Why a request could not be turned into a plan at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanningError {
    /// The target shape cannot satisfy the intent (e.g. OpenUrl with a path).
    TargetMismatch {
        intent: ActionIntent,
        detail: String,
    },
    /// Nothing in the request says what to act on.
    MissingTarget(ActionIntent),
    /// The intent itself is not something ArcSonare routes.
    UnroutableIntent(ActionIntent),
}

impl PlanningError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::TargetMismatch { .. } => "TARGET_MISMATCH",
            Self::MissingTarget(_) => "MISSING_TARGET",
            Self::UnroutableIntent(_) => "UNROUTABLE_INTENT",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::TargetMismatch { intent, detail } => {
                format!("{intent:?} cannot act on that target: {detail}")
            }
            Self::MissingTarget(intent) => format!("{intent:?} was given nothing to act on."),
            Self::UnroutableIntent(intent) => {
                format!("{intent:?} is not something ArcSonare knows how to route.")
            }
        }
    }
}

/// What the assistant loop must do to finish a visual action.
///
/// The planner cannot run this itself: finding something on screen needs a
/// vision-model call, and that lives in the assistant loop. Rather than growing
/// a second, blinder copy of the model client in Rust, the planner hands back a
/// filled-in request — and keeps ownership of everything that is not the model
/// call, which is the coordinate work that used to go wrong.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualExecutionRequest {
    /// One id across capture, model call, execution and verification.
    pub correlation_id: String,
    pub request_id: String,
    pub plan_id: String,
    pub intent: ActionIntent,
    /// What to look for, in the user's words. Not a coordinate.
    pub target_description: String,
    pub requires_click: bool,
    pub requires_overlay: bool,
    /// What must be true afterwards, as a validated verifier name plus
    /// parameters — never arbitrary code the model chose.
    pub expected_outcome: serde_json::Value,
    /// The risk level the plan assigned, so the assistant loop cannot execute a
    /// visual action at a lower bar than a native one.
    pub risk_level: super::strategy::RiskLevel,
}

/// What the planner decided should happen next.
///
/// A visual plan is not a failure and not a completed action; it is work that
/// belongs to a different part of the system. Modelling that as its own case
/// keeps "we could not" and "you finish this" from looking alike.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "disposition", rename_all = "kebab-case")]
pub enum PlanExecutionDisposition {
    /// Done. The result is final.
    Executed(ActionResult),
    /// The assistant loop must capture, ask the model, and call back in.
    RequiresVision(VisualExecutionRequest),
    /// Nothing here can do it, and the result says so.
    Unsupported(ActionResult),
}

/// Outcome of a whole request, across every strategy that was tried.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActionStatus {
    Succeeded,
    /// The OS accepted it but the postcondition could not be confirmed. Never
    /// retried: a second attempt could open a second window.
    PartiallyCompleted,
    NeedsConfirmation,
    NotFound,
    Denied,
    Unsafe,
    Unsupported,
    /// The strategy is correct but its production path is not migrated yet.
    NotReady,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub verified: bool,
    /// Mirrors the capability evidence vocabulary: filesystem-postcondition,
    /// window-detected, process-detected, return-code, not-verifiable...
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl VerificationResult {
    pub fn not_verifiable() -> Self {
        Self {
            verified: false,
            method: "not-verifiable".into(),
            details: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyAttempt {
    pub strategy: ExecutionStrategy,
    /// Serialized form of `AttemptStatus`, so the UI can explain the chain.
    pub status: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub request_id: String,
    pub plan_id: String,
    pub intent: ActionIntent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy_used: Option<ExecutionStrategy>,
    pub status: ActionStatus,
    pub verification: VerificationResult,
    pub attempts: Vec<StrategyAttempt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Machine-readable justification, carried through from the plan or set by
    /// the executor when it refuses.
    pub reason_code: String,
    /// The underlying capability result, so the existing response composer,
    /// audit trail and confirmation flow keep working unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result: Option<ToolResult>,
    /// The typed display refusal, when that is why this stopped.
    ///
    /// Carried whole rather than flattened into `reason_code`, so the frontend's
    /// refusal mapper gets the display name, the geometry that changed and the
    /// recommended action instead of having to infer them from a string.
    #[cfg(windows)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_refusal: Option<crate::display::interaction_error::DisplayInteractionError>,
}

#[cfg(test)]
mod tests {
    //! The wire format is the contract between plannerBridge.ts and Rust. A
    //! silent rename on either side turns "open my folder" into a deserialize
    //! error at runtime, which is exactly the class of break unit tests should
    //! catch, so these use the literal JSON the frontend sends.
    use super::*;

    fn parse(json: &str) -> ActionRequest {
        serde_json::from_str(json).expect("frontend payload must deserialize")
    }

    #[test]
    fn the_folder_payload_the_frontend_sends_deserializes() {
        let req = parse(
            r#"{
                "requestId": "req-1",
                "intent": "open-folder",
                "target": {
                    "kind": "path",
                    "path": null,
                    "name": "ArcSonare",
                    "knownFolder": "desktop"
                },
                "source": "chat"
            }"#,
        );
        assert_eq!(req.intent, super::super::strategy::ActionIntent::OpenFolder);
        assert_eq!(
            req.target,
            ActionTarget::Path {
                path: None,
                name: Some("ArcSonare".into()),
                known_folder: Some(KnownFolder::Desktop),
            }
        );
        // Omitted entirely by the frontend — it must not mean "approved".
        assert_eq!(req.confirmation_state, ConfirmationState::NotRequired);
    }

    #[test]
    fn the_application_payload_keeps_its_camel_case_fields() {
        let req = parse(
            r#"{
                "requestId": "req-2",
                "intent": "launch-application",
                "target": { "kind": "application", "appName": "Spotify", "appId": null },
                "source": "voice"
            }"#,
        );
        assert_eq!(
            req.target,
            ActionTarget::Application {
                app_name: "Spotify".into(),
                app_id: None,
            }
        );
        assert_eq!(req.source, RequestSource::Voice);
    }

    #[test]
    fn url_and_settings_payloads_deserialize() {
        let url = parse(
            r#"{"requestId":"r","intent":"open-url","target":{"kind":"url","url":"https://github.com"},"source":"chat"}"#,
        );
        assert_eq!(
            url.target,
            ActionTarget::Url {
                url: "https://github.com".into()
            }
        );
        let settings = parse(
            r#"{"requestId":"r","intent":"open-system-settings","target":{"kind":"system-settings","page":"wi-fi"},"source":"chat"}"#,
        );
        assert_eq!(
            settings.target,
            ActionTarget::SystemSettings {
                page: "wi-fi".into()
            }
        );
    }

    #[test]
    fn a_result_serializes_with_the_keys_the_frontend_reads() {
        let result = ActionResult {
            #[cfg(windows)]
            display_refusal: None,
            request_id: "r".into(),
            plan_id: "p".into(),
            intent: super::super::strategy::ActionIntent::OpenFolder,
            strategy_used: Some(super::super::strategy::ExecutionStrategy::NativeOs),
            status: ActionStatus::Succeeded,
            verification: VerificationResult {
                verified: true,
                method: "filesystem-postcondition".into(),
                details: None,
            },
            attempts: Vec::new(),
            message: Some("Opened it.".into()),
            reason_code: "NATIVE_CAPABILITY_AVAILABLE".into(),
            tool_result: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["requestId"], "r");
        assert_eq!(json["planId"], "p");
        assert_eq!(json["strategyUsed"], "native-os");
        assert_eq!(json["status"], "succeeded");
        assert_eq!(json["reasonCode"], "NATIVE_CAPABILITY_AVAILABLE");
    }
}
