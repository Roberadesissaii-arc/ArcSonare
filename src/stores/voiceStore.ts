/**
 * The single shared voice-state store. Every voice surface (global overlay,
 * header voice button, Voice Action card) reads from here; state changes are
 * broadcast across windows via a Tauri event so the overlay window and the
 * main window never diverge.
 *
 * No microphone exists in this phase: `startVoiceSession` runs a clearly
 * local simulation (listening → thinking → responding → success) so every
 * visual state is exercisable. Nothing here performs an external action.
 */
import { useSyncExternalStore } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type VoiceStatus =
  | "idle"
  | "listening"
  | "thinking"
  | "responding"
  | "success"
  | "error"
  | "cancelled";

export interface VoiceState {
  status: VoiceStatus;
  transcript: string;
  resultMessage: string;
  isOverlayVisible: boolean;
  /** Live amplitude samples once real audio capture exists; empty for now. */
  audioLevels: number[];
  startedAt: number | null;
  errorMessage: string;
}

export const VOICE_STATUS_TEXT: Record<VoiceStatus, string> = {
  idle: "Ready",
  listening: "Listening...",
  thinking: "Thinking...",
  responding: "Responding...",
  success: "Done",
  error: "Something went wrong",
  cancelled: "Cancelled",
};

const SYNC_EVENT = "sonare:voice-state";
const WINDOW_LABEL = getCurrentWindow().label;

let state: VoiceState = {
  status: "idle",
  transcript: "",
  resultMessage: "",
  isOverlayVisible: false,
  audioLevels: [],
  startedAt: null,
  errorMessage: "",
};

const listeners = new Set<() => void>();
let timers: number[] = [];

function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
}

function set(patch: Partial<VoiceState>, broadcast = true) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  if (broadcast) {
    emit(SYNC_EVENT, {
      origin: WINDOW_LABEL,
      status: state.status,
      resultMessage: state.resultMessage,
      isOverlayVisible: state.isOverlayVisible,
    }).catch(() => undefined);
  }
}

// Apply state changes broadcast by other windows (never re-broadcast them).
listen<{
  origin: string;
  status: VoiceStatus;
  resultMessage: string;
  isOverlayVisible: boolean;
}>(SYNC_EVENT, (event) => {
  if (event.payload.origin === WINDOW_LABEL) return;
  set(
    {
      status: event.payload.status,
      resultMessage: event.payload.resultMessage,
      isOverlayVisible: event.payload.isOverlayVisible,
    },
    false,
  );
}).catch((err) => console.error("[ArcSonare] voice-state sync failed:", err));

export function getVoiceState(): VoiceState {
  return state;
}

export function setVoiceStatus(status: VoiceStatus, resultMessage = "") {
  set({ status, resultMessage });
}

/**
 * Development simulation of a voice session (no real audio is captured):
 * listening → thinking → responding → success. The overlay auto-hides
 * shortly after success (handled by the overlay component).
 */
export function startVoiceSession() {
  clearTimers();
  set({
    status: "listening",
    transcript: "",
    resultMessage: "",
    isOverlayVisible: true,
    startedAt: Date.now(),
    errorMessage: "",
  });
  timers = [
    window.setTimeout(() => set({ status: "thinking" }), 4600),
    window.setTimeout(() => set({ status: "responding" }), 6800),
    window.setTimeout(
      () => set({ status: "success", resultMessage: "Task created" }),
      9400,
    ),
  ];
}

/** Cancels the current session (Escape / close button). */
export function cancelVoiceSession() {
  clearTimers();
  set({ status: "cancelled", resultMessage: "" });
}

/** Called once the overlay window is fully hidden. */
export function voiceSessionEnded() {
  clearTimers();
  set({
    status: "idle",
    transcript: "",
    resultMessage: "",
    isOverlayVisible: false,
    startedAt: null,
  });
}

export function useVoiceState(): VoiceState {
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
