/**
 * Capability run state machine. One store drives the voice overlay, chat
 * cards, activity log and notifications via `arcsonare://capability-*` events
 * — no competing execution-state stores.
 */
import { useSyncExternalStore } from "react";
import { emit } from "@tauri-apps/api/event";
import type {
  CapabilityRun,
  CapabilityRunState,
  ToolResult,
} from "./capabilityTypes";

const MAX_HISTORY = 20;

let runs: CapabilityRun[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const STATE_EVENTS: Record<CapabilityRunState, string> = {
  received: "arcsonare://capability-run-started",
  routing: "arcsonare://capability-routing",
  planning: "arcsonare://capability-routing",
  "awaiting-confirmation": "arcsonare://capability-confirmation-required",
  executing: "arcsonare://capability-executing",
  verifying: "arcsonare://capability-verifying",
  completed: "arcsonare://capability-completed",
  "partially-completed": "arcsonare://capability-completed",
  denied: "arcsonare://capability-failed",
  cancelled: "arcsonare://capability-cancelled",
  failed: "arcsonare://capability-failed",
};

export function startRun(
  userRequest: string,
  route: CapabilityRun["route"],
  origin?: { conversationId?: string; voiceSessionId?: string },
): CapabilityRun {
  const run: CapabilityRun = {
    id: newRunId(),
    conversationId: origin?.conversationId,
    voiceSessionId: origin?.voiceSessionId,
    userRequest,
    route,
    selectedCapabilityIds: [],
    state: "received",
    riskLevel: "read-only",
    confirmationRequired: false,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  runs = [run, ...runs].slice(0, MAX_HISTORY);
  notify();
  broadcast(run, "Received");
  return run;
}

export function patchRun(
  runId: string,
  patch: Partial<CapabilityRun>,
  displayMessage?: string,
  iconKey?: string,
): CapabilityRun | undefined {
  let updated: CapabilityRun | undefined;
  runs = runs.map((r) => {
    if (r.id !== runId) return r;
    updated = { ...r, ...patch };
    return updated;
  });
  notify();
  if (updated && patch.state) {
    broadcast(updated, displayMessage ?? defaultMessage(updated), iconKey);
  }
  return updated;
}

function defaultMessage(run: CapabilityRun): string {
  switch (run.state) {
    case "routing":
      return "Thinking...";
    case "planning":
      return "Thinking...";
    case "awaiting-confirmation":
      return "Waiting for confirmation...";
    case "executing":
      return "Working...";
    case "verifying":
      return "Verifying...";
    case "completed":
      return "Done";
    case "partially-completed":
      return "Partially done";
    case "failed":
      return "Couldn't complete";
    case "cancelled":
      return "Cancelled";
    case "denied":
      return "Not allowed";
    default:
      return "Received";
  }
}

function broadcast(run: CapabilityRun, displayMessage: string, iconKey?: string) {
  const event = STATE_EVENTS[run.state];
  emit(event, {
    runId: run.id,
    capabilityId: run.selectedCapabilityIds[0],
    state: run.state,
    displayMessage,
    iconKey,
  }).catch(() => undefined);
}

export function finishRun(
  runId: string,
  result: ToolResult,
  responseText: string,
): CapabilityRun | undefined {
  const state: CapabilityRunState =
    result.status === "success"
      ? "completed"
      : result.status === "partial"
        ? "partially-completed"
        : result.status === "cancelled"
          ? "cancelled"
          : result.status === "denied"
            ? "denied"
            : "failed";
  return patchRun(
    runId,
    {
      state,
      finalResult: result,
      responseText,
      completedAt: new Date().toISOString(),
    },
    responseText.slice(0, 140),
  );
}

export function getRun(runId: string): CapabilityRun | undefined {
  return runs.find((r) => r.id === runId);
}

export function getRuns(): CapabilityRun[] {
  return runs;
}

export function useCapabilityRuns(): CapabilityRun[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => runs,
  );
}
