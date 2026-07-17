import type { DataCategoryId } from "./dataPrivacyTypes";
import type { DataRetention, RetentionDataType } from "../../config/prefs";

export interface UsageCategoryDef {
  id: DataCategoryId;
  displayName: string;
  description: string;
  tone: "violet" | "blue" | "cyan" | "deep" | "muted";
  clearable: boolean;
  exportable: boolean;
  sensitive: boolean;
}

export const USAGE_CATEGORIES: UsageCategoryDef[] = [
  {
    id: "screen-captures",
    displayName: "Screen captures & annotations",
    description: "Confirmed screenshots, annotations, and capture metadata.",
    tone: "violet",
    clearable: true,
    exportable: true,
    sensitive: true,
  },
  {
    id: "voice-transcripts",
    displayName: "Voice transcripts & raw audio",
    description: "Saved transcripts and microphone recordings when enabled.",
    tone: "blue",
    clearable: true,
    exportable: true,
    sensitive: true,
  },
  {
    id: "activity-logs",
    displayName: "Activity & agent logs",
    description: "Commands, search, agent activity, and operational events.",
    tone: "cyan",
    clearable: true,
    exportable: true,
    sensitive: false,
  },
  {
    id: "model-cache",
    displayName: "Models & caches",
    description: "Local model files and temporary inference caches.",
    tone: "deep",
    clearable: true,
    exportable: false,
    sensitive: false,
  },
  {
    id: "other",
    displayName: "Other",
    description: "Preferences, small config files, and uncategorized data.",
    tone: "muted",
    clearable: false,
    exportable: true,
    sensitive: false,
  },
];

export const RETENTION_LABELS: Record<RetentionDataType, string> = {
  "voice-transcripts": "Voice transcripts",
  "raw-audio": "Raw microphone recordings",
  "screen-captures": "Screen captures",
  "screen-annotations": "Screen annotations",
  "agent-activity": "Agent activity",
  "search-history": "Search history",
  "command-history": "Command history",
};

export const RETENTION_DESCRIPTIONS: Record<RetentionDataType, string> = {
  "voice-transcripts": "How long saved transcripts stay on this device.",
  "raw-audio": "Microphone recordings after transcription (off by default).",
  "screen-captures": "Confirmed Screen Context captures.",
  "screen-annotations": "Annotation overlays saved with captures.",
  "agent-activity": "Operational agent events and approvals.",
  "search-history": "Local search queries.",
  "command-history": "Dashboard and overlay command history.",
};

export const RETENTION_OPTIONS: { value: DataRetention; label: string }[] = [
  { value: "never", label: "Never save" },
  { value: "after-processing", label: "Delete after processing" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "manual", label: "Keep until deleted" },
];

/** Options that make sense for raw audio. */
export const RAW_AUDIO_RETENTION: DataRetention[] = [
  "never",
  "after-processing",
  "1h",
  "1d",
  "7d",
];

export function retentionOptionsFor(
  id: RetentionDataType,
): { value: DataRetention; label: string }[] {
  if (id === "raw-audio") {
    return RETENTION_OPTIONS.filter((o) =>
      RAW_AUDIO_RETENTION.includes(o.value),
    );
  }
  return RETENTION_OPTIONS;
}
