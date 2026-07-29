//! Local agent persistence + sync outbox (transactional).

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use super::manager::DatabaseManager;
use super::sync::{enqueue_outbox, ensure_device_id, now_iso};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentRow {
    pub id: String,
    pub workspace_id: Option<String>,
    pub name: String,
    pub role: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub status: String,
    pub runtime_type: String,
    pub model_provider: Option<String>,
    pub model_id: Option<String>,
    pub voice_character_id: Option<String>,
    pub configuration_json: String,
    pub version: i64,
    pub base_version: Option<i64>,
    pub cloud_version: Option<i64>,
    pub sync_state: String,
    pub last_synced_at: Option<String>,
    pub local_updated_at: String,
    pub sync_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

fn row_from_query(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalAgentRow> {
    Ok(LocalAgentRow {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        role: row.get(3)?,
        description: row.get(4)?,
        instructions: row.get(5)?,
        status: row.get(6)?,
        runtime_type: row.get(7)?,
        model_provider: row.get(8)?,
        model_id: row.get(9)?,
        voice_character_id: row.get(10)?,
        configuration_json: row.get(11)?,
        version: row.get(12)?,
        base_version: row.get(13)?,
        cloud_version: row.get(14)?,
        sync_state: row.get(15)?,
        last_synced_at: row.get(16)?,
        local_updated_at: row.get(17)?,
        sync_error: row.get(18)?,
        created_at: row.get(19)?,
        updated_at: row.get(20)?,
        deleted_at: row.get(21)?,
    })
}

const AGENT_SELECT: &str = "SELECT id, workspace_id, name, role, description, instructions, status,
    runtime_type, model_provider, model_id, voice_character_id, configuration_json, version,
    base_version, cloud_version, sync_state, last_synced_at, local_updated_at, sync_error,
    created_at, updated_at, deleted_at FROM agents";

fn upsert_agent_in_tx(
    conn: &Connection,
    user_id: &str,
    device_id: &str,
    agent: Value,
) -> Result<LocalAgentRow, String> {
    let id = agent
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let name = agent
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled agent")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("Agent name is required.".into());
    }

    let role = agent
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("General")
        .to_string();
    let description = agent
        .get("description")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let enabled = agent
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let status = if enabled { "active" } else { "inactive" };
    let runtime_type = agent
        .get("runtimeType")
        .and_then(|v| v.as_str())
        .unwrap_or("manual")
        .to_string();
    let model_provider = agent
        .get("modelProvider")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let model_id = agent
        .get("modelId")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let voice_character_id = agent
        .pointer("/voice/characterId")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let instructions = agent
        .get("instructions")
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".into()));
    let configuration_json =
        serde_json::to_string(&agent).map_err(|e| format!("serialize agent payload: {e}"))?;

    let now = now_iso();
    let existing: Option<(i64, Option<i64>)> = conn
        .query_row(
            "SELECT version, base_version FROM agents WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    let (version, base_version, operation) = if let Some((ver, base)) = existing {
        (ver + 1, base.or(Some(ver)), "update")
    } else {
        (1_i64, None, "insert")
    };

    conn.execute(
        "INSERT INTO agents (
            id, workspace_id, name, role, description, instructions, status, runtime_type,
            model_provider, model_id, voice_character_id, configuration_json, version, base_version,
            cloud_version, sync_state, last_synced_at, local_updated_at, sync_error, created_at,
            updated_at, deleted_at
        ) VALUES (
            ?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL,
            'pending', NULL, ?14, NULL, ?14, ?14, NULL
        )
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            role = excluded.role,
            description = excluded.description,
            instructions = excluded.instructions,
            status = excluded.status,
            runtime_type = excluded.runtime_type,
            model_provider = excluded.model_provider,
            model_id = excluded.model_id,
            voice_character_id = excluded.voice_character_id,
            configuration_json = excluded.configuration_json,
            version = excluded.version,
            base_version = excluded.base_version,
            sync_state = 'pending',
            local_updated_at = excluded.local_updated_at,
            updated_at = excluded.updated_at,
            deleted_at = NULL",
        params![
            id,
            name,
            role,
            description,
            instructions,
            status,
            runtime_type,
            model_provider,
            model_id,
            voice_character_id,
            configuration_json,
            version,
            base_version,
            now,
        ],
    )
    .map_err(|e| format!("upsert agent: {e}"))?;

    enqueue_outbox(
        conn,
        user_id,
        device_id,
        "agents",
        &id,
        operation,
        Some(&configuration_json),
        base_version,
    )?;

    conn.query_row(
        &format!("{AGENT_SELECT} WHERE id = ?1"),
        params![id],
        row_from_query,
    )
    .map_err(|e| format!("read agent after upsert: {e}"))
}

#[tauri::command]
pub fn agents_list_local(state: State<'_, DatabaseManager>) -> Result<Vec<LocalAgentRow>, String> {
    state.with_conn_mut(|conn| {
        let mut stmt = conn
            .prepare(&format!(
                "{AGENT_SELECT} WHERE deleted_at IS NULL ORDER BY local_updated_at DESC"
            ))
            .map_err(|e| format!("prepare agents list: {e}"))?;
        let rows = stmt
            .query_map([], row_from_query)
            .map_err(|e| format!("query agents: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("map agents: {e}"))?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn agents_upsert_local(
    state: State<'_, DatabaseManager>,
    agent: Value,
) -> Result<LocalAgentRow, String> {
    let user_id = state.sync_user_id()?;
    let device_id = ensure_device_id()?;
    state.with_conn_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("begin agent upsert tx: {e}"))?;
        let row = upsert_agent_in_tx(&tx, &user_id, &device_id, agent)?;
        tx.commit()
            .map_err(|e| format!("commit agent upsert tx: {e}"))?;
        Ok(row)
    })
}

#[tauri::command]
pub fn agents_soft_delete_local(
    state: State<'_, DatabaseManager>,
    agent_id: String,
) -> Result<(), String> {
    let agent_id = agent_id.trim().to_string();
    if agent_id.is_empty() {
        return Err("agent_id is required".into());
    }
    let user_id = state.sync_user_id()?;
    let device_id = ensure_device_id()?;
    state.with_conn_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("begin agent delete tx: {e}"))?;
        let (version, base_version, configuration_json): (i64, Option<i64>, String) = tx
            .query_row(
                "SELECT version, base_version, configuration_json FROM agents WHERE id = ?1 AND deleted_at IS NULL",
                params![agent_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| format!("Agent '{agent_id}' was not found or is already deleted."))?;

        let now = now_iso();
        let new_version = version + 1;
        tx.execute(
            "UPDATE agents SET deleted_at = ?1, version = ?2, sync_state = 'pending',
             local_updated_at = ?1, updated_at = ?1 WHERE id = ?3",
            params![now, new_version, agent_id],
        )
        .map_err(|e| format!("soft delete agent: {e}"))?;

        enqueue_outbox(
            &tx,
            &user_id,
            &device_id,
            "agents",
            &agent_id,
            "delete",
            Some(&configuration_json),
            base_version.or(Some(version)),
        )?;

        tx.commit()
            .map_err(|e| format!("commit agent delete tx: {e}"))?;
        Ok(())
    })
}
