/**
 * Dispatches frontend-only global shortcut actions emitted by Rust as
 * `sonare:shortcut-action`.
 */
import { listen } from "@tauri-apps/api/event";
import { navigate, navigateSettings } from "../../stores/appStore";
import {
  getCenterStage,
  setCenterView,
  type CenterStageView,
} from "../../stores/centerStageStore";
import { patchPrefs, getPrefs } from "../../stores/settingsStore";

const DASHBOARD_VIEW_ORDER: CenterStageView[] = [
  "overview",
  "active-work",
  "review",
  "chat",
];

function openDashboardView(view: CenterStageView): void {
  navigate("dashboard");
  setCenterView(view);
}

function cycleDashboardView(direction: 1 | -1): void {
  const current = getCenterStage().view;
  const currentIndex = DASHBOARD_VIEW_ORDER.indexOf(current);
  const nextIndex = Math.min(
    DASHBOARD_VIEW_ORDER.length - 1,
    Math.max(0, currentIndex + direction),
  );
  openDashboardView(DASHBOARD_VIEW_ORDER[nextIndex]);
}

export async function handleShortcutAction(action: string): Promise<void> {
  switch (action) {
    case "open-dashboard":
      navigate("dashboard");
      return;
    case "open-tasks":
      navigate("tasks");
      return;
    case "select-voice-sonare":
      patchPrefs("voice", { voiceId: "sonare" });
      return;
    case "select-voice-vela":
      patchPrefs("voice", { voiceId: "vela" });
      return;
    case "select-voice-orion":
      patchPrefs("voice", { voiceId: "orion" });
      return;
    case "select-voice-lyra":
      patchPrefs("voice", { voiceId: "lyra" });
      return;
    case "select-voice-nova":
      patchPrefs("voice", { voiceId: "nova" });
      return;
    case "select-voice-jane":
      patchPrefs("voice", { voiceId: "jane" });
      return;
    case "dashboard-chat":
      openDashboardView("chat");
      return;
    case "dashboard-next-view":
      cycleDashboardView(1);
      return;
    case "dashboard-previous-view":
      cycleDashboardView(-1);
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
