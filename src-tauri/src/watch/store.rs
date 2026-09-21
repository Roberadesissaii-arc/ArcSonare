//! Durable, account-scoped persistence for watched applications.
//!
//! Account scoping is structural rather than enforced by a `WHERE user_id = ?`
//! clause: `DatabaseManager` opens a different SQLite *file* per account, so a
//! query written here physically cannot read another account's watches. That is
//! the property the localStorage store could not have — browser storage is keyed
//! by origin, and every account shared one origin.

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use super::model::{
    AdapterHealth, PrivacyPolicy, RunningAppInstance, WatchSession, WatchState, WatchedApplication,
};

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

const WATCH_SELECT: &str = "SELECT id, app_catalog_id, display_name, state, preferred_instance_key,
    privacy_policy_json, enabled_context_providers_json, enabled_action_providers_json,
    adapter_id, adapter_health, adapter_message, created_at, updated_at, last_seen_at
    FROM watched_applications";

fn row_to_watched(row: &rusqlite::Row<'_>) -> rusqlite::Result<WatchedApplication> {
    let privacy_raw: String = row.get(5)?;
    let context_raw: String = row.get(6)?;
    let action_raw: String = row.get(7)?;
    let state_raw: String = row.get(3)?;
    let health_raw: String = row.get(9)?;
    Ok(WatchedApplication {
        id: row.get(0)?,
        app_catalog_id: row.get(1)?,
        display_name: row.get(2)?,
        state: WatchState::parse(&state_raw),
        preferred_instance_key: row.get(4)?,
        // A policy that fails to parse must not become the permissive default.
        // Falling back to `PrivacyPolicy::default()` on corrupt JSON would turn
        // a storage bug into consent the user never gave, so the closed
        // messaging defaults are used instead.
        privacy_policy: serde_json::from_str(&privacy_raw)
            .unwrap_or_else(|_| PrivacyPolicy::sensitive_default()),
        enabled_context_providers: serde_json::from_str(&context_raw).unwrap_or_default(),
        enabled_action_providers: serde_json::from_str(&action_raw).unwrap_or_default(),
        adapter_id: row.get(8)?,
        adapter_health: AdapterHealth::parse(&health_raw),
        adapter_message: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        last_seen_at: row.get(13)?,
        instances: Vec::new(),
    })
}

pub fn list_watched(conn: &Connection) -> Result<Vec<WatchedApplication>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{WATCH_SELECT} WHERE deleted_at IS NULL ORDER BY created_at ASC"
        ))
        .map_err(|e| format!("prepare watched list: {e}"))?;
    let rows = stmt
        .query_map([], row_to_watched)
        .map_err(|e| format!("query watched: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("map watched: {e}"))?;
    Ok(rows)
}

pub fn get_watched(
    conn: &Connection,
    app_catalog_id: &str,
) -> Result<Option<WatchedApplication>, String> {
    conn.query_row(
        &format!("{WATCH_SELECT} WHERE app_catalog_id = ?1 AND deleted_at IS NULL"),
        params![app_catalog_id],
        row_to_watched,
    )
    .optional()
    .map_err(|e| format!("get watched: {e}"))
}

/// Start watching, or revive a previously stopped watch.
///
/// Revival matters: stopping and restarting a watch must not discard the
/// privacy policy the user configured, and it must not discard the pinned
/// workspace. Both are kept on the soft-deleted row and restored here.
pub fn add_watched(
    conn: &Connection,
    app_catalog_id: &str,
    display_name: &str,
    adapter_id: Option<&str>,
) -> Result<WatchedApplication, String> {
    let now = now_iso();
    let existing: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT id, privacy_policy_json FROM watched_applications WHERE app_catalog_id = ?1",
            params![app_catalog_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("look up watched: {e}"))?;

    if let Some((id, _)) = existing {
        conn.execute(
            "UPDATE watched_applications
             SET state = 'watching', deleted_at = NULL, display_name = ?2,
                 adapter_id = ?3, updated_at = ?4, local_updated_at = ?4, sync_state = 'pending'
             WHERE id = ?1",
            params![id, display_name, adapter_id, now],
        )
        .map_err(|e| format!("revive watched: {e}"))?;
    } else {
        let policy = PrivacyPolicy::for_app(app_catalog_id);
        conn.execute(
            "INSERT INTO watched_applications (
                id, app_catalog_id, display_name, state, preferred_instance_key,
                privacy_policy_json, enabled_context_providers_json,
                enabled_action_providers_json, adapter_id, adapter_health, adapter_message,
                version, base_version, cloud_version, sync_state, last_synced_at,
                local_updated_at, sync_error, created_at, updated_at, last_seen_at, deleted_at
             ) VALUES (
                ?1, ?2, ?3, 'watching', NULL, ?4, '[]', '[]', ?5, 'unknown', NULL,
                1, NULL, NULL, 'pending', NULL, ?6, NULL, ?6, ?6, NULL, NULL
             )",
            params![
                Uuid::new_v4().to_string(),
                app_catalog_id,
                display_name,
                serde_json::to_string(&policy).unwrap_or_else(|_| "{}".into()),
                adapter_id,
                now,
            ],
        )
        .map_err(|e| format!("insert watched: {e}"))?;
    }

    get_watched(conn, app_catalog_id)?
        .ok_or_else(|| "the watch was written but could not be read back".to_string())
}

/// Stop watching. Soft delete so the policy and pin survive a re-watch.
pub fn remove_watched(conn: &Connection, app_catalog_id: &str) -> Result<bool, String> {
    let now = now_iso();
    let changed = conn
        .execute(
            "UPDATE watched_applications
             SET deleted_at = ?2, updated_at = ?2, local_updated_at = ?2, sync_state = 'pending'
             WHERE app_catalog_id = ?1 AND deleted_at IS NULL",
            params![app_catalog_id, now],
        )
        .map_err(|e| format!("remove watched: {e}"))?;
    if changed > 0 {
        // Conversation bindings must not outlive the watch, or a follow-up
        // ("pause it") would resolve against an application no longer watched.
        conn.execute(
            "DELETE FROM watch_sessions
             WHERE watched_application_id IN (
                SELECT id FROM watched_applications WHERE app_catalog_id = ?1
             )",
            params![app_catalog_id],
        )
        .map_err(|e| format!("clear sessions: {e}"))?;
    }
    Ok(changed > 0)
}

pub fn set_state(
    conn: &Connection,
    app_catalog_id: &str,
    state: WatchState,
) -> Result<bool, String> {
    let now = now_iso();
    let changed = conn
        .execute(
            "UPDATE watched_applications
             SET state = ?2, updated_at = ?3, local_updated_at = ?3, sync_state = 'pending'
             WHERE app_catalog_id = ?1 AND deleted_at IS NULL AND state != ?2",
            params![app_catalog_id, state.as_str(), now],
        )
        .map_err(|e| format!("set watch state: {e}"))?;
    Ok(changed > 0)
}

pub fn set_adapter_health(
    conn: &Connection,
    app_catalog_id: &str,
    health: AdapterHealth,
    message: Option<&str>,
) -> Result<(), String> {
    let now = now_iso();
    conn.execute(
        "UPDATE watched_applications
         SET adapter_health = ?2, adapter_message = ?3, updated_at = ?4, local_updated_at = ?4
         WHERE app_catalog_id = ?1 AND deleted_at IS NULL",
        params![app_catalog_id, health.as_str(), message, now],
    )
    .map_err(|e| format!("set adapter health: {e}"))?;
    Ok(())
}

pub fn set_preferred_instance(
    conn: &Connection,
    app_catalog_id: &str,
    instance_key: Option<&str>,
) -> Result<(), String> {
    let now = now_iso();
    conn.execute(
        "UPDATE watched_applications
         SET preferred_instance_key = ?2, updated_at = ?3, local_updated_at = ?3,
             sync_state = 'pending'
         WHERE app_catalog_id = ?1 AND deleted_at IS NULL",
        params![app_catalog_id, instance_key, now],
    )
    .map_err(|e| format!("pin instance: {e}"))?;
    Ok(())
}

pub fn set_privacy_policy(
    conn: &Connection,
    app_catalog_id: &str,
    policy: &PrivacyPolicy,
) -> Result<(), String> {
    let now = now_iso();
    conn.execute(
        "UPDATE watched_applications
         SET privacy_policy_json = ?2, updated_at = ?3, local_updated_at = ?3,
             sync_state = 'pending'
         WHERE app_catalog_id = ?1 AND deleted_at IS NULL",
        params![
            app_catalog_id,
            serde_json::to_string(policy).map_err(|e| format!("serialize policy: {e}"))?,
            now
        ],
    )
    .map_err(|e| format!("set privacy policy: {e}"))?;
    Ok(())
}

/// Record the instances seen for a watched application in this pass.
///
/// Instances that disappeared are marked `stopped` rather than deleted, so a
/// pinned workspace that is closed and reopened rebinds to the same row instead
/// of arriving as a stranger.
pub fn record_instances(
    conn: &Connection,
    watched_application_id: &str,
    app_catalog_id: &str,
    instances: &[RunningAppInstance],
) -> Result<(), String> {
    let now = now_iso();
    conn.execute(
        "UPDATE watched_app_instances SET state = 'stopped'
         WHERE watched_application_id = ?1",
        params![watched_application_id],
    )
    .map_err(|e| format!("mark instances stopped: {e}"))?;

    for instance in instances {
        let bounds = instance
            .window_bounds
            .as_ref()
            .and_then(|b| serde_json::to_string(b).ok());
        conn.execute(
            "INSERT INTO watched_app_instances (
                id, watched_application_id, instance_key, app_catalog_id, process_id,
                executable_path, executable_name, window_id, window_title, window_bounds_json,
                monitor_id, workspace_identity, parent_process_id, state, started_at,
                first_seen_at, last_seen_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
             ON CONFLICT(watched_application_id, instance_key) DO UPDATE SET
                process_id = excluded.process_id,
                executable_path = excluded.executable_path,
                executable_name = excluded.executable_name,
                window_id = excluded.window_id,
                window_title = excluded.window_title,
                window_bounds_json = excluded.window_bounds_json,
                monitor_id = excluded.monitor_id,
                workspace_identity = excluded.workspace_identity,
                parent_process_id = excluded.parent_process_id,
                state = excluded.state,
                last_seen_at = excluded.last_seen_at",
            params![
                Uuid::new_v4().to_string(),
                watched_application_id,
                instance.instance_key,
                app_catalog_id,
                instance.process_id,
                instance.executable_path,
                instance.executable_name,
                instance.window_id,
                instance.window_title,
                bounds,
                instance.monitor_id,
                instance.workspace_identity,
                instance.parent_process_id,
                match instance.state {
                    super::model::InstanceState::Minimized => "minimized",
                    super::model::InstanceState::Stopped => "stopped",
                    _ => "running",
                },
                instance.started_at,
                now,
            ],
        )
        .map_err(|e| format!("record instance: {e}"))?;
    }

    if !instances.is_empty() {
        conn.execute(
            "UPDATE watched_applications SET last_seen_at = ?2 WHERE id = ?1",
            params![watched_application_id, now],
        )
        .map_err(|e| format!("touch watched: {e}"))?;
    }
    Ok(())
}

/// Whether this application has ever been seen with this instance key.
///
/// Used to decide "rebound" versus "started": a workspace ArcSonare has seen
/// before and is now seeing again is a rebind, and the UI says so rather than
/// presenting it as a new thing the user never chose.
pub fn instance_known(
    conn: &Connection,
    watched_application_id: &str,
    instance_key: &str,
) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM watched_app_instances
             WHERE watched_application_id = ?1 AND instance_key = ?2",
            params![watched_application_id, instance_key],
            |row| row.get(0),
        )
        .map_err(|e| format!("check instance: {e}"))?;
    Ok(count > 0)
}

// ---------------------------------------------------------------------------
// Conversation sessions
// ---------------------------------------------------------------------------

pub fn bind_session(
    conn: &Connection,
    conversation_id: &str,
    watched_application_id: &str,
    instance_key: Option<&str>,
) -> Result<WatchSession, String> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO watch_sessions (
            id, conversation_id, watched_application_id, bound_instance_key, mode, status,
            created_at, last_snapshot_at, last_event_at
         ) VALUES (?1, ?2, ?3, ?4, 'on-demand', 'active', ?5, NULL, ?5)
         ON CONFLICT(conversation_id, watched_application_id) DO UPDATE SET
            bound_instance_key = excluded.bound_instance_key,
            status = 'active',
            last_event_at = excluded.last_event_at",
        params![
            Uuid::new_v4().to_string(),
            conversation_id,
            watched_application_id,
            instance_key,
            now
        ],
    )
    .map_err(|e| format!("bind session: {e}"))?;

    conn.query_row(
        "SELECT id, conversation_id, watched_application_id, bound_instance_key, mode, status,
                created_at, last_snapshot_at, last_event_at
         FROM watch_sessions WHERE conversation_id = ?1 AND watched_application_id = ?2",
        params![conversation_id, watched_application_id],
        |row| {
            Ok(WatchSession {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                watched_application_id: row.get(2)?,
                bound_instance_key: row.get(3)?,
                mode: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
                last_snapshot_at: row.get(7)?,
                last_event_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| format!("read session: {e}"))
}

/// The application this conversation most recently acted on.
///
/// This is what makes "pause it" work three turns after "what's playing?" —
/// without it every follow-up re-runs relevance scoring and can land elsewhere.
pub fn active_session_app(
    conn: &Connection,
    conversation_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT w.app_catalog_id
         FROM watch_sessions s
         JOIN watched_applications w ON w.id = s.watched_application_id
         WHERE s.conversation_id = ?1 AND s.status = 'active' AND w.deleted_at IS NULL
         ORDER BY s.last_event_at DESC LIMIT 1",
        params![conversation_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("read active session: {e}"))
}

pub fn clear_conversation_sessions(
    conn: &Connection,
    conversation_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM watch_sessions WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| format!("clear sessions: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use crate::watch::model::InstanceState;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrate");
        conn
    }

    fn instance(key: &str, workspace: Option<&str>) -> RunningAppInstance {
        RunningAppInstance {
            id: format!("inst-{key}"),
            instance_key: key.into(),
            app_catalog_id: "vscode".into(),
            process_id: 4242,
            executable_path: Some(r"C:\Code\Code.exe".into()),
            executable_name: "Code.exe".into(),
            window_id: Some("w1a2b".into()),
            window_title: Some("main.rs — proj — Visual Studio Code".into()),
            window_bounds: None,
            monitor_id: None,
            workspace_identity: workspace.map(str::to_string),
            parent_process_id: None,
            state: InstanceState::Running,
            started_at: None,
            last_seen_at: now_iso(),
        }
    }

    /// The headline requirement: closing an application must not un-watch it.
    #[test]
    fn a_closed_application_stays_watched_in_an_offline_state() {
        let conn = db();
        add_watched(&conn, "spotify", "Spotify", Some("spotify-desktop")).expect("watch");

        set_state(&conn, "spotify", WatchState::AppClosed).expect("close");

        let watched = get_watched(&conn, "spotify").expect("read").expect("present");
        assert_eq!(watched.state, WatchState::AppClosed);
        assert_eq!(
            list_watched(&conn).expect("list").len(),
            1,
            "the entry must remain in the list, not disappear"
        );
    }

    /// Re-watching must not silently reopen permissions the user closed.
    #[test]
    fn a_privacy_policy_survives_stop_and_restart() {
        let conn = db();
        add_watched(&conn, "discord", "Discord", Some("discord-desktop")).expect("watch");
        let mut policy = PrivacyPolicy::for_app("discord");
        policy.message_content = true;
        set_privacy_policy(&conn, "discord", &policy).expect("set policy");

        remove_watched(&conn, "discord").expect("stop");
        let revived = add_watched(&conn, "discord", "Discord", Some("discord-desktop"))
            .expect("re-watch");

        assert!(
            revived.privacy_policy.message_content,
            "the consent the user gave must be remembered, not reset"
        );
        assert_eq!(revived.state, WatchState::Watching);
    }

    #[test]
    fn a_pinned_instance_survives_the_application_closing() {
        let conn = db();
        let watched = add_watched(&conn, "vscode", "VS Code", Some("vscode-bridge")).expect("watch");
        set_preferred_instance(&conn, "vscode", Some("vscode:ws:arcsonare")).expect("pin");
        record_instances(
            &conn,
            &watched.id,
            "vscode",
            &[instance("vscode:ws:arcsonare", Some("ArcSonare"))],
        )
        .expect("record");

        // The app closes: no instances this pass.
        record_instances(&conn, &watched.id, "vscode", &[]).expect("record empty");
        set_state(&conn, "vscode", WatchState::AppClosed).expect("close");

        let after = get_watched(&conn, "vscode").expect("read").expect("present");
        assert_eq!(
            after.preferred_instance_key.as_deref(),
            Some("vscode:ws:arcsonare")
        );
        assert!(
            instance_known(&conn, &watched.id, "vscode:ws:arcsonare").expect("known"),
            "the instance must still be recognised when it comes back"
        );
    }

    #[test]
    fn two_workspaces_are_stored_as_two_instances() {
        let conn = db();
        let watched = add_watched(&conn, "vscode", "VS Code", Some("vscode-bridge")).expect("watch");
        record_instances(
            &conn,
            &watched.id,
            "vscode",
            &[
                instance("vscode:ws:a", Some("a")),
                instance("vscode:ws:b", Some("b")),
            ],
        )
        .expect("record");

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM watched_app_instances WHERE watched_application_id = ?1",
                params![watched.id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 2);
    }

    #[test]
    fn stopping_a_watch_releases_its_conversation_bindings() {
        let conn = db();
        let watched = add_watched(&conn, "spotify", "Spotify", None).expect("watch");
        bind_session(&conn, "conv-1", &watched.id, None).expect("bind");
        assert_eq!(
            active_session_app(&conn, "conv-1").expect("read").as_deref(),
            Some("spotify")
        );

        remove_watched(&conn, "spotify").expect("stop");

        assert_eq!(
            active_session_app(&conn, "conv-1").expect("read"),
            None,
            "an unwatched application must stop being a conversation's active context"
        );
    }

    /// Corrupt stored consent must fail closed, never open.
    #[test]
    fn an_unreadable_privacy_policy_falls_back_to_the_closed_defaults() {
        let conn = db();
        add_watched(&conn, "discord", "Discord", None).expect("watch");
        conn.execute(
            "UPDATE watched_applications SET privacy_policy_json = 'not json'
             WHERE app_catalog_id = 'discord'",
            [],
        )
        .expect("corrupt");

        let watched = get_watched(&conn, "discord").expect("read").expect("present");
        assert!(!watched.privacy_policy.window_title);
        assert!(!watched.privacy_policy.message_content);
    }
}
