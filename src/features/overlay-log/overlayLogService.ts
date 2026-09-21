/**
 * Overlay Log Service — Frontend bridge for recording overlay speech-to-speech turns and diagnostics.
 *
 * All IPC calls are non-blocking so logging failures never interrupt the user's overlay conversation.
 *
 * Owned by Agent 5.
 */

import { invoke } from "@tauri-apps/api/core";

export type OverlaySurface = "voice-overlay" | "main-window-voice" | "main-window-text";
export type OverlaySessionStatus = "active" | "completed" | "cancelled" | "interrupted" | "failed";
export type OverlayTurnStatus = "in-flight" | "completed" | "cancelled" | "failed" | "transcript-rejected";

export interface OverlayLogSettings {
  enabled: boolean;
  retentionDays: number;
  includeInterim: boolean;
  includeCapabilityTimeline: boolean;
  includeTechnicalDiagnostics: boolean;
  includeTypedChats: boolean;
  rawAudioEnabled: boolean;
  screenshotsEnabled: boolean;
}

export interface OverlayLogSummary {
  totalSessions: number;
  totalTurns: number;
  failedTurns: number;
  lastRecordedTurnMs?: number;
  storageSizeBytes: number;
  retentionDays: number;
  loggingEnabled: boolean;
}

export interface OverlayDiagnosticEvent {
  id: string;
  turnId: string;
  sessionId: string;
  timestampMs: number;
  eventType: string;
  safeMetadata: Record<string, unknown>;
}

export interface OverlayConversationTurn {
  id: string;
  sessionId: string;
  correlationId: string;
  startedAtMs: number;
  completedAtMs?: number;
  userTranscript?: string;
  assistantResponse?: string;
  status: OverlayTurnStatus;
  errorCode?: string;
  metadata: Record<string, unknown>;
  events: OverlayDiagnosticEvent[];
}

export interface OverlayConversationSession {
  id: string;
  accountId: string;
  conversationId?: string;
  startedAtMs: number;
  endedAtMs?: number;
  surface: OverlaySurface;
  status: OverlaySessionStatus;
  turnCount: number;
  firstUserTranscript?: string;
  hasError: boolean;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDetailView {
  session: OverlayConversationSession;
  turns: OverlayConversationTurn[];
}

export interface ExportRequest {
  format: "json" | "jsonl" | "markdown" | "zip";
  sessionIds?: string[];
  targetPath?: string;
}

export interface ExportResult {
  success: boolean;
  path: string;
  format: string;
  bytesWritten: number;
}

// Active session tracking across webview
let currentSessionId: string | null = null;
let currentTurnId: string | null = null;
let currentCorrelationId: string | null = null;
let sessionPromise: Promise<string | null> | null = null;
let turnPromise: Promise<string> | null = null;
let turnCounter = 0;

export function newCorrelationId(): string {
  turnCounter += 1;
  return `corr-${Date.now().toString(36)}-${turnCounter}`;
}

export function startOverlayLogSession(
  surface: OverlaySurface = "voice-overlay",
  conversationId?: string,
): Promise<string | null> {
  if (currentSessionId) return Promise.resolve(currentSessionId);
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    try {
      const session = await invoke<OverlayConversationSession>("overlay_log_session_start", {
        surface,
        conversationId,
      });
      currentSessionId = session.id;
      return session.id;
    } catch (err) {
      console.warn("[OverlayLog] Session start failed:", err);
      return null;
    } finally {
      sessionPromise = null;
    }
  })();

  return sessionPromise;
}

export async function endOverlayLogSession(
  status: OverlaySessionStatus = "completed",
): Promise<void> {
  if (sessionPromise) await sessionPromise;
  if (!currentSessionId) return;
  const sid = currentSessionId;
  currentSessionId = null;
  currentTurnId = null;
  try {
    await invoke("overlay_log_session_end", { sessionId: sid, status });
  } catch (err) {
    console.warn("[OverlayLog] Session end failed:", err);
  }
}

export function startOverlayLogTurn(
  userTranscript?: string,
  providedCorrelationId?: string,
): Promise<string> {
  const corrId = providedCorrelationId ?? currentCorrelationId ?? newCorrelationId();
  currentCorrelationId = corrId;

  turnPromise = (async () => {
    if (!currentSessionId) {
      await startOverlayLogSession("voice-overlay");
    }
    const sid = currentSessionId;
    if (!sid) return corrId;

    try {
      const turn = await invoke<OverlayConversationTurn>("overlay_log_turn_start", {
        sessionId: sid,
        correlationId: corrId,
        userTranscript: userTranscript ?? null,
      });
      currentTurnId = turn.id;
    } catch (err) {
      console.warn("[OverlayLog] Turn start failed:", err);
    }
    return corrId;
  })();

  return turnPromise;
}

export async function updateOverlayLogTurn(
  status: OverlayTurnStatus,
  userTranscript?: string,
  assistantResponse?: string,
  errorCode?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (turnPromise) await turnPromise;
  if (!currentTurnId) {
    // If no turn exists, start one now
    await startOverlayLogTurn(userTranscript);
  }
  if (!currentTurnId) return;
  const tid = currentTurnId;
  try {
    await invoke("overlay_log_turn_update", {
      turnId: tid,
      userTranscript: userTranscript ?? null,
      assistantResponse: assistantResponse ?? null,
      status,
      errorCode: errorCode ?? null,
      metadata: metadata ?? null,
    });
    if (status !== "in-flight") {
      currentTurnId = null;
    }
  } catch (err) {
    console.warn("[OverlayLog] Turn update failed:", err);
  }
}

export async function recordOverlayLogEvent(
  eventType: string,
  safeMetadata?: Record<string, unknown>,
): Promise<void> {
  if (sessionPromise) await sessionPromise;
  if (!currentSessionId) {
    await startOverlayLogSession("voice-overlay");
  }
  if (turnPromise) await turnPromise;
  if (!currentTurnId) {
    await startOverlayLogTurn();
  }
  if (!currentTurnId || !currentSessionId) return;
  const tid = currentTurnId;
  const sid = currentSessionId;
  try {
    await invoke("overlay_log_event_record", {
      turnId: tid,
      sessionId: sid,
      eventType,
      safeMetadata: safeMetadata ?? {},
    });
  } catch (err) {
    console.warn("[OverlayLog] Event record failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Convenient helper loggers
// ---------------------------------------------------------------------------

export function logOverlayOpened(): void {
  void recordOverlayLogEvent("overlay-opened");
}

export function logListeningStarted(): void {
  void recordOverlayLogEvent("listening-started");
}

export function logInterimTranscript(transcript: string): void {
  void recordOverlayLogEvent("interim-transcript", { transcript });
}

export function logFinalTranscript(transcript: string): void {
  void recordOverlayLogEvent("final-transcript", { transcript });
}

export function logTranscriptRejected(reason: string): void {
  void recordOverlayLogEvent("transcript-rejected", { reason });
  void updateOverlayLogTurn("transcript-rejected", undefined, undefined, reason);
}

export function logRequestCreated(query: string): void {
  void recordOverlayLogEvent("request-created", { query });
}

export function logPlanningStarted(): void {
  void recordOverlayLogEvent("planning-started");
}

export function logPlanSelected(capabilityOrIntent: string): void {
  void recordOverlayLogEvent("plan-selected", { capabilityOrIntent });
}

export function logCapabilityStarted(capabilityId: string): void {
  void recordOverlayLogEvent("capability-started", { capabilityId });
}

export function logCapabilityCompleted(
  capabilityId: string,
  durationMs?: number,
  sideEffectPossible = false,
): void {
  void recordOverlayLogEvent("capability-completed", {
    capabilityId,
    durationMs: durationMs ?? 0,
    sideEffectPossible,
    status: "success",
  });
}

export function logCapabilityFailed(
  capabilityId: string,
  errorCode: string,
  durationMs?: number,
): void {
  void recordOverlayLogEvent("capability-failed", {
    capabilityId,
    errorCode,
    durationMs: durationMs ?? 0,
    status: "failed",
  });
}

export function logApprovalRequested(action: string): void {
  void recordOverlayLogEvent("approval-requested", { action });
}

export function logApprovalGranted(action: string): void {
  void recordOverlayLogEvent("approval-granted", { action });
}

export function logApprovalRejected(action: string): void {
  void recordOverlayLogEvent("approval-rejected", { action });
}

export function logAssistantResponseStarted(): void {
  void recordOverlayLogEvent("assistant-response-started");
}

export function logAssistantResponseCompleted(response: string): void {
  void recordOverlayLogEvent("assistant-response-completed", { length: response.length });
  void updateOverlayLogTurn("completed", undefined, response);
}

export function logTtsStarted(playbackId?: string): void {
  void recordOverlayLogEvent("tts-started", { playbackId });
}

export function logTtsCompleted(playbackId?: string): void {
  void recordOverlayLogEvent("tts-completed", { playbackId });
}

export function logTtsFailed(playbackId?: string, error?: string): void {
  void recordOverlayLogEvent("tts-failed", { playbackId, error });
}

export function logTurnCancelled(reason?: string): void {
  void recordOverlayLogEvent("turn-cancelled", { reason });
  void updateOverlayLogTurn("cancelled", undefined, undefined, reason ?? "user-cancelled");
}

export function logOverlayClosed(): void {
  void recordOverlayLogEvent("overlay-closed");
  void endOverlayLogSession("completed");
}

// ---------------------------------------------------------------------------
// Querying & Management API
// ---------------------------------------------------------------------------

export function getOverlayLogSummary(): Promise<OverlayLogSummary> {
  return invoke<OverlayLogSummary>("overlay_log_get_summary");
}

export function getOverlayLogSettings(): Promise<OverlayLogSettings> {
  return invoke<OverlayLogSettings>("overlay_log_get_settings");
}

export function updateOverlayLogSettings(settings: OverlayLogSettings): Promise<void> {
  return invoke("overlay_log_update_settings", { settings });
}

export function listOverlayLogSessions(limit = 50): Promise<OverlayConversationSession[]> {
  return invoke<OverlayConversationSession[]>("overlay_log_sessions_list", { limit });
}

export function getOverlayLogSessionDetail(sessionId: string): Promise<SessionDetailView> {
  return invoke<SessionDetailView>("overlay_log_session_get", { sessionId });
}

export function deleteOverlayLogSession(sessionId: string): Promise<void> {
  return invoke("overlay_log_session_delete", { sessionId });
}

export function clearAllOverlayLogs(): Promise<void> {
  return invoke("overlay_log_clear_all");
}

export function exportOverlayLogs(request: ExportRequest): Promise<ExportResult> {
  return invoke<ExportResult>("overlay_log_export", { request });
}
