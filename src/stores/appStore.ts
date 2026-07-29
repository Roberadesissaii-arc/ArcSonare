/**
 * Application-level UI state for the main Command Center window: active
 * page, task filter handoff, command palette visibility, profile name and
 * the local activity log (persisted).
 */
import { useSyncExternalStore } from "react";
import type { TaskFilter } from "./taskStore";

export type MainPage = "dashboard" | "tasks" | "agent" | "connect" | "settings";

export type SettingsSection =
  | "account"
  | "general"
  | "voice"
  | "models"
  | "shortcuts"
  | "appearance"
  | "sounds"
  | "notifications"
  | "data-privacy"
  | "integrations"
  | "about"
  | "voice-lab";

const SETTINGS_SECTIONS: SettingsSection[] = [
  "account",
  "general",
  "voice",
  "voice-lab",
  "models",
  "shortcuts",
  "appearance",
  "sounds",
  "notifications",
  "data-privacy",
  "integrations",
  "about",
];

const SECTION_KEY = "arcsonare.settingsSection.v1";

function loadSettingsSection(): SettingsSection {
  try {
    const raw = window.localStorage.getItem(SECTION_KEY);
    if (raw && SETTINGS_SECTIONS.includes(raw as SettingsSection)) {
      return raw as SettingsSection;
    }
  } catch {
    // localStorage unavailable — fall back to the first section.
  }
  return "account";
}

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
  /** Entries newer than this are unread in the notification popover. */
  notificationsReadAt: number;
  /** Last visited Settings section (persisted; the gear returns here). */
  settingsSection: SettingsSection;
  /** Main page that was active before entering Settings (for Back). */
  pageBeforeSettings: Exclude<MainPage, "settings">;
}

const ACTIVITY_KEY = "arcsonare.activity.v1";
const READ_AT_KEY = "arcsonare.notificationsReadAt.v1";

function loadReadAt(): number {
  try {
    const raw = window.localStorage.getItem(READ_AT_KEY);
    if (raw) return Number(raw) || 0;
  } catch (err) {
    console.error("[ArcSonare] failed to load notifications read state:", err);
  }
  return 0;
}

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
  profileName: "",
  activity: loadActivity(),
  notificationsReadAt: loadReadAt(),
  settingsSection: loadSettingsSection(),
  pageBeforeSettings: "dashboard",
};

const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function navigate(page: MainPage, opts?: { taskFilter?: TaskFilter }) {
  const remember =
    page === "settings" && state.page !== "settings"
      ? { pageBeforeSettings: state.page as Exclude<MainPage, "settings"> }
      : {};
  set({
    page,
    ...remember,
    ...(opts?.taskFilter ? { taskFilter: opts.taskFilter } : {}),
  });
}

/** Opens a specific Settings section (and remembers it as last visited). */
export function navigateSettings(section: SettingsSection) {
  try {
    window.localStorage.setItem(SECTION_KEY, section);
  } catch {
    // Persistence is best-effort.
  }
  const remember =
    state.page !== "settings"
      ? { pageBeforeSettings: state.page as Exclude<MainPage, "settings"> }
      : {};
  set({ page: "settings", settingsSection: section, ...remember });
}

/** Back action from Settings to the previously open main page. */
export function leaveSettings() {
  set({ page: state.pageBeforeSettings });
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

/** Updates the display name used by the Dashboard greeting. */
export function setProfileDisplayName(name: string) {
  const trimmed = name.trim();
  set({ profileName: trimmed });
}

export function markNotificationsRead() {
  const now = Date.now();
  try {
    window.localStorage.setItem(READ_AT_KEY, String(now));
  } catch (err) {
    console.error("[ArcSonare] failed to persist notifications read state:", err);
  }
  set({ notificationsReadAt: now });
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
