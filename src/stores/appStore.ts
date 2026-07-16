/**
 * Application-level UI state for the main Command Center window: active
 * page, task filter handoff, command palette visibility, profile name and
 * the local activity log (persisted).
 */
import { useSyncExternalStore } from "react";
import type { TaskFilter } from "./taskStore";

export type MainPage = "dashboard" | "tasks" | "agent" | "connect";

export interface ActivityEntry {
  id: string;
  text: string;
  source: "command" | "voice" | "task" | "agent" | "system";
  at: number;
}

interface AppState {
  page: MainPage;
  taskFilter: TaskFilter;
  paletteOpen: boolean;
  /** Development default profile; a real profile arrives in a later phase. */
  profileName: string;
  activity: ActivityEntry[];
}

const ACTIVITY_KEY = "arcsonare.activity.v1";

function loadActivity(): ActivityEntry[] {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY);
    if (raw) return JSON.parse(raw) as ActivityEntry[];
  } catch (err) {
    console.error("[ArcSonare] failed to load activity:", err);
  }
  return [];
}

let state: AppState = {
  page: "dashboard",
  taskFilter: "all",
  paletteOpen: false,
  profileName: "Robera",
  activity: loadActivity(),
};

const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function navigate(page: MainPage, opts?: { taskFilter?: TaskFilter }) {
  set({ page, ...(opts?.taskFilter ? { taskFilter: opts.taskFilter } : {}) });
}

export function setTaskFilter(taskFilter: TaskFilter) {
  set({ taskFilter });
}

export function openPalette() {
  set({ paletteOpen: true });
}

export function closePalette() {
  set({ paletteOpen: false });
}

export function addActivity(text: string, source: ActivityEntry["source"]) {
  const entry: ActivityEntry = {
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    source,
    at: Date.now(),
  };
  const activity = [entry, ...state.activity].slice(0, 50);
  try {
    window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
  } catch (err) {
    console.error("[ArcSonare] failed to persist activity:", err);
  }
  set({ activity });
}

export function useAppState(): AppState {
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
