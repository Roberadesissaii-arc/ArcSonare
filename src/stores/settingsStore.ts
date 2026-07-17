/**
 * Module-level settings store shared by every component in a window.
 * Wraps the Rust-owned settings (get_settings / update_settings /
 * sonare:settings-changed) and exposes the typed `prefs` tree.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENT_SETTINGS_CHANGED, type Settings } from "../types";
import { DEFAULT_PREFS, normalizePrefs, type Prefs } from "../config/prefs";

interface SettingsSnapshot {
  settings: Settings | null;
  prefs: Prefs;
}

let snapshot: SettingsSnapshot = { settings: null, prefs: DEFAULT_PREFS };
const listeners = new Set<() => void>();
let initialized = false;

function publish(settings: Settings | null) {
  snapshot = {
    settings,
    prefs: settings ? normalizePrefs(settings.prefs) : DEFAULT_PREFS,
  };
  listeners.forEach((l) => l());
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  invoke<Settings>("get_settings")
    .then((loaded) => publish(loaded))
    .catch((err) => console.error("[ArcSonare] failed to load settings:", err));
  listen<Settings>(EVENT_SETTINGS_CHANGED, (event) => {
    publish(event.payload);
  }).catch((err) =>
    console.error("[ArcSonare] settings-changed listener failed:", err),
  );
}

function persist(next: Settings) {
  invoke("update_settings", { settings: next }).catch((err) =>
    console.error("[ArcSonare] failed to save settings:", err),
  );
}

/** Patches top-level settings fields (theme, overlayPosition, ...). */
export function updateSettings(patch: Partial<Settings>) {
  if (!snapshot.settings) return;
  const next = { ...snapshot.settings, ...patch };
  publish(next);
  persist(next);
}

/**
 * Applies a functional update to the prefs tree and persists it. The updater
 * receives the current normalized prefs and returns the next tree.
 */
export function updatePrefs(updater: (prefs: Prefs) => Prefs) {
  if (!snapshot.settings) return;
  const nextPrefs = updater(snapshot.prefs);
  const next = { ...snapshot.settings, prefs: nextPrefs };
  publish(next);
  persist(next);
}

/** Convenience: patch one prefs group immutably. */
export function patchPrefs<K extends keyof Prefs>(
  group: K,
  patch: Partial<Prefs[K]>,
) {
  updatePrefs((prefs) => ({
    ...prefs,
    [group]:
      typeof prefs[group] === "object" && !Array.isArray(prefs[group])
        ? { ...(prefs[group] as object), ...(patch as object) }
        : patch,
  }));
}

export function getSettingsSnapshot(): SettingsSnapshot {
  return snapshot;
}

export function getPrefs(): Prefs {
  return snapshot.prefs;
}

export function useSettingsStore(): SettingsSnapshot {
  ensureInitialized();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => snapshot,
  );
}

export function usePrefs(): Prefs {
  return useSettingsStore().prefs;
}
