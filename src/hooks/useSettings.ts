import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENT_SETTINGS_CHANGED, type Settings } from "../types";

/**
 * Loads the Rust-backed settings and stays in sync with every window via the
 * `sonare:settings-changed` broadcast. `update` applies an optimistic local
 * patch and persists it through the `update_settings` command (the global
 * shortcut and autostart flag have their own dedicated commands).
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let mounted = true;
    invoke<Settings>("get_settings")
      .then((loaded) => {
        if (mounted) setSettings(loaded);
      })
      .catch((err) => console.error("[ArcSonare] failed to load settings:", err));

    const unlisten = listen<Settings>(EVENT_SETTINGS_CHANGED, (event) => {
      setSettings(event.payload);
    });
    return () => {
      mounted = false;
      unlisten.then((f) => f());
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      invoke("update_settings", { settings: next }).catch((err) =>
        console.error("[ArcSonare] failed to save settings:", err),
      );
      return next;
    });
  }, []);

  return { settings, update };
}
