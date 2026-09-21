/**
 * Meeting Intelligence — core TypeScript types.
 *
 * Mirrors the Rust model in src-tauri/src/meeting/model.rs.
 * Rust is the authority for persistence; these interfaces let the UI and
 * detection service read/write without re-deriving from raw JSON.
 *
 * Owned by Agent 3. Do not modify from other agents.
 */

// ---------------------------------------------------------------------------
// Lifecycle states
// ---------------------------------------------------------------------------

export type MeetingState =
  | "idle"
  | "detected"
  | "awaiting-permission"
  | "notes-active"
  | "recording-active"
  | "paused"
  | "processing"
  | "completed"
  | "ignored"
  | "permission-denied"
  | "capture-error"
  | "transcription-error"
  | "cancelled";

// ---------------------------------------------------------------------------
// Detection confidence levels
// ---------------------------------------------------------------------------

export type MeetingConfidence = "possible" | "likely" | "confirmed";

// ---------------------------------------------------------------------------
// Capture and transcription modes
// ---------------------------------------------------------------------------

export type CaptureMode = "none" | "notes-only" | "microphone" | "system-audio" | "mixed";

export type TranscriptionMode = "none" | "openai-whisper" | "local-whisper" | "manual";

export type ConsentState = "unknown" | "pending" | "granted-notes" | "granted-recording" | "denied" | "revoked";

// ---------------------------------------------------------------------------
// Source platforms
// ---------------------------------------------------------------------------

export type MeetingSourceId =
  | "zoom"
  | "teams"
  | "google-meet"
  | "webex"
  | "discord"
  | "slack"
  | "generic-browser"
  | "manual";

// ---------------------------------------------------------------------------
// Core meeting session
// ---------------------------------------------------------------------------

export interface MeetingSession {
  id: string;
  accountId: string;
  conversationId?: string;

  /** Which platform / detector created this session. */
  source: MeetingSourceId;
  /** Human-readable application name e.g. "Zoom" */
  sourceApplication: string;
  /** Instance key from the Watch system, if available. */
  sourceInstanceId?: string;
  /** Window title / meeting room name, when available and consented. */
  meetingTitle?: string;

  organizer?: string;
  participants?: string[];

  startedAt: string;     // ISO-8601
  endedAt?: string;      // ISO-8601

  state: MeetingState;
  captureMode: CaptureMode;
  transcriptionMode: TranscriptionMode;
  language?: string;
  consentState: ConsentState;

  /** Reference to an audio artifact on disk, if recording is stored. */
  audioArtifactId?: string;
  transcriptId?: string;
  summaryId?: string;

  /** Deduplication key — same (source + instanceId + day). */
  deduplicationKey: string;

  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Transcript segments
// ---------------------------------------------------------------------------

export interface MeetingTranscriptSegment {
  id: string;
  meetingId: string;
  speakerId?: string;
  speakerLabel?: string;
  /** Milliseconds from meeting start. */
  startedAtMs: number;
  endedAtMs: number;
  text: string;
  confidence?: number;
  /** Whether this segment has been confirmed final (no further updates). */
  isFinal: boolean;
}

// ---------------------------------------------------------------------------
// Summary and extraction
// ---------------------------------------------------------------------------

export interface MeetingActionItem {
  id: string;
  meetingId: string;
  text: string;
  owner?: string;
  dueDate?: string;
  /** 0..1 — how certain the extraction is. */
  confidence: number;
  /** Which transcript segment IDs support this item. */
  sourceSegmentIds: string[];
  /** If converted to an ArcSonare task, the task id. */
  taskId?: string;
  status: "pending" | "accepted" | "dismissed" | "created-task";
}

export interface MeetingDecision {
  id: string;
  meetingId: string;
  text: string;
  confidence: number;
  sourceSegmentIds: string[];
  uncertain: boolean;
}

export interface MeetingQuestion {
  id: string;
  meetingId: string;
  text: string;
  answeredInMeeting: boolean;
}

export interface MeetingSummary {
  meetingId: string;
  title: string;
  overview: string;
  decisions: MeetingDecision[];
  actionItems: MeetingActionItem[];
  questions: MeetingQuestion[];
  followUps: string[];
  risks: string[];
  topics: string[];
  /** Mentioned people, not assumed to be attendees. */
  mentionedPeople: string[];
  /** Mentioned projects/products. */
  mentionedProjects: string[];
  generatedAt: string;
  modelProvenance: string;
}

// ---------------------------------------------------------------------------
// Searchable memory record
// ---------------------------------------------------------------------------

export interface MeetingMemory {
  meetingId: string;
  searchableText: string;
  entities: string[];
  topics: string[];
  decisions: string[];
  actionItems: string[];
}

// ---------------------------------------------------------------------------
// Detection candidate (pre-session, used by detectors)
// ---------------------------------------------------------------------------

export interface MeetingCandidate {
  id: string;
  source: MeetingSourceId;
  sourceApplication: string;
  sourceInstanceId?: string;
  meetingTitle?: string;
  confidence: MeetingConfidence;
  /** Signals that contributed to this candidate. */
  evidenceCategories: string[];
  canCaptureAudio: boolean;
  canTranscribe: boolean;
  requiresUserPermission: boolean;
  detectedAt: number;  // Date.now()
  /** Dedup key to prevent re-notifying for the same meeting. */
  deduplicationKey: string;
}

// ---------------------------------------------------------------------------
// Tauri IPC payloads (meeting commands)
// ---------------------------------------------------------------------------

export interface MeetingSessionRow {
  id: string;
  accountId: string;
  conversationId?: string;
  source: MeetingSourceId;
  sourceApplication: string;
  sourceInstanceId?: string;
  meetingTitle?: string;
  organizer?: string;
  participants?: string[];
  startedAt: string;
  endedAt?: string;
  state: MeetingState;
  captureMode: CaptureMode;
  transcriptionMode: TranscriptionMode;
  language?: string;
  consentState: ConsentState;
  audioArtifactId?: string;
  transcriptId?: string;
  summaryId?: string;
  deduplicationKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingTranscriptSegmentRow {
  id: string;
  meetingId: string;
  speakerId?: string;
  speakerLabel?: string;
  startedAtMs: number;
  endedAtMs: number;
  text: string;
  confidence?: number;
  isFinal: boolean;
}

// ---------------------------------------------------------------------------
// Meeting detection events (emitted via Tauri event bus)
// ---------------------------------------------------------------------------

export type MeetingEventKind =
  | "meeting-detected"
  | "meeting-state-changed"
  | "meeting-ended"
  | "transcript-segment-ready"
  | "summary-ready"
  | "action-items-ready";

export interface MeetingEvent {
  kind: MeetingEventKind;
  meetingId?: string;
  state?: MeetingState;
  at: string;
}

export const MEETING_EVENT = "arcsonare://meeting-event";

// ---------------------------------------------------------------------------
// Settings schema extension (added to Prefs)
// ---------------------------------------------------------------------------

export type MeetingDefaultMode = "ask" | "notes-only" | "record-and-transcribe" | "ignore";
export type MeetingTranscriptionProvider = "none" | "openai-whisper" | "local-whisper";
export type MeetingRetentionPeriod = "session" | "7d" | "30d" | "90d" | "forever";

export interface MeetingPrefs {
  /** Master switch — detection runs only when true. */
  detectionEnabled: boolean;
  /** Which sources to detect. */
  enabledSources: MeetingSourceId[];
  /** Always show the consent prompt before any capture. */
  alwaysAsk: boolean;
  /** What to do by default when alwaysAsk is false. */
  defaultMode: MeetingDefaultMode;
  transcriptionProvider: MeetingTranscriptionProvider;
  localOnlyTranscription: boolean;
  storeRawAudio: boolean;
  deleteAudioAfterTranscription: boolean;
  meetingLanguage: string;
  automaticSummary: boolean;
  automaticActionItemExtraction: boolean;
  /** Off by default — creating tasks from meetings is a deliberate act. */
  automaticTaskCreation: boolean;
  desktopNotifications: boolean;
  recordingIndicator: boolean;
  retentionPeriod: MeetingRetentionPeriod;
  /** User must confirm consent for each recording. */
  requireConsentConfirmation: boolean;
  /** Show a privacy reminder before each recording starts. */
  showPrivacyReminder: boolean;
}

export const DEFAULT_MEETING_PREFS: MeetingPrefs = {
  detectionEnabled: true,
  enabledSources: ["zoom", "teams", "google-meet", "webex", "discord", "slack", "generic-browser", "manual"],
  alwaysAsk: true,
  defaultMode: "ask",
  transcriptionProvider: "none",
  localOnlyTranscription: false,
  storeRawAudio: false,
  deleteAudioAfterTranscription: true,
  meetingLanguage: "auto",
  automaticSummary: true,
  automaticActionItemExtraction: true,
  automaticTaskCreation: false,
  desktopNotifications: true,
  recordingIndicator: true,
  retentionPeriod: "30d",
  requireConsentConfirmation: true,
  showPrivacyReminder: true,
};

// ---------------------------------------------------------------------------
// Platform display metadata
// ---------------------------------------------------------------------------

export interface MeetingPlatformInfo {
  id: MeetingSourceId;
  displayName: string;
  /** Whether detection is implemented and active. */
  detectionAvailable: boolean;
  /** Whether audio capture from this source is implemented. */
  audioCaptureAvailable: boolean;
  /** Whether transcription from this source works end-to-end. */
  transcriptionAvailable: boolean;
  /** Show in the platform icon row on the dashboard. */
  showOnDashboard: boolean;
}

export const MEETING_PLATFORMS: MeetingPlatformInfo[] = [
  {
    id: "zoom",
    displayName: "Zoom",
    detectionAvailable: true,
    audioCaptureAvailable: true,
    transcriptionAvailable: false, // requires transcription provider
    showOnDashboard: true,
  },
  {
    id: "google-meet",
    displayName: "Google Meet",
    detectionAvailable: true,
    audioCaptureAvailable: true,
    transcriptionAvailable: false,
    showOnDashboard: true,
  },
  {
    id: "teams",
    displayName: "Microsoft Teams",
    detectionAvailable: true,
    audioCaptureAvailable: true,
    transcriptionAvailable: false,
    showOnDashboard: true,
  },
  {
    id: "webex",
    displayName: "Webex",
    detectionAvailable: true,
    audioCaptureAvailable: true,
    transcriptionAvailable: false,
    showOnDashboard: true,
  },
  {
    id: "discord",
    displayName: "Discord",
    detectionAvailable: true,
    audioCaptureAvailable: true,
    transcriptionAvailable: false,
    showOnDashboard: false,
  },
  {
    id: "slack",
    displayName: "Slack Huddles",
    detectionAvailable: false, // huddle detection not yet implemented
    audioCaptureAvailable: false,
    transcriptionAvailable: false,
    showOnDashboard: false,
  },
  {
    id: "generic-browser",
    displayName: "Browser Meeting",
    detectionAvailable: true,
    audioCaptureAvailable: true,
    transcriptionAvailable: false,
    showOnDashboard: false,
  },
  {
    id: "manual",
    displayName: "Manual",
    detectionAvailable: true,
    audioCaptureAvailable: true,
    transcriptionAvailable: false,
    showOnDashboard: false,
  },
];
