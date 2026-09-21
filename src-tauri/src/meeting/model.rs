//! Meeting Intelligence — data model.
//!
//! Mirrors src/features/meeting/meetingTypes.ts.
//! Rust is the authority for persistence; TypeScript is a cache.
//!
//! Owned by Agent 3.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// States and modes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingState {
    Idle,
    Detected,
    AwaitingPermission,
    NotesActive,
    RecordingActive,
    Paused,
    Processing,
    Completed,
    Ignored,
    PermissionDenied,
    CaptureError,
    TranscriptionError,
    Cancelled,
}

impl MeetingState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Detected => "detected",
            Self::AwaitingPermission => "awaiting-permission",
            Self::NotesActive => "notes-active",
            Self::RecordingActive => "recording-active",
            Self::Paused => "paused",
            Self::Processing => "processing",
            Self::Completed => "completed",
            Self::Ignored => "ignored",
            Self::PermissionDenied => "permission-denied",
            Self::CaptureError => "capture-error",
            Self::TranscriptionError => "transcription-error",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "idle" => Self::Idle,
            "detected" => Self::Detected,
            "awaiting-permission" => Self::AwaitingPermission,
            "notes-active" => Self::NotesActive,
            "recording-active" => Self::RecordingActive,
            "paused" => Self::Paused,
            "processing" => Self::Processing,
            "completed" => Self::Completed,
            "ignored" => Self::Ignored,
            "permission-denied" => Self::PermissionDenied,
            "capture-error" => Self::CaptureError,
            "transcription-error" => Self::TranscriptionError,
            "cancelled" => Self::Cancelled,
            _ => Self::Idle,
        }
    }

    /// The meeting is active and the user has consented to some form of capture.
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            Self::NotesActive | Self::RecordingActive | Self::Paused | Self::Processing
        )
    }

    /// The meeting has ended (terminal state).
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Ignored | Self::PermissionDenied | Self::Cancelled
        )
    }
}

impl std::fmt::Display for MeetingState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureMode {
    None,
    NotesOnly,
    Microphone,
    SystemAudio,
    Mixed,
}

impl CaptureMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::NotesOnly => "notes-only",
            Self::Microphone => "microphone",
            Self::SystemAudio => "system-audio",
            Self::Mixed => "mixed",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "notes-only" => Self::NotesOnly,
            "microphone" => Self::Microphone,
            "system-audio" => Self::SystemAudio,
            "mixed" => Self::Mixed,
            _ => Self::None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConsentState {
    Unknown,
    Pending,
    GrantedNotes,
    GrantedRecording,
    Denied,
    Revoked,
}

impl ConsentState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Pending => "pending",
            Self::GrantedNotes => "granted-notes",
            Self::GrantedRecording => "granted-recording",
            Self::Denied => "denied",
            Self::Revoked => "revoked",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "pending" => Self::Pending,
            "granted-notes" => Self::GrantedNotes,
            "granted-recording" => Self::GrantedRecording,
            "denied" => Self::Denied,
            "revoked" => Self::Revoked,
            _ => Self::Unknown,
        }
    }
}

// ---------------------------------------------------------------------------
// Core meeting session row
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSessionRow {
    pub id: String,
    pub account_id: String,
    pub conversation_id: Option<String>,
    pub source: String,
    pub source_application: String,
    pub source_instance_id: Option<String>,
    pub meeting_title: Option<String>,
    pub organizer: Option<String>,
    pub participants: Vec<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub state: String,
    pub capture_mode: String,
    pub transcription_mode: String,
    pub language: Option<String>,
    pub consent_state: String,
    pub audio_artifact_id: Option<String>,
    pub transcript_id: Option<String>,
    pub summary_id: Option<String>,
    pub deduplication_key: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for creating a new meeting session.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMeetingSessionInput {
    pub source: String,
    pub source_application: String,
    pub source_instance_id: Option<String>,
    pub meeting_title: Option<String>,
    pub capture_mode: String,
    pub consent_state: String,
}

// ---------------------------------------------------------------------------
// Transcript segments
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingTranscriptSegmentRow {
    pub id: String,
    pub meeting_id: String,
    pub speaker_id: Option<String>,
    pub speaker_label: Option<String>,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub text: String,
    pub confidence: Option<f64>,
    pub is_final: bool,
}

/// Input from the frontend's transcription provider.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertTranscriptSegmentInput {
    pub meeting_id: String,
    pub speaker_id: Option<String>,
    pub speaker_label: Option<String>,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub text: String,
    pub confidence: Option<f64>,
    pub is_final: bool,
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSummaryRow {
    pub meeting_id: String,
    pub title: String,
    pub overview: String,
    /// JSON blob of the full summary (decisions, action items, etc.)
    pub summary_json: String,
    pub generated_at: String,
    pub model_provenance: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn build_dedup_key(source: &str, instance_key: &str) -> String {
    let day = Utc::now().format("%Y-%m-%d").to_string();
    format!("{source}:{instance_key}:{day}")
}
