//! Sync outbox helpers and status commands for the frontend sync worker.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::credentials::{secure_storage_read, secure_storage_write};

use super::manager::DatabaseManager;

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn ensure_device_id() -> Result<String, String> {
    if let Some(id) = secure_storage_read("device.id")? {
        if !id.trim().is_empty() {
            return Ok(id);
        }
    }
    let id = Uuid::new_v4().to_string();
    secure_storage_write("device.id", &id)?;
    Ok(id)
}

pub fn enqueue_outbox(
    conn: &Connection,
    user_id: &str,
    device_id: &str,
    entity_type: &str,
    entity_id: &str,
    operation: &str,
    payload_json: Option<&str>,
    base_version: Option<i64>,
) -> Result<(), String> {
    let now = now_iso();
    let id = Uuid::new_v4().to_string();
    let idempotency_key = format!("{entity_type}:{entity_id}:{operation}:{id}");
    let _ = conn.execute(
        "DELETE FROM sync_outbox
         WHERE entity_type = ?1 AND entity_id = ?2
           AND state IN ('pending', 'retry')",
        params![entity_type, entity_id],
    );
    conn.execute(
        "INSERT INTO sync_outbox (
            id, user_id, device_id, entity_type, entity_id, operation, payload_json,
            base_version, idempotency_key, priority, state, attempt_count,
            next_attempt_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 'pending', 0, NULL, ?10, ?10)",
        params![
            id,
            user_id,
            device_id,
            entity_type,
            entity_id,
            operation,
            payload_json,
            base_version,
            idempotency_key,
            now,
        ],
    )
    .map_err(|e| format!("enqueue sync outbox: {e}"))?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusDto {
    pub pending: i64,
    pub failed: i64,
    pub conflicts: i64,
    pub last_cursor: i64,
}

#[tauri::command]
pub fn sync_get_status(state: State<'_, DatabaseManager>) -> Result<SyncStatusDto, String> {
    state.with_conn_mut(|conn| {
        let pending: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_outbox WHERE state IN ('pending','retry','sending')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let failed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_outbox WHERE state = 'failed'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let conflicts: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_conflicts WHERE resolution = 'pending'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let last_cursor: i64 = conn
            .query_row(
                "SELECT value FROM sync_cursors WHERE name = 'sync_change_log'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        Ok(SyncStatusDto {
            pending,
            failed,
            conflicts,
            last_cursor,
        })
    })
}

#[tauri::command]
pub fn sync_push_batch(
    state: State<'_, DatabaseManager>,
    limit: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.clamp(1, 50);
    state.with_conn_mut(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, entity_type, entity_id, operation, payload_json, base_version, idempotency_key
                 FROM sync_outbox
                 WHERE state IN ('pending','retry')
                 ORDER BY priority DESC, created_at ASC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([limit], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "entityType": row.get::<_, String>(1)?,
                    "entityId": row.get::<_, String>(2)?,
                    "operation": row.get::<_, String>(3)?,
                    "payloadJson": row.get::<_, Option<String>>(4)?,
                    "baseVersion": row.get::<_, Option<i64>>(5)?,
                    "idempotencyKey": row.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for row in &rows {
            if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
                let _ = conn.execute(
                    "UPDATE sync_outbox SET state = 'sending', updated_at = datetime('now') WHERE id = ?1",
                    [id],
                );
            }
        }
        Ok(rows)
    })
}

#[tauri::command]
pub fn sync_pull(
    state: State<'_, DatabaseManager>,
    after_sequence: i64,
    limit: i64,
) -> Result<SyncStatusDto, String> {
    let _ = (after_sequence, limit);
    sync_get_status(state)
}

#[tauri::command]
pub fn sync_advance_cursor(state: State<'_, DatabaseManager>, sequence: i64) -> Result<(), String> {
    state.with_conn_mut(|conn| {
        conn.execute(
            "INSERT INTO sync_cursors (name, value, updated_at) VALUES ('sync_change_log', ?1, datetime('now'))
             ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            [sequence],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn sync_mark_outbox_completed(
    state: State<'_, DatabaseManager>,
    id: String,
) -> Result<(), String> {
    state.with_conn_mut(|conn| {
        conn.execute(
            "UPDATE sync_outbox SET state = 'completed', updated_at = datetime('now') WHERE id = ?1",
            [&id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}
