/**
 * Meeting notification bridge.
 *
 * Sends native OS notifications for meeting detection events.
 * Uses tauri-plugin-notification (already installed and configured).
 *
 * Owned by Agent 3.
 */

import { invoke } from "@tauri-apps/api/core";
import type { MeetingCandidate } from "./meetingTypes";
import { meetingSourceDisplayName } from "./meetingUtils";

/**
 * Send a native Windows notification when a meeting is detected.
 *
 * The notification links back to ArcSonare so the user can open the
 * consent prompt. We use the existing send_test_notification command
 * rather than creating a new one, since it already does exactly this.
 */
export async function sendMeetingDetectedNotification(
  candidate: MeetingCandidate,
): Promise<void> {
  try {
    const platform = meetingSourceDisplayName(candidate.source);
    const title = candidate.meetingTitle
      ? `Meeting detected: ${candidate.meetingTitle}`
      : `${platform} meeting detected`;
    const body = "ArcSonare can take notes. Click to decide.";

    await invoke("send_test_notification", { title, body });
  } catch (err) {
    // Notifications are best-effort. The in-app toast is the primary channel.
    console.warn("[ArcSonare] meeting notification failed:", err);
  }
}

export async function sendMeetingEndedNotification(
  meetingTitle?: string,
  summary?: string,
): Promise<void> {
  try {
    const title = meetingTitle ? `Meeting ended: ${meetingTitle}` : "Meeting ended";
    const body = summary ?? "Your meeting notes are ready.";
    await invoke("send_test_notification", { title, body });
  } catch (err) {
    console.warn("[ArcSonare] meeting ended notification failed:", err);
  }
}
