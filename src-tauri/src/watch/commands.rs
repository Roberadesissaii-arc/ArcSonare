//! Tauri commands and cross-WebView events for the watch system.
//!
//! Every window — main, voice overlay, quick menu — reads through here. That is
//! the whole point: the previous store lived in each webview's own
//! `localStorage`, and `sonare-overlay` is a separate WebView2 heap, so the
//! voice agent and the Dashboard held two different sets of watched
//! applications and neither could see the other change.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::database::DatabaseManager;

use super::catalog::catalog_entry;
use super::instances::{discover_instances, display_name_for, instances_for};
use super::model::{
    AdapterHealth, InstanceResolution, PrivacyPolicy, RunningAppInstance, WatchState,
    WatchedApplication,
};
use super::resolve::{rank_relevant, resolve_instance};
use super::store;

/// One event name, carrying a typed payload, rather than nine event names.
///
/// Nine separate Tauri events would mean nine `listen` calls per window and
/// nine chances for one window to have subscribed to eight of them. The kinds
/// below are the required event set; they travel as data.
pub const WATCH_CHANGED_EVENT: &str = "arcsonare://watch-changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    /// watched-app-added | watched-app-removed | watched-app-updated |
    /// app-instance-started | app-instance-stopped | app-instance-rebound |
    /// app-context-updated | app-adapter-error | active-watched-app-changed
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_catalog_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub at: String,
}

impl WatchEvent {
    fn new(kind: &'static str) -> Self {
        Self {
            kind,
            app_catalog_id: None,
            instance_key: None,
            conversation_id: None,
            message: None,
            at: store::now_iso(),
        }
    }

    fn app(kind: &'static str, app_catalog_id: &str) -> Self {
        Self {
            app_catalog_id: Some(app_catalog_id.to_string()),
            ..Self::new(kind)
        }
    }
}

fn emit<R: Runtime>(app: &AppHandle<R>, event: WatchEvent) {
    if let Err(e) = app.emit(WATCH_CHANGED_EVENT, event) {
        log::error!("failed to broadcast a watch change: {e}");
    }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSnapshot {
    /// Watched applications, each carrying its live instances.
    pub watched: Vec<WatchedApplication>,
    /// Everything running that ArcSonare recognises, watched or not. This is
    /// what the Running Apps list shows — the complete set, never a slice.
    pub running: Vec<RunningAppInstance>,
    pub captured_at: String,
}

/// Refresh instance state and reconcile watch states with reality.
///
/// Reconciliation is where "closing an app does not delete the watch" actually
/// happens: an application with no live instances moves to `app-closed` and
/// stays in the table, and when it comes back it moves to `watching` again.
fn refresh<R: Runtime>(
    app: &AppHandle<R>,
    state: &DatabaseManager,
    emit_events: bool,
) -> Result<WatchSnapshot, String> {
    let running = discover_instances()?;
    let mut events: Vec<WatchEvent> = Vec::new();

    let watched = state.with_conn_mut(|conn| {
        let mut watched = store::list_watched(conn)?;
        for entry in &mut watched {
            let live = instances_for(&entry.app_catalog_id, &running);

            for instance in &live {
                let known = store::instance_known(conn, &entry.id, &instance.instance_key)?;
                if !known {
                    let mut event =
                        WatchEvent::app("app-instance-started", &entry.app_catalog_id);
                    event.instance_key = Some(instance.instance_key.clone());
                    events.push(event);
                } else if !entry.state.is_live() {
                    // Seen before, and the watch was offline: this is the
                    // reopen case, which the UI reports as a rebind rather than
                    // as a new instance the user never chose.
                    let mut event =
                        WatchEvent::app("app-instance-rebound", &entry.app_catalog_id);
                    event.instance_key = Some(instance.instance_key.clone());
                    events.push(event);
                }
            }

            store::record_instances(conn, &entry.id, &entry.app_catalog_id, &live)?;

            // Paused is a user decision and must survive the app restarting.
            if entry.state != WatchState::Paused {
                let next = if live.is_empty() {
                    WatchState::AppClosed
                } else {
                    WatchState::Watching
                };
                if entry.state != next {
                    if next == WatchState::AppClosed {
                        events.push(WatchEvent::app(
                            "app-instance-stopped",
                            &entry.app_catalog_id,
                        ));
                    }
                    store::set_state(conn, &entry.app_catalog_id, next)?;
                    entry.state = next;
                    events.push(WatchEvent::app("watched-app-updated", &entry.app_catalog_id));
                }
            }

            entry.instances = live;
        }
        Ok(watched)
    })?;

    if emit_events {
        for event in events {
            emit(app, event);
        }
    }

    Ok(WatchSnapshot {
        watched,
        running,
        captured_at: store::now_iso(),
    })
}

#[tauri::command]
pub fn watch_snapshot(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
) -> Result<WatchSnapshot, String> {
    refresh(&app, &state, true)
}

/// Running applications only — no database access.
///
/// Exists so the Running Apps list still renders before sign-in, when no user
/// database is open. Showing nothing there would be a lie about the machine.
#[tauri::command]
pub fn watch_running_instances() -> Result<Vec<RunningAppInstance>, String> {
    discover_instances()
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn watch_add(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    app_catalog_id: String,
) -> Result<WatchedApplication, String> {
    let app_catalog_id = app_catalog_id.trim().to_string();
    if app_catalog_id.is_empty() {
        return Err("app_catalog_id is required".into());
    }
    let display_name = display_name_for(&app_catalog_id);
    let adapter_id = catalog_entry(&app_catalog_id).and_then(|e| e.adapter_id);

    let watched = state.with_conn_mut(|conn| {
        store::add_watched(conn, &app_catalog_id, &display_name, adapter_id)
    })?;

    emit(&app, WatchEvent::app("watched-app-added", &app_catalog_id));
    // Reconcile immediately so the caller's first snapshot already has real
    // instances rather than an empty list that fills in a poll later.
    let _ = refresh(&app, &state, false);
    Ok(watched)
}

#[tauri::command]
pub fn watch_remove(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    app_catalog_id: String,
) -> Result<bool, String> {
    let removed = state.with_conn_mut(|conn| {
        let removed = store::remove_watched(conn, app_catalog_id.trim())?;
        // A conversation must not keep pointing at an application the user just
        // stopped watching — the next Watch-mode message would still carry it.
        super::scope::prune_unwatched(conn)?;
        Ok(removed)
    })?;
    if removed {
        emit(&app, WatchEvent::app("watched-app-removed", &app_catalog_id));
        emit(&app, WatchEvent::new("active-watched-app-changed"));
    }
    Ok(removed)
}

#[tauri::command]
pub fn watch_set_paused(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    app_catalog_id: String,
    paused: bool,
) -> Result<bool, String> {
    let next = if paused {
        WatchState::Paused
    } else {
        WatchState::Watching
    };
    let changed = state.with_conn_mut(|conn| store::set_state(conn, app_catalog_id.trim(), next))?;
    if changed {
        emit(&app, WatchEvent::app("watched-app-updated", &app_catalog_id));
        let _ = refresh(&app, &state, false);
    }
    Ok(changed)
}

#[tauri::command]
pub fn watch_pin_instance(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    app_catalog_id: String,
    instance_key: Option<String>,
) -> Result<(), String> {
    state.with_conn_mut(|conn| {
        store::set_preferred_instance(conn, app_catalog_id.trim(), instance_key.as_deref())
    })?;
    emit(&app, WatchEvent::app("watched-app-updated", &app_catalog_id));
    Ok(())
}

#[tauri::command]
pub fn watch_set_privacy(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    app_catalog_id: String,
    policy: PrivacyPolicy,
) -> Result<(), String> {
    state
        .with_conn_mut(|conn| store::set_privacy_policy(conn, app_catalog_id.trim(), &policy))?;
    emit(&app, WatchEvent::app("watched-app-updated", &app_catalog_id));
    Ok(())
}

#[tauri::command]
pub fn watch_report_adapter_health(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    app_catalog_id: String,
    health: String,
    message: Option<String>,
) -> Result<(), String> {
    let parsed = AdapterHealth::parse(&health);
    state.with_conn_mut(|conn| {
        store::set_adapter_health(conn, app_catalog_id.trim(), parsed, message.as_deref())
    })?;
    let mut event = WatchEvent::app(
        if matches!(parsed, AdapterHealth::Error) {
            "app-adapter-error"
        } else {
            "watched-app-updated"
        },
        &app_catalog_id,
    );
    event.message = message;
    emit(&app, event);
    Ok(())
}

// ---------------------------------------------------------------------------
// Conversation binding + resolution
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub request_text: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// Restrict to this application instead of ranking. Used when the model has
    /// already named one.
    #[serde(default)]
    pub app_catalog_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWatchContext {
    pub application: WatchedApplication,
    pub resolution: InstanceResolution,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveOutcome {
    /// Ranked, most relevant first. Empty when nothing watched can answer.
    pub candidates: Vec<ResolvedWatchContext>,
    /// True when the caller must ask which application before acting.
    pub needs_clarification: bool,
    pub captured_at: String,
}

/// Which watched application (and instance) a request should act on.
#[tauri::command]
pub fn watch_resolve(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    request: ResolveRequest,
) -> Result<ResolveOutcome, String> {
    let snapshot = refresh(&app, &state, false)?;
    let active = match request.conversation_id.as_deref() {
        Some(conversation) => {
            state.with_conn_mut(|conn| store::active_session_app(conn, conversation))?
        }
        None => None,
    };

    let ranked: Vec<&WatchedApplication> = match request.app_catalog_id.as_deref() {
        Some(id) => snapshot
            .watched
            .iter()
            .filter(|w| w.app_catalog_id == id)
            .collect(),
        None => rank_relevant(&snapshot.watched, &request.request_text, active.as_deref()),
    };

    let bound_key = None; // Instance binding is per-session; see `watch_bind`.
    let candidates: Vec<ResolvedWatchContext> = ranked
        .into_iter()
        .map(|watched| ResolvedWatchContext {
            resolution: resolve_instance(watched, &snapshot.running, bound_key),
            application: watched.clone(),
        })
        .collect();

    // Two different applications could answer, and nothing distinguishes them.
    let live_count = candidates
        .iter()
        .filter(|c| c.application.state.is_live())
        .count();
    let needs_clarification = live_count > 1
        || candidates
            .iter()
            .any(|c| matches!(c.resolution, InstanceResolution::Ambiguous { .. }));

    Ok(ResolveOutcome {
        candidates,
        needs_clarification,
        captured_at: snapshot.captured_at,
    })
}

/// Record that a conversation is now acting on this application/instance.
#[tauri::command]
pub fn watch_bind(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    conversation_id: String,
    app_catalog_id: String,
    instance_key: Option<String>,
) -> Result<(), String> {
    let conversation_id = conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return Err("conversation_id is required".into());
    }
    state.with_conn_mut(|conn| {
        let watched = store::get_watched(conn, app_catalog_id.trim())?
            .ok_or_else(|| format!("{app_catalog_id} is not being watched"))?;
        store::bind_session(conn, &conversation_id, &watched.id, instance_key.as_deref())?;
        Ok(())
    })?;
    let mut event = WatchEvent::app("active-watched-app-changed", &app_catalog_id);
    event.conversation_id = Some(conversation_id);
    event.instance_key = instance_key;
    emit(&app, event);
    Ok(())
}

#[tauri::command]
pub fn watch_clear_conversation(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    conversation_id: String,
) -> Result<(), String> {
    state
        .with_conn_mut(|conn| store::clear_conversation_sessions(conn, conversation_id.trim()))?;
    let mut event = WatchEvent::new("active-watched-app-changed");
    event.conversation_id = Some(conversation_id);
    emit(&app, event);
    Ok(())
}

/// Focus the real window of a resolved instance.
///
/// Deliberately here rather than reached through `applications.focus`: that one
/// resolves by *name* against the application index and returns the first
/// window it finds, which is exactly the behaviour that could focus the wrong
/// VS Code workspace.
#[tauri::command]
pub fn watch_focus_instance(
    _app: AppHandle,
    instance_key: String,
) -> Result<serde_json::Value, String> {
    let instances = discover_instances()?;
    let Some(instance) = instances.iter().find(|i| i.instance_key == instance_key) else {
        return Err("That instance is no longer running.".into());
    };
    let Some(window_id) = instance.window_id.as_deref() else {
        return Err("That instance has no window to focus.".into());
    };
    let raw = crate::capabilities::system::parse_window_id(window_id)
        .ok_or_else(|| "That window id is not valid.".to_string())?;
    let focused = crate::capabilities::windows::focus_hwnd(raw);
    Ok(serde_json::json!({
        "focused": focused,
        "instanceKey": instance.instance_key,
        "processId": instance.process_id,
    }))
}

// ---------------------------------------------------------------------------
// Active conversation scope
// ---------------------------------------------------------------------------

/// The conversation's active scope, with each application's real abilities.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchScopeResult {
    pub scope: super::scope::ActiveWatchScope,
    /// What ArcSonare can do with each active application, right now.
    pub abilities: Vec<super::abilities::ApplicationAbilities>,
    /// Capability ids the model may be offered for this turn. Nothing else.
    pub capability_ids: Vec<String>,
    /// Ids the caller claimed that did not validate. A stale UI, not a secret.
    pub rejected_claims: Vec<String>,
    /// True when the scope was inferred rather than chosen, so the UI can say so.
    pub implicit: bool,
}

fn scope_result<R: Runtime>(
    app: &AppHandle<R>,
    state: &DatabaseManager,
    conversation_id: &str,
    claimed: &[String],
) -> Result<WatchScopeResult, String> {
    let snapshot = refresh(app, state, false)?;
    let running_ids: Vec<String> = snapshot
        .running
        .iter()
        .map(|i| i.app_catalog_id.clone())
        .collect();
    let account_id = state.sync_user_id().unwrap_or_else(|_| "guest".into());

    let (mut scope, rejected, implicit) = state.with_conn_mut(|conn| {
        let (_accepted, rejected) =
            super::scope::validate_claimed_scope(conn, conversation_id, claimed)?;
        let scope =
            super::scope::active_scope(conn, &account_id, conversation_id, &running_ids)?;

        // Nothing is adopted implicitly.
        //
        // An earlier version activated the single watched application when a
        // conversation had none, so that a generic question had something to
        // answer from. That was the wrong trade: it made Watch on by default,
        // silently attached an application to every new conversation, and put
        // Spotify into requests that had nothing to do with it. Watched is a
        // standing permission; active is an explicit choice, made per
        // conversation, and it starts empty.
        let implicit = false;
        Ok((scope, rejected, implicit))
    })?;

    // Bind each entry to a concrete instance when it is unambiguous, so an
    // action carries an instance key rather than resolving again later.
    let mut abilities = Vec::new();
    for entry in &mut scope.entries {
        let watched = snapshot
            .watched
            .iter()
            .find(|w| w.app_catalog_id == entry.app_catalog_id);
        let instances = instances_for(&entry.app_catalog_id, &snapshot.running);
        if entry.bound_instance_key.is_none() && instances.len() == 1 {
            entry.bound_instance_key = Some(instances[0].instance_key.clone());
        }

        let message_content = watched
            .map(|w| w.privacy_policy.message_content)
            .unwrap_or(false);
        // Whether the VS Code bridge is genuinely reachable for this instance.
        // Asked here rather than assumed, so the ability list cannot promise a
        // read the extension is not there to perform.
        let bridge_ready = matches!(entry.app_catalog_id.as_str(), "vscode" | "cursor")
            && instances.iter().any(|i| {
                i.workspace_identity
                    .as_deref()
                    .map(|w| {
                        super::vscode_bridge::availability(w)
                            == super::vscode_bridge::BridgeAvailability::Ready
                    })
                    .unwrap_or(false)
            });

        abilities.push(super::abilities::abilities_for(
            &entry.app_catalog_id,
            &entry.display_name,
            entry.running,
            message_content,
            bridge_ready,
        ));
    }

    let capability_ids = super::abilities::capability_ids(&abilities)
        .into_iter()
        .map(str::to_string)
        .collect();

    Ok(WatchScopeResult {
        scope,
        abilities,
        capability_ids,
        rejected_claims: rejected,
        implicit,
    })
}

/// Read (and validate) the active watch scope for a conversation.
#[tauri::command]
pub fn watch_scope_get(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    conversation_id: String,
    claimed_application_ids: Option<Vec<String>>,
) -> Result<WatchScopeResult, String> {
    let conversation_id = conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return Err("conversation_id is required".into());
    }
    scope_result(
        &app,
        &state,
        &conversation_id,
        &claimed_application_ids.unwrap_or_default(),
    )
}

/// Replace a conversation's active scope.
#[tauri::command]
pub fn watch_scope_set(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    conversation_id: String,
    app_catalog_ids: Vec<String>,
) -> Result<WatchScopeResult, String> {
    let conversation_id = conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return Err("conversation_id is required".into());
    }
    state.with_conn_mut(|conn| {
        super::scope::set_active_scope(conn, &conversation_id, &app_catalog_ids)
    })?;
    let mut event = WatchEvent::new("active-watched-app-changed");
    event.conversation_id = Some(conversation_id.clone());
    emit(&app, event);
    scope_result(&app, &state, &conversation_id, &[])
}

/// Add or remove one application from the conversation's scope.
#[tauri::command]
pub fn watch_scope_toggle(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    conversation_id: String,
    app_catalog_id: String,
) -> Result<WatchScopeResult, String> {
    let conversation_id = conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return Err("conversation_id is required".into());
    }
    state.with_conn_mut(|conn| {
        super::scope::toggle_active(conn, &conversation_id, app_catalog_id.trim())
    })?;
    let mut event = WatchEvent::app("active-watched-app-changed", &app_catalog_id);
    event.conversation_id = Some(conversation_id.clone());
    emit(&app, event);
    scope_result(&app, &state, &conversation_id, &[])
}

/// Bind a conversation's application to one specific instance.
#[tauri::command]
pub fn watch_scope_bind_instance(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    conversation_id: String,
    app_catalog_id: String,
    instance_key: Option<String>,
) -> Result<WatchScopeResult, String> {
    let conversation_id = conversation_id.trim().to_string();
    state.with_conn_mut(|conn| {
        super::scope::bind_instance(
            conn,
            &conversation_id,
            app_catalog_id.trim(),
            instance_key.as_deref(),
        )
    })?;
    let mut event = WatchEvent::app("active-watched-app-changed", &app_catalog_id);
    event.conversation_id = Some(conversation_id.clone());
    emit(&app, event);
    scope_result(&app, &state, &conversation_id, &[])
}

/// Drop every watch binding when the account changes.
///
/// The database file changes on sign-in, so rows are already isolated. This
/// clears the *event* side: windows holding a rendered list from the previous
/// account must be told to re-read rather than keep showing it.
#[tauri::command]
pub fn watch_account_changed(app: AppHandle) -> Result<(), String> {
    emit(&app, WatchEvent::new("watched-app-updated"));
    Ok(())
}

/// Reconcile once at start-up so the first render is not empty.
pub fn prime<R: Runtime>(app: &AppHandle<R>) {
    // Watch starts off. Watched applications are a standing permission and
    // survive a restart; being *active* in a conversation does not.
    //
    // Done here, synchronously, before the webview exists — not on the worker
    // below. Cleared on a thread it raced the frontend's first scope read, and
    // the composer came up showing a Watch pill for whatever had been active
    // when the app was last closed. The delete is a single statement; the scan
    // that follows is the slow part, and that is what the thread is for.
    {
        let state = app.state::<DatabaseManager>();
        match state.with_conn_mut(|conn| super::scope::clear_all_active_scopes(conn)) {
            Ok(cleared) if cleared > 0 => {
                log::info!("watch: cleared {cleared} active scope(s) from the previous run");
            }
            Ok(_) => {}
            Err(e) => log::warn!("watch: could not clear active scopes at startup: {e}"),
        }
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        let state = handle.state::<DatabaseManager>();
        match refresh(&handle, &state, true) {
            Ok(snapshot) => log::info!(
                "watch primed: {} watched, {} running instances",
                snapshot.watched.len(),
                snapshot.running.len()
            ),
            Err(e) => log::warn!("watch prime skipped: {e}"),
        }
    });
}
