/**
 * Drives the voice overlay from an OpenAI Realtime session.
 *
 * The model hears the microphone directly, decides which capability to call,
 * and speaks the answer. This module's only job is to keep the overlay's
 * visual state in step with the session and to shut the microphone down
 * cleanly when the overlay closes.
 */

import { getPrefs } from "../../stores/settingsStore";
import { getProfileName } from "../../stores/appStore";
import {
  connectedIntegrationsSummary,
  syncConnectionBrokerFromIntegrations,
} from "../../services/integrationStatusService";
import { buildRealtimeInstructions } from "../../services/realtime/realtimeInstructions";
import { watchContextForPrompt } from "../watch/watchPromptContext";
import { resolveRealtimeVoice } from "../../services/realtime/realtimeToolSchemas";
import {
  RealtimeSession,
  realtimeConfigured,
  type RealtimeStatus,
} from "../../services/realtime/RealtimeSession";
import { stopSpeechListening } from "../../services/SpeechRecognitionService";
import { characterById } from "../voice-settings/voiceCharacters";
import {
  setOverlayError,
  setOverlayMode,
  patchOverlay,
  clearOverlayError,
  getOverlayState,
} from "./overlayStore";
import {
  humanToolLabel,
  sanitizeStatusLine,
  sanitizeTranscript,
} from "./statusSanitize";

/** Lazily-imported so this module never delays startup. */
function log(): Promise<typeof import("../overlay-log/overlayLogService")> {
  return import("../overlay-log/overlayLogService");
}

/**
 * Guard against stale or cross-topic status lines (e.g. “11 folders” while the
 * user asked about Spotify). Loose heuristic only — never blocks normal replies.
 */
function isOffTopicStatus(status: string, userTranscript?: string): boolean {
  const s = status.toLowerCase();
  const u = (userTranscript ?? "").toLowerCase();
  if (!s || !u) return false;
  // Folder listing language when the user didn't ask about files/folders.
  if (
    /\b\d+\s+folders?\b/.test(s) ||
    /\bfolders?\b.*\b(found|listed|there are|there is)\b/.test(s) ||
    /\b(found|listed)\b.*\bfolders?\b/.test(s)
  ) {
    if (!/\b(folder|file|desktop|documents|directory|dir)\b/.test(u)) {
      return true;
    }
  }
  return false;
}

let session: RealtimeSession | null = null;
/**
 * The in-flight connect, if one is running.
 *
 * `session` is only assigned once `connect()` resolves, and connecting takes
 * seconds — an ephemeral token fetch plus WebRTC negotiation. Guarding on
 * `session` alone left that whole window open, so a second trigger (hotkey
 * pressed twice, hotkey plus a click) built a SECOND session with its own
 * audio track and two assistants talked over each other. Callers that arrive
 * mid-connect now wait for the first one instead of starting another.
 */
let connecting: Promise<RealtimeStart> | null = null;
/**
 * True from the moment we claim the mic for Realtime until the session is
 * torn down. Covers the connect gap where `session` is still null but local
 * STT must not start (it would race the voice path and overwrite the UI).
 */
let realtimeOwnsMic = false;
/** Accumulates transcript deltas so the capsule can show partial speech. */
let assistantText = "";
/** Full cleaned assistant reply for the expandable transcript panel. */
let assistantFull = "";
const ownershipListeners = new Set<() => void>();

function setRealtimeOwnsMic(on: boolean): void {
  if (realtimeOwnsMic === on) return;
  realtimeOwnsMic = on;
  ownershipListeners.forEach((l) => l());
}

/** True when OpenAI Realtime owns voice I/O — local STT must stay off. */
export function realtimeOverlayActive(): boolean {
  return session !== null || realtimeOwnsMic;
}

/** Subscribe to Realtime mic-ownership changes (for overlay STT gating). */
export function subscribeRealtimeOwnership(cb: () => void): () => void {
  ownershipListeners.add(cb);
  return () => {
    ownershipListeners.delete(cb);
  };
}

export function getRealtimeAssistantTranscript(): string {
  return assistantFull;
}

function formatNow(): { full: string; zone: string } {
  const now = new Date();
  return {
    full: now.toLocaleString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    zone:
      new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value ?? "local time",
  };
}

/** Map session state onto the overlay's existing visual modes. */
function applyStatus(status: RealtimeStatus): void {
  switch (status) {
    case "connecting":
      // Never open as "Thinking" — that looked broken when nothing was said yet.
      setOverlayMode("listening", {
        status: "Listening...",
        expanded: false,
        error: undefined,
        actionPayload: undefined,
      });
      return;
    case "listening": {
      // Back to listening after a spoken answer — show Listening (purple), not a
      // leftover tool label or a parallel text-path notice panel.
      const keepExpanded =
        getOverlayState().expanded && Boolean(getOverlayState().result);
      setOverlayMode("listening", {
        status: "Listening...",
        error: undefined,
        expanded: keepExpanded,
        // Drop connection/notice panels from the text path; keep transcript result.
        actionPayload: undefined,
        applicationId: undefined,
        applicationIcon: undefined,
      });
      return;
    }
    case "thinking":
      // Only after the user spoke or a tool is running.
      setOverlayMode("thinking", {
        status: "Thinking...",
        actionPayload: undefined,
        error: undefined,
      });
      return;
    case "speaking": {
      const line = sanitizeStatusLine(assistantText || assistantFull, "Responding...");
      setOverlayMode("responding", {
        status: line,
        error: undefined,
        actionPayload: undefined,
      });
      return;
    }
    default:
      return;
  }
}

/**
 * Start a Realtime conversation for the open overlay.
 * Returns false when Realtime is not usable, so the caller can fall back.
 */
/**
 * "started"      — Realtime owns the turn.
 * "unconfigured" — no OpenAI key; caller may fall back to the local path.
 * "failed"       — configured but the call could not be opened. The caller must
 *                  NOT fall through: doing so overwrote the error with
 *                  "Listening…", so a broken session looked like a silent mic.
 */
export type RealtimeStart = "started" | "unconfigured" | "failed";

export async function startRealtimeOverlaySession(): Promise<RealtimeStart> {
  if (session) return "started";
  if (connecting) return connecting;
  connecting = openRealtimeSession().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function openRealtimeSession(): Promise<RealtimeStart> {
  if (session) return "started";
  if (!(await realtimeConfigured())) return "unconfigured";

  // Claim the mic before connect so local STT cannot race us.
  setRealtimeOwnsMic(true);
  stopSpeechListening();

  // Keep ConnectionBroker in sync with live OAuth (local fallback paths).
  await syncConnectionBrokerFromIntegrations().catch(() => undefined);

  const { full, zone } = formatNow();
  const [integrations, watchedApps] = await Promise.all([
    connectedIntegrationsSummary().catch(
      () => "Integration status is unavailable right now.",
    ),
    // The same broker the main window uses. Passing "" asks for every live
    // watched application, because a voice session's instructions are built
    // once and must cover whatever the user says next.
    watchContextForPrompt("").catch(() => ""),
  ]);
  const character = characterById(getPrefs().voice.voiceId);

  const next = new RealtimeSession(
    buildRealtimeInstructions({
      datetime: full,
      zone,
      integrations,
      userName: getProfileName(),
      watchedApps,
    }),
    resolveRealtimeVoice(character.preferredProviderVoiceId),
    { origin: "voice" },
    {
      onStatus: applyStatus,
      onUserTranscript: (text, final) => {
        // New user turn: drop any stale result (old folder counts, etc.).
        if (!final) {
          patchOverlay({
            transcript: text,
            result: undefined,
            actionPayload: undefined,
          });
          // Log interim transcripts non-blocking.
          void log().then((m) => m.logInterimTranscript(text));
          return;
        }
        assistantText = "";
        assistantFull = "";
        // Begin a new logged turn for this user utterance (non-blocking).
        void log().then((m) => {
          void m.startOverlayLogTurn(text);
          m.logFinalTranscript(text);
        });
        setOverlayMode("thinking", {
          status: "Thinking...",
          transcript: text,
          result: undefined,
          actionPayload: undefined,
          error: undefined,
          expanded: false,
        });
      },
      onAssistantTranscript: (text, final) => {
        // Deltas arrive piecewise; the final event carries the whole line.
        const raw = final ? text : assistantText + text;
        assistantText = raw;
        const cleaned = sanitizeTranscript(raw);
        // Only the spoken reply belongs on the capsule — never a leftover tool dump.
        if (cleaned) assistantFull = cleaned;
        // Log the completed assistant response non-blocking.
        if (final && cleaned) {
          void log().then((m) => m.logAssistantResponseCompleted(cleaned));
        }
        const line = sanitizeStatusLine(cleaned || raw, "Responding...");
        // Reject off-topic capsule lines that clearly belong to another turn
        // (e.g. “11 folders” while the user asked about Spotify).
        const safeLine =
          isOffTopicStatus(line, getOverlayState().transcript) ? "Responding..." : line;
        setOverlayMode("responding", {
          status: safeLine,
          error: undefined,
          actionPayload: undefined,
          expanded: false,
          result:
            cleaned && !isOffTopicStatus(cleaned, getOverlayState().transcript)
              ? { title: cleaned, summary: "Tap status to expand" }
              : cleaned
                ? { title: cleaned, summary: "Tap status to expand" }
                : undefined,
        });
      },
      onToolResult: (capabilityId, display) => {
        clearOverlayError();
        // Log capability completion non-blocking (logged even for filesystem tools).
        void log().then((m) => m.logCapabilityCompleted(capabilityId));
        // Never put filesystem listing text on the capsule during voice.
        if (capabilityId.startsWith("filesystem.")) return;
        const mode = getOverlayState().mode;
        if (mode === "responding" || mode === "success") return;
        // Prefer short human label; ignore long display strings entirely.
        const label = humanToolLabel(capabilityId);
        if (display && display.length < 40 && !/\bfolders?\b/i.test(display)) {
          patchOverlay({ status: display, expanded: false, actionPayload: undefined });
          return;
        }
        patchOverlay({ status: label, expanded: false, actionPayload: undefined });
      },
      onError: (message) => {
        // Schema / tool-arg / transient noise must not kill the session or show
        // an error banner when the action actually succeeded.
        if (
          /invalid-arguments|invalid schema|tool call|function.?call|already|rate.?limit|cancellation/i.test(
            message,
          )
        ) {
          console.warn("[ArcSonare] Realtime tool noise (not shown):", message);
          return;
        }
        // Log hard errors non-blocking.
        void log().then((m) =>
          m.recordOverlayLogEvent("realtime-error", { message }),
        );
        setOverlayError({ message, code: "realtime" });
      },
    },
  );

  try {
    // Show listening immediately — never "Thinking" before the user speaks.
    setOverlayMode("listening", {
      status: "Listening...",
      expanded: false,
      error: undefined,
      actionPayload: undefined,
      result: undefined,
    });
    await next.connect();
    session = next;
    stopSpeechListening();
    setOverlayMode("listening", {
      status: "Listening...",
      error: undefined,
      actionPayload: undefined,
    });
    // Log successful WebRTC connect — the log session was already started by GlobalTopOverlay.
    void log().then((m) =>
      m.recordOverlayLogEvent("realtime-session-connected", { surface: "voice-overlay" }),
    );
    return "started";
  } catch (err) {
    next.close();
    session = null;
    setRealtimeOwnsMic(false);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ArcSonare] Realtime connect failed:", err);
    // Log connection failure non-blocking.
    void log().then((m) =>
      m.recordOverlayLogEvent("realtime-connect-failed", { message }),
    );
    setOverlayError({
      message: `Voice couldn't start: ${message}`,
      code: "realtime-connect",
    });
    return "failed";
  }
}

/** Tear the session down — always called when the overlay closes. */
export function stopRealtimeOverlaySession(): void {
  try {
    session?.close();
  } catch (err) {
    console.warn("[ArcSonare] stopRealtimeOverlaySession:", err);
  }
  session = null;
  setRealtimeOwnsMic(false);
  assistantText = "";
  assistantFull = "";
  // Hide any lingering purple pointer from a mid-click close.
  void import("../../services/agentPointer").then((m) => m.hideAgentPointer());
}

/** Feed a typed utterance into the live session (used by the test runner). */
export function sendRealtimeText(text: string): boolean {
  if (!session) return false;
  session.sendText(text);
  return true;
}
