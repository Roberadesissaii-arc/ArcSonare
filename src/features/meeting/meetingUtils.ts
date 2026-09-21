/**
 * Meeting utility functions.
 * Owned by Agent 3.
 */

import type { MeetingSourceId } from "./meetingTypes";

let candidateSeq = 0;

export function newCandidateId(): string {
  return `mc-${Date.now().toString(36)}-${(++candidateSeq).toString(36)}`;
}

export function buildDeduplicationKey(source: MeetingSourceId, instanceKey: string): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${source}:${instanceKey}:${day}`;
}

export function newSegmentId(): string {
  return `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newMeetingId(): string {
  return `mtg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatMeetingDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours > 0) {
    return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  }
  return minutes === 0 ? "< 1m" : `${minutes}m`;
}

export function relativeMeetingTime(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (diff < 60_000) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return new Date(startedAt).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function meetingSourceDisplayName(source: MeetingSourceId): string {
  const names: Record<MeetingSourceId, string> = {
    zoom: "Zoom",
    teams: "Microsoft Teams",
    "google-meet": "Google Meet",
    webex: "Webex",
    discord: "Discord",
    slack: "Slack",
    "generic-browser": "Browser Meeting",
    manual: "Manual Session",
  };
  return names[source] ?? source;
}
