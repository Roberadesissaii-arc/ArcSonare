//! Meeting Intelligence — Tauri commands.
//!
//! All Tauri commands exposed by the Meeting Intelligence feature live here.
//! The frontend calls these to create, update, and query meeting sessions.
//!
//! Privacy and security rules enforced here:
//! - No audio is ever captured by Rust in this module.
//! - All audio capture is done in the frontend (MediaRecorder) and chunks are
//!   sent to Rust only for cloud transcription (IPC, not disk).
//! - All mutations require a valid open user database.
//!
//! Owned by Agent 3.

use serde::{Deserialize, Serialize};
use serde_json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::database::DatabaseManager;

use super::model::{
    CreateMeetingSessionInput, InsertTranscriptSegmentInput, MeetingSessionRow,
    MeetingTranscriptSegmentRow, MeetingSummaryRow,
};
use super::store;

/// Event emitted on any meeting state change. Listened to by the frontend store.
pub const MEETING_EVENT: &str = "arcsonare://meeting-event";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeetingEvent {
    kind: &'static str,
    meeting_id: Option<String>,
    state: Option<String>,
    at: String,
}

fn emit_meeting_event(app: &AppHandle, kind: &'static str, meeting_id: Option<&str>, state: Option<&str>) {
    let event = MeetingEvent {
        kind,
        meeting_id: meeting_id.map(|s| s.to_string()),
        state: state.map(|s| s.to_string()),
        at: super::model::now_iso(),
    };
    if let Err(e) = app.emit(MEETING_EVENT, event) {
        log::error!("failed to emit meeting event: {e}");
    }
}

// ---------------------------------------------------------------------------
// Backend health probe
// ---------------------------------------------------------------------------

/// Simple probe command so the frontend store can detect backend availability.
#[tauri::command]
pub fn meeting_backend_available() -> bool {
    true
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/// Create a new meeting session (after user consent).
#[tauri::command]
pub fn meeting_session_create(
    app: AppHandle,
    db: State<'_, DatabaseManager>,
    source: String,
    source_application: String,
    source_instance_id: Option<String>,
    meeting_title: Option<String>,
    capture_mode: String,
    consent_state: String,
) -> Result<MeetingSessionRow, String> {
    let input = CreateMeetingSessionInput {
        source,
        source_application,
        source_instance_id,
        meeting_title,
        capture_mode,
        consent_state,
    };

    let account_id = db.sync_user_id()?;
    let row = db.with_conn_mut(|conn| store::create_meeting_session(conn, &input, &account_id))?;

    emit_meeting_event(&app, "meeting-state-changed", Some(&row.id), Some(&row.state));
    Ok(row)
}

/// List meeting sessions for the current account.
#[tauri::command]
pub fn meeting_sessions_list(
    db: State<'_, DatabaseManager>,
    limit: Option<i64>,
) -> Result<Vec<MeetingSessionRow>, String> {
    let limit = limit.unwrap_or(50).min(200);
    db.with_conn_mut(|conn| store::list_meeting_sessions(conn, limit))
}

/// Update the state of a meeting session.
#[tauri::command]
pub fn meeting_session_update_state(
    app: AppHandle,
    db: State<'_, DatabaseManager>,
    session_id: String,
    state: String,
) -> Result<(), String> {
    db.with_conn_mut(|conn| store::update_meeting_state(conn, &session_id, &state))?;
    emit_meeting_event(&app, "meeting-state-changed", Some(&session_id), Some(&state));
    Ok(())
}

/// Start recording for a meeting (updates state, no actual audio capture in Rust).
#[tauri::command]
pub fn meeting_session_start_recording(
    app: AppHandle,
    db: State<'_, DatabaseManager>,
    session_id: String,
    capture_mode: String,
) -> Result<(), String> {
    let new_state = "recording-active";
    db.with_conn_mut(|conn| {
        // Update capture mode and state.
        conn.execute(
            "UPDATE meeting_sessions
             SET state = ?1, capture_mode = ?2, updated_at = ?3
             WHERE id = ?4",
            rusqlite::params![new_state, capture_mode, super::model::now_iso(), session_id],
        )
        .map_err(|e| format!("update meeting recording: {e}"))?;
        Ok::<(), String>(())
    })?;
    emit_meeting_event(&app, "meeting-state-changed", Some(&session_id), Some(new_state));
    Ok(())
}

/// End a meeting session.
#[tauri::command]
pub fn meeting_session_end(
    app: AppHandle,
    db: State<'_, DatabaseManager>,
    session_id: String,
) -> Result<(), String> {
    db.with_conn_mut(|conn| store::end_meeting_session(conn, &session_id))?;
    emit_meeting_event(&app, "meeting-ended", Some(&session_id), Some("completed"));
    Ok(())
}

// ---------------------------------------------------------------------------
// Transcript segments
// ---------------------------------------------------------------------------

/// Insert a single transcript segment (called by frontend transcription provider).
#[tauri::command]
pub fn meeting_transcript_insert(
    db: State<'_, DatabaseManager>,
    meeting_id: String,
    speaker_id: Option<String>,
    speaker_label: Option<String>,
    started_at_ms: i64,
    ended_at_ms: i64,
    text: String,
    confidence: Option<f64>,
    is_final: bool,
) -> Result<MeetingTranscriptSegmentRow, String> {
    let input = InsertTranscriptSegmentInput {
        meeting_id,
        speaker_id,
        speaker_label,
        started_at_ms,
        ended_at_ms,
        text,
        confidence,
        is_final,
    };
    db.with_conn_mut(|conn| store::insert_transcript_segment(conn, &input))
}

/// List transcript segments for a meeting.
#[tauri::command]
pub fn meeting_transcript_list(
    db: State<'_, DatabaseManager>,
    meeting_id: String,
) -> Result<Vec<MeetingTranscriptSegmentRow>, String> {
    db.with_conn_mut(|conn| store::list_transcript_segments(conn, &meeting_id))
}

// ---------------------------------------------------------------------------
// Transcription relay (cloud Whisper via OpenAI)
// ---------------------------------------------------------------------------

/// Transcribe an audio chunk via OpenAI Whisper API.
///
/// The frontend sends base64-encoded audio. This command:
/// 1. Decodes the base64 payload.
/// 2. Forwards to OpenAI Whisper API using the stored provider key.
/// 3. Returns the transcript text and segments.
///
/// Audio chunks are NEVER written to disk here — they travel in memory only.
#[tauri::command]
pub async fn meeting_transcribe_chunk(
    meeting_id: String,
    audio_base64: String,
    audio_mime_type: String,
    start_offset_ms: i64,
    language: Option<String>,
) -> Result<serde_json::Value, String> {
    use crate::credentials;
    use base64::Engine as _;

    let api_key = credentials::get_provider_key("openai")
        .map_err(|e| format!("OpenAI key not available: {e}"))?;

    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("invalid base64: {e}"))?;

    // Determine file extension from MIME type.
    let ext = if audio_mime_type.contains("ogg") { "ogg" } else { "webm" };
    let filename = format!("chunk.{ext}");

    // Build multipart form request.
    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename)
        .mime_str(&audio_mime_type)
        .map_err(|e| format!("invalid mime: {e}"))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-1")
        .text("response_format", "verbose_json");

    if let Some(lang) = language {
        form = form.text("language", lang);
    }

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {api_key}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("whisper request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Whisper API error {status}: {body}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("whisper response parse failed: {e}"))?;

    Ok(json)
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/// Save a generated meeting summary.
#[tauri::command]
pub fn meeting_summary_save(
    app: AppHandle,
    db: State<'_, DatabaseManager>,
    meeting_id: String,
    title: String,
    overview: String,
    summary_json: String,
    model_provenance: String,
) -> Result<String, String> {
    let summary_id = db.with_conn_mut(|conn| {
        store::upsert_meeting_summary(conn, &meeting_id, &title, &overview, &summary_json, &model_provenance)
    })?;

    db.with_conn_mut(|conn| store::set_session_summary_id(conn, &meeting_id, &summary_id))?;

    emit_meeting_event(&app, "summary-ready", Some(&meeting_id), None);
    Ok(summary_id)
}

/// Retrieve a meeting summary.
#[tauri::command]
pub fn meeting_summary_get(
    db: State<'_, DatabaseManager>,
    meeting_id: String,
) -> Result<Option<MeetingSummaryRow>, String> {
    db.with_conn_mut(|conn| store::get_meeting_summary(conn, &meeting_id))
}
