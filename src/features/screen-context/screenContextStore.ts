/**
 * Screen Context frontend state: active status (synced from Rust), monitor
 * list and the capture → annotate flow. Context packages combine the Rust
 * capture metadata with locally stored annotation vectors.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPrefs } from "../../stores/settingsStore";
import { playEventSound } from "../../services/SoundService";
import { addActivity } from "../../stores/appStore";
import type { CaptureMeta, MonitorInfo, ScreenContextPackage } from "./types";

const PACKAGES_KEY = "arcsonare.screenContextPackages.v1";
export const PENDING_ANNOTATION_KEY = "arcsonare.annotate.pending.v1";

interface ScreenContextState {
  active: boolean;
  monitorIds: string[];
}

let state: ScreenContextState = { active: false, monitorIds: [] };
const listeners = new Set<() => void>();
let initialized = false;

function publish(next: ScreenContextState) {
  state = next;
  listeners.forEach((l) => l());
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  invoke<ScreenContextState>("screen_context_status")
    .then(publish)
    .catch(() => undefined);
  listen<ScreenContextState>("sonare:screen-context-changed", (event) => {
    publish(event.payload);
  }).catch((err) =>
    console.error("[ArcSonare] screen-context listener failed:", err),
  );
}

export function useScreenContext(): ScreenContextState {
  ensureInitialized();
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

export function getScreenContextState(): ScreenContextState {
  return state;
}

export async function listMonitors(): Promise<MonitorInfo[]> {
  return invoke<MonitorInfo[]>("list_monitors");
}

/** Resolves the monitor ids the edge indicator should cover. */
async function resolveIndicatorMonitors(): Promise<string[]> {
  const prefs = getPrefs().screenContext;
  const monitors = await listMonitors();
  switch (prefs.defaultTarget) {
    case "selected-monitor":
      return prefs.selectedMonitorIds.length > 0
        ? prefs.selectedMonitorIds.filter((id) => monitors.some((m) => m.id === id))
        : monitors.filter((m) => m.isPrimary).map((m) => m.id);
    case "all-monitors":
      return monitors.map((m) => m.id);
    case "primary-monitor":
      return monitors.filter((m) => m.isPrimary).map((m) => m.id);
    default: {
      // active-window / mouse-monitor / region: indicate the primary (or
      // selected) monitors — the true target is resolved at capture time.
      const selected = prefs.selectedMonitorIds.filter((id) =>
        monitors.some((m) => m.id === id),
      );
      if (selected.length > 0) return selected;
      return monitors.filter((m) => m.isPrimary).map((m) => m.id);
    }
  }
}

/** Starts Screen Context (edge indicators + active state). */
export async function startScreenContext(): Promise<void> {
  const ids = await resolveIndicatorMonitors();
  await invoke("start_screen_context", { monitorIds: ids });
  if (getPrefs().screenContext.playCaptureSound) {
    playEventSound("screen-context-start");
  }
  addActivity("Screen Context started", "system");
}

export async function stopScreenContext(): Promise<void> {
  await invoke("stop_screen_context");
  if (getPrefs().screenContext.playCaptureSound) {
    playEventSound("screen-context-stop");
  }
  addActivity("Screen Context stopped", "system");
}

export async function toggleScreenContext(): Promise<void> {
  if (state.active) await stopScreenContext();
  else await startScreenContext();
}

export interface CaptureFlowResult {
  meta: CaptureMeta;
}

/**
 * Captures the configured (or overridden) target. Returns the first capture
 * (multi-monitor targets return one per monitor; annotation uses the first).
 */
export async function captureTarget(
  override?: "active-window" | "mouse-monitor" | "region",
): Promise<CaptureMeta[]> {
  const prefs = getPrefs().screenContext;
  let target: string = override ?? prefs.defaultTarget;
  let monitorId: string | null = null;
  if (target === "region") {
    // Region selection happens in the annotation view over a full capture.
    target = "mouse-monitor";
  }
  if (target === "selected-monitor") {
    monitorId = prefs.selectedMonitorIds[0] ?? null;
    target = monitorId ? "monitor" : "primary-monitor";
  }
  const results = await invoke<{ meta: CaptureMeta }[]>("capture_screen", {
    target,
    monitorId,
  });
  if (prefs.playCaptureSound) playEventSound("screen-context-start");
  return results.map((r) => r.meta);
}

/** Opens the fullscreen annotation window for a capture. */
export async function openAnnotationFor(
  meta: CaptureMeta,
  mode: "annotate" | "region",
): Promise<void> {
  try {
    window.localStorage.setItem(
      PENDING_ANNOTATION_KEY,
      JSON.stringify({ captureId: meta.id, mode, at: Date.now() }),
    );
  } catch {
    // localStorage unavailable — the annotate window will show an error.
  }
  await invoke("open_annotation", {
    monitorId: meta.monitorIds[0] ?? null,
  });
}

/** Capture the configured target and immediately annotate it. */
export async function captureAndAnnotate(
  override?: "active-window" | "mouse-monitor" | "region",
): Promise<void> {
  const prefs = getPrefs().screenContext;
  if (prefs.requireConfirmation) {
    const ok = window.confirm(
      "Capture the selected screen and open annotation?",
    );
    if (!ok) return;
  }
  const metas = await captureTarget(override);
  if (metas.length > 0) {
    await openAnnotationFor(metas[0], override === "region" ? "region" : "annotate");
  }
}

function loadPackages(): ScreenContextPackage[] {
  try {
    const raw = window.localStorage.getItem(PACKAGES_KEY);
    if (raw) return JSON.parse(raw) as ScreenContextPackage[];
  } catch {
    // Corrupt or unavailable — start fresh.
  }
  return [];
}

export function listPackages(): ScreenContextPackage[] {
  return loadPackages();
}

export function savePackage(pkg: ScreenContextPackage) {
  const all = [pkg, ...loadPackages()].slice(0, 40);
  try {
    window.localStorage.setItem(PACKAGES_KEY, JSON.stringify(all));
  } catch (err) {
    console.error("[ArcSonare] failed to persist context package:", err);
  }
}

export function removePackage(id: string) {
  const all = loadPackages().filter((p) => p.id !== id);
  try {
    window.localStorage.setItem(PACKAGES_KEY, JSON.stringify(all));
  } catch {
    // Best-effort.
  }
}
