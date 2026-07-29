/**
 * Dispatches frontend-only global shortcut actions emitted by Rust as
 * `sonare:shortcut-action`.
 */
import { listen } from "@tauri-apps/api/event";
import { navigate, navigateSettings } from "../../stores/appStore";
import { patchPrefs, getPrefs } from "../../stores/settingsStore";

export async function handleShortcutAction(action: string): Promise<void> {
  switch (action) {
    case "open-dashboard":
      navigate("dashboard");
      return;
    case "open-tasks":
      navigate("tasks");
      return;
    case "open-agent":
      navigate("agent");
      return;
    case "open-connect":
      navigate("connect");
      return;
    case "open-settings":
      navigate("settings");
      return;
    case "open-voice-settings":
      navigateSettings("voice");
      return;
    case "mute":
      patchPrefs("voice", {
        muteResponses: !getPrefs().voice.muteResponses,
      });
      return;
    case "stop-speaking":
      return;
    default:
      console.warn(`[ArcSonare] unhandled shortcut action: ${action}`);
  }
}

/** Subscribe once from the main window shell. */
export function bindShortcutActions(): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  listen<string>("sonare:shortcut-action", (event) => {
    if (disposed) return;
    void handleShortcutAction(event.payload).catch((err) =>
      console.error("[ArcSonare] shortcut action failed:", err),
    );
  })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch((err) =>
      console.error("[ArcSonare] shortcut listener failed:", err),
    );
  return () => {
    disposed = true;
    unlisten?.();
  };
}
