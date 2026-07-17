/** Geometry constants for the global top overlay (logical CSS pixels). */
export const OVERLAY_CAPSULE_WIDTH = 600;
export const OVERLAY_CAPSULE_HEIGHT = 88;
export const OVERLAY_SHADOW_GUTTER = 0;
export const OVERLAY_TOP_OFFSET = 16;
export const OVERLAY_WINDOW_WIDTH = OVERLAY_CAPSULE_WIDTH + OVERLAY_SHADOW_GUTTER * 2;
export const OVERLAY_WINDOW_HEIGHT = OVERLAY_CAPSULE_HEIGHT + OVERLAY_SHADOW_GUTTER;
export const OVERLAY_CORNER_RADIUS = 32;
export const OVERLAY_EXPANDED_MIN = 180;
export const OVERLAY_EXPANDED_TYPICAL = 280;
export const OVERLAY_EXPANDED_MAX = 460;

export type OverlayMode =
  | "hidden"
  | "entering"
  | "listening"
  | "thinking"
  | "responding"
  | "opening-app"
  | "opening-web"
  | "web-search"
  | "drafting-email"
  | "scheduling-meeting"
  | "creating-task"
  | "screen-context"
  | "confirmation"
  | "success"
  | "error"
  | "closing"
  | "clarifying";

export type OverlayPhase = "hidden" | "opening" | "visible" | "closing";

export type OverlayIntentKind =
  | "mention"
  | "open-desktop"
  | "open-web"
  | "web-search"
  | "api-action"
  | "local-action"
  | "clarify";

export interface OverlayError {
  code?: string;
  message: string;
}

export interface EmailDraftPayload {
  providerId: string;
  to: string;
  subject: string;
  body: string;
  tone?: string;
  contextUsed?: string;
  providerConnected: boolean;
}

export interface MeetingPayload {
  title: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  durationLabel: string;
  attendees: string[];
  location?: string;
  providerId: string;
  hasConflict?: boolean;
}

export interface TaskPayload {
  title: string;
  description?: string;
  dueLabel?: string;
  priority?: "low" | "medium" | "high";
  assignee?: string;
  project?: string;
  subtasks?: string[];
}

export interface ScreenContextPayload {
  previewDataUrl?: string;
  monitorLabel?: string;
  capturing: boolean;
  privacyNote: string;
}

export interface SuccessPayload {
  title: string;
  summary: string;
  destination?: string;
  openLabel?: string;
  openUrl?: string;
  applicationId?: string;
}

export interface ClarificationPayload {
  question: string;
  options: { id: string; label: string }[];
}

export type OverlayActionPayload =
  | { type: "email"; data: EmailDraftPayload }
  | { type: "meeting"; data: MeetingPayload }
  | { type: "task"; data: TaskPayload }
  | { type: "screen-context"; data: ScreenContextPayload }
  | { type: "success"; data: SuccessPayload }
  | { type: "clarification"; data: ClarificationPayload }
  | { type: "none" };

export interface OverlayState {
  mode: OverlayMode;
  phase: OverlayPhase;
  visible: boolean;
  expanded: boolean;
  title: string;
  status: string;
  applicationId?: string;
  applicationIcon?: string;
  transcript?: string;
  waveformLevels: number[];
  actionPayload?: OverlayActionPayload;
  requiresConfirmation: boolean;
  pendingConfirmAction?: "send-email" | "schedule-meeting" | "create-task" | "open-compose";
  result?: SuccessPayload;
  error?: OverlayError;
}

/** Maps overlay mode → orb/waveform visual variant. */
export type OrbVisualStatus =
  | "idle"
  | "listening"
  | "thinking"
  | "responding"
  | "success"
  | "error"
  | "cancelled"
  | "opening"
  | "confirmation";

export function modeToOrbStatus(mode: OverlayMode): OrbVisualStatus {
  switch (mode) {
    case "listening":
    case "entering":
      return "listening";
    case "thinking":
    case "clarifying":
      return "thinking";
    case "responding":
      return "responding";
    case "opening-app":
    case "opening-web":
    case "web-search":
    case "drafting-email":
    case "scheduling-meeting":
    case "creating-task":
    case "screen-context":
      return "opening";
    case "confirmation":
      return "confirmation";
    case "success":
      return "success";
    case "error":
      return "error";
    case "closing":
    case "hidden":
      return "idle";
    default:
      return "idle";
  }
}

export function statusColorClass(mode: OverlayMode): string {
  switch (mode) {
    case "listening":
    case "responding":
      return "status-listening";
    case "thinking":
      return "status-thinking";
    case "opening-app":
    case "opening-web":
    case "web-search":
    case "drafting-email":
    case "scheduling-meeting":
    case "creating-task":
    case "screen-context":
      return "status-working";
    case "success":
      return "status-success";
    case "error":
      return "status-error";
    case "confirmation":
    case "clarifying":
      return "status-neutral";
    default:
      return "status-neutral";
  }
}
