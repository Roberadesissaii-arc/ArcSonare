/**
 * Meeting Detection Service.
 *
 * Consumes the public Watch system API (Agent B's store) to detect when the
 * user joins a meeting. Never modifies watchStore.ts or any Agent B file.
 *
 * Detection strategy:
 * 1. Listen to "arcsonare://watch-changed" via onWatchEvent().
 * 2. When an app-instance-started event fires for a known meeting app, run
 *    the appropriate platform detector.
 * 3. Poll candidate validity every 5 seconds (meeting might start mid-instance).
 * 4. When a candidate is confirmed, add it to meetingStore's pendingCandidates.
 * 5. Notify the user via native notification + in-app toast.
 *
 * Privacy guarantee:
 * - Detection uses only process presence and window title (when permitted).
 * - No audio is captured without explicit user consent.
 * - A meeting candidate does NOT automatically start a session.
 *
 * Owned by Agent 3.
 */

import { onWatchEvent, getWatchSnapshot, instancesOf } from "../watch/watchStore";
import type { WatchEvent, RunningAppInstance } from "../watch/watchTypes";
import type { MeetingCandidate, MeetingSourceId } from "./meetingTypes";
import {
  addPendingCandidate,
  getMeetingState,
} from "./meetingStore";
import {
  detectZoomMeeting,
  detectTeamsMeeting,
  detectGoogleMeetMeeting,
  detectWebexMeeting,
  detectDiscordVoice,
  detectGenericBrowserMeeting,
} from "./meetingDetectors/index";
import { sendMeetingDetectedNotification } from "./meetingNotifications";


const MEETING_INSTANCE_MAP: Record<string, MeetingSourceId> = {
  zoom: "zoom",
  teams: "teams",
  "google-meet": "google-meet",
  webex: "webex",
  discord: "discord",
  slack: "slack",
  chrome: "generic-browser",
  edge: "generic-browser",
  firefox: "generic-browser",
  brave: "generic-browser",
};

// ---------------------------------------------------------------------------
// Detector dispatch
// ---------------------------------------------------------------------------

type PlatformDetector = (instances: RunningAppInstance[]) => MeetingCandidate | null;

const DETECTORS: Record<string, PlatformDetector> = {
  zoom: detectZoomMeeting,
  teams: detectTeamsMeeting,
  "google-meet": detectGoogleMeetMeeting,
  webex: detectWebexMeeting,
  discord: detectDiscordVoice,
  chrome: detectGenericBrowserMeeting,
  edge: detectGenericBrowserMeeting,
  firefox: detectGenericBrowserMeeting,
  brave: detectGenericBrowserMeeting,
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

let isRunning = false;
let watchEventCleanup: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Recently emitted dedup keys, so we don't re-notify for the same session. */
const emittedKeys = new Set<string>();

// Cleared when a meeting ends or when the session is dismissed.
export function clearEmittedKey(deduplicationKey: string): void {
  emittedKeys.delete(deduplicationKey);
}

// ---------------------------------------------------------------------------
// Candidate evaluation
// ---------------------------------------------------------------------------

function evaluateApp(catalogId: string): void {
  const source = MEETING_INSTANCE_MAP[catalogId];
  if (!source) return;

  const detector = DETECTORS[catalogId];
  if (!detector) return;

  const instances = instancesOf(catalogId);
  if (instances.length === 0) return;

  const candidate = detector(instances);
  if (!candidate) return;

  // Already have this dedup key pending or active.
  if (emittedKeys.has(candidate.deduplicationKey)) return;
  const { pendingCandidates } = getMeetingState();
  if (pendingCandidates.some((c) => c.deduplicationKey === candidate.deduplicationKey)) return;

  emittedKeys.add(candidate.deduplicationKey);
  addPendingCandidate(candidate);
  void sendMeetingDetectedNotification(candidate);
}

function runAllDetectors(): void {
  const { running } = getWatchSnapshot();
  const catalogIds = [...new Set(running.map((i) => i.appCatalogId))];
  for (const id of catalogIds) {
    if (MEETING_INSTANCE_MAP[id]) {
      evaluateApp(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Handle Watch events
// ---------------------------------------------------------------------------

function onEvent(event: WatchEvent): void {
  const { kind, appCatalogId } = event;
  if (kind === "app-instance-started" && appCatalogId) {
    // Slight delay: the window title may not yet be populated by the OS.
    setTimeout(() => evaluateApp(appCatalogId), 1500);
  } else if (kind === "app-instance-stopped" && appCatalogId) {
    // Check if the active meeting is from this app; if so, trigger end detection.
    // (The actual end-of-meeting flow is managed separately in meetingLifecycle.ts)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startMeetingDetection(): void {
  if (isRunning) return;
  isRunning = true;

  // Subscribe to Watch events.
  watchEventCleanup = onWatchEvent(onEvent);

  // Run all detectors once immediately (catches already-running meetings).
  runAllDetectors();

  // Poll every 5 seconds for meetings that start while the app is idle.
  pollTimer = setInterval(runAllDetectors, 5_000);

  console.info("[ArcSonare] Meeting detection service started.");
}

export function stopMeetingDetection(): void {
  if (!isRunning) return;
  isRunning = false;

  if (watchEventCleanup) {
    watchEventCleanup();
    watchEventCleanup = null;
  }
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  console.info("[ArcSonare] Meeting detection service stopped.");
}

export function isMeetingDetectionRunning(): boolean {
  return isRunning;
}

// ---------------------------------------------------------------------------
// Account change handling (called from AppShell when auth changes)
// ---------------------------------------------------------------------------

export function onMeetingAccountChanged(): void {
  emittedKeys.clear();
  // Restart detection for new account context.
  if (isRunning) {
    stopMeetingDetection();
    startMeetingDetection();
  }
}
