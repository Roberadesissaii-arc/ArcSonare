//! Meeting Intelligence — SQLite persistence.
//!
//! All writes go through this module. The DatabaseManager provides the
//! connection; this module owns the SQL.
//!
//! Account isolation is structural: the DatabaseManager already opens a
//! different file per account, so all queries here are naturally scoped.
//!
//! Owned by Agent 3.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json;

use super::model::{
    build_dedup_key, new_id, now_iso, CaptureMode, ConsentState, CreateMeetingSessionInput,
    InsertTranscriptSegmentInput, MeetingSessionRow, MeetingState, MeetingSummaryRow,
    MeetingTranscriptSegmentRow,
};

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

/// Persist a new meeting session. Returns the created row.
pub fn create_meeting_session(
    conn: &Connection,
    input: &CreateMeetingSessionInput,
    account_id: &str,
) -> Result<MeetingSessionRow, String> {
    let id = new_id();
    let now = now_iso();
    let dedup_key = build_dedup_key(
        &input.source,
        input.source_instance_id.as_deref().unwrap_or("manual"),
    );

    conn.execute(
        "INSERT INTO meeting_sessions (
            id, account_id, source, source_application, source_instance_id,
            meeting_title, organizer, participants_json, started_at,
            state, capture_mode, transcription_mode, consent_state,
            deduplication_key, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, NULL, '[]', ?7,
            ?8, ?9, 'none', ?10,
            ?11, ?12, ?12
        )",
        params![
            id,
            account_id,
            input.source,
            input.source_application,
            input.source_instance_id,
            input.meeting_title,
            now,
            MeetingState::NotesActive.as_str(),
            input.capture_mode,
            input.consent_state,
            dedup_key,
        ],
    )
    .map_err(|e| format!("insert meeting session: {e}"))?;

    get_meeting_session(conn, &id)?.ok_or_else(|| "created session not found".to_string())
}

/// Read a single session by ID.
pub fn get_meeting_session(
    conn: &Connection,
    id: &str,
) -> Result<Option<MeetingSessionRow>, String> {
    conn.query_row(
        "SELECT id, account_id, conversation_id, source, source_application,
                source_instance_id, meeting_title, organizer, participants_json,
                started_at, ended_at, state, capture_mode, transcription_mode,
                language, consent_state, audio_artifact_id, transcript_id,
                summary_id, deduplication_key, created_at, updated_at
         FROM meeting_sessions WHERE id = ?1",
        params![id],
        row_to_session,
    )
    .optional()
    .map_err(|e| format!("get meeting session: {e}"))
}

/// List sessions for the current account (most recent first).
pub fn list_meeting_sessions(
    conn: &Connection,
    limit: i64,
) -> Result<Vec<MeetingSessionRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, account_id, conversation_id, source, source_application,
                    source_instance_id, meeting_title, organizer, participants_json,
                    started_at, ended_at, state, capture_mode, transcription_mode,
                    language, consent_state, audio_artifact_id, transcript_id,
                    summary_id, deduplication_key, created_at, updated_at
             FROM meeting_sessions
             WHERE deleted_at IS NULL
             ORDER BY started_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("prepare meeting list: {e}"))?;

    let rows = stmt
        .query_map(params![limit], row_to_session)
        .map_err(|e| format!("query meetings: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("map meetings: {e}"))?;

    Ok(rows)
}

/// Update the state of a meeting session.
pub fn update_meeting_state(
    conn: &Connection,
    id: &str,
    state: &str,
) -> Result<(), String> {
    let now = now_iso();
    conn.execute(
        "UPDATE meeting_sessions SET state = ?1, updated_at = ?2 WHERE id = ?3",
        params![state, now, id],
    )
    .map_err(|e| format!("update meeting state: {e}"))?;
    Ok(())
}

/// Mark a meeting as ended with an end timestamp.
pub fn end_meeting_session(conn: &Connection, id: &str) -> Result<(), String> {
    let now = now_iso();
    conn.execute(
        "UPDATE meeting_sessions
         SET state = ?1, ended_at = ?2, updated_at = ?2
         WHERE id = ?3",
        params![MeetingState::Completed.as_str(), now, id],
    )
    .map_err(|e| format!("end meeting session: {e}"))?;
    Ok(())
}

/// Attach a summary ID to a session.
pub fn set_session_summary_id(
    conn: &Connection,
    session_id: &str,
    summary_id: &str,
) -> Result<(), String> {
    let now = now_iso();
    conn.execute(
        "UPDATE meeting_sessions SET summary_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![summary_id, now, session_id],
    )
    .map_err(|e| format!("set summary id: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Transcript segments
// ---------------------------------------------------------------------------

pub fn insert_transcript_segment(
    conn: &Connection,
    input: &InsertTranscriptSegmentInput,
) -> Result<MeetingTranscriptSegmentRow, String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO meeting_transcript_segments (
            id, meeting_id, speaker_id, speaker_label,
            started_at_ms, ended_at_ms, text, confidence, is_final
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            input.meeting_id,
            input.speaker_id,
            input.speaker_label,
            input.started_at_ms,
            input.ended_at_ms,
            input.text,
            input.confidence,
            input.is_final as i32,
        ],
    )
    .map_err(|e| format!("insert transcript segment: {e}"))?;

    Ok(MeetingTranscriptSegmentRow {
        id,
        meeting_id: input.meeting_id.clone(),
        speaker_id: input.speaker_id.clone(),
        speaker_label: input.speaker_label.clone(),
        started_at_ms: input.started_at_ms,
        ended_at_ms: input.ended_at_ms,
        text: input.text.clone(),
        confidence: input.confidence,
        is_final: input.is_final,
    })
}

pub fn list_transcript_segments(
    conn: &Connection,
    meeting_id: &str,
) -> Result<Vec<MeetingTranscriptSegmentRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, meeting_id, speaker_id, speaker_label,
                    started_at_ms, ended_at_ms, text, confidence, is_final
             FROM meeting_transcript_segments
             WHERE meeting_id = ?1
             ORDER BY started_at_ms ASC",
        )
        .map_err(|e| format!("prepare transcript list: {e}"))?;

    let rows = stmt
        .query_map(params![meeting_id], |row| {
            Ok(MeetingTranscriptSegmentRow {
                id: row.get(0)?,
                meeting_id: row.get(1)?,
                speaker_id: row.get(2)?,
                speaker_label: row.get(3)?,
                started_at_ms: row.get(4)?,
                ended_at_ms: row.get(5)?,
                text: row.get(6)?,
                confidence: row.get(7)?,
                is_final: {
                    let v: i32 = row.get(8)?;
                    v != 0
                },
            })
        })
        .map_err(|e| format!("query transcript: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("map transcript: {e}"))?;

    Ok(rows)
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

pub fn upsert_meeting_summary(
    conn: &Connection,
    meeting_id: &str,
    title: &str,
    overview: &str,
    summary_json: &str,
    model_provenance: &str,
) -> Result<String, String> {
    let id = format!("sum-{meeting_id}");
    let now = now_iso();
    conn.execute(
        "INSERT INTO meeting_summaries (
            id, meeting_id, title, overview, summary_json, generated_at, model_provenance
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(meeting_id) DO UPDATE SET
            title = excluded.title,
            overview = excluded.overview,
            summary_json = excluded.summary_json,
            generated_at = excluded.generated_at,
            model_provenance = excluded.model_provenance",
        params![id, meeting_id, title, overview, summary_json, now, model_provenance],
    )
    .map_err(|e| format!("upsert meeting summary: {e}"))?;
    Ok(id)
}

pub fn get_meeting_summary(
    conn: &Connection,
    meeting_id: &str,
) -> Result<Option<MeetingSummaryRow>, String> {
    conn.query_row(
        "SELECT id, meeting_id, title, overview, summary_json, generated_at, model_provenance
         FROM meeting_summaries WHERE meeting_id = ?1",
        params![meeting_id],
        |row| {
            Ok(MeetingSummaryRow {
                meeting_id: row.get(1)?,
                title: row.get(2)?,
                overview: row.get(3)?,
                summary_json: row.get(4)?,
                generated_at: row.get(5)?,
                model_provenance: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("get meeting summary: {e}"))
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<MeetingSessionRow> {
    let participants_raw: String = row.get(8)?;
    let participants: Vec<String> =
        serde_json::from_str(&participants_raw).unwrap_or_default();

    Ok(MeetingSessionRow {
        id: row.get(0)?,
        account_id: row.get(1)?,
        conversation_id: row.get(2)?,
        source: row.get(3)?,
        source_application: row.get(4)?,
        source_instance_id: row.get(5)?,
        meeting_title: row.get(6)?,
        organizer: row.get(7)?,
        participants,
        started_at: row.get(9)?,
        ended_at: row.get(10)?,
        state: row.get(11)?,
        capture_mode: row.get(12)?,
        transcription_mode: row.get(13)?,
        language: row.get(14)?,
        consent_state: row.get(15)?,
        audio_artifact_id: row.get(16)?,
        transcript_id: row.get(17)?,
        summary_id: row.get(18)?,
        deduplication_key: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
    })
}
