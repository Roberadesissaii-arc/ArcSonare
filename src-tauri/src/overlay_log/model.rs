//! Overlay Conversation Log & Speech Diagnostics — Data Models.
//!
//! Owned by Agent 5.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OverlaySurface {
    VoiceOverlay,
    MainWindowVoice,
    MainWindowText,
}

impl OverlaySurface {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::VoiceOverlay => "voice-overlay",
            Self::MainWindowVoice => "main-window-voice",
            Self::MainWindowText => "main-window-text",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "main-window-voice" => Self::MainWindowVoice,
            "main-window-text" => Self::MainWindowText,
            _ => Self::VoiceOverlay,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OverlaySessionStatus {
    Active,
    Completed,
    Cancelled,
    Interrupted,
    Failed,
}

impl OverlaySessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
            Self::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "completed" => Self::Completed,
            "cancelled" => Self::Cancelled,
            "interrupted" => Self::Interrupted,
            "failed" => Self::Failed,
            _ => Self::Active,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OverlayTurnStatus {
    InFlight,
    Completed,
    Cancelled,
    Failed,
    TranscriptRejected,
}

impl OverlayTurnStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InFlight => "in-flight",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
            Self::TranscriptRejected => "transcript-rejected",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "completed" => Self::Completed,
            "cancelled" => Self::Cancelled,
            "failed" => Self::Failed,
            "transcript-rejected" => Self::TranscriptRejected,
            _ => Self::InFlight,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OverlayEventType {
    OverlayOpened,
    ListeningStarted,
    InterimTranscript,
    FinalTranscript,
    TranscriptRejected,
    RequestCreated,
    PlanningStarted,
    PlanSelected,
    CapabilityStarted,
    CapabilityCompleted,
    CapabilityFailed,
    ApprovalRequested,
    ApprovalGranted,
    ApprovalRejected,
    AssistantResponseStarted,
    AssistantResponseCompleted,
    TtsStarted,
    TtsCompleted,
    TtsFailed,
    TurnCancelled,
    OverlayClosed,
    Error,
}

impl OverlayEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OverlayOpened => "overlay-opened",
            Self::ListeningStarted => "listening-started",
            Self::InterimTranscript => "interim-transcript",
            Self::FinalTranscript => "final-transcript",
            Self::TranscriptRejected => "transcript-rejected",
            Self::RequestCreated => "request-created",
            Self::PlanningStarted => "planning-started",
            Self::PlanSelected => "plan-selected",
            Self::CapabilityStarted => "capability-started",
            Self::CapabilityCompleted => "capability-completed",
            Self::CapabilityFailed => "capability-failed",
            Self::ApprovalRequested => "approval-requested",
            Self::ApprovalGranted => "approval-granted",
            Self::ApprovalRejected => "approval-rejected",
            Self::AssistantResponseStarted => "assistant-response-started",
            Self::AssistantResponseCompleted => "assistant-response-completed",
            Self::TtsStarted => "tts-started",
            Self::TtsCompleted => "tts-completed",
            Self::TtsFailed => "tts-failed",
            Self::TurnCancelled => "turn-cancelled",
            Self::OverlayClosed => "overlay-closed",
            Self::Error => "error",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "overlay-opened" => Self::OverlayOpened,
            "listening-started" => Self::ListeningStarted,
            "interim-transcript" => Self::InterimTranscript,
            "final-transcript" => Self::FinalTranscript,
            "transcript-rejected" => Self::TranscriptRejected,
            "request-created" => Self::RequestCreated,
            "planning-started" => Self::PlanningStarted,
            "plan-selected" => Self::PlanSelected,
            "capability-started" => Self::CapabilityStarted,
            "capability-completed" => Self::CapabilityCompleted,
            "capability-failed" => Self::CapabilityFailed,
            "approval-requested" => Self::ApprovalRequested,
            "approval-granted" => Self::ApprovalGranted,
            "approval-rejected" => Self::ApprovalRejected,
            "assistant-response-started" => Self::AssistantResponseStarted,
            "assistant-response-completed" => Self::AssistantResponseCompleted,
            "tts-started" => Self::TtsStarted,
            "tts-completed" => Self::TtsCompleted,
            "tts-failed" => Self::TtsFailed,
            "turn-cancelled" => Self::TurnCancelled,
            "overlay-closed" => Self::OverlayClosed,
            _ => Self::Error,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConversationSession {
    pub id: String,
    pub account_id: String,
    pub conversation_id: Option<String>,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
    pub surface: OverlaySurface,
    pub status: OverlaySessionStatus,
    pub turn_count: u32,
    pub first_user_transcript: Option<String>,
    pub has_error: bool,
    pub duration_ms: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConversationTurn {
    pub id: String,
    pub session_id: String,
    pub correlation_id: String,
    pub started_at_ms: u64,
    pub completed_at_ms: Option<u64>,
    pub user_transcript: Option<String>,
    pub assistant_response: Option<String>,
    pub status: OverlayTurnStatus,
    pub error_code: Option<String>,
    pub metadata: serde_json::Value,
    pub events: Vec<OverlayDiagnosticEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayDiagnosticEvent {
    pub id: String,
    pub turn_id: String,
    pub session_id: String,
    pub timestamp_ms: u64,
    pub event_type: OverlayEventType,
    pub safe_metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayLogSettings {
    pub enabled: bool,
    pub retention_days: u32,
    pub include_interim: bool,
    pub include_capability_timeline: bool,
    pub include_technical_diagnostics: bool,
    pub include_typed_chats: bool,
    pub raw_audio_enabled: bool,
    pub screenshots_enabled: bool,
}

impl Default for OverlayLogSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            retention_days: 30,
            include_interim: false,
            include_capability_timeline: true,
            include_technical_diagnostics: true,
            include_typed_chats: false,
            raw_audio_enabled: false,
            screenshots_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayLogSummary {
    pub total_sessions: u32,
    pub total_turns: u32,
    pub failed_turns: u32,
    pub last_recorded_turn_ms: Option<u64>,
    pub storage_size_bytes: u64,
    pub retention_days: u32,
    pub logging_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailView {
    pub session: OverlayConversationSession,
    pub turns: Vec<OverlayConversationTurn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportManifest {
    pub app_name: String,
    pub app_version: String,
    pub schema_version: u32,
    pub exported_at: String,
    pub operating_system: String,
    pub tauri_version: String,
    pub session_count: usize,
    pub turn_count: usize,
    pub settings: OverlayLogSettings,
}
