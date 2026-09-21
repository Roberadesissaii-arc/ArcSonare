/**
 * Typed overlay state machine. Broadcasts across Tauri windows so the main
 * window Voice button and the overlay window stay in sync.
 */
import { useSyncExternalStore } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  OverlayActionPayload,
  OverlayError,
  OverlayMode,
  OverlayPhase,
  OverlayState,
  SuccessPayload,
} from "./overlayTypes";

const SYNC_EVENT = "sonare:overlay-state";
const WINDOW_LABEL = getCurrentWindow().label;

const initialState: OverlayState = {
  mode: "hidden",
  phase: "hidden",
  visible: false,
  expanded: false,
  title: "ArcSonare",
  status: "Ready",
  waveformLevels: [],
  requiresConfirmation: false,
};

let state: OverlayState = { ...initialState };
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function broadcast() {
  emit(SYNC_EVENT, {
    origin: WINDOW_LABEL,
    state: {
      mode: state.mode,
      phase: state.phase,
      visible: state.visible,
      expanded: state.expanded,
      title: state.title,
      status: state.status,
      applicationId: state.applicationId,
      applicationIcon: state.applicationIcon,
      transcript: state.transcript,
      requiresConfirmation: state.requiresConfirmation,
      pendingConfirmAction: state.pendingConfirmAction,
      error: state.error,
      // Keep payloads in sync for expanded panels across windows.
      actionPayload: state.actionPayload,
      result: state.result,
    },
  }).catch(() => undefined);
}

listen<{ origin: string; state: Partial<OverlayState> }>(SYNC_EVENT, (event) => {
  if (event.payload.origin === WINDOW_LABEL) return;
  state = { ...state, ...event.payload.state };
  notify();
}).catch((err) => console.error("[ArcSonare] overlay-state sync failed:", err));

export function getOverlayState(): OverlayState {
  return state;
}

export function patchOverlay(patch: Partial<OverlayState>, shouldBroadcast = true) {
  state = { ...state, ...patch };
  notify();
  if (shouldBroadcast) broadcast();
}

export function setOverlayMode(
  mode: OverlayMode,
  extras: Partial<OverlayState> = {},
) {
  const expanded = isExpandedMode(mode) || Boolean(extras.expanded);
  patchOverlay({
    mode,
    visible: mode !== "hidden" && mode !== "closing",
    expanded,
    ...extras,
  });
}

export function setOverlayPhase(phase: OverlayPhase) {
  patchOverlay({ phase, visible: phase !== "hidden" });
}

export function setStatusText(status: string) {
  patchOverlay({ status });
}

export function clearOverlayError() {
  if (!state.error) return;
  patchOverlay({ error: undefined });
}

/** Expand/collapse the transcript / result dropdown under the capsule. */
export function toggleOverlayTranscriptPanel() {
  const next = !state.expanded;
  // Prefer showing the latest assistant reply or user transcript.
  const title =
    state.result?.title ||
    state.transcript ||
    state.status ||
    "Transcript";
  patchOverlay({
    expanded: next,
    result: next
      ? state.result ?? { title, summary: "" }
      : state.result,
    // Don't keep an error panel if the user just wants the transcript.
    error: next ? undefined : state.error,
  });
}

export function setApplicationContext(
  applicationId: string | undefined,
  applicationIcon: string | undefined,
) {
  patchOverlay({ applicationId, applicationIcon });
}

export function setActionPayload(actionPayload: OverlayActionPayload | undefined) {
  patchOverlay({ actionPayload });
}

export function setOverlayError(error: OverlayError) {
  patchOverlay({
    mode: "error",
    expanded: true,
    status: "Something went wrong",
    error,
    actionPayload: undefined,
    result: undefined,
    requiresConfirmation: false,
  });
}

export function setOverlaySuccess(result: SuccessPayload, status?: string, expand = false) {
  const applicationId = result.applicationId ?? state.applicationId;
  const keptIcon =
    state.applicationIcon && state.applicationIcon.length > 0
      ? state.applicationIcon
      : undefined;
  patchOverlay({
    mode: "success",
    expanded: expand && Boolean(result.summary),
    status: status ?? result.title,
    result,
    actionPayload: expand ? { type: "success", data: result } : undefined,
    requiresConfirmation: false,
    applicationId,
    // Keep the right-side app icon through the success state.
    applicationIcon: keptIcon,
  });
}

export function resetOverlay() {
  state = { ...initialState };
  notify();
  broadcast();
}

function isExpandedMode(mode: OverlayMode): boolean {
  return (
    mode === "drafting-email" ||
    mode === "scheduling-meeting" ||
    mode === "creating-task" ||
    mode === "screen-context" ||
    mode === "confirmation" ||
    mode === "error" ||
    mode === "clarifying" ||
    mode === "success"
  );
}

export function useOverlayStore(): OverlayState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
  );
}

/** Bridge: keep legacy voiceStore consumers roughly aligned. */
export function overlayModeToLegacyVoiceStatus(
  mode: OverlayMode,
): "idle" | "listening" | "thinking" | "responding" | "success" | "error" | "cancelled" {
  switch (mode) {
    case "listening":
    case "entering":
      return "listening";
    case "thinking":
    case "clarifying":
      return "thinking";
    case "responding":
    case "opening-app":
    case "opening-web":
    case "web-search":
    case "drafting-email":
    case "scheduling-meeting":
    case "creating-task":
    case "screen-context":
    case "confirmation":
      return "responding";
    case "success":
      return "success";
    case "error":
      return "error";
    case "closing":
      return "cancelled";
    default:
      return "idle";
  }
}
