import { useCallback } from "react";
import type { Settings } from "../types";
import { updateSettings, useSettingsStore } from "../stores/settingsStore";

/**
 * Thin wrapper over the shared settings store (one subscription per window).
 * `update` applies an optimistic local patch and persists it through the
 * `update_settings` command (the global shortcut, action shortcuts and
 * autostart flag have their own dedicated commands).
 */
export function useSettings() {
  const { settings } = useSettingsStore();
  const update = useCallback((patch: Partial<Settings>) => {
    updateSettings(patch);
  }, []);
  return { settings, update };
}
