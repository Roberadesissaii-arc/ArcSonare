//! Local SQLite schema migrations (user_version pragma).

use rusqlite::Connection;

pub const LOCAL_SCHEMA_VERSION: i32 = 5;

const V1: &str = r#"
CREATE TABLE IF NOT EXISTS migration_state (
  migration_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  backup_path TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT,
  base_version INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error_code TEXT,
  last_error_message TEXT
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_version INTEGER,
  local_version INTEGER,
  cloud_version INTEGER,
  local_payload TEXT NOT NULL,
  cloud_payload TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS sync_failures (
  id TEXT PRIMARY KEY,
  outbox_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_settings (
  section TEXT PRIMARY KEY,
  document_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_secret_references (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT,
  label TEXT,
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_application_index (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  executable_path TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'none',
  due_at TEXT,
  assigned_agent_id TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  tags_json TEXT NOT NULL DEFAULT '[]',
  configuration_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
  runtime_type TEXT NOT NULL DEFAULT 'manual',
  model_provider TEXT,
  model_id TEXT,
  voice_character_id TEXT,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS settings_documents (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  section TEXT NOT NULL,
  device_id TEXT,
  document_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(scope, section, device_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  locale TEXT NOT NULL DEFAULT 'en-US',
  timezone TEXT,
  week_starts_on INTEGER NOT NULL DEFAULT 0,
  time_format TEXT NOT NULL DEFAULT 'system',
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_version TEXT,
  architecture TEXT,
  app_version TEXT,
  device_fingerprint_hash TEXT,
  last_seen_at TEXT,
  last_sync_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'personal',
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  workspace_id TEXT,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_tools (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  tool_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  permission_level TEXT NOT NULL DEFAULT 'ask',
  configuration_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(agent_id, tool_id)
);

CREATE TABLE IF NOT EXISTS agent_knowledge_sources (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  source_type TEXT NOT NULL,
  label TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS integration_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_label TEXT,
  account_email TEXT,
  status TEXT NOT NULL,
  services_json TEXT NOT NULL DEFAULT '[]',
  granted_scopes_json TEXT NOT NULL DEFAULT '[]',
  token_storage_mode TEXT NOT NULL DEFAULT 'none',
  server_connection_id TEXT,
  last_validated_at TEXT,
  last_successful_request_at TEXT,
  reconnect_required INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS integration_services (
  id TEXT PRIMARY KEY,
  integration_account_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  local_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(integration_account_id, service_id)
);

CREATE TABLE IF NOT EXISTS service_preferences (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  preferred_target TEXT NOT NULL DEFAULT 'native',
  preferred_browser TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(service_id)
);

CREATE TABLE IF NOT EXISTS application_aliases (
  id TEXT PRIMARY KEY,
  phrase TEXT NOT NULL,
  canonical_service_id TEXT NOT NULL,
  preferred_target TEXT NOT NULL DEFAULT 'native',
  preferred_browser TEXT,
  confirmed_by_user INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(phrase)
);

CREATE TABLE IF NOT EXISTS approval_policies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  document_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  agent_id TEXT,
  task_id TEXT,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by_user_id TEXT,
  expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  device_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'info',
  occurred_at TEXT NOT NULL,
  expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT
);

CREATE INDEX IF NOT EXISTS sync_outbox_state_idx ON sync_outbox(state, next_attempt_at);
CREATE INDEX IF NOT EXISTS tasks_active_idx ON tasks(deleted_at);

INSERT OR IGNORE INTO sync_cursors (name, value, updated_at)
VALUES ('sync_change_log', 0, datetime('now'));
"#;

/// Watched applications.
///
/// This table is what makes "Watch" mean something. The previous store was a
/// `Set<string>` of catalog ids in `localStorage`, which had three defects that
/// no amount of frontend code could fix: it was per-webview (so the voice
/// overlay and the main window disagreed), per-browser-profile rather than
/// per-account (so signing out left the previous account's watches in place),
/// and it was pruned against the running-process list on every poll (so closing
/// an application silently deleted the user's choice).
///
/// Living in the per-user database fixes the first two by construction — the
/// file is chosen by `sha256(user_id)`, so account B physically cannot read
/// account A's rows — and `state` fixes the third: a closed application becomes
/// `app-closed`, not absent.
const V2: &str = r#"
CREATE TABLE IF NOT EXISTS watched_applications (
  id TEXT PRIMARY KEY,
  app_catalog_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'watching',
  preferred_instance_key TEXT,
  privacy_policy_json TEXT NOT NULL DEFAULT '{}',
  enabled_context_providers_json TEXT NOT NULL DEFAULT '[]',
  enabled_action_providers_json TEXT NOT NULL DEFAULT '[]',
  adapter_id TEXT,
  adapter_health TEXT NOT NULL DEFAULT 'unknown',
  adapter_message TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER,
  cloud_version INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  local_updated_at TEXT NOT NULL,
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  deleted_at TEXT,
  UNIQUE(app_catalog_id)
);

-- Instance bindings survive a restart of the watched application, so the
-- preferred workspace/window is still preferred tomorrow.
CREATE TABLE IF NOT EXISTS watched_app_instances (
  id TEXT PRIMARY KEY,
  watched_application_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  app_catalog_id TEXT NOT NULL,
  process_id INTEGER,
  executable_path TEXT,
  executable_name TEXT,
  window_id TEXT,
  window_title TEXT,
  window_bounds_json TEXT,
  monitor_id TEXT,
  workspace_identity TEXT,
  parent_process_id INTEGER,
  state TEXT NOT NULL DEFAULT 'running',
  started_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(watched_application_id, instance_key)
);

CREATE TABLE IF NOT EXISTS watch_sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  watched_application_id TEXT NOT NULL,
  bound_instance_key TEXT,
  mode TEXT NOT NULL DEFAULT 'on-demand',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_snapshot_at TEXT,
  last_event_at TEXT,
  UNIQUE(conversation_id, watched_application_id)
);

CREATE INDEX IF NOT EXISTS watched_applications_active_idx
  ON watched_applications(deleted_at);
CREATE INDEX IF NOT EXISTS watched_app_instances_app_idx
  ON watched_app_instances(watched_application_id);
CREATE INDEX IF NOT EXISTS watch_sessions_conversation_idx
  ON watch_sessions(conversation_id);
"#;

/// Meeting Intelligence tables (Agent 3).
///
/// Account isolation is structural: each account's meetings live in their own
/// database file (selected by sha256(user_id) in DatabaseManager). There is no
/// user_id column because the file IS the user_id selector.
const V3: &str = r#"
CREATE TABLE IF NOT EXISTS meeting_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  conversation_id TEXT,
  source TEXT NOT NULL,
  source_application TEXT NOT NULL,
  source_instance_id TEXT,
  meeting_title TEXT,
  organizer TEXT,
  participants_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  state TEXT NOT NULL DEFAULT 'idle',
  capture_mode TEXT NOT NULL DEFAULT 'none',
  transcription_mode TEXT NOT NULL DEFAULT 'none',
  language TEXT,
  consent_state TEXT NOT NULL DEFAULT 'unknown',
  audio_artifact_id TEXT,
  transcript_id TEXT,
  summary_id TEXT,
  deduplication_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(deduplication_key)
);

CREATE TABLE IF NOT EXISTS meeting_transcript_segments (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  speaker_id TEXT,
  speaker_label TEXT,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  confidence REAL,
  is_final INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (meeting_id) REFERENCES meeting_sessions(id)
);

CREATE TABLE IF NOT EXISTS meeting_summaries (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  overview TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT NOT NULL,
  model_provenance TEXT NOT NULL DEFAULT 'unknown',
  FOREIGN KEY (meeting_id) REFERENCES meeting_sessions(id)
);

CREATE INDEX IF NOT EXISTS meeting_sessions_account_idx
  ON meeting_sessions(account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS meeting_sessions_state_idx
  ON meeting_sessions(state);
CREATE INDEX IF NOT EXISTS meeting_transcript_meeting_idx
  ON meeting_transcript_segments(meeting_id, started_at_ms);
"#;

/// Overlay Conversation Log tables (Agent 5).
const V4: &str = r#"
CREATE TABLE IF NOT EXISTS overlay_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  conversation_id TEXT,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  surface TEXT NOT NULL DEFAULT 'voice-overlay',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS overlay_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  user_transcript TEXT,
  assistant_response TEXT,
  status TEXT NOT NULL DEFAULT 'in-flight',
  error_code TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (session_id) REFERENCES overlay_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS overlay_events (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  safe_metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (turn_id) REFERENCES overlay_turns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS overlay_log_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled INTEGER NOT NULL DEFAULT 1,
  retention_days INTEGER NOT NULL DEFAULT 30,
  include_interim INTEGER NOT NULL DEFAULT 0,
  include_capability_timeline INTEGER NOT NULL DEFAULT 1,
  include_technical_diagnostics INTEGER NOT NULL DEFAULT 1,
  include_typed_chats INTEGER NOT NULL DEFAULT 0,
  raw_audio_enabled INTEGER NOT NULL DEFAULT 0,
  screenshots_enabled INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO overlay_log_settings (id, enabled, retention_days, include_interim, include_capability_timeline, include_technical_diagnostics, include_typed_chats, raw_audio_enabled, screenshots_enabled)
VALUES ('default', 1, 30, 0, 1, 1, 0, 0, 0);

CREATE INDEX IF NOT EXISTS overlay_sessions_account_idx
  ON overlay_sessions(account_id, started_at_ms DESC);
CREATE INDEX IF NOT EXISTS overlay_turns_session_idx
  ON overlay_turns(session_id, started_at_ms ASC);
CREATE INDEX IF NOT EXISTS overlay_events_turn_idx
  ON overlay_events(turn_id, timestamp_ms ASC);
"#;

/// V5: Ensure Overlay Conversation Log tables exist.
///
/// The V4 migration may have been stamped without executing if the database
/// already had user_version=4 at the time Agent 5's schema was added.
/// This V5 pass uses CREATE TABLE IF NOT EXISTS so it is safe to run on any
/// database, whether the tables already exist or not.
const V5: &str = r#"
CREATE TABLE IF NOT EXISTS overlay_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  conversation_id TEXT,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  surface TEXT NOT NULL DEFAULT 'voice-overlay',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS overlay_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  user_transcript TEXT,
  assistant_response TEXT,
  status TEXT NOT NULL DEFAULT 'in-flight',
  error_code TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (session_id) REFERENCES overlay_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS overlay_events (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  safe_metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (turn_id) REFERENCES overlay_turns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS overlay_log_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled INTEGER NOT NULL DEFAULT 1,
  retention_days INTEGER NOT NULL DEFAULT 30,
  include_interim INTEGER NOT NULL DEFAULT 0,
  include_capability_timeline INTEGER NOT NULL DEFAULT 1,
  include_technical_diagnostics INTEGER NOT NULL DEFAULT 1,
  include_typed_chats INTEGER NOT NULL DEFAULT 0,
  raw_audio_enabled INTEGER NOT NULL DEFAULT 0,
  screenshots_enabled INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO overlay_log_settings
  (id, enabled, retention_days, include_interim, include_capability_timeline,
   include_technical_diagnostics, include_typed_chats, raw_audio_enabled, screenshots_enabled)
VALUES ('default', 1, 30, 0, 1, 1, 0, 0, 0);

CREATE INDEX IF NOT EXISTS overlay_sessions_account_idx
  ON overlay_sessions(account_id, started_at_ms DESC);
CREATE INDEX IF NOT EXISTS overlay_turns_session_idx
  ON overlay_turns(session_id, started_at_ms ASC);
CREATE INDEX IF NOT EXISTS overlay_events_turn_idx
  ON overlay_events(turn_id, timestamp_ms ASC);
"#;

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    let current: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("read user_version: {e}"))?;

    if current < 1 {
        conn.execute_batch(V1)
            .map_err(|e| format!("apply local migration v1: {e}"))?;
    }
    if current < 2 {
        conn.execute_batch(V2)
            .map_err(|e| format!("apply local migration v2: {e}"))?;
    }
    if current < 3 {
        conn.execute_batch(V3)
            .map_err(|e| format!("apply local migration v3: {e}"))?;
    }
    if current < 4 {
        conn.execute_batch(V4)
            .map_err(|e| format!("apply local migration v4: {e}"))?;
    }
    if current < 5 {
        conn.execute_batch(V5)
            .map_err(|e| format!("apply local migration v5: {e}"))?;
    }

    if current < LOCAL_SCHEMA_VERSION {
        conn.pragma_update(None, "user_version", LOCAL_SCHEMA_VERSION)
            .map_err(|e| format!("set user_version: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A database created before the watch tables existed must gain them.
    ///
    /// The original `run_migrations` only stamped `user_version` inside the
    /// `current < 1` branch, so an existing v1 database would have been left at
    /// version 1 forever and every watch query would have failed with "no such
    /// table" — on precisely the machines that already have user data.
    #[test]
    fn a_v1_database_is_upgraded_to_the_watch_schema() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(V1).expect("apply v1");
        conn.pragma_update(None, "user_version", 1).expect("stamp");

        run_migrations(&conn).expect("upgrade");

        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read version");
        assert_eq!(version, LOCAL_SCHEMA_VERSION);
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='watched_applications'",
                [],
                |row| row.get(0),
            )
            .expect("query schema");
        assert_eq!(count, 1, "the watch table must exist after the upgrade");
    }

    /// Running migrations twice must not fail — every window opens the database.
    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("first run");
        run_migrations(&conn).expect("second run");
    }
}
