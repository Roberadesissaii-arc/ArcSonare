//! Local SQLite schema migrations (user_version pragma).

use rusqlite::Connection;

pub const LOCAL_SCHEMA_VERSION: i32 = 1;

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

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    let current: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("read user_version: {e}"))?;

    if current < 1 {
        conn.execute_batch(V1)
            .map_err(|e| format!("apply local migration v1: {e}"))?;
        conn.pragma_update(None, "user_version", LOCAL_SCHEMA_VERSION)
            .map_err(|e| format!("set user_version: {e}"))?;
    }
    Ok(())
}
