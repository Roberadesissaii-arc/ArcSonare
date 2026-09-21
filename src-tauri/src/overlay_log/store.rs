//! Overlay Conversation Log — Persistence & Store.
//!
//! Owned by Agent 5.

use rusqlite::{params, Connection};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::model::*;
use super::redact::{redact_json_value, redact_str};

pub fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

pub fn get_log_settings(conn: &Connection) -> Result<OverlayLogSettings, String> {
    let mut stmt = conn
        .prepare(
            "SELECT enabled, retention_days, include_interim, include_capability_timeline,
                    include_technical_diagnostics, include_typed_chats, raw_audio_enabled, screenshots_enabled
             FROM overlay_log_settings WHERE id = 'default'",
        )
        .map_err(|e| format!("prepare get settings: {e}"))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| format!("query settings: {e}"))?;

    if let Some(row) = rows.next().map_err(|e| format!("read settings row: {e}"))? {
        let enabled: i32 = row.get(0).unwrap_or(1);
        let retention_days: i32 = row.get(1).unwrap_or(30);
        let include_interim: i32 = row.get(2).unwrap_or(0);
        let include_capability_timeline: i32 = row.get(3).unwrap_or(1);
        let include_technical_diagnostics: i32 = row.get(4).unwrap_or(1);
        let include_typed_chats: i32 = row.get(5).unwrap_or(0);
        let raw_audio_enabled: i32 = row.get(6).unwrap_or(0);
        let screenshots_enabled: i32 = row.get(7).unwrap_or(0);

        Ok(OverlayLogSettings {
            enabled: enabled != 0,
            retention_days: retention_days as u32,
            include_interim: include_interim != 0,
            include_capability_timeline: include_capability_timeline != 0,
            include_technical_diagnostics: include_technical_diagnostics != 0,
            include_typed_chats: include_typed_chats != 0,
            raw_audio_enabled: raw_audio_enabled != 0,
            screenshots_enabled: screenshots_enabled != 0,
        })
    } else {
        Ok(OverlayLogSettings::default())
    }
}

pub fn update_log_settings(
    conn: &Connection,
    settings: &OverlayLogSettings,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO overlay_log_settings (id, enabled, retention_days, include_interim,
                                           include_capability_timeline, include_technical_diagnostics,
                                           include_typed_chats, raw_audio_enabled, screenshots_enabled)
         VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           enabled = ?1,
           retention_days = ?2,
           include_interim = ?3,
           include_capability_timeline = ?4,
           include_technical_diagnostics = ?5,
           include_typed_chats = ?6,
           raw_audio_enabled = ?7,
           screenshots_enabled = ?8",
        params![
            if settings.enabled { 1 } else { 0 },
            settings.retention_days as i32,
            if settings.include_interim { 1 } else { 0 },
            if settings.include_capability_timeline { 1 } else { 0 },
            if settings.include_technical_diagnostics { 1 } else { 0 },
            if settings.include_typed_chats { 1 } else { 0 },
            if settings.raw_audio_enabled { 1 } else { 0 },
            if settings.screenshots_enabled { 1 } else { 0 },
        ],
    )
    .map_err(|e| format!("update log settings: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Session & Turn Operations
// ---------------------------------------------------------------------------

pub fn create_session(
    conn: &Connection,
    account_id: &str,
    surface: OverlaySurface,
    conversation_id: Option<&str>,
) -> Result<OverlayConversationSession, String> {
    let settings = get_log_settings(conn)?;
    if !settings.enabled {
        return Err("Logging is disabled".into());
    }

    let id = format!("osess-{}", Uuid::new_v4());
    let now_ms = current_time_ms();
    let iso = now_iso();
    let surface_str = surface.as_str();

    conn.execute(
        "INSERT INTO overlay_sessions (id, account_id, conversation_id, started_at_ms, surface, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7)",
        params![id, account_id, conversation_id, now_ms, surface_str, iso, iso],
    )
    .map_err(|e| format!("create overlay session: {e}"))?;

    Ok(OverlayConversationSession {
        id,
        account_id: account_id.to_string(),
        conversation_id: conversation_id.map(|s| s.to_string()),
        started_at_ms: now_ms,
        ended_at_ms: None,
        surface,
        status: OverlaySessionStatus::Active,
        turn_count: 0,
        first_user_transcript: None,
        has_error: false,
        duration_ms: None,
        created_at: iso.clone(),
        updated_at: iso,
    })
}

pub fn end_session(
    conn: &Connection,
    session_id: &str,
    status: OverlaySessionStatus,
) -> Result<(), String> {
    let now_ms = current_time_ms();
    let iso = now_iso();

    conn.execute(
        "UPDATE overlay_sessions
         SET ended_at_ms = ?1, status = ?2, updated_at = ?3
         WHERE id = ?4",
        params![now_ms, status.as_str(), iso, session_id],
    )
    .map_err(|e| format!("end overlay session: {e}"))?;

    Ok(())
}

pub fn create_turn(
    conn: &Connection,
    session_id: &str,
    correlation_id: &str,
    user_transcript: Option<&str>,
) -> Result<OverlayConversationTurn, String> {
    let id = format!("oturn-{}", Uuid::new_v4());
    let now_ms = current_time_ms();
    let safe_transcript = user_transcript.map(redact_str);

    conn.execute(
        "INSERT INTO overlay_turns (id, session_id, correlation_id, started_at_ms, user_transcript, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'in-flight')",
        params![id, session_id, correlation_id, now_ms, safe_transcript],
    )
    .map_err(|e| format!("create overlay turn: {e}"))?;

    Ok(OverlayConversationTurn {
        id,
        session_id: session_id.to_string(),
        correlation_id: correlation_id.to_string(),
        started_at_ms: now_ms,
        completed_at_ms: None,
        user_transcript: safe_transcript,
        assistant_response: None,
        status: OverlayTurnStatus::InFlight,
        error_code: None,
        metadata: json!({}),
        events: Vec::new(),
    })
}

pub fn update_turn(
    conn: &Connection,
    turn_id: &str,
    user_transcript: Option<&str>,
    assistant_response: Option<&str>,
    status: OverlayTurnStatus,
    error_code: Option<&str>,
    metadata: Option<&serde_json::Value>,
) -> Result<(), String> {
    let now_ms = current_time_ms();
    let safe_transcript = user_transcript.map(redact_str);
    let safe_response = assistant_response.map(redact_str);
    let safe_meta = metadata.map(redact_json_value).unwrap_or(json!({}));

    conn.execute(
        "UPDATE overlay_turns
         SET user_transcript = COALESCE(?1, user_transcript),
             assistant_response = COALESCE(?2, assistant_response),
             status = ?3,
             completed_at_ms = CASE WHEN ?3 != 'in-flight' THEN ?4 ELSE completed_at_ms END,
             error_code = COALESCE(?5, error_code),
             metadata_json = ?6
         WHERE id = ?7",
        params![
            safe_transcript,
            safe_response,
            status.as_str(),
            now_ms,
            error_code,
            safe_meta.to_string(),
            turn_id
        ],
    )
    .map_err(|e| format!("update overlay turn: {e}"))?;

    Ok(())
}

pub fn record_event(
    conn: &Connection,
    turn_id: &str,
    session_id: &str,
    event_type: OverlayEventType,
    safe_metadata: &serde_json::Value,
) -> Result<OverlayDiagnosticEvent, String> {
    let id = format!("oevt-{}", Uuid::new_v4());
    let now_ms = current_time_ms();
    let redacted_meta = redact_json_value(safe_metadata);

    conn.execute(
        "INSERT INTO overlay_events (id, turn_id, session_id, timestamp_ms, event_type, safe_metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            turn_id,
            session_id,
            now_ms,
            event_type.as_str(),
            redacted_meta.to_string()
        ],
    )
    .map_err(|e| format!("record overlay event: {e}"))?;

    Ok(OverlayDiagnosticEvent {
        id,
        turn_id: turn_id.to_string(),
        session_id: session_id.to_string(),
        timestamp_ms: now_ms,
        event_type,
        safe_metadata: redacted_meta,
    })
}

// ---------------------------------------------------------------------------
// Recovery & Maintenance
// ---------------------------------------------------------------------------

pub fn mark_interrupted_sessions(conn: &Connection) -> Result<usize, String> {
    let count = conn
        .execute(
            "UPDATE overlay_sessions
             SET status = 'interrupted', updated_at = ?1
             WHERE status = 'active'",
            params![now_iso()],
        )
        .map_err(|e| format!("mark interrupted sessions: {e}"))?;

    conn.execute(
        "UPDATE overlay_turns
         SET status = 'cancelled', completed_at_ms = ?1
         WHERE status = 'in-flight'",
        params![current_time_ms()],
    )
    .map_err(|e| format!("mark interrupted turns: {e}"))?;

    Ok(count)
}

pub fn purge_old_logs(conn: &Connection, retention_days: u32) -> Result<usize, String> {
    if retention_days == 0 {
        return Ok(0); // 0 = Keep until deleted
    }

    let millis_per_day: u64 = 86_400_000;
    let cutoff_ms = current_time_ms().saturating_sub(retention_days as u64 * millis_per_day);

    let count = conn
        .execute(
            "DELETE FROM overlay_sessions WHERE started_at_ms < ?1",
            params![cutoff_ms],
        )
        .map_err(|e| format!("purge old logs: {e}"))?;

    Ok(count)
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

pub fn get_summary(conn: &Connection) -> Result<OverlayLogSummary, String> {
    let settings = get_log_settings(conn)?;

    let total_sessions: u32 = conn
        .query_row("SELECT COUNT(*) FROM overlay_sessions", [], |r| r.get(0))
        .unwrap_or(0);

    let total_turns: u32 = conn
        .query_row("SELECT COUNT(*) FROM overlay_turns", [], |r| r.get(0))
        .unwrap_or(0);

    let failed_turns: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM overlay_turns WHERE status IN ('failed', 'transcript-rejected')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let last_recorded_turn_ms: Option<u64> = conn
        .query_row(
            "SELECT MAX(started_at_ms) FROM overlay_turns",
            [],
            |r| r.get(0),
        )
        .ok();

    // Approximate database file size estimation
    let page_count: u64 = conn
        .pragma_query_value(None, "page_count", |r| r.get(0))
        .unwrap_or(0);
    let page_size: u64 = conn
        .pragma_query_value(None, "page_size", |r| r.get(0))
        .unwrap_or(4096);

    Ok(OverlayLogSummary {
        total_sessions,
        total_turns,
        failed_turns,
        last_recorded_turn_ms,
        storage_size_bytes: page_count * page_size,
        retention_days: settings.retention_days,
        logging_enabled: settings.enabled,
    })
}

pub fn list_sessions(
    conn: &Connection,
    account_id: &str,
    limit: u32,
) -> Result<Vec<OverlayConversationSession>, String> {
    let limit = limit.min(200);

    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.account_id, s.conversation_id, s.started_at_ms, s.ended_at_ms,
                    s.surface, s.status, s.created_at, s.updated_at,
                    COUNT(t.id) as turn_count,
                    MIN(t.user_transcript) as first_transcript,
                    MAX(CASE WHEN t.status IN ('failed', 'transcript-rejected') THEN 1 ELSE 0 END) as has_error
             FROM overlay_sessions s
             LEFT JOIN overlay_turns t ON s.id = t.session_id
             WHERE s.account_id = ?1
             GROUP BY s.id
             ORDER BY s.started_at_ms DESC
             LIMIT ?2",
        )
        .map_err(|e| format!("prepare list sessions: {e}"))?;

    let rows = stmt
        .query_map(params![account_id, limit], |row| {
            let id: String = row.get(0)?;
            let account_id: String = row.get(1)?;
            let conversation_id: Option<String> = row.get(2)?;
            let started_at_ms: u64 = row.get(3)?;
            let ended_at_ms: Option<u64> = row.get(4)?;
            let surface_str: String = row.get(5)?;
            let status_str: String = row.get(6)?;
            let created_at: String = row.get(7)?;
            let updated_at: String = row.get(8)?;
            let turn_count: u32 = row.get(9)?;
            let first_user_transcript: Option<String> = row.get(10)?;
            let has_error_int: i32 = row.get(11)?;

            let duration_ms = ended_at_ms.map(|e| e.saturating_sub(started_at_ms));

            Ok(OverlayConversationSession {
                id,
                account_id,
                conversation_id,
                started_at_ms,
                ended_at_ms,
                surface: OverlaySurface::parse(&surface_str),
                status: OverlaySessionStatus::parse(&status_str),
                turn_count,
                first_user_transcript,
                has_error: has_error_int != 0,
                duration_ms,
                created_at,
                updated_at,
            })
        })
        .map_err(|e| format!("query sessions: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("map sessions: {e}"))?;

    Ok(rows)
}

pub fn get_session_detail(
    conn: &Connection,
    session_id: &str,
) -> Result<SessionDetailView, String> {
    let mut stmt_sess = conn
        .prepare(
            "SELECT id, account_id, conversation_id, started_at_ms, ended_at_ms, surface, status, created_at, updated_at
             FROM overlay_sessions WHERE id = ?1",
        )
        .map_err(|e| format!("prepare session detail: {e}"))?;

    let session = stmt_sess
        .query_row(params![session_id], |row| {
            let id: String = row.get(0)?;
            let account_id: String = row.get(1)?;
            let conversation_id: Option<String> = row.get(2)?;
            let started_at_ms: u64 = row.get(3)?;
            let ended_at_ms: Option<u64> = row.get(4)?;
            let surface_str: String = row.get(5)?;
            let status_str: String = row.get(6)?;
            let created_at: String = row.get(7)?;
            let updated_at: String = row.get(8)?;

            Ok(OverlayConversationSession {
                id,
                account_id,
                conversation_id,
                started_at_ms,
                ended_at_ms,
                surface: OverlaySurface::parse(&surface_str),
                status: OverlaySessionStatus::parse(&status_str),
                turn_count: 0,
                first_user_transcript: None,
                has_error: false,
                duration_ms: ended_at_ms.map(|e| e.saturating_sub(started_at_ms)),
                created_at,
                updated_at,
            })
        })
        .map_err(|e| format!("session not found: {e}"))?;

    let mut stmt_turns = conn
        .prepare(
            "SELECT id, session_id, correlation_id, started_at_ms, completed_at_ms, user_transcript, assistant_response, status, error_code, metadata_json
             FROM overlay_turns WHERE session_id = ?1 ORDER BY started_at_ms ASC",
        )
        .map_err(|e| format!("prepare turns: {e}"))?;

    let turns_raw = stmt_turns
        .query_map(params![session_id], |row| {
            let id: String = row.get(0)?;
            let session_id: String = row.get(1)?;
            let correlation_id: String = row.get(2)?;
            let started_at_ms: u64 = row.get(3)?;
            let completed_at_ms: Option<u64> = row.get(4)?;
            let user_transcript: Option<String> = row.get(5)?;
            let assistant_response: Option<String> = row.get(6)?;
            let status_str: String = row.get(7)?;
            let error_code: Option<String> = row.get(8)?;
            let metadata_json: String = row.get(9)?;

            let metadata = serde_json::from_str(&metadata_json).unwrap_or(json!({}));

            Ok((
                id,
                session_id,
                correlation_id,
                started_at_ms,
                completed_at_ms,
                user_transcript,
                assistant_response,
                OverlayTurnStatus::parse(&status_str),
                error_code,
                metadata,
            ))
        })
        .map_err(|e| format!("query turns: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("map turns: {e}"))?;

    let mut turns = Vec::new();
    for (
        id,
        sess_id,
        corr_id,
        start_ms,
        comp_ms,
        user_tx,
        asst_resp,
        status,
        err_code,
        metadata,
    ) in turns_raw
    {
        let mut stmt_events = conn
            .prepare(
                "SELECT id, turn_id, session_id, timestamp_ms, event_type, safe_metadata_json
                 FROM overlay_events WHERE turn_id = ?1 ORDER BY timestamp_ms ASC",
            )
            .map_err(|e| format!("prepare events: {e}"))?;

        let events = stmt_events
            .query_map(params![&id], |row| {
                let evt_id: String = row.get(0)?;
                let turn_id: String = row.get(1)?;
                let session_id: String = row.get(2)?;
                let timestamp_ms: u64 = row.get(3)?;
                let event_type_str: String = row.get(4)?;
                let safe_metadata_json: String = row.get(5)?;

                let safe_metadata =
                    serde_json::from_str(&safe_metadata_json).unwrap_or(json!({}));

                Ok(OverlayDiagnosticEvent {
                    id: evt_id,
                    turn_id,
                    session_id,
                    timestamp_ms,
                    event_type: OverlayEventType::parse(&event_type_str),
                    safe_metadata,
                })
            })
            .map_err(|e| format!("query events: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("map events: {e}"))?;

        turns.push(OverlayConversationTurn {
            id,
            session_id: sess_id,
            correlation_id: corr_id,
            started_at_ms: start_ms,
            completed_at_ms: comp_ms,
            user_transcript: user_tx,
            assistant_response: asst_resp,
            status,
            error_code: err_code,
            metadata,
            events,
        });
    }

    Ok(SessionDetailView { session, turns })
}

pub fn delete_session(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM overlay_events WHERE session_id = ?1", params![session_id])
        .map_err(|e| format!("delete session events: {e}"))?;
    conn.execute("DELETE FROM overlay_turns WHERE session_id = ?1", params![session_id])
        .map_err(|e| format!("delete session turns: {e}"))?;
    conn.execute("DELETE FROM overlay_sessions WHERE id = ?1", params![session_id])
        .map_err(|e| format!("delete session: {e}"))?;
    Ok(())
}

pub fn clear_all(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM overlay_events", [])
        .map_err(|e| format!("clear events: {e}"))?;
    conn.execute("DELETE FROM overlay_turns", [])
        .map_err(|e| format!("clear turns: {e}"))?;
    conn.execute("DELETE FROM overlay_sessions", [])
        .map_err(|e| format!("clear sessions: {e}"))?;
    Ok(())
}
