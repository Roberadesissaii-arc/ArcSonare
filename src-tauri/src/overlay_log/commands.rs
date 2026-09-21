//! Overlay Conversation Log — Tauri Commands & Export Logic.
//!
//! Owned by Agent 5.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use super::model::*;
use super::redact::redact_str;
use super::store;
use crate::database::manager::DatabaseManager;

// ---------------------------------------------------------------------------
// Commands: Logging (Non-blocking IPC targets)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn overlay_log_session_start(
    db: State<'_, DatabaseManager>,
    surface: Option<String>,
    conversation_id: Option<String>,
) -> Result<OverlayConversationSession, String> {
    let account_id = db.sync_user_id().unwrap_or_else(|_| "guest".into());
    let surface_enum = surface
        .as_deref()
        .map(OverlaySurface::parse)
        .unwrap_or(OverlaySurface::VoiceOverlay);

    db.with_conn_mut(|conn| store::create_session(conn, &account_id, surface_enum, conversation_id.as_deref()))
}

#[tauri::command]
pub fn overlay_log_session_end(
    db: State<'_, DatabaseManager>,
    session_id: String,
    status: Option<String>,
) -> Result<(), String> {
    let status_enum = status
        .as_deref()
        .map(OverlaySessionStatus::parse)
        .unwrap_or(OverlaySessionStatus::Completed);

    db.with_conn_mut(|conn| store::end_session(conn, &session_id, status_enum))
}

#[tauri::command]
pub fn overlay_log_turn_start(
    db: State<'_, DatabaseManager>,
    session_id: String,
    correlation_id: String,
    user_transcript: Option<String>,
) -> Result<OverlayConversationTurn, String> {
    db.with_conn_mut(|conn| {
        store::create_turn(conn, &session_id, &correlation_id, user_transcript.as_deref())
    })
}

#[tauri::command]
pub fn overlay_log_turn_update(
    db: State<'_, DatabaseManager>,
    turn_id: String,
    user_transcript: Option<String>,
    assistant_response: Option<String>,
    status: String,
    error_code: Option<String>,
    metadata: Option<serde_json::Value>,
) -> Result<(), String> {
    let status_enum = OverlayTurnStatus::parse(&status);
    db.with_conn_mut(|conn| {
        store::update_turn(
            conn,
            &turn_id,
            user_transcript.as_deref(),
            assistant_response.as_deref(),
            status_enum,
            error_code.as_deref(),
            metadata.as_ref(),
        )
    })
}

#[tauri::command]
pub fn overlay_log_event_record(
    db: State<'_, DatabaseManager>,
    turn_id: String,
    session_id: String,
    event_type: String,
    safe_metadata: Option<serde_json::Value>,
) -> Result<OverlayDiagnosticEvent, String> {
    let event_type_enum = OverlayEventType::parse(&event_type);
    let meta = safe_metadata.unwrap_or(json!({}));
    db.with_conn_mut(|conn| {
        store::record_event(conn, &turn_id, &session_id, event_type_enum, &meta)
    })
}

// ---------------------------------------------------------------------------
// Commands: Querying & Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn overlay_log_get_settings(
    db: State<'_, DatabaseManager>,
) -> Result<OverlayLogSettings, String> {
    db.with_conn_mut(|conn| store::get_log_settings(conn))
}

#[tauri::command]
pub fn overlay_log_update_settings(
    db: State<'_, DatabaseManager>,
    settings: OverlayLogSettings,
) -> Result<(), String> {
    db.with_conn_mut(|conn| store::update_log_settings(conn, &settings))
}

#[tauri::command]
pub fn overlay_log_get_summary(
    db: State<'_, DatabaseManager>,
) -> Result<OverlayLogSummary, String> {
    db.with_conn_mut(|conn| store::get_summary(conn))
}

#[tauri::command]
pub fn overlay_log_sessions_list(
    db: State<'_, DatabaseManager>,
    limit: Option<u32>,
) -> Result<Vec<OverlayConversationSession>, String> {
    let account_id = db.sync_user_id().unwrap_or_else(|_| "guest".into());
    db.with_conn_mut(|conn| store::list_sessions(conn, &account_id, limit.unwrap_or(50)))
}

#[tauri::command]
pub fn overlay_log_session_get(
    db: State<'_, DatabaseManager>,
    session_id: String,
) -> Result<SessionDetailView, String> {
    db.with_conn_mut(|conn| store::get_session_detail(conn, &session_id))
}

#[tauri::command]
pub fn overlay_log_session_delete(
    db: State<'_, DatabaseManager>,
    session_id: String,
) -> Result<(), String> {
    db.with_conn_mut(|conn| store::delete_session(conn, &session_id))
}

#[tauri::command]
pub fn overlay_log_clear_all(
    db: State<'_, DatabaseManager>,
) -> Result<(), String> {
    db.with_conn_mut(|conn| store::clear_all(conn))
}

// ---------------------------------------------------------------------------
// Export Functionality (JSON, JSONL, Markdown, ZIP bundle)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ExportRequest {
    pub format: String, // "json" | "jsonl" | "markdown" | "zip"
    pub session_ids: Option<Vec<String>>,
    pub target_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub success: bool,
    pub path: String,
    pub format: String,
    pub bytes_written: u64,
}

#[tauri::command]
pub fn overlay_log_export(
    app: AppHandle,
    db: State<'_, DatabaseManager>,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    let account_id = db.sync_user_id().unwrap_or_else(|_| "guest".into());
    let settings = db.with_conn_mut(|conn| store::get_log_settings(conn))?;

    // Determine target sessions
    let sessions_to_export: Vec<SessionDetailView> = db.with_conn_mut(|conn| {
        let all_sessions = store::list_sessions(conn, &account_id, 200)?;
        let mut list = Vec::new();
        for sess in all_sessions {
            if let Some(ref ids) = request.session_ids {
                if !ids.contains(&sess.id) {
                    continue;
                }
            }
            if let Ok(detail) = store::get_session_detail(conn, &sess.id) {
                list.push(detail);
            }
        }
        Ok::<Vec<SessionDetailView>, String>(list)
    })?;

    let now_str = chrono::Utc::now().format("%Y-%m-%d-%H%M%S").to_string();
    let default_filename = format!("ArcSonare-overlay-logs-{now_str}");

    // Target file path
    let target_path = if let Some(path) = request.target_path {
        PathBuf::from(path)
    } else {
        let download_dir = app
            .path()
            .download_dir()
            .unwrap_or_else(|_| std::env::temp_dir());
        let ext = match request.format.as_str() {
            "json" => "json",
            "jsonl" => "jsonl",
            "markdown" => "md",
            _ => "zip",
        };
        download_dir.join(format!("{default_filename}.{ext}"))
    };

    let bytes_written = match request.format.as_str() {
        "json" => {
            let json_data = json!({
                "manifest": build_manifest(&settings, sessions_to_export.len()),
                "sessions": sessions_to_export
            });
            let mut file = File::create(&target_path)
                .map_err(|e| format!("cannot create export file: {e}"))?;
            let content = serde_json::to_string_pretty(&json_data)
                .map_err(|e| format!("cannot serialize export: {e}"))?;
            file.write_all(content.as_bytes())
                .map_err(|e| format!("cannot write export file: {e}"))?;
            content.len() as u64
        }
        "jsonl" => {
            let mut file = File::create(&target_path)
                .map_err(|e| format!("cannot create export file: {e}"))?;
            let mut total_bytes = 0;
            for sess in &sessions_to_export {
                let line = serde_json::to_string(sess)
                    .map_err(|e| format!("serialize jsonl row: {e}"))?;
                file.write_all(line.as_bytes())
                    .map_err(|e| format!("write jsonl: {e}"))?;
                file.write_all(b"\n")
                    .map_err(|e| format!("write jsonl: {e}"))?;
                total_bytes += line.len() as u64 + 1;
            }
            total_bytes
        }
        "markdown" => {
            let md_content = generate_markdown_export(&settings, &sessions_to_export);
            let mut file = File::create(&target_path)
                .map_err(|e| format!("cannot create export file: {e}"))?;
            file.write_all(md_content.as_bytes())
                .map_err(|e| format!("cannot write markdown: {e}"))?;
            md_content.len() as u64
        }
        "zip" | _ => {
            let bytes = generate_zip_export(&target_path, &settings, &sessions_to_export)?;
            bytes
        }
    };

    Ok(ExportResult {
        success: true,
        path: target_path.to_string_lossy().to_string(),
        format: request.format,
        bytes_written,
    })
}

fn build_manifest(settings: &OverlayLogSettings, session_count: usize) -> ExportManifest {
    ExportManifest {
        app_name: "ArcSonare".into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        schema_version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        operating_system: std::env::consts::OS.into(),
        tauri_version: "2.0".into(),
        session_count,
        turn_count: 0,
        settings: settings.clone(),
    }
}

fn generate_markdown_export(
    _settings: &OverlayLogSettings,
    sessions: &[SessionDetailView],
) -> String {
    let mut out = String::new();
    out.push_str("# ArcSonare Speech Overlay Conversation Logs\n\n");
    out.push_str(&format!(
        "Exported at: {}\nApplication Version: {}\nOperating System: {}\n\n",
        chrono::Utc::now().to_rfc3339(),
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    ));

    out.push_str("## Privacy Notice\n");
    out.push_str("This export contains speech overlay transcripts, assistant responses, and diagnostic timelines.\n");
    out.push_str("Raw audio, screenshots, API keys, passwords, and private credentials have been redacted.\n\n");

    out.push_str("---\n\n");

    for (idx, sess) in sessions.iter().enumerate() {
        let date_str = chrono::DateTime::from_timestamp_millis(sess.session.started_at_ms as i64)
            .map(|dt| dt.format("%b %d, %Y · %I:%M %p").to_string())
            .unwrap_or_else(|| sess.session.started_at_ms.to_string());

        out.push_str(&format!(
            "### Session {} — {}\n",
            idx + 1,
            date_str
        ));
        out.push_str(&format!(
            "**Surface:** {} | **Status:** {} | **Turns:** {}\n\n",
            sess.session.surface.as_str(),
            sess.session.status.as_str(),
            sess.turns.len()
        ));

        for (t_idx, turn) in sess.turns.iter().enumerate() {
            out.push_str(&format!("#### Turn {}\n", t_idx + 1));
            if let Some(ref tx) = turn.user_transcript {
                out.push_str(&format!("**You:** {}\n\n", redact_str(tx)));
            }
            if let Some(ref resp) = turn.assistant_response {
                out.push_str(&format!("**ArcSonare:** {}\n\n", redact_str(resp)));
            }

            out.push_str("<details><summary>Technical Timeline</summary>\n\n");
            out.push_str(&format!("- Correlation ID: `{}`\n", turn.correlation_id));
            out.push_str(&format!("- Turn ID: `{}`\n", turn.id));
            out.push_str(&format!("- Status: {}\n", turn.status.as_str()));
            if let Some(ref err) = turn.error_code {
                out.push_str(&format!("- Error Code: `{}`\n", err));
            }
            out.push_str("\n**Events:**\n");

            for evt in &turn.events {
                let offset = evt.timestamp_ms.saturating_sub(turn.started_at_ms);
                out.push_str(&format!(
                    "- +{}ms: `{}`\n",
                    offset,
                    evt.event_type.as_str()
                ));
            }
            out.push_str("\n</details>\n\n");
        }

        out.push_str("---\n\n");
    }

    out
}

fn generate_zip_export(
    target_path: &PathBuf,
    settings: &OverlayLogSettings,
    sessions: &[SessionDetailView],
) -> Result<u64, String> {
    // Generate simple zip file
    let file = File::create(target_path)
        .map_err(|e| format!("cannot create zip file: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);

    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);

    // 1. manifest.json
    zip.start_file("manifest.json", options)
        .map_err(|e| format!("zip add manifest: {e}"))?;
    let manifest_data = serde_json::to_string_pretty(&build_manifest(settings, sessions.len()))
        .unwrap_or_default();
    zip.write_all(manifest_data.as_bytes())
        .map_err(|e| format!("zip write manifest: {e}"))?;

    // 2. conversation.md
    zip.start_file("conversation.md", options)
        .map_err(|e| format!("zip add conversation.md: {e}"))?;
    let md = generate_markdown_export(settings, sessions);
    zip.write_all(md.as_bytes())
        .map_err(|e| format!("zip write conversation.md: {e}"))?;

    // 3. sessions.jsonl
    zip.start_file("sessions.jsonl", options)
        .map_err(|e| format!("zip add sessions.jsonl: {e}"))?;
    for sess in sessions {
        if let Ok(line) = serde_json::to_string(sess) {
            let _ = zip.write_all(line.as_bytes());
            let _ = zip.write_all(b"\n");
        }
    }

    // 4. environment.json
    zip.start_file("environment.json", options)
        .map_err(|e| format!("zip add environment.json: {e}"))?;
    let env_json = json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "tauriVersion": "2.0",
        "exportedAt": chrono::Utc::now().to_rfc3339()
    });
    zip.write_all(serde_json::to_string_pretty(&env_json).unwrap_or_default().as_bytes())
        .map_err(|e| format!("zip write environment.json: {e}"))?;

    let mut zip_file = zip
        .finish()
        .map_err(|e| format!("zip finish error: {e}"))?;

    zip_file.flush().map_err(|e| format!("zip flush error: {e}"))?;
    let metadata = std::fs::metadata(target_path).map_err(|e| format!("stat zip: {e}"))?;
    Ok(metadata.len())
}
