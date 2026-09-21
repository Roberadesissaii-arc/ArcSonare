//! The active watch scope: which watched applications a conversation is talking
//! about right now.
//!
//! Three states exist and must not be conflated. The reported failures are all
//! symptoms of collapsing them:
//!
//!   1. **Running** — a detected process. Detection authorises nothing. Chrome
//!      being open is not permission to read Chrome's window title.
//!   2. **Watched** — the user added it to Watch. Persists across the
//!      application closing.
//!   3. **Active** — attached to *this* conversation. Only this drives ordinary
//!      Watch-mode requests.
//!
//! Before this module there was no third state, so "what can you do?" had
//! nothing conversation-shaped to answer from: relevance ranking scored the
//! question against each watched application's vocabulary, scored zero, and
//! dropped every one of them. The prompt then said "no watched applications are
//! relevant" while Discord was watched, and the model fell back to describing
//! ArcSonare itself.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::model::WatchedApplication;
use super::store::{self, now_iso};

/// How many applications this conversation is scoped to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScopeMode {
    Single,
    Multiple,
}

impl ScopeMode {
    fn for_count(count: usize) -> Self {
        if count > 1 {
            Self::Multiple
        } else {
            Self::Single
        }
    }
}

/// One application attached to a conversation, with the instance it is bound to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWatchEntry {
    pub app_catalog_id: String,
    pub display_name: String,
    /// The instance this conversation acts on, when one is unambiguous.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bound_instance_key: Option<String>,
    /// Whether the application is running right now.
    pub running: bool,
    /// When this application joined the conversation, most recent first.
    ///
    /// Ordering is a property of the scope, not of whichever surface happens to
    /// be drawing it. The card, the composer, the dropdown, the manager and the
    /// prompt all read this one number — computing "most recently activated"
    /// separately in React is how two surfaces start disagreeing about which
    /// application the conversation is about.
    ///
    /// 0 is the most recent. Monotonic within a conversation.
    pub activated_sequence: u64,
}

/// What a conversation is scoped to.
///
/// `account_id` is carried for the frontend's benefit only. Isolation is
/// structural — the row lives in the account's own database file — so this is a
/// label, never the thing that enforces separation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWatchScope {
    pub account_id: String,
    pub conversation_id: String,
    pub entries: Vec<ActiveWatchEntry>,
    pub mode: ScopeMode,
    pub updated_at: String,
}

impl ActiveWatchScope {
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Read the conversation's scope, validated against the watch store.
///
/// Validation is not decoration. The frontend sends application ids with each
/// message, and an id that is not *actually* watched — stale UI, a replayed
/// envelope, a tampered payload — must not become context. Anything that no
/// longer resolves to a live watch row is dropped here, silently and by
/// construction, because there is no code path that reads an id without
/// resolving it first.
pub fn active_scope(
    conn: &Connection,
    account_id: &str,
    conversation_id: &str,
    running_ids: &[String],
) -> Result<ActiveWatchScope, String> {
    let mut stmt = conn
        .prepare(
            "SELECT w.app_catalog_id, w.display_name, s.bound_instance_key, s.created_at
             FROM watch_sessions s
             JOIN watched_applications w ON w.id = s.watched_application_id
             WHERE s.conversation_id = ?1
               AND s.status = 'active'
               AND w.deleted_at IS NULL
             -- Most recently activated first. `rowid` breaks the tie rather
             -- than `id`, which is a UUID and sorts arbitrarily: two rows
             -- written inside the same millisecond have identical timestamps,
             -- and two fast clicks would otherwise order at random.
             ORDER BY s.created_at DESC, s.rowid DESC",
        )
        .map_err(|e| format!("prepare active scope: {e}"))?;

    let rows = stmt
        .query_map(params![conversation_id], |row| {
            let app_catalog_id: String = row.get(0)?;
            Ok(ActiveWatchEntry {
                running: running_ids.iter().any(|id| id == &app_catalog_id),
                app_catalog_id,
                display_name: row.get(1)?,
                bound_instance_key: row.get(2)?,
                // Filled from the row's position below, once the rejected and
                // retired entries have been dropped, so the sequence has no
                // gaps a caller would have to reason about.
                activated_sequence: 0,
            })
        })
        .map_err(|e| format!("query active scope: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("map active scope: {e}"))?;

    // An application that has closed stops being what this conversation is
    // about. Its watch permission is untouched — that lives in
    // `watched_applications` and is a standing decision — but the session is
    // retired, so the manager shows it under "Watched, not running" rather than
    // as the active subject, and no later turn resolves to a process that is
    // gone. Reopening it does not silently re-activate: that is the user's call.
    let closed: Vec<String> = rows
        .iter()
        .filter(|entry| !entry.running)
        .map(|entry| entry.app_catalog_id.clone())
        .collect();
    for app_catalog_id in &closed {
        conn.execute(
            "DELETE FROM watch_sessions
             WHERE conversation_id = ?1
               AND watched_application_id IN (
                   SELECT id FROM watched_applications WHERE app_catalog_id = ?2
               )",
            params![conversation_id, app_catalog_id],
        )
        .map_err(|e| format!("retire closed application: {e}"))?;
    }
    let mut rows: Vec<ActiveWatchEntry> = rows.into_iter().filter(|e| e.running).collect();
    // Newest first, numbered from zero. The query already orders by creation
    // time descending; this turns that order into a value the frontend can sort
    // by without knowing how it was derived.
    for (index, entry) in rows.iter_mut().enumerate() {
        entry.activated_sequence = index as u64;
    }

    let updated_at: Option<String> = conn
        .query_row(
            "SELECT max(coalesce(last_event_at, created_at)) FROM watch_sessions
             WHERE conversation_id = ?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("read scope timestamp: {e}"))?
        .flatten();

    Ok(ActiveWatchScope {
        account_id: account_id.to_string(),
        conversation_id: conversation_id.to_string(),
        mode: ScopeMode::for_count(rows.len()),
        entries: rows,
        updated_at: updated_at.unwrap_or_else(now_iso),
    })
}

/// Replace a conversation's scope with exactly these applications.
///
/// Ids that are not watched are refused rather than skipped: a caller asking to
/// activate something unwatched has a bug, and silently dropping it would make
/// the UI show a scope the store does not agree with.
pub fn set_active_scope(
    conn: &Connection,
    conversation_id: &str,
    app_catalog_ids: &[String],
) -> Result<(), String> {
    let now = now_iso();
    let mut resolved: Vec<(String, String)> = Vec::new();
    for app_catalog_id in app_catalog_ids {
        let watched = store::get_watched(conn, app_catalog_id)?.ok_or_else(|| {
            format!("{app_catalog_id} is not being watched, so it cannot be activated.")
        })?;
        resolved.push((watched.id, app_catalog_id.clone()));
    }

    conn.execute(
        "DELETE FROM watch_sessions WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| format!("clear scope: {e}"))?;

    for (watched_id, _) in &resolved {
        conn.execute(
            "INSERT INTO watch_sessions (
                id, conversation_id, watched_application_id, bound_instance_key, mode, status,
                created_at, last_snapshot_at, last_event_at
             ) VALUES (?1, ?2, ?3, NULL, ?4, 'active', ?5, NULL, ?5)",
            params![
                Uuid::new_v4().to_string(),
                conversation_id,
                watched_id,
                if resolved.len() > 1 { "multiple" } else { "single" },
                now,
            ],
        )
        .map_err(|e| format!("activate application: {e}"))?;
    }
    Ok(())
}

/// Add or remove one application from the conversation's scope.
pub fn toggle_active(
    conn: &Connection,
    conversation_id: &str,
    app_catalog_id: &str,
) -> Result<bool, String> {
    let watched = store::get_watched(conn, app_catalog_id)?.ok_or_else(|| {
        format!("{app_catalog_id} is not being watched, so it cannot be activated.")
    })?;

    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM watch_sessions
             WHERE conversation_id = ?1 AND watched_application_id = ?2",
            params![conversation_id, watched.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("look up session: {e}"))?;

    if let Some(id) = existing {
        conn.execute("DELETE FROM watch_sessions WHERE id = ?1", params![id])
            .map_err(|e| format!("deactivate: {e}"))?;
        return Ok(false);
    }

    let now = now_iso();
    conn.execute(
        "INSERT INTO watch_sessions (
            id, conversation_id, watched_application_id, bound_instance_key, mode, status,
            created_at, last_snapshot_at, last_event_at
         ) VALUES (?1, ?2, ?3, NULL, 'multiple', 'active', ?4, NULL, ?4)",
        params![
            Uuid::new_v4().to_string(),
            conversation_id,
            watched.id,
            now
        ],
    )
    .map_err(|e| format!("activate: {e}"))?;
    Ok(true)
}

/// Bind the conversation's entry for one application to a specific instance.
pub fn bind_instance(
    conn: &Connection,
    conversation_id: &str,
    app_catalog_id: &str,
    instance_key: Option<&str>,
) -> Result<(), String> {
    let watched = store::get_watched(conn, app_catalog_id)?
        .ok_or_else(|| format!("{app_catalog_id} is not being watched."))?;
    conn.execute(
        "UPDATE watch_sessions
         SET bound_instance_key = ?3, last_event_at = ?4
         WHERE conversation_id = ?1 AND watched_application_id = ?2",
        params![conversation_id, watched.id, instance_key, now_iso()],
    )
    .map_err(|e| format!("bind instance: {e}"))?;
    Ok(())
}

/// Validate ids the frontend claims are active for this conversation.
///
/// The envelope contract: a message carries application ids, and the backend
/// reloads them from the store rather than trusting them. Returns only the ids
/// that are genuinely watched *and* genuinely active in this conversation, plus
/// the ones that were rejected, so a caller can report a stale UI honestly
/// instead of silently answering about something else.
pub fn validate_claimed_scope(
    conn: &Connection,
    conversation_id: &str,
    claimed: &[String],
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();
    for app_catalog_id in claimed {
        let is_watched = store::get_watched(conn, app_catalog_id)?.is_some();
        if !is_watched {
            rejected.push(app_catalog_id.clone());
            continue;
        }
        let active: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM watch_sessions s
                 JOIN watched_applications w ON w.id = s.watched_application_id
                 WHERE s.conversation_id = ?1 AND w.app_catalog_id = ?2
                   AND s.status = 'active' AND w.deleted_at IS NULL",
                params![conversation_id, app_catalog_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("validate scope: {e}"))?;
        if active.is_some() {
            accepted.push(app_catalog_id.clone());
        } else {
            rejected.push(app_catalog_id.clone());
        }
    }
    Ok((accepted, rejected))
}

/// Applications whose watch was stopped, removed from every conversation.
///
/// Called after `remove_watched`. Without it a conversation would keep pointing
/// at an application the user just stopped watching, and the next Watch-mode
/// message would still carry it.
pub fn prune_unwatched(conn: &Connection) -> Result<usize, String> {
    let removed = conn
        .execute(
            "DELETE FROM watch_sessions WHERE watched_application_id NOT IN (
                SELECT id FROM watched_applications WHERE deleted_at IS NULL
             )",
            [],
        )
        .map_err(|e| format!("prune scope: {e}"))?;
    Ok(removed)
}

/// Every conversation starts a session with nothing active.
///
/// Watching is a standing permission and persists; being the subject of a
/// conversation is not. Without this, ArcSonare came back up with whatever had
/// been active when it was last closed — the composer already showing a Watch
/// pill, and the next unrelated question carrying an application the user had
/// not chosen in this session. Making it explicit every time is the whole point
/// of an active set.
///
/// The watch rows are untouched: only the per-conversation sessions go.
pub fn clear_all_active_scopes(conn: &Connection) -> Result<usize, String> {
    conn.execute("DELETE FROM watch_sessions", [])
        .map_err(|e| format!("clear active scopes at startup: {e}"))
}

/// Which watched applications a conversation should fall back to.
///
/// Used when the user has watched applications but has not explicitly activated
/// any for this conversation. Activating the single watched application is the
/// behaviour a person expects — they watched one thing, they are asking about
/// it — while two or more require a choice, because guessing between them is
/// how a command lands in the wrong application.
pub fn implicit_scope(watched: &[WatchedApplication]) -> Vec<String> {
    let live: Vec<&WatchedApplication> = watched
        .iter()
        .filter(|w| w.state.is_live() && !w.instances.is_empty())
        .collect();
    if live.len() == 1 {
        return vec![live[0].app_catalog_id.clone()];
    }
    // Exactly one watched application overall, even if closed: it is
    // unambiguous what the user means, and "it is not running" is a better
    // answer than "which application?".
    if watched.len() == 1 {
        return vec![watched[0].app_catalog_id.clone()];
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use crate::watch::model::{AdapterHealth, PrivacyPolicy, WatchState};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrate");
        conn
    }

    fn watch(conn: &Connection, id: &str) {
        store::add_watched(conn, id, id, None).expect("watch");
    }

    fn watched_app(app: &str, state: WatchState, instances: usize) -> WatchedApplication {
        WatchedApplication {
            id: format!("wa-{app}"),
            app_catalog_id: app.into(),
            display_name: app.into(),
            state,
            preferred_instance_key: None,
            privacy_policy: PrivacyPolicy::for_app(app),
            enabled_context_providers: Vec::new(),
            enabled_action_providers: Vec::new(),
            adapter_id: None,
            adapter_health: AdapterHealth::Unknown,
            adapter_message: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            last_seen_at: None,
            instances: (0..instances)
                .map(|i| crate::watch::model::RunningAppInstance {
                    id: format!("inst-{app}-{i}"),
                    instance_key: format!("{app}:exe:x:{i}"),
                    app_catalog_id: app.into(),
                    process_id: 1,
                    executable_path: None,
                    executable_name: format!("{app}.exe"),
                    window_id: None,
                    window_title: None,
                    window_bounds: None,
                    monitor_id: None,
                    workspace_identity: None,
                    parent_process_id: None,
                    state: crate::watch::model::InstanceState::Running,
                    started_at: None,
                    last_seen_at: "2026-01-01T00:00:00Z".into(),
                })
                .collect(),
        }
    }

    /// The headline: activating Discord scopes the conversation to Discord, and
    /// a running-but-unwatched Chrome is nowhere in the result.
    #[test]
    fn an_active_scope_contains_only_what_was_activated() {
        let conn = db();
        watch(&conn, "discord");
        set_active_scope(&conn, "conv-1", &["discord".to_string()]).expect("activate");

        let running = vec!["discord".to_string(), "chrome".to_string()];
        let scope = active_scope(&conn, "acct", "conv-1", &running).expect("read");

        assert_eq!(scope.entries.len(), 1);
        assert_eq!(scope.entries[0].app_catalog_id, "discord");
        assert!(scope.entries[0].running);
        assert_eq!(scope.mode, ScopeMode::Single);
        assert!(
            !scope.entries.iter().any(|e| e.app_catalog_id == "chrome"),
            "a running-but-unwatched application must never enter the scope"
        );
    }

    /// Activating something that is not watched is a bug in the caller, and
    /// must surface as one rather than producing a half-populated scope.
    #[test]
    fn an_unwatched_application_cannot_be_activated() {
        let conn = db();
        watch(&conn, "discord");
        let err = set_active_scope(&conn, "conv-1", &["chrome".to_string()])
            .expect_err("must refuse");
        assert!(err.contains("not being watched"), "got: {err}");
    }

    /// The envelope contract. Ids arrive from the frontend and are reloaded
    /// here; anything that does not resolve is rejected, not trusted.
    #[test]
    fn claimed_ids_are_validated_against_the_store() {
        let conn = db();
        watch(&conn, "discord");
        set_active_scope(&conn, "conv-1", &["discord".to_string()]).expect("activate");

        let (accepted, rejected) = validate_claimed_scope(
            &conn,
            "conv-1",
            &[
                "discord".to_string(),
                // Watched by nobody — a stale or tampered id.
                "chrome".to_string(),
                // Real application, but never activated in this conversation.
                "spotify".to_string(),
            ],
        )
        .expect("validate");

        assert_eq!(accepted, vec!["discord".to_string()]);
        assert_eq!(rejected.len(), 2);
    }

    #[test]
    fn stopping_a_watch_removes_it_from_every_conversation() {
        let conn = db();
        watch(&conn, "discord");
        watch(&conn, "spotify");
        set_active_scope(
            &conn,
            "conv-1",
            &["discord".to_string(), "spotify".to_string()],
        )
        .expect("activate");

        store::remove_watched(&conn, "discord").expect("stop watching");
        prune_unwatched(&conn).expect("prune");

        let running = ["discord".to_string(), "spotify".to_string()];
        let scope = active_scope(&conn, "acct", "conv-1", &running).expect("read");
        assert_eq!(scope.entries.len(), 1);
        assert_eq!(scope.entries[0].app_catalog_id, "spotify");
    }

    #[test]
    fn toggling_adds_then_removes() {
        let conn = db();
        watch(&conn, "spotify");
        let running = ["spotify".to_string()];
        assert!(toggle_active(&conn, "conv-1", "spotify").expect("on"));
        assert_eq!(
            active_scope(&conn, "a", "conv-1", &running).expect("read").entries.len(),
            1
        );
        assert!(!toggle_active(&conn, "conv-1", "spotify").expect("off"));
        assert!(active_scope(&conn, "a", "conv-1", &running).expect("read").is_empty());
    }

    /// Two activated applications must report `multiple`, so the caller knows
    /// to group its answer rather than merge it.
    #[test]
    fn two_activated_applications_report_multiple_mode() {
        let conn = db();
        watch(&conn, "spotify");
        watch(&conn, "discord");
        set_active_scope(
            &conn,
            "conv-1",
            &["spotify".to_string(), "discord".to_string()],
        )
        .expect("activate");
        let running = ["spotify".to_string(), "discord".to_string()];
        let scope = active_scope(&conn, "a", "conv-1", &running).expect("read");
        assert_eq!(scope.mode, ScopeMode::Multiple);
        assert_eq!(scope.entries.len(), 2);
    }

    /// An application that closes stops being the conversation's subject.
    ///
    /// It keeps its watch permission — that is a standing decision the user
    /// made — but the session is retired, so nothing later resolves to a
    /// process that is gone and the manager lists it under "Watched, not
    /// running" rather than as active.
    #[test]
    fn a_closed_application_is_retired_from_the_conversation() {
        let conn = db();
        watch(&conn, "spotify");
        watch(&conn, "discord");
        set_active_scope(
            &conn,
            "conv-1",
            &["spotify".to_string(), "discord".to_string()],
        )
        .expect("activate");

        // Spotify quits: it is no longer in the running set.
        let running = ["discord".to_string()];
        let scope = active_scope(&conn, "a", "conv-1", &running).expect("read");
        assert_eq!(scope.entries.len(), 1);
        assert_eq!(scope.entries[0].app_catalog_id, "discord");

        // The watch permission survives.
        assert!(store::get_watched(&conn, "spotify")
            .expect("read watch")
            .is_some());

        // And it does not silently come back when Spotify reopens: activation
        // is the user's choice, made once, not restored behind their back.
        let both = ["discord".to_string(), "spotify".to_string()];
        let after = active_scope(&conn, "a", "conv-1", &both).expect("read");
        assert_eq!(after.entries.len(), 1);
        assert_eq!(after.entries[0].app_catalog_id, "discord");
    }

    /// Watch is off when ArcSonare starts.
    ///
    /// Permissions survive; being the subject of a conversation does not. The
    /// composer used to come back up already showing a Watch pill for whatever
    /// had been active when the app was last closed.
    #[test]
    fn startup_clears_every_active_scope_but_keeps_the_watches() {
        let conn = db();
        watch(&conn, "spotify");
        watch(&conn, "discord");
        set_active_scope(&conn, "conv-1", &["spotify".to_string()]).expect("a");
        set_active_scope(&conn, "conv-2", &["discord".to_string()]).expect("b");

        let cleared = clear_all_active_scopes(&conn).expect("clear");
        assert_eq!(cleared, 2);

        let running = ["spotify".to_string(), "discord".to_string()];
        assert!(active_scope(&conn, "a", "conv-1", &running)
            .expect("read")
            .is_empty());
        assert!(active_scope(&conn, "a", "conv-2", &running)
            .expect("read")
            .is_empty());

        // Both are still watched, so the manager still lists them.
        assert!(store::get_watched(&conn, "spotify").expect("read").is_some());
        assert!(store::get_watched(&conn, "discord").expect("read").is_some());
    }

    /// Conversations do not share a scope.
    #[test]
    fn scopes_are_per_conversation() {
        let conn = db();
        watch(&conn, "spotify");
        watch(&conn, "discord");
        set_active_scope(&conn, "conv-1", &["spotify".to_string()]).expect("a");
        set_active_scope(&conn, "conv-2", &["discord".to_string()]).expect("b");

        let running = ["spotify".to_string(), "discord".to_string()];
        assert_eq!(
            active_scope(&conn, "a", "conv-1", &running).expect("read").entries[0].app_catalog_id,
            "spotify"
        );
        assert_eq!(
            active_scope(&conn, "a", "conv-2", &running).expect("read").entries[0].app_catalog_id,
            "discord"
        );
    }

    /// One watched application is unambiguous — the user watched one thing and
    /// is asking about it. Two are not, and must not be guessed between.
    #[test]
    fn a_single_watched_application_is_implicitly_active() {
        let only = vec![watched_app("discord", WatchState::Watching, 1)];
        assert_eq!(implicit_scope(&only), vec!["discord".to_string()]);

        let two = vec![
            watched_app("discord", WatchState::Watching, 1),
            watched_app("spotify", WatchState::Watching, 1),
        ];
        assert!(
            implicit_scope(&two).is_empty(),
            "two live watched applications must require an explicit choice"
        );
    }

    /// A single watched application that is closed is still what the user means.
    /// "It is not running" is a better answer than "which application?".
    #[test]
    fn a_single_closed_watched_application_is_still_implicitly_active() {
        let closed = vec![watched_app("youtube", WatchState::AppClosed, 0)];
        assert_eq!(implicit_scope(&closed), vec!["youtube".to_string()]);
    }
}
