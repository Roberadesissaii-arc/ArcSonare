/**
 * Platform-specific meeting detectors.
 *
 * Each detector receives the live RunningAppInstance list for its catalog ID
 * and returns a MeetingCandidate if a meeting is detected, or null if not.
 *
 * Detectors use ONLY:
 * - executableName (process identity)
 * - windowTitle (only when available and consented at the OS level — the Watch
 *   system already filters this before exposing it to the frontend)
 * - state (running / minimized / stopped)
 *
 * No audio is involved here. Detectors only recognise, not capture.
 *
 * Owned by Agent 3.
 */

import type { RunningAppInstance } from "../../watch/watchTypes";
import type { MeetingCandidate, MeetingSourceId } from "../meetingTypes";
import { buildDeduplicationKey, newCandidateId } from "../meetingUtils";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function candidate(
  source: MeetingSourceId,
  sourceApplication: string,
  instance: RunningAppInstance,
  evidenceCategories: string[],
  meetingTitle?: string,
  confidence: MeetingCandidate["confidence"] = "likely",
): MeetingCandidate {
  const deduplicationKey = buildDeduplicationKey(source, instance.instanceKey);
  return {
    id: newCandidateId(),
    source,
    sourceApplication,
    sourceInstanceId: instance.instanceKey,
    meetingTitle,
    confidence,
    evidenceCategories,
    canCaptureAudio: true,
    canTranscribe: false,
    requiresUserPermission: true,
    detectedAt: Date.now(),
    deduplicationKey,
  };
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/**
 * Zoom meeting detection.
 *
 * A Zoom call is active when the "Zoom" process is running AND a window whose
 * title contains "Zoom Meeting" or "Zoom Webinar" is present. The meeting title
 * can be extracted from the window title.
 *
 * Zoom's main browser window title format: "Zoom Meeting - <Meeting Topic>"
 * or just "Zoom Meeting" when the topic is not set.
 */
export function detectZoomMeeting(
  instances: RunningAppInstance[],
): MeetingCandidate | null {
  // Must be running (not minimized would still be a meeting).
  const running = instances.filter((i) => i.state !== "stopped");
  if (running.length === 0) return null;

  // Check for a meeting window.
  for (const instance of running) {
    const title = (instance.windowTitle ?? "").toLowerCase();
    const evidence: string[] = ["process-running"];

    if (title.includes("zoom meeting") || title.includes("zoom webinar")) {
      evidence.push("window-title-match");
      const meetingTitle = extractZoomMeetingTitle(instance.windowTitle ?? "");
      return candidate("zoom", "Zoom", instance, evidence, meetingTitle, "confirmed");
    }

    // Zoom is running but no meeting window yet — might be in lobby.
    if (running.some((i) => (i.windowTitle ?? "").toLowerCase().includes("zoom"))) {
      evidence.push("app-running");
      return candidate("zoom", "Zoom", instance, evidence, undefined, "possible");
    }
  }
  return null;
}

function extractZoomMeetingTitle(windowTitle: string): string | undefined {
  // "Zoom Meeting - My Team Standup" → "My Team Standup"
  const match = windowTitle.match(/zoom (?:meeting|webinar)\s*[-–]\s*(.+)/i);
  return match?.[1]?.trim() ?? undefined;
}

// ---------------------------------------------------------------------------
// Microsoft Teams
// ---------------------------------------------------------------------------

/**
 * Teams meeting detection.
 *
 * A Teams call is active when the Teams process is running and its window
 * title indicates an active call. Teams titles during a call often contain
 * "Microsoft Teams" with clues like "Call" or "Meeting".
 */
export function detectTeamsMeeting(
  instances: RunningAppInstance[],
): MeetingCandidate | null {
  const running = instances.filter((i) => i.state !== "stopped");
  if (running.length === 0) return null;

  for (const instance of running) {
    const title = (instance.windowTitle ?? "").toLowerCase();
    const evidence: string[] = ["process-running"];

    if (
      title.includes("| microsoft teams") ||
      title.includes("microsoft teams") ||
      title.includes("call") ||
      title.includes("meeting")
    ) {
      evidence.push("window-title-match");
      const meetingTitle = extractTeamsMeetingTitle(instance.windowTitle ?? "");
      return candidate(
        "teams",
        "Microsoft Teams",
        instance,
        evidence,
        meetingTitle,
        title.includes("call") || title.includes("meeting") ? "likely" : "possible",
      );
    }
  }
  return null;
}

function extractTeamsMeetingTitle(windowTitle: string): string | undefined {
  // "Meeting with Alex | Microsoft Teams" → "Meeting with Alex"
  const match = windowTitle.match(/^(.+?)\s*\|\s*microsoft teams/i);
  return match?.[1]?.trim() ?? undefined;
}

// ---------------------------------------------------------------------------
// Google Meet
// ---------------------------------------------------------------------------

/**
 * Google Meet detection.
 *
 * Meet runs in a browser tab. The Watch catalog already identifies it by
 * title hint "meet.google" / "google meet". The instance's windowTitle will
 * contain the meeting name.
 */
export function detectGoogleMeetMeeting(
  instances: RunningAppInstance[],
): MeetingCandidate | null {
  const running = instances.filter((i) => i.state !== "stopped");
  if (running.length === 0) return null;

  for (const instance of running) {
    const title = (instance.windowTitle ?? "").toLowerCase();
    const evidence: string[] = ["process-running"];

    if (title.includes("meet.google") || title.includes("google meet") || title.includes("meet -")) {
      evidence.push("window-title-match", "browser-tab");
      const meetingTitle = extractMeetTitle(instance.windowTitle ?? "");
      return candidate(
        "google-meet",
        "Google Meet",
        instance,
        evidence,
        meetingTitle,
        "confirmed",
      );
    }
  }
  return null;
}

function extractMeetTitle(windowTitle: string): string | undefined {
  // "Meet - My Team Standup - Google Chrome" → "My Team Standup"
  // "Meet - Google Chrome" (when in lobby) → undefined
  const match = windowTitle.match(/meet\s*[-–]\s*(.+?)\s*[-–]\s*google/i);
  const result = match?.[1]?.trim();
  return result && result.toLowerCase() !== "google" ? result : undefined;
}

// ---------------------------------------------------------------------------
// Webex
// ---------------------------------------------------------------------------

/**
 * Webex detection.
 *
 * Cisco Webex can be a desktop app (webex.exe) or a browser meeting.
 * Desktop: process name "webex" or "ciscowebexstart".
 * Browser: title contains "Webex Meeting".
 */
export function detectWebexMeeting(
  instances: RunningAppInstance[],
): MeetingCandidate | null {
  const running = instances.filter((i) => i.state !== "stopped");
  if (running.length === 0) return null;

  for (const instance of running) {
    const title = (instance.windowTitle ?? "").toLowerCase();
    const exe = (instance.executableName ?? "").toLowerCase();
    const evidence: string[] = [];

    if (exe.includes("webex") || exe.includes("cisco")) {
      evidence.push("process-running");
    }
    if (title.includes("webex") || title.includes("cisco webex")) {
      evidence.push("window-title-match");
    }

    if (evidence.length >= 1) {
      const meetingTitle = extractWebexTitle(instance.windowTitle ?? "");
      return candidate(
        "webex",
        "Webex",
        instance,
        evidence,
        meetingTitle,
        evidence.length >= 2 ? "confirmed" : "likely",
      );
    }
  }
  return null;
}

function extractWebexTitle(windowTitle: string): string | undefined {
  // "Webex Meeting - Monthly Sync" → "Monthly Sync"
  const match = windowTitle.match(/webex (?:meeting|webinar|call)\s*[-–]\s*(.+)/i);
  return match?.[1]?.trim() ?? undefined;
}

// ---------------------------------------------------------------------------
// Discord voice channels
// ---------------------------------------------------------------------------

/**
 * Discord voice channel detection.
 *
 * Discord window title changes to "Discord" during a call and may include
 * server/channel information. The Discord adapter (Agent B) may have more
 * detail, but for meeting detection we only use the instance list.
 *
 * We mark these as "possible" since we cannot confirm audio without the adapter.
 */
export function detectDiscordVoice(
  instances: RunningAppInstance[],
): MeetingCandidate | null {
  const running = instances.filter((i) => i.state !== "stopped");
  if (running.length === 0) return null;

  for (const instance of running) {
    const title = (instance.windowTitle ?? "").toLowerCase();
    const evidence: string[] = ["process-running"];

    if (title.includes("discord")) {
      evidence.push("window-title-match");
      // We cannot confirm voice from title alone — require window focus/UIA data.
      return candidate("discord", "Discord", instance, evidence, undefined, "possible");
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generic browser meeting fallback
// ---------------------------------------------------------------------------

const GENERIC_MEETING_HINTS = [
  "zoom.us",
  "meet.google.com",
  "teams.microsoft.com",
  "webex.com",
  "whereby.com",
  "around.co",
  "gather.town",
  "jitsi.org",
  "daily.co",
  "loom.com",
  "bluejeans",
];

/**
 * Generic browser meeting detection.
 *
 * Catches meetings that don't match a known app — e.g. Whereby, Jitsi,
 * or company-hosted Zoom/Teams links.
 */
export function detectGenericBrowserMeeting(
  instances: RunningAppInstance[],
): MeetingCandidate | null {
  const running = instances.filter((i) => i.state !== "stopped");
  if (running.length === 0) return null;

  for (const instance of running) {
    const title = (instance.windowTitle ?? "").toLowerCase();
    const evidence: string[] = ["process-running"];

    const match = GENERIC_MEETING_HINTS.find((hint) => title.includes(hint));
    if (match) {
      evidence.push("url-hint", "browser-tab");
      return candidate(
        "generic-browser",
        "Browser Meeting",
        instance,
        evidence,
        extractBrowserMeetingTitle(instance.windowTitle ?? ""),
        "likely",
      );
    }
  }
  return null;
}

function extractBrowserMeetingTitle(windowTitle: string): string | undefined {
  // Remove browser name suffix: "My Meeting - Google Chrome" → "My Meeting"
  const match = windowTitle.match(/^(.+?)\s*[-–]\s*(?:google chrome|microsoft edge|mozilla firefox|brave|opera)/i);
  return match?.[1]?.trim() ?? undefined;
}
