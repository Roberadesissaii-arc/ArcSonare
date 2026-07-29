/**
 * Center-stage view state for the Dashboard orbital workspace.
 */
import { useSyncExternalStore } from "react";

export type CenterStageView = "overview" | "active-work" | "review" | "chat";

export type CenterWorkKind =
  | "draft-email"
  | "summarize"
  | "find-insights"
  | "create-task"
  | "generic";

export interface CenterWorkState {
  kind: CenterWorkKind;
  title: string;
  status: string;
  step: string;
  progress: number;
  contextNote: string;
  resultReady: boolean;
  configRequired?: boolean;
  configMessage?: string;
  draft?: {
    to: string;
    subject: string;
    body: string;
    tone: string;
  };
}

interface CenterStageState {
  view: CenterStageView;
  work: CenterWorkState | null;
}

let state: CenterStageState = {
  view: "overview",
  work: null,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function getCenterStage(): CenterStageState {
  return state;
}

export function setCenterView(view: CenterStageView) {
  state = { ...state, view };
  notify();
}

export function startCenterWork(work: CenterWorkState) {
  state = { view: "active-work", work };
  notify();
}

export function setCenterWorkProgress(patch: Partial<CenterWorkState>) {
  if (!state.work) return;
  state = { ...state, work: { ...state.work, ...patch } };
  notify();
}

export function completeCenterWork(patch: Partial<CenterWorkState> = {}) {
  if (!state.work) return;
  state = {
    view: "review",
    work: { ...state.work, ...patch, resultReady: true, progress: 100 },
  };
  notify();
}

export function requireCenterConfig(message: string) {
  if (!state.work) return;
  state = {
    view: "review",
    work: {
      ...state.work,
      configRequired: true,
      configMessage: message,
      resultReady: false,
      progress: 100,
      status: "Configuration required",
    },
  };
  notify();
}

export function clearCenterWork() {
  state = { view: "overview", work: null };
  notify();
}

export function useCenterStage(): CenterStageState {
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
