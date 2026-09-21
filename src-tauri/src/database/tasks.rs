//! Local task persistence + sync outbox (transactional).

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

use super::manager::DatabaseManager;
use super::sync::{enqueue_outbox, ensure_device_id, now_iso};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTaskRow {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub due_at: Option<String>,
    pub assigned_agent_id: Option<String>,
    pub progress: i32,
    pub source: String,
    pub tags_json: String,
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
    pub completed_at: Option<String>,
    pub deleted_at: Option<String>,
}

fn map_priority(task: &Value) -> String {
    if task
        .get("urgent")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return "urgent".into();
    }
    match task
        .get("priority")
        .and_then(|v| v.as_str())
        .unwrap_or("medium")
    {
        "high" => "high",
        "low" => "low",
        "medium" => "medium",
        _ => "none",
    }
    .to_string()
}

fn map_status(task: &Value) -> String {
    if task
        .get("completed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        "completed".into()
    } else {
        "open".into()
    }
}

fn row_from_query(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalTaskRow> {
    Ok(LocalTaskRow {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        status: row.get(4)?,
        priority: row.get(5)?,
        due_at: row.get(6)?,
        assigned_agent_id: row.get(7)?,
        progress: row.get(8)?,
        source: row.get(9)?,
        tags_json: row.get(10)?,
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
        completed_at: row.get(21)?,
        deleted_at: row.get(22)?,
    })
}

const TASK_SELECT: &str = "SELECT id, workspace_id, title, description, status, priority, due_at,
    assigned_agent_id, progress, source, tags_json, configuration_json, version, base_version,
    cloud_version, sync_state, last_synced_at, local_updated_at, sync_error, created_at, updated_at,
    completed_at, deleted_at FROM tasks";

fn upsert_task_in_tx(
    conn: &Connection,
    user_id: &str,
    device_id: &str,
    task: Value,
) -> Result<LocalTaskRow, String> {
    let id = task
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let title = task
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled task")
        .trim()
        .to_string();
    if title.is_empty() {
        return Err("Task title is required.".into());
    }

    let now = now_iso();
    let status = map_status(&task);
    let priority = map_priority(&task);
    let description = task
        .get("note")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let due_at = task.get("due").and_then(|v| v.as_str()).map(str::to_string);
    let assigned_agent_id = task
        .get("agentId")
        .or_else(|| task.get("assignedAgentId"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let progress = task
        .get("progress")
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
        .clamp(0, 100) as i32;
    let tags_json = task
        .get("tags")
        .map(|t| serde_json::to_string(t).unwrap_or_else(|_| "[]".into()))
        .unwrap_or_else(|| "[]".into());
    let configuration_json =
        serde_json::to_string(&task).map_err(|e| format!("serialize task payload: {e}"))?;

    let existing: Option<(i64, Option<i64>)> = conn
        .query_row(
            "SELECT version, base_version FROM tasks WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    let (version, base_version, operation) = if let Some((ver, base)) = existing {
        (ver + 1, base.or(Some(ver)), "update")
    } else {
        (1_i64, None, "insert")
    };

    let completed_at = if status == "completed" {
        Some(now.clone())
    } else {
        None
    };

    conn.execute(
        "INSERT INTO tasks (
            id, workspace_id, title, description, status, priority, due_at, assigned_agent_id,
            progress, source, tags_json, configuration_json, version, base_version, cloud_version,
            sync_state, last_synced_at, local_updated_at, sync_error, created_at, updated_at,
            completed_at, deleted_at
        ) VALUES (
            ?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'user', ?9, ?10, ?11, ?12, NULL,
            'pending', NULL, ?13, NULL, ?13, ?13, ?14, NULL
        )
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            priority = excluded.priority,
            due_at = excluded.due_at,
            assigned_agent_id = excluded.assigned_agent_id,
            progress = excluded.progress,
            tags_json = excluded.tags_json,
            configuration_json = excluded.configuration_json,
            version = excluded.version,
            base_version = excluded.base_version,
            sync_state = 'pending',
            local_updated_at = excluded.local_updated_at,
            updated_at = excluded.updated_at,
            completed_at = excluded.completed_at,
            deleted_at = NULL",
        params![
            id,
            title,
            description,
            status,
            priority,
            due_at,
            assigned_agent_id,
            progress,
            tags_json,
            configuration_json,
            version,
            base_version,
            now,
            completed_at,
        ],
    )
    .map_err(|e| format!("upsert task: {e}"))?;

    enqueue_outbox(
        conn,
        user_id,
        device_id,
        "tasks",
        &id,
        operation,
        Some(&configuration_json),
        base_version,
    )?;

    conn.query_row(
        &format!("{TASK_SELECT} WHERE id = ?1"),
        params![id],
        row_from_query,
    )
    .map_err(|e| format!("read task after upsert: {e}"))
}

/// Told to every webview when the task table changes.
///
/// Voice runs in the `sonare-overlay` window and the Tasks page runs in `main`.
/// Those are separate JavaScript heaps, so a task created by voice updated an
/// array the Dashboard could never see. A Rust-owned event is the only thing
/// both windows genuinely share.
pub const TASKS_CHANGED_EVENT: &str = "arcsonare://tasks-changed";

/// Read one task straight from the database.
///
/// Exists so a caller can verify a write actually landed. The frontend's own
/// `readPersistedTasks()` returns its in-memory cache, so using it as a
/// read-after-write check proved only that the cache had been written to — which
/// is how a task that was never saved came to be announced as created.
#[tauri::command]
pub fn tasks_get_local(
    state: State<'_, DatabaseManager>,
    task_id: String,
) -> Result<Option<LocalTaskRow>, String> {
    let task_id = task_id.trim().to_string();
    if task_id.is_empty() {
        return Err("task_id is required".into());
    }
    state.with_conn_mut(|conn| {
        let mut stmt = conn
            .prepare(&format!(
                "{TASK_SELECT} WHERE id = ?1 AND deleted_at IS NULL"
            ))
            .map_err(|e| format!("prepare task get: {e}"))?;
        let mut rows = stmt
            .query_map(params![task_id], row_from_query)
            .map_err(|e| format!("query task: {e}"))?;
        match rows.next() {
            Some(row) => Ok(Some(row.map_err(|e| format!("map task: {e}"))?)),
            None => Ok(None),
        }
    })
}

#[tauri::command]
pub fn tasks_list_local(state: State<'_, DatabaseManager>) -> Result<Vec<LocalTaskRow>, String> {
    state.with_conn_mut(|conn| {
        let mut stmt = conn
            .prepare(&format!(
                "{TASK_SELECT} WHERE deleted_at IS NULL ORDER BY local_updated_at DESC"
            ))
            .map_err(|e| format!("prepare tasks list: {e}"))?;
        let rows = stmt
            .query_map([], row_from_query)
            .map_err(|e| format!("query tasks: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("map tasks: {e}"))?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn tasks_upsert_local<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DatabaseManager>,
    task: Value,
) -> Result<LocalTaskRow, String> {
    let user_id = state.sync_user_id()?;
    let device_id = ensure_device_id()?;
    let row = state.with_conn_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("begin task upsert tx: {e}"))?;
        let row = upsert_task_in_tx(&tx, &user_id, &device_id, task)?;
        tx.commit()
            .map_err(|e| format!("commit task upsert tx: {e}"))?;
        Ok(row)
    })?;
    // After the commit, never before: a window told a task exists must be able
    // to read it.
    let _ = app.emit(TASKS_CHANGED_EVENT, &row.id);
    Ok(row)
}

#[tauri::command]
pub fn tasks_soft_delete_local<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DatabaseManager>,
    task_id: String,
) -> Result<(), String> {
    let task_id = task_id.trim().to_string();
    if task_id.is_empty() {
        return Err("task_id is required".into());
    }
    let user_id = state.sync_user_id()?;
    let device_id = ensure_device_id()?;
    state.with_conn_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("begin task delete tx: {e}"))?;
        let (version, base_version, configuration_json): (i64, Option<i64>, String) = tx
            .query_row(
                "SELECT version, base_version, configuration_json FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
                params![task_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| format!("Task '{task_id}' was not found or is already deleted."))?;

        let now = now_iso();
        let new_version = version + 1;
        tx.execute(
            "UPDATE tasks SET deleted_at = ?1, version = ?2, sync_state = 'pending',
             local_updated_at = ?1, updated_at = ?1 WHERE id = ?3",
            params![now, new_version, task_id],
        )
        .map_err(|e| format!("soft delete task: {e}"))?;

        enqueue_outbox(
            &tx,
            &user_id,
            &device_id,
            "tasks",
            &task_id,
            "delete",
            Some(&configuration_json),
            base_version.or(Some(version)),
        )?;

        tx.commit()
            .map_err(|e| format!("commit task delete tx: {e}"))?;
        Ok(())
    })?;
    let _ = app.emit(TASKS_CHANGED_EVENT, &task_id);
    Ok(())
}
