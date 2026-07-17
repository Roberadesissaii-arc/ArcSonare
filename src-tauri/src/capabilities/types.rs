//! Shared capability result contract. Every native tool returns a `ToolResult`
//! with an honest status and verification evidence — never prose-as-success.

use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolResultStatus {
    Success,
    Partial,
    NeedsConfirmation,
    Cancelled,
    Denied,
    NotFound,
    Unsupported,
    Timeout,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technical_details: Option<String>,
}

/// How a result was verified. `not-verifiable` is honest, not a failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationEvidence {
    pub verified: bool,
    /// One of: return-code | filesystem-postcondition | process-detected |
    /// window-detected | artifact-validated | state-readback | not-verifiable
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl VerificationEvidence {
    pub fn verified(method: &str) -> Self {
        Self {
            verified: true,
            method: method.into(),
            details: None,
        }
    }
    pub fn verified_with(method: &str, details: serde_json::Value) -> Self {
        Self {
            verified: true,
            method: method.into(),
            details: Some(details),
        }
    }
    pub fn unverified(method: &str) -> Self {
        Self {
            verified: false,
            method: method.into(),
            details: None,
        }
    }
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
pub struct ToolArtifact {
    pub id: String,
    /// image | file | folder | url | application | task
    pub kind: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub call_id: String,
    pub capability_id: String,
    pub status: ToolResultStatus,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    pub evidence: VerificationEvidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifacts: Option<Vec<ToolArtifact>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ToolError>,
    pub started_at: String,
    pub completed_at: String,
    pub duration_ms: u64,
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn new_call_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!(
        "call-{}-{}",
        chrono::Local::now().timestamp_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// Builder capturing start time so `duration_ms` is always honest.
pub struct ResultBuilder {
    capability_id: String,
    call_id: String,
    started_at: String,
    started: Instant,
    warnings: Vec<String>,
}

impl ResultBuilder {
    pub fn new(capability_id: &str) -> Self {
        Self {
            capability_id: capability_id.into(),
            call_id: new_call_id(),
            started_at: now_iso(),
            started: Instant::now(),
            warnings: Vec::new(),
        }
    }

    pub fn warn(&mut self, message: impl Into<String>) {
        self.warnings.push(message.into());
    }

    fn finish(
        self,
        status: ToolResultStatus,
        summary: String,
        data: Option<serde_json::Value>,
        evidence: VerificationEvidence,
        artifacts: Option<Vec<ToolArtifact>>,
        error: Option<ToolError>,
    ) -> ToolResult {
        ToolResult {
            call_id: self.call_id,
            capability_id: self.capability_id,
            status,
            summary,
            data,
            evidence,
            artifacts,
            warnings: if self.warnings.is_empty() {
                None
            } else {
                Some(self.warnings)
            },
            error,
            started_at: self.started_at,
            completed_at: now_iso(),
            duration_ms: self.started.elapsed().as_millis() as u64,
        }
    }

    pub fn success(
        self,
        summary: impl Into<String>,
        data: serde_json::Value,
        evidence: VerificationEvidence,
    ) -> ToolResult {
        self.finish(
            ToolResultStatus::Success,
            summary.into(),
            Some(data),
            evidence,
            None,
            None,
        )
    }

    pub fn success_with_artifacts(
        self,
        summary: impl Into<String>,
        data: serde_json::Value,
        evidence: VerificationEvidence,
        artifacts: Vec<ToolArtifact>,
    ) -> ToolResult {
        self.finish(
            ToolResultStatus::Success,
            summary.into(),
            Some(data),
            evidence,
            Some(artifacts),
            None,
        )
    }

    pub fn partial(
        self,
        summary: impl Into<String>,
        data: serde_json::Value,
        evidence: VerificationEvidence,
    ) -> ToolResult {
        self.finish(
            ToolResultStatus::Partial,
            summary.into(),
            Some(data),
            evidence,
            None,
            None,
        )
    }

    pub fn needs_confirmation(
        self,
        summary: impl Into<String>,
        confirmation: serde_json::Value,
    ) -> ToolResult {
        self.finish(
            ToolResultStatus::NeedsConfirmation,
            summary.into(),
            Some(confirmation),
            VerificationEvidence::not_verifiable(),
            None,
            None,
        )
    }

    pub fn status(
        self,
        status: ToolResultStatus,
        summary: impl Into<String>,
        error: Option<ToolError>,
    ) -> ToolResult {
        self.finish(
            status,
            summary.into(),
            None,
            VerificationEvidence::not_verifiable(),
            None,
            error,
        )
    }

    pub fn not_found(self, summary: impl Into<String>) -> ToolResult {
        self.status(ToolResultStatus::NotFound, summary, None)
    }

    pub fn unsupported(self, summary: impl Into<String>) -> ToolResult {
        self.status(ToolResultStatus::Unsupported, summary, None)
    }

    pub fn denied(self, summary: impl Into<String>, code: &str) -> ToolResult {
        let msg = summary.into();
        self.finish(
            ToolResultStatus::Denied,
            msg.clone(),
            None,
            VerificationEvidence::not_verifiable(),
            None,
            Some(ToolError {
                code: code.into(),
                message: msg,
                recoverable: false,
                user_action: None,
                technical_details: None,
            }),
        )
    }

    pub fn error(self, code: &str, message: impl Into<String>, recoverable: bool) -> ToolResult {
        let message = message.into();
        self.finish(
            ToolResultStatus::Error,
            message.clone(),
            None,
            VerificationEvidence::not_verifiable(),
            None,
            Some(ToolError {
                code: code.into(),
                message,
                recoverable,
                user_action: None,
                technical_details: None,
            }),
        )
    }
}

/// Args every executor receives after deserialization already validated.
pub fn invalid_args(capability_id: &str, detail: &str) -> ToolResult {
    ResultBuilder::new(capability_id).error(
        "invalid-arguments",
        format!("Arguments were rejected: {detail}"),
        true,
    )
}
