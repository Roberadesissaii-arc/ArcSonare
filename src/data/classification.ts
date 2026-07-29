/**
 * Classification of existing ArcSonare persisted fields (audit snapshot).
 *
 * Account-synchronized — profile, tasks, agents, account prefs, integration metadata
 * Device-specific — shortcuts, monitors, mic/speaker IDs, autostart, window state
 * Local cache — capability memory, screen package index metadata
 * Temporary — pending annotations
 * Secrets — provider API keys (Credential Manager), future auth session
 * Derived — agent status from model assignment
 *
 * Current stores (pre-migration still active for UI):
 * - settings.rs JSON file → device + account prefs (split by settingsScope.ts)
 * - localStorage arcsonare.tasks.v2 → account sync (migrating to SQLite)
 * - localStorage arcsonare.agents.v2 → account sync (migrating to SQLite)
 * - localStorage arcsonare.activity.v1 → selective activity sync
 * - Windows Credential Manager ArcSonare/<provider> → secrets
 */

export const DATA_CLASSIFICATION_DOC = "src/data/settingsScope.ts";
