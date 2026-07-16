/**
 * Shared voice state for both voice surfaces (in-app console + global
 * overlay). No microphone exists in this phase: `toggleVoice` runs a safe,
 * clearly-local simulation so every visual state can be exercised. The UI
 * must never claim real audio capture is happening.
 */
import { useSyncExternalStore } from "react";

export type VoiceState =
  | "ready"
  | "listening"
  | "processing"
  | "speaking"
  | "success"
  | "error";

export const VOICE_STATUS: Record<VoiceState, string> = {
  ready: "Ready when you are",
  listening: "Listening for your command",
  processing: "Understanding your request",
  speaking: "Responding",
  success: "Done",
  error: "Something went wrong",
};

let state: VoiceState = "ready";
const listeners = new Set<() => void>();
let timers: number[] = [];

function emit() {
  listeners.forEach((l) => l());
}

function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
}

export function getVoiceState(): VoiceState {
  return state;
}

export function setVoiceState(next: VoiceState) {
  if (state !== next) {
    state = next;
    emit();
  }
}

/** Simulated session: listening → processing → speaking → ready. */
export function toggleVoice() {
  clearTimers();
  if (state === "ready" || state === "success" || state === "error") {
    setVoiceState("listening");
    timers = [
      window.setTimeout(() => setVoiceState("processing"), 4500),
      window.setTimeout(() => setVoiceState("speaking"), 6800),
      window.setTimeout(() => setVoiceState("ready"), 10200),
    ];
  } else {
    setVoiceState("ready");
  }
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
