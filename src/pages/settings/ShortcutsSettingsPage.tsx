import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { ShortcutRecorder } from "../../components/settings/ShortcutRecorder";
import { useSettings } from "../../hooks/useSettings";
import { usePrefs } from "../../stores/settingsStore";
import { DEFAULT_SHORTCUT_ACTIONS } from "../../features/shortcuts/shortcutActions";

export function ShortcutsSettingsPage() {
  const { settings } = useSettings();
  const prefs = usePrefs();
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  const bindingFor = (actionId: string): string | null => {
    if (actionId === "voice-toggle") return settings?.globalShortcut ?? null;
    return prefs.shortcuts[actionId] ?? null;
  };

  // Conflict indicator: two actions holding the same combination. Rust
  // refuses to create this state, but stale settings files could contain it.
  const allBindings = DEFAULT_SHORTCUT_ACTIONS.map((a) => bindingFor(a.id));
  const conflicting = new Set(
    allBindings.filter(
      (value, index) => value && allBindings.indexOf(value) !== index,
    ),
  );

  const commit = (actionId: string) => async (candidate: string) => {
    if (actionId === "voice-toggle") {
      await invoke("set_global_shortcut", { shortcut: candidate });
    } else {
      await invoke("set_action_shortcut", { action: actionId, shortcut: candidate });
    }
  };

  const clearBinding = (actionId: string) => {
    invoke("set_action_shortcut", { action: actionId, shortcut: null }).catch(
      (err) => console.error("[ArcSonare] failed to clear shortcut:", err),
    );
  };

  const restoreDefaults = async () => {
    setResetStatus(null);
    try {
      for (const action of DEFAULT_SHORTCUT_ACTIONS) {
        if (action.id === "voice-toggle") continue;
        if (prefs.shortcuts[action.id]) {
          await invoke("set_action_shortcut", { action: action.id, shortcut: null });
        }
      }
      await invoke("set_global_shortcut", { shortcut: "Ctrl+Shift+Space" });
      setResetStatus("Defaults restored: voice toggle is Ctrl+Shift+Space; other actions are unbound.");
    } catch (err) {
      setResetStatus(typeof err === "string" ? err : "Defaults could not be fully restored.");
    }
  };

  return (
    <div className="page">
      <SettingsPageHeader
        title="Shortcuts"
        description="Global shortcuts work anywhere in Windows. A binding is saved only after Windows accepts it; failures keep the previous shortcut."
      />

      <SettingsGroup
        title="Actions"
        description="The Fn key is handled by keyboard hardware and cannot be registered. Mouse side buttons are not supported by Windows global shortcuts."
      >
        {DEFAULT_SHORTCUT_ACTIONS.map((action) => {
          const binding = bindingFor(action.id);
          const hasConflict = binding !== null && conflicting.has(binding);
          return (
            <div className="shortcut-action-row" key={action.id}>
              <div className="setting-meta">
                <div className="setting-label">
                  {action.label}
                  {hasConflict ? (
                    <span className="shortcut-conflict" role="alert">
                      Conflict
                    </span>
                  ) : null}
                  {action.frontendOnly ? null : null}
                </div>
                <div className="setting-desc">{action.description}</div>
              </div>
              <div className="shortcut-action-controls">
                <ShortcutRecorder
                  shortcut={binding}
                  onCommit={commit(action.id)}
                  emptyLabel="Not set"
                />
                {action.id !== "voice-toggle" && binding ? (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => clearBinding(action.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Defaults">
        <div className="shortcut-defaults-row">
          <button type="button" className="btn" onClick={() => void restoreDefaults()}>
            Restore defaults
          </button>
          {resetStatus ? (
            <p className="field-help" role="status">
              {resetStatus}
            </p>
          ) : null}
        </div>
      </SettingsGroup>
    </div>
  );
}
