/**
 * Meeting Intelligence store.
 *
 * Follows the watchStore.ts discipline exactly:
 * - Rust / Tauri commands are the authority for persistence.
 * - This module is a reactive in-memory cache.
 * - Mutations go through Tauri commands; the change event refreshes the cache.
 * - useSyncExternalStore keeps React up-to-date without a context.
 *
 * Events come from two sources:
 * 1. Tauri backend: "arcsonare://meeting-event" (state changes, summaries ready)
 * 2. meetingDetectionService: candidates discovered from Watch events
 *
 * Owned by Agent 3. Do not modify from other agents.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  MeetingSession,
  MeetingSessionRow,
  MeetingSummary,
  MeetingTranscriptSegment,
  MeetingTranscriptSegmentRow,
  MeetingCandidate,
  MeetingEvent,
  MeetingState,
  CaptureMode,
  ConsentState,
} from "./meetingTypes";
import { MEETING_EVENT } from "./meetingTypes";

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

interface MeetingStoreState {
  /** All sessions for the current account. */
  sessions: MeetingSession[];
  /** The active/most-recent in-progress session, if any. */
  activeMeeting: MeetingSession | null;
  /** Pending detection candidates waiting for user consent. */
  pendingCandidates: MeetingCandidate[];
  /** Current transcript segments for the active meeting. */
  activeTranscriptSegments: MeetingTranscriptSegment[];
  /** Summary for the most recently completed meeting. */
  latestSummary: MeetingSummary | null;
  /** Whether the store has hydrated from Rust. */
  hydrated: boolean;
  /** Whether backend meeting commands are available. */
  backendAvailable: boolean;
}

const EMPTY_STATE: MeetingStoreState = {
  sessions: [],
  activeMeeting: null,
  pendingCandidates: [],
  activeTranscriptSegments: [],
  latestSummary: null,
  hydrated: false,
  backendAvailable: false,
};

let state: MeetingStoreState = { ...EMPTY_STATE };

const listeners = new Set<() => void>();
const candidateListeners = new Set<(candidate: MeetingCandidate) => void>();
const eventListeners = new Set<(event: MeetingEvent) => void>();

let tauriListenerCleanup: (() => void) | null = null;
let hydratePromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Internal emit
// ---------------------------------------------------------------------------

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    void ensureInitialized();
  }
  return () => {
    listeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Row normalisation (Rust snake_case → camelCase is done by serde, but we
// need to ensure optional fields are present with sensible defaults)
// ---------------------------------------------------------------------------

function normalizeSession(row: MeetingSessionRow): MeetingSession {
  return {
    ...row,
    participants: row.participants ?? [],
    language: row.language ?? "auto",
  };
}

function normalizeSegment(row: MeetingTranscriptSegmentRow): MeetingTranscriptSegment {
  return {
    ...row,
    confidence: row.confidence ?? undefined,
    isFinal: row.isFinal ?? true,
  };
}

// ---------------------------------------------------------------------------
// Backend probe — gracefully handles the case where the meeting Rust module
// is not yet compiled (non-blocking; degrades to no-op).
// ---------------------------------------------------------------------------

async function probeBackend(): Promise<boolean> {
  try {
    await invoke("meeting_backend_available");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

async function hydrateOnce(): Promise<void> {
  const available = await probeBackend();
  if (!available) {
    state = {
      ...state,
      hydrated: true,
      backendAvailable: false,
    };
    emit();
    return;
  }

  try {
    const rows = await invoke<MeetingSessionRow[]>("meeting_sessions_list");
    const sessions = rows.map(normalizeSession);
    const active = sessions.find(
      (s) =>
        s.state === "notes-active" ||
        s.state === "recording-active" ||
        s.state === "detected" ||
        s.state === "awaiting-permission" ||
        s.state === "processing",
    ) ?? null;

    state = {
      ...state,
      sessions,
      activeMeeting: active,
      hydrated: true,
      backendAvailable: true,
    };
    emit();
  } catch (err) {
    console.error("[ArcSonare] meeting store hydration failed:", err);
    state = {
      ...state,
      hydrated: true,
      backendAvailable: false,
    };
    emit();
  }
}

async function ensureInitialized(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    await hydrateOnce();
    await installTauriListener();
  })();
  return hydratePromise;
}

// ---------------------------------------------------------------------------
// Tauri event listener
// ---------------------------------------------------------------------------

async function installTauriListener(): Promise<void> {
  if (tauriListenerCleanup) return;
  try {
    const unlisten = await listen<MeetingEvent>(MEETING_EVENT, (event) => {
      eventListeners.forEach((l) => l(event.payload));
      // Refresh on any meeting change event.
      void refresh();
    });
    tauriListenerCleanup = () => unlisten();
  } catch (err) {
    console.warn("[ArcSonare] meeting event listener could not be installed:", err);
  }
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<void> | null = null;
let refreshAgain = false;

async function refresh(): Promise<void> {
  if (refreshInFlight) {
    refreshAgain = true;
    return;
  }
  refreshInFlight = (async () => {
    try {
      do {
        refreshAgain = false;
        await hydrateOnce();
      } while (refreshAgain);
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Candidate management (from meetingDetectionService, pure frontend)
// ---------------------------------------------------------------------------

export function addPendingCandidate(candidate: MeetingCandidate): void {
  // Don't add the same dedup key twice.
  const already = state.pendingCandidates.find(
    (c) => c.deduplicationKey === candidate.deduplicationKey,
  );
  if (already) return;
  state = {
    ...state,
    pendingCandidates: [...state.pendingCandidates, candidate],
  };
  emit();
  candidateListeners.forEach((l) => l(candidate));
}

export function removePendingCandidate(candidateId: string): void {
  state = {
    ...state,
    pendingCandidates: state.pendingCandidates.filter((c) => c.id !== candidateId),
  };
  emit();
}

export function clearPendingCandidates(): void {
  state = { ...state, pendingCandidates: [] };
  emit();
}

// ---------------------------------------------------------------------------
// Transcript updates (called by meetingAudioCapture)
// ---------------------------------------------------------------------------

export function appendTranscriptSegment(segment: MeetingTranscriptSegment): void {
  state = {
    ...state,
    activeTranscriptSegments: [...state.activeTranscriptSegments, segment],
  };
  emit();
}

export function updateTranscriptSegment(segment: MeetingTranscriptSegment): void {
  state = {
    ...state,
    activeTranscriptSegments: state.activeTranscriptSegments.map((s) =>
      s.id === segment.id ? segment : s,
    ),
  };
  emit();
}

export function clearActiveTranscript(): void {
  state = { ...state, activeTranscriptSegments: [] };
  emit();
}

// ---------------------------------------------------------------------------
// Session lifecycle commands (invoke Tauri)
// ---------------------------------------------------------------------------

export async function meetingStart(candidateId: string): Promise<MeetingSession | null> {
  const candidate = state.pendingCandidates.find((c) => c.id === candidateId);
  if (!candidate) return null;

  try {
    const row = await invoke<MeetingSessionRow>("meeting_session_create", {
      source: candidate.source,
      sourceApplication: candidate.sourceApplication,
      sourceInstanceId: candidate.sourceInstanceId,
      meetingTitle: candidate.meetingTitle,
      captureMode: "notes-only",
      consentState: "granted-notes",
    });
    const session = normalizeSession(row);
    removePendingCandidate(candidateId);
    void refresh();
    return session;
  } catch (err) {
    console.error("[ArcSonare] meeting_session_create failed:", err);
    return null;
  }
}

export async function meetingStartRecording(
  sessionId: string,
  captureMode: CaptureMode,
): Promise<void> {
  try {
    await invoke("meeting_session_start_recording", { sessionId, captureMode });
    void refresh();
  } catch (err) {
    console.error("[ArcSonare] meeting_session_start_recording failed:", err);
  }
}

export async function meetingPauseRecording(sessionId: string): Promise<void> {
  try {
    await invoke("meeting_session_update_state", { sessionId, state: "paused" });
    void refresh();
  } catch (err) {
    console.error("[ArcSonare] meeting pause failed:", err);
  }
}

export async function meetingEnd(sessionId: string): Promise<void> {
  try {
    await invoke("meeting_session_end", { sessionId });
    void refresh();
  } catch (err) {
    console.error("[ArcSonare] meeting_session_end failed:", err);
  }
}

export async function meetingIgnore(candidateId: string): Promise<void> {
  removePendingCandidate(candidateId);
}

export async function meetingSetConsent(
  sessionId: string,
  consentState: ConsentState,
): Promise<void> {
  try {
    await invoke("meeting_session_update_state", {
      sessionId,
      state: consentState === "denied" ? "permission-denied" : "notes-active" as MeetingState,
    });
    void refresh();
  } catch (err) {
    console.error("[ArcSonare] meeting consent update failed:", err);
  }
}

export async function loadMeetingSessions(limit = 50): Promise<MeetingSession[]> {
  try {
    const rows = await invoke<MeetingSessionRow[]>("meeting_sessions_list", { limit });
    return rows.map(normalizeSession);
  } catch {
    return [];
  }
}

export async function loadMeetingTranscript(
  meetingId: string,
): Promise<MeetingTranscriptSegment[]> {
  try {
    const rows = await invoke<MeetingTranscriptSegmentRow[]>("meeting_transcript_list", {
      meetingId,
    });
    return rows.map(normalizeSegment);
  } catch {
    return [];
  }
}

export async function loadMeetingSummary(
  meetingId: string,
): Promise<MeetingSummary | null> {
  try {
    return await invoke<MeetingSummary | null>("meeting_summary_get", { meetingId });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public subscriptions
// ---------------------------------------------------------------------------

export function onMeetingEvent(cb: (event: MeetingEvent) => void): () => void {
  eventListeners.add(cb);
  return () => eventListeners.delete(cb);
}

export function onNewCandidate(cb: (candidate: MeetingCandidate) => void): () => void {
  candidateListeners.add(cb);
  return () => candidateListeners.delete(cb);
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export function getMeetingState(): MeetingStoreState {
  return state;
}

export function isMeetingStoreHydrated(): boolean {
  return state.hydrated;
}

export function useMeetingState(): MeetingStoreState {
  return useSyncExternalStore(subscribe, getMeetingState, getMeetingState);
}

export function useActiveMeeting(): MeetingSession | null {
  const s = useMeetingState();
  return s.activeMeeting;
}

export function usePendingCandidates(): MeetingCandidate[] {
  const s = useMeetingState();
  return s.pendingCandidates;
}

export function useRecentMeetings(count = 5): MeetingSession[] {
  const s = useMeetingState();
  return s.sessions
    .filter((m) => m.state === "completed")
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, count);
}

export function useMeetingBackendAvailable(): boolean {
  const s = useMeetingState();
  return s.backendAvailable;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function destroyMeetingStore(): void {
  if (tauriListenerCleanup) {
    tauriListenerCleanup();
    tauriListenerCleanup = null;
  }
  hydratePromise = null;
  state = { ...EMPTY_STATE };
  emit();
}
