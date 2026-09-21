/**
 * Overlay action runners — honest success only after native confirmation.
 */
import { invoke } from "@tauri-apps/api/core";
import { getApplication } from "../../config/applicationRegistry";
import { getIconById } from "../../config/topOverlayIconRegistry";
import { getPrefs } from "../../stores/settingsStore";
import { speechRecognitionAvailable } from "../../services/SpeechRecognitionService";
import { getWebService } from "../../config/webServiceRegistry";
import { playEventSound } from "../../services/SoundService";
import {
  isSendConfirmUtterance,
  parseOverlayIntent,
  resolveDemoContact,
  type ParsedIntent,
} from "./iconResolver";

import { askAssistant, getAssistantRoute } from "../../services/AssistantService";
import { describeProviderError, errorText } from "../../services/providerErrors";
import {
  clipForError,
  playBuiltinVoice,
  stopBuiltinVoice,
} from "../../services/builtinVoice";
import { speak, stopSpeaking } from "../../services/SpeechService";
import {
  startRealtimeOverlaySession,
  stopRealtimeOverlaySession,
} from "./realtimeOverlay";
import { characterById } from "../voice-settings/voiceCharacters";
import {
  handleCapabilityRequest,
  resolvePendingConfirmation,
} from "../capabilities/capabilityEngine";
import { getIconById as getOverlayIcon } from "../../config/topOverlayIconRegistry";
import type {
  CapabilityConfirmation,
  ToolResult,
} from "../capabilities/capabilityTypes";
import { handleOrchestratedRequest } from "../orchestration/IntentOrchestrator";
import type {
  ConnectionAction,
  OrchestrationResult,
} from "../orchestration/IntentContract";
import { navigate } from "../../stores/appStore";
import {
  getOverlayState,
  patchOverlay,
  resetOverlay,
  setActionPayload,
  setApplicationContext,
  setOverlayError,
  setOverlayMode,
  setOverlaySuccess,
  setStatusText,
} from "./overlayStore";
import type {
  EmailDraftPayload,
  MeetingPayload,
  OverlayActionPayload,
  TaskPayload,
} from "./overlayTypes";
import { OVERLAY_EXPANDED_TYPICAL } from "./overlayTypes";

export interface OverlayActionResult {
  ok: boolean;
  action: string;
  target: string;
  method?: string;
  message: string;
}

let sessionTimers: number[] = [];
let demoActive = false;

/**
 * Bumped when the user taps the marble to barge in (listen now).
 * In-flight think/speak work checks this and yields if superseded.
 */
let listenEpoch = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isStale(epoch: number): boolean {
  return epoch !== listenEpoch;
}

/**
 * How long expanded panels stay readable before idle auto-close.
 * Panels carry lists and multi-line results, so they hold longer than a
 * one-line spoken answer.
 */
const RESULT_PANEL_HOLD_MS = 14_000;

/**
 * After an answer is spoken (or shown), keep the overlay visible this long
 * so the user can read it — then hide. Does **not** re-open the mic.
 * Press the activation shortcut again for another utterance.
 */
const POST_ANSWER_DISMISS_MS = 10_000;

/**
 * Speak overlay replies (voice conversations only).
 * Dashboard / typed chat must not call this.
 */
async function speakOverlayReply(text: string): Promise<void> {
  const epoch = listenEpoch;
  const trimmed = text.trim();
  if (!trimmed) return;
  const spoken =
    trimmed.length > 480 ? `${trimmed.slice(0, 480).trim()}…` : trimmed;
  try {
    const voice = characterById(getPrefs().voice.voiceId).preferredProviderVoiceId;
    const { speakWithTurnTaking } = await import("../../services/voiceSession");
    const { logTtsStarted, logTtsCompleted } = await import("../overlay-log/overlayLogService");
    logTtsStarted();
    await speakWithTurnTaking(spoken, () =>
      speak(spoken, { voice, shouldAbort: () => isStale(epoch) }),
    );
    logTtsCompleted();
  } catch (err) {
    import("../overlay-log/overlayLogService").then((m) => {
      m.logTtsFailed(undefined, String(err));
    });
    console.warn("[ArcSonare] overlay speech skipped:", err);
  }
}

/**
 * Present text, speak it, then hold the answer briefly and dismiss the overlay.
 * Mic does not reopen — one shortcut press = one listen → one answer.
 */
async function finishSpokenReply(
  text: string,
  opts?: { dismissAfterMs?: number },
) {
  const epoch = listenEpoch;
  playEventSound("responding");
  await speakOverlayReply(text);
  if (isStale(epoch)) return;
  scheduleOverlayAutoDismiss(opts?.dismissAfterMs ?? POST_ANSWER_DISMISS_MS);
}

/**
 * Tap the marble orb: stop speaking / abandon in-flight reply and listen now.
 * Keeps the result dropdown if one is open.
 */
export function activateOverlayListening() {
  const current = getOverlayState();
  if (
    current.mode === "hidden" ||
    current.mode === "closing" ||
    current.phase === "hidden" ||
    current.phase === "closing"
  ) {
    return;
  }

  listenEpoch += 1;
  stopSpeaking();
  clearSessionTimers();
  demoActive = false;

  // Interactive draft/confirm flows already accept speech — just cut TTS.
  if (
    current.mode === "confirmation" ||
    current.mode === "drafting-email" ||
    current.mode === "clarifying" ||
    current.mode === "scheduling-meeting" ||
    current.mode === "creating-task" ||
    current.requiresConfirmation
  ) {
    playEventSound("listening");
    return;
  }

  // Explicit re-listen (marble / barge-in): collapse leftover panels, open mic.
  void collapseOverlayWindow();
  setOverlayMode("listening", {
    status: "Listening...",
    expanded: false,
    transcript: "",
    requiresConfirmation: false,
    actionPayload: undefined,
    result: undefined,
    error: undefined,
  });
  playEventSound("listening");
}

function clearSessionTimers() {
  sessionTimers.forEach((t) => window.clearTimeout(t));
  sessionTimers = [];
}

function hasResultPanel(s: ReturnType<typeof getOverlayState>): boolean {
  return Boolean(s.expanded && (s.actionPayload || s.result || s.error));
}

/**
 * Modes that mean "we're done answering" and may auto-hide.
 * Interactive draft/confirm flows are excluded so the user can act.
 */
function isDismissibleAnswerMode(mode: string): boolean {
  return (
    mode === "success" ||
    mode === "responding" ||
    mode === "error" ||
    mode === "opening-app" ||
    mode === "opening-web" ||
    mode === "web-search"
  );
}

/**
 * Hold the answer on screen briefly, then close the overlay.
 * Never transitions back to listening — shortcut required for the next turn.
 */
function scheduleOverlayAutoDismiss(holdMs = POST_ANSWER_DISMISS_MS) {
  clearSessionTimers();
  const epoch = listenEpoch;
  sessionTimers.push(
    window.setTimeout(() => {
      if (isStale(epoch)) return;
      const s = getOverlayState();
      if (
        s.mode === "hidden" ||
        s.mode === "closing" ||
        s.mode === "listening" ||
        s.mode === "thinking" ||
        s.mode === "confirmation" ||
        s.mode === "clarifying" ||
        s.mode === "drafting-email" ||
        s.mode === "scheduling-meeting" ||
        s.mode === "creating-task" ||
        s.requiresConfirmation
      ) {
        return;
      }
      if (!isDismissibleAnswerMode(s.mode) && !hasResultPanel(s)) return;
      void invoke("request_close").catch((err) =>
        console.error("[ArcSonare] overlay auto-dismiss failed:", err),
      );
    }, holdMs),
  );
}

export const OVERLAY_COMMAND_EVENT = "sonare:overlay-command";

export async function resizeOverlayWindow(contentHeight: number) {
  try {
    await invoke("resize_overlay", { contentHeight });
  } catch (err) {
    console.error("[ArcSonare] resize_overlay failed:", err);
  }
}

export async function collapseOverlayWindow() {
  await resizeOverlayWindow(0);
}

export async function expandOverlayWindow(height = OVERLAY_EXPANDED_TYPICAL) {
  await resizeOverlayWindow(height);
}

/** Begin a listening session when the overlay opens. */
export async function startOverlaySession() {
  clearSessionTimers();

  try {
    const queued = await invoke<string | null>("overlay_take_pending_command");
    if (queued?.trim()) {
      demoActive = false;
      await commitOverlayTranscript(queued.trim());
      return;
    }
  } catch {
    // Pending-command command unavailable — fall through to listening.
  }

  // Realtime owns the whole turn when it is configured: the model hears the
  // mic itself, picks the capability, and speaks. Local STT + the deterministic
  // router only run when there is no Realtime session to hand off to.
  demoActive = false;
  // Sync Connect → ConnectionBroker before any path answers “is Gmail connected?”.
  void import("../../services/integrationStatusService").then((m) =>
    m.syncConnectionBrokerFromIntegrations().catch(() => undefined),
  );
  const realtime = await startRealtimeOverlaySession();
  if (realtime === "started") {
    sessionTimers = [];
    playEventSound("overlay-open");
    playEventSound("listening");
    return;
  }
  // Realtime needs only an OpenAI key — it does not use the chat model. Check
  // it BEFORE giving up: bailing on "no chat model" first meant a user with an
  // OpenAI key was told nothing was connected and voice never even tried.
  if (realtime === "unconfigured" && getAssistantRoute().provider === "none") {
    const epoch = listenEpoch;
    const message =
      "No OpenAI key yet. Open Settings → Voice & AI keys and save your OpenAI API key for voice.";
    setOverlayMode("error", { status: "Not connected", expanded: false });
    setOverlayError({ message, code: "no-model" });
    await expandOverlayWindow(220);
    await sleep(600);
    if (isStale(epoch) || getOverlayState().mode === "hidden") return;
    await playBuiltinVoice("no-provider");
    scheduleOverlayAutoDismiss(RESULT_PANEL_HOLD_MS);
    return;
  }

  if (realtime === "failed") {
    // Keep the reason on screen. Falling through to "Listening…" here hid
    // every connection failure behind a mic that silently never responded.
    await expandOverlayWindow(220);
    playEventSound("error");
    scheduleOverlayAutoDismiss(RESULT_PANEL_HOLD_MS);
    return;
  }

  demoActive = true;
  setOverlayMode("listening", {
    status: "Listening...",
    expanded: false,
    applicationId: undefined,
    applicationIcon: undefined,
    actionPayload: undefined,
    requiresConfirmation: false,
    error: undefined,
    result: undefined,
    transcript: "",
  });
  void collapseOverlayWindow();
  playEventSound("overlay-open");
  playEventSound("listening");

  // When local STT can hear the mic, stay in listening for real commands
  // (“open Spotify”). Otherwise run the visual demo progression.
  const prefs = getPrefs();
  const liveListen =
    prefs.voice.sttEngine === "local" && speechRecognitionAvailable();
  if (liveListen) {
    sessionTimers = [];
    return;
  }

  // Demo progression so every visual state remains exercisable without a mic.
  // Interrupted by cancel or by commitOverlayTranscript / runOverlayIntent.
  sessionTimers = [
    window.setTimeout(() => {
      if (!demoActive) return;
      setOverlayMode("thinking", { status: "Thinking..." });
      playEventSound("thinking");
    }, 4200),
    window.setTimeout(() => {
      if (!demoActive) return;
      void runDemoCycle();
    }, 6400),
  ];
}

async function runDemoCycle() {
  if (!demoActive) return;
  const demos: ParsedIntent[] = [
    { kind: "open", appId: "spotify", entry: getIconById("spotify")! },
  ];
  // Only auto-demo open if the icon resolved; otherwise show responding.
  const first = demos[0];
  if (first?.kind === "open" && first.entry) {
    // Keep listening/thinking/responding inspectable via Dev number keys;
    // auto-demo stays on responding with a short answer unless user drives it.
    setOverlayMode("responding", {
      status: "Responding...",
      applicationId: undefined,
      applicationIcon: undefined,
    });
    playEventSound("responding");
    sessionTimers.push(
      window.setTimeout(() => {
        if (!demoActive) return;
        setOverlaySuccess(
          {
            title: "Ready",
            summary: "Say “Open Spotify”, “Draft an email…”, or press 1–9 in dev.",
          },
          "Ready",
        );
        // Demo answer also dismisses — same one-shot flow as real replies.
        scheduleOverlayAutoDismiss(POST_ANSWER_DISMISS_MS);
      }, 2800),
    );
  }
}

export function cancelOverlaySession() {
  demoActive = false;
  listenEpoch += 1;
  stopSpeaking();
  stopBuiltinVoice();
  // Hard-stop Realtime speech immediately (must not keep talking after close).
  stopRealtimeOverlaySession();
  clearSessionTimers();
  void import("../../services/agentPointer").then((m) => m.hideAgentPointer());
  const mode = getOverlayState().mode;
  if (mode === "closing") {
    // Already mid-close / stuck on Cancelled — force the native hide now.
    void invoke("overlay_hidden");
    resetOverlay();
    return;
  }
  if (mode !== "hidden") {
    setStatusText("Cancelled");
    playEventSound("overlay-close");
  }
  patchOverlay({
    mode: "closing",
    requiresConfirmation: false,
  });
}

export function endOverlaySession() {
  demoActive = false;
  stopSpeaking();
  stopBuiltinVoice();
  stopRealtimeOverlaySession();
  clearSessionTimers();
  void import("../../services/agentPointer").then((m) => m.hideAgentPointer());
  void collapseOverlayWindow();
  resetOverlay();
}

// Run id of a capability run awaiting a spoken/clicked yes/no.
let pendingConfirmRunId: string | null = null;

const AFFIRM_RE = /^(?:yes|yeah|yep|confirm|do it|go ahead|okay|ok|sure|please do|move to (?:the )?recycle bin|recycle bin)\.?$/i;
const DENY_RE = /^(?:no|nope|cancel|stop|don'?t|nevermind|never mind|abort)\.?$/i;

/** Map a capability ToolResult/EngineOutcome onto overlay visual states. */
async function applyEngineOutcome(
  outcome: Awaited<ReturnType<typeof handleCapabilityRequest>>,
): Promise<void> {
  const epoch = listenEpoch;
  // Paused for confirmation (destructive delete, ambiguous app, overwrite).
  if (outcome.pendingConfirmation && outcome.run) {
    pendingConfirmRunId = outcome.run.id;
    presentConfirmation(outcome.pendingConfirmation);
    return;
  }
  pendingConfirmRunId = null;
  if (isStale(epoch)) return;
  const result = outcome.result;
  let text = outcome.responseText ?? result?.summary ?? "Done";
  // Structure dumps into list/table markdown so the overlay never shows raw API text.
  try {
    const { structureAsMarkdown, detectOutputShape } = await import(
      "../../services/styleAssistantOutput"
    );
    text = structureAsMarkdown(
      text,
      detectOutputShape(text, result?.capabilityId),
      result?.capabilityId,
    );
  } catch {
    // Keep original text if the formatter is unavailable.
  }

  // Screenshot artifact → render the image in the expanded panel.
  const imageArtifact = result?.artifacts?.find((a) => a.kind === "image");
  if (result?.status === "success" && imageArtifact?.id) {
    await showScreenshotArtifact(imageArtifact.id, text);
    return;
  }

  const appId = engineAppId(result);
  const icon = appId ? getOverlayIcon(appId) : undefined;

  if (!result || result.status === "success") {
    if (isStale(epoch)) return;
    if (appId) setApplicationContext(appId, icon?.iconPath);
    setOverlaySuccess(
      { title: text, summary: "", applicationId: appId },
      text,
      false,
    );
    playEventSound("task-completed");
    await speakOverlayReply(text);
    if (isStale(epoch)) return;
    scheduleOverlayAutoDismiss(POST_ANSWER_DISMISS_MS);
    return;
  }
  if (result.status === "partial") {
    if (isStale(epoch)) return;
    if (appId) setApplicationContext(appId, icon?.iconPath);
    setOverlaySuccess({ title: text, summary: "", applicationId: appId }, text, false);
    await finishSpokenReply(text);
    return;
  }
  if (result.status === "cancelled") {
    if (isStale(epoch)) return;
    setStatusText(text);
    setOverlayMode("responding", { status: text, expanded: false });
    scheduleOverlayAutoDismiss(POST_ANSWER_DISMISS_MS);
    return;
  }
  // not-found / denied / unsupported / error → honest error surface.
  if (isStale(epoch)) return;
  const friendly =
    text
      .replace(/\b[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*\b/gi, "the system")
      .replace(/\s{2,}/g, " ")
      .trim() || "Something went wrong. Please try again.";
  setOverlayError({
    message: friendly,
    code: result.error?.code ?? result.status,
  });
  playEventSound("error");
  await expandOverlayWindow(OVERLAY_EXPANDED_TYPICAL);
  if (isStale(epoch)) return;
  await speakOverlayReply(friendly);
  if (isStale(epoch)) return;
  scheduleOverlayAutoDismiss(RESULT_PANEL_HOLD_MS);
}

function engineAppId(result: ToolResult | undefined): string | undefined {
  if (!result) return undefined;
  const data = result.data as { application?: string; target_id?: string } | undefined;
  const raw = data?.target_id ?? data?.application;
  if (!raw) return undefined;
  // Map "cur-spotify" / index ids to a top-overlay icon id when possible.
  const guess = raw.replace(/^(cur|ap|sm|proto)-/, "");
  return getOverlayIcon(guess) ? guess : undefined;
}

function presentConfirmation(confirmation: CapabilityConfirmation) {
  const options = confirmation.candidates?.length
    ? confirmation.candidates.map((c) => ({ id: c.id ?? c.label, label: c.label }))
    : [
        { id: "confirm", label: confirmation.reversible ? "Move to Recycle Bin" : "Confirm" },
        { id: "cancel", label: "Cancel" },
      ];
  setOverlayMode("confirmation", {
    status: confirmation.title,
    expanded: true,
    requiresConfirmation: true,
    actionPayload: {
      type: "clarification",
      data: {
        question: confirmation.title,
        options,
      },
    },
  });
  void expandOverlayWindow(220);
  playEventSound("confirmation");
}

async function showScreenshotArtifact(captureId: string, text: string) {
  let dataUrl: string | undefined;
  try {
    dataUrl = await invoke<string>("get_capture_data_url", {
      id: captureId,
      annotated: false,
    });
  } catch {
    dataUrl = undefined;
  }
  setOverlayMode("screen-context", {
    status: text,
    expanded: true,
    requiresConfirmation: false,
    actionPayload: {
      type: "screen-context",
      data: {
        capturing: Boolean(dataUrl),
        previewDataUrl: dataUrl,
        privacyNote: text,
        monitorLabel: "Screenshot",
      },
    },
  });
  await expandOverlayWindow(340);
  playEventSound("task-completed");
}

/**
 * Route a transcript through the capability engine. Returns true when the
 * engine handled it (action executed / confirmation shown), false when the
 * request is conversation and should fall through to the chat/intent path.
 */
async function driveOverlayFromEngine(trimmed: string): Promise<boolean> {
  // A pending confirmation captures the next yes/no first.
  if (pendingConfirmRunId) {
    if (AFFIRM_RE.test(trimmed)) {
      const runId = pendingConfirmRunId;
      pendingConfirmRunId = null;
      setOverlayMode("responding", { status: "Working...", expanded: false });
      const outcome = await resolvePendingConfirmation(runId, true);
      await applyEngineOutcome(outcome);
      return true;
    }
    if (DENY_RE.test(trimmed)) {
      const runId = pendingConfirmRunId;
      pendingConfirmRunId = null;
      const outcome = await resolvePendingConfirmation(runId, false);
      await applyEngineOutcome(outcome);
      return true;
    }
    // Any other utterance abandons the pending confirmation and re-routes.
    pendingConfirmRunId = null;
  }

  let sawProgress = false;
  const outcome = await handleCapabilityRequest(trimmed, {
    origin: "voice",
    onProgress: (message, capabilityId) => {
      sawProgress = true;
      const appId = capabilityId ? undefined : undefined;
      void appId;
      const opening = message.startsWith("Opening");
      const working =
        message.startsWith("Working") ||
        message.startsWith("Verifying") ||
        message.startsWith("Done");
      setOverlayMode(opening ? "opening-app" : working ? "responding" : "thinking", {
        status: opening || working ? message : "Thinking...",
        expanded: false,
      });
    },
  });
  if (!outcome.handled) {
    return false;
  }
  void sawProgress;
  await applyEngineOutcome(outcome);
  return true;
}

/** Confirmation panel button handler (Confirm / Cancel / candidate id). */
export async function resolveOverlayConfirmation(optionId: string) {
  const runId = pendingConfirmRunId;
  if (!runId) return;
  pendingConfirmRunId = null;
  if (optionId === "cancel") {
    const outcome = await resolvePendingConfirmation(runId, false);
    await applyEngineOutcome(outcome);
    return;
  }
  setOverlayMode("responding", { status: "Working...", expanded: false });
  const approvedId = optionId === "confirm" ? undefined : optionId;
  const outcome = await resolvePendingConfirmation(runId, true, approvedId);
  await applyEngineOutcome(outcome);
}

/** Capsule status stays short; the dropdown carries the full message. */
const STATUS_CAPSULE_MAX = 72;

/**
 * Flatten a reply for the one-line capsule. Replies are composed as markdown
 * for the expanded panel, and the capsule renders its string as plain text —
 * so without this the user reads literal "**fantastic** — 5 i…".
 */
function capsuleText(raw: string, max = STATUS_CAPSULE_MAX): string {
  const flat = raw
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean)
    .join(" · ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
/** Expand when the reply won't fit the capsule (or needs a CTA). */
const NOTICE_EXPAND_MIN_CHARS = 90;

function serviceLabel(service: string): string {
  switch (service) {
    case "calendar":
      return "Calendar";
    case "email":
      return "Email";
    case "drive":
      return "Drive";
    default:
      return service.charAt(0).toUpperCase() + service.slice(1);
  }
}

function noticeHeading(action: ConnectionAction): string {
  const svc = serviceLabel(action.service);
  switch (action.action) {
    case "connect":
      return `${svc} isn’t connected`;
    case "reconnect":
      return `Reconnect ${svc}`;
    case "grant-permission":
      return "Permission needed";
    case "choose-account":
      return "Choose an account";
    case "retry":
      return `${svc} unavailable`;
    default:
      return "Needs attention";
  }
}

function shouldExpandOrchestration(result: OrchestrationResult): boolean {
  if (result.action) return true;
  return result.text.trim().length >= NOTICE_EXPAND_MIN_CHARS;
}

async function presentOrchestratedResult(result: OrchestrationResult) {
  const epoch = listenEpoch;
  if (result.navigatePage) {
    navigate(result.navigatePage);
  }
  if (result.openAppId) {
    if (isStale(epoch)) return;
    await openApplication(result.openAppId);
    return;
  }

  if (!shouldExpandOrchestration(result)) {
    if (isStale(epoch)) return;
    setOverlayMode("responding", {
      status: capsuleText(result.text, 120),
      expanded: false,
      applicationId: undefined,
      applicationIcon: undefined,
      actionPayload: undefined,
      error: undefined,
    });
    await finishSpokenReply(result.text);
    return;
  }

  if (isStale(epoch)) return;
  const title = result.action ? noticeHeading(result.action) : "Update";
  const status = result.action
    ? capsuleText(title)
    : capsuleText(result.text);
  setOverlayMode("responding", {
    status,
    expanded: true,
    applicationId: undefined,
    applicationIcon: undefined,
    error: undefined,
    requiresConfirmation: false,
    actionPayload: {
      type: "notice",
      data: {
        title,
        message: result.text,
        primaryLabel: result.action?.label,
        navigateTo: result.action?.navigateTo,
        code: result.action?.action,
      },
    },
  });
  await expandOverlayWindow(result.action ? 240 : OVERLAY_EXPANDED_TYPICAL);
  if (isStale(epoch)) return;
  // Connection CTAs stay open for a click; free-form answers speak then auto-dismiss.
  if (!result.action) {
    await finishSpokenReply(result.text);
  } else {
    playEventSound("error");
    void speakOverlayReply(result.text);
  }
}

/** Present a longer reply in the dropdown; short replies stay in the capsule. */
async function presentTextReply(text: string, opts?: { asError?: boolean }) {
  const epoch = listenEpoch;
  const trimmed = text.trim();
  import("../overlay-log/overlayLogService").then((m) => {
    m.logAssistantResponseCompleted(trimmed);
  });
  if (opts?.asError) {
    if (isStale(epoch)) return;
    setOverlayError({ message: trimmed || "Something went wrong" });
    playEventSound("error");
    await expandOverlayWindow(OVERLAY_EXPANDED_TYPICAL);
    if (isStale(epoch)) return;
    await speakOverlayReply(trimmed || "Something went wrong");
    if (isStale(epoch)) return;
    scheduleOverlayAutoDismiss(RESULT_PANEL_HOLD_MS);
    return;
  }
  if (trimmed.length < NOTICE_EXPAND_MIN_CHARS) {
    if (isStale(epoch)) return;
    setOverlayMode("responding", {
      status: capsuleText(trimmed, 120),
      expanded: false,
      applicationId: undefined,
      applicationIcon: undefined,
      actionPayload: undefined,
      error: undefined,
    });
    await finishSpokenReply(trimmed);
    return;
  }
  if (isStale(epoch)) return;
  setOverlayMode("responding", {
    status: capsuleText(trimmed),
    expanded: true,
    applicationId: undefined,
    applicationIcon: undefined,
    error: undefined,
    actionPayload: {
      type: "notice",
      data: {
        title: "Update",
        message: trimmed,
      },
    },
  });
  await expandOverlayWindow(OVERLAY_EXPANDED_TYPICAL);
  if (isStale(epoch)) return;
  await finishSpokenReply(trimmed, { dismissAfterMs: RESULT_PANEL_HOLD_MS });
}

/** Commit a transcript (push-to-talk release / typed command). */
export async function commitOverlayTranscript(transcript: string) {
  // Voice-to-voice Realtime already heard this and will speak the answer.
  // Never run the parallel text/orchestration path — it overwrites the capsule
  // with a second, often contradictory reply (e.g. “not connected”).
  const { realtimeOverlayActive } = await import("./realtimeOverlay");
  if (realtimeOverlayActive()) {
    return;
  }

  demoActive = false;
  clearSessionTimers();
  const epoch = listenEpoch;
  const trimmed = transcript.trim();
  patchOverlay({ transcript: trimmed });

  // Log turn start and transcripts
  import("../overlay-log/overlayLogService").then((m) => {
    void m.startOverlayLogTurn(trimmed);
    m.logFinalTranscript(trimmed);
    m.logRequestCreated(trimmed);
  });

  // While a draft is open, “send” / “send it” confirms without re-thinking.
  const current = getOverlayState();
  if (
    isSendConfirmUtterance(trimmed) &&
    current.actionPayload?.type === "email" &&
    (current.mode === "drafting-email" ||
      current.mode === "confirmation" ||
      current.mode === "responding")
  ) {
    await confirmSendEmail();
    return;
  }

  // Clear any prior app chip before a new command so leftover Calendar/Gmail
  // icons don’t stick on unrelated answers (“what time is it?”).
  // Keep the previous dropdown until the new answer replaces it.
  const prior = getOverlayState();
  const keepPanel = hasResultPanel(prior);
  setOverlayMode("thinking", {
    status: "Thinking...",
    applicationId: undefined,
    applicationIcon: undefined,
    expanded: keepPanel,
    actionPayload: keepPanel ? prior.actionPayload : undefined,
    result: keepPanel ? prior.result : undefined,
    error: keepPanel ? prior.error : undefined,
  });
  playEventSound("thinking");

  // Local capability engine FIRST — real Windows actions (time, desktop,
  // open apps, folders, screenshots, tasks, navigation) with verification.
  const engineHandled = await driveOverlayFromEngine(trimmed);
  if (engineHandled || isStale(epoch)) return;

  await new Promise((r) => setTimeout(r, 350));
  if (isStale(epoch)) return;

  // Intent Precision layer — calendar/email/drive/nav before bare app-open.
  const orchestrated = await handleOrchestratedRequest(trimmed);
  if (isStale(epoch)) return;
  if (orchestrated.handled) {
    await presentOrchestratedResult(orchestrated);
    return;
  }

  await runOverlayIntent(parseOverlayIntent(trimmed));
}

export async function runOverlayIntent(intent: ParsedIntent) {
  demoActive = false;
  clearSessionTimers();

  switch (intent.kind) {
    case "open":
      await openApplication(intent.appId);
      break;
    case "search":
      await performWebSearch(intent.query);
      break;
    case "draft-email":
      await beginEmailDraft(intent);
      break;
    case "send-email": {
      const state = getOverlayState();
      if (state.actionPayload?.type === "email") {
        await confirmSendEmail();
      } else {
        setOverlayMode("responding", {
          status: "Nothing to send yet — try “email Kelvin and say…”",
          expanded: false,
        });
      }
      break;
    }
    case "schedule-meeting":
      await beginMeetingDraft(intent.title);
      break;
    case "create-task":
      await beginTaskDraft(intent.title);
      break;
    case "mention":
      setApplicationContext(intent.appId, intent.entry.iconPath);
      setOverlayMode("responding", {
        status: "Responding...",
        expanded: false,
      });
      playEventSound("responding");
      // Honest: no model backend yet — surface a clear local reply.
      await new Promise((r) => setTimeout(r, 600));
      setOverlayMode("responding", {
        status: "Responding...",
        actionPayload: {
          type: "none",
        },
      });
      setStatusText(`About ${intent.entry.displayName}`);
      // Stay collapsed while "responding" about a mention.
      break;
    case "clarify":
      setOverlayMode("clarifying", {
        status: "Waiting for confirmation",
        expanded: true,
        requiresConfirmation: true,
        actionPayload: {
          type: "clarification",
          data: { question: intent.question, options: intent.options },
        },
      });
      await expandOverlayWindow(OVERLAY_EXPANDED_TYPICAL);
      playEventSound("confirmation");
      break;
    case "respond":
      await respondWithAssistant(intent.text);
      break;
  }
}

async function respondWithAssistant(text: string) {
  if (!text.trim()) {
    setOverlayMode("listening", {
      status: "Listening...",
      expanded: false,
      applicationId: undefined,
      applicationIcon: undefined,
    });
    return;
  }

  const epoch = listenEpoch;

  // General Q&A (time, date, chat) — no app icon unless an intent set one.
  setApplicationContext(undefined, undefined);
  setOverlayMode("thinking", {
    status: "Thinking...",
    expanded: false,
    applicationId: undefined,
    applicationIcon: undefined,
  });
  playEventSound("thinking");

  try {
    const reply = await askAssistant(text.trim(), { skipCapabilities: true });
    if (isStale(epoch)) return;
    await presentTextReply(reply.text);
  } catch (err) {
    if (isStale(epoch)) return;
    console.error("[ArcSonare] Assistant respond failed:", err);
    const message = describeProviderError(err, getAssistantRoute().displayName);
    await presentTextReply(message, { asError: true });
    // Setup problems get spoken guidance. This is exactly the case the
    // pre-generated clips exist for: no model means no model can say it.
    const clip = clipForError(message);
    if (clip) await playBuiltinVoice(clip);
  }
}

export async function openApplication(appId: string) {
  const icon = getIconById(appId);
  const app = getApplication(appId);
  const name = icon?.displayName ?? app?.displayName ?? appId;
  const iconPath =
    icon?.iconPath && icon.iconPath.length > 0 ? icon.iconPath : undefined;

  // Set app context + opening mode in one patch so the right-side circle
  // shows the application logo immediately (Opening Spotify / Gmail / …).
  setOverlayMode(icon?.canOpenDesktop ? "opening-app" : "opening-web", {
    status: app?.openingStatus ?? `Opening ${name}`,
    expanded: false,
    applicationId: appId,
    applicationIcon: iconPath,
  });
  await collapseOverlayWindow();
  playEventSound("responding");

  try {
    const result = await invoke<OverlayActionResult>("overlay_open_service", {
      serviceId: appId,
    });
    if (result.ok) {
      // Re-assert logo BEFORE success so the checkmark path never wins a race.
      setApplicationContext(appId, iconPath);
      setOverlaySuccess(
        {
          title: app?.successStatus ?? `${name} opened`,
          summary: result.message,
          applicationId: appId,
          openLabel: icon?.canOpenWeb ? `Open ${name}` : undefined,
          openUrl: icon?.webUrl,
        },
        app?.successStatus ?? `${name} opened`,
        false,
      );
      setApplicationContext(appId, iconPath);
      playEventSound("task-completed");
      // Show success briefly, then dismiss — no re-listen.
      scheduleOverlayAutoDismiss(POST_ANSWER_DISMISS_MS);
    } else {
      setOverlayError({ message: result.message, code: "launch-failed" });
      playEventSound("error");
      await expandOverlayWindow(220);
      scheduleOverlayAutoDismiss(RESULT_PANEL_HOLD_MS);
    }
  } catch (err) {
    setOverlayError({
      message: errorText(err) || "Launch failed",
      code: "launch-exception",
    });
    playEventSound("error");
    await expandOverlayWindow(220);
  }
}

export async function performWebSearch(query: string) {
  setApplicationContext("microsoft-bing", getIconById("microsoft-bing")?.iconPath);
  setOverlayMode("web-search", {
    status: "Searching the web...",
    expanded: false,
  });
  await collapseOverlayWindow();
  playEventSound("responding");

  try {
    const result = await invoke<OverlayActionResult>("overlay_web_search", { query });
    if (result.ok) {
      setOverlaySuccess(
        {
          title: "Search opened",
          summary: `Results for “${query}” opened in your browser.`,
          applicationId: "microsoft-bing",
        },
        "Search opened",
      );
      playEventSound("task-completed");
      scheduleOverlayAutoDismiss(POST_ANSWER_DISMISS_MS);
    } else {
      setOverlayError({ message: result.message, code: "search-failed" });
      playEventSound("error");
      await expandOverlayWindow(220);
      scheduleOverlayAutoDismiss(RESULT_PANEL_HOLD_MS);
    }
  } catch (err) {
    setOverlayError({
      message: errorText(err) || "Search failed",
      code: "search-exception",
    });
    playEventSound("error");
  }
}

function buildEmailBody(recipientName: string, spokenBody?: string): string {
  if (spokenBody?.trim()) {
    const line = spokenBody.trim().replace(/\s+/g, " ");
    const capitalized = line.charAt(0).toUpperCase() + line.slice(1);
    const withPunctuation = /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}?`;
    return `Hi ${recipientName},\n\n${withPunctuation}\n\nBest,\n`;
  }
  return `Hi ${recipientName},\n\nI wanted to check in.\n\nBest,\n`;
}

async function beginEmailDraft(intent: Extract<ParsedIntent, { kind: "draft-email" }>) {
  const provider = getIconById("gmail");
  const contact = resolveDemoContact(intent.to) ?? {
    display: "Julia",
    email: "julia@acme.com",
  };
  let subject =
    intent.subject?.trim() ||
    (intent.body?.trim()
      ? intent.body.trim().replace(/\s+/g, " ").slice(0, 72)
      : `Quick note for ${contact.display}`);
  let body = buildEmailBody(contact.display, intent.body);

  // Always open the draft dropdown first — never launch Gmail for “email …”.
  const payload: EmailDraftPayload = {
    providerId: "gmail",
    to: contact.email,
    subject,
    body,
    tone: "Professional",
    contextUsed: `Draft for ${contact.display}`,
    providerConnected: true,
  };

  setApplicationContext("gmail", provider?.iconPath);
  setOverlayMode("drafting-email", {
    status: "Drafting email...",
    expanded: true,
    actionPayload: { type: "email", data: payload },
    requiresConfirmation: false,
  });
  await expandOverlayWindow(360);
  playEventSound("responding");

  if (getOverlayState().mode === "drafting-email") {
    patchOverlay({ status: "Drafting email..." });
  }
}

async function beginMeetingDraft(title?: string) {
  const provider = getIconById("google-calendar");
  const payload: MeetingPayload = {
    title: title ?? "Team Sync",
    dateLabel: "Tomorrow",
    startTime: "10:00 AM",
    endTime: "10:45 AM",
    durationLabel: "45 minutes",
    attendees: [],
    location: "Google Meet",
    providerId: "google-calendar",
    hasConflict: false,
  };
  setApplicationContext("google-calendar", provider?.iconPath);
  setOverlayMode("scheduling-meeting", {
    status: "Scheduling meeting...",
    expanded: true,
    actionPayload: { type: "meeting", data: payload },
  });
  await expandOverlayWindow(280);
  playEventSound("responding");
}

async function beginTaskDraft(title: string) {
  const payload: TaskPayload = {
    title,
    description: "",
    dueLabel: "May 20, 2026",
    priority: "high",
    assignee: "Marketing Agent",
  };
  setApplicationContext(undefined, undefined);
  setOverlayMode("creating-task", {
    status: "Creating task...",
    expanded: true,
    actionPayload: { type: "task", data: payload },
  });
  await expandOverlayWindow(280);
  playEventSound("responding");
}

/** Persist a local task — success only after this resolves. */
export async function confirmCreateTask() {
  const payload = getOverlayState().actionPayload;
  if (payload?.type !== "task") return;

  try {
    // Local persistence via app store event; no fake cloud claim.
    const { addActivity } = await import("../../stores/appStore");
    addActivity(`Task created: ${payload.data.title}`, "task");
    setOverlaySuccess(
      {
        title: "Task created",
        summary: payload.data.title,
      },
      "Task created",
    );
    playEventSound("task-completed");
    scheduleOverlayAutoDismiss(POST_ANSWER_DISMISS_MS);
  } catch (err) {
    setOverlayError({
      message: errorText(err) || "Could not create task",
    });
    playEventSound("error");
    scheduleOverlayAutoDismiss(RESULT_PANEL_HOLD_MS);
  }
}

export async function requestSendEmailConfirmation() {
  // Prototype: Send goes straight to the compose handoff (same as confirm).
  await confirmSendEmail();
}

export async function confirmSendEmail() {
  const payload = getOverlayState().actionPayload;
  if (payload?.type !== "email") return;

  const data = payload.data;
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: data.to,
    su: data.subject,
    body: data.body,
  });
  const url = `https://mail.google.com/mail/?${params.toString()}`;

  try {
    const result = await invoke<OverlayActionResult>("overlay_open_url", { url });
    if (result.ok) {
      setApplicationContext("gmail", getIconById("gmail")?.iconPath);
      setOverlaySuccess(
        {
          title: "Compose opened",
          summary: `Draft to ${data.to} opened in Gmail. Review there and press Send — ArcSonare does not send mail by itself yet.`,
          applicationId: "gmail",
        },
        "Compose opened",
        true,
      );
      playEventSound("task-completed");
      sessionTimers.push(
        window.setTimeout(() => {
          const s = getOverlayState();
          if (s.mode !== "success" || s.applicationId !== "gmail") return;
          patchOverlay({
            applicationId: undefined,
            applicationIcon: undefined,
          });
        }, 5000),
      );
    } else {
      setOverlayError({ message: result.message, code: "compose-failed" });
      playEventSound("error");
    }
  } catch (err) {
    setOverlayError({
      message: errorText(err) || "Could not open compose",
      code: "compose-exception",
    });
    playEventSound("error");
  }
}

export async function saveEmailDraftLocally() {
  const payload = getOverlayState().actionPayload;
  if (payload?.type !== "email") return;
  setOverlaySuccess(
    {
      title: "Draft saved",
      summary: `Draft “${payload.data.subject}” saved locally. Not sent.`,
      applicationId: "gmail",
    },
    "Draft saved",
    true,
  );
  playEventSound("task-completed");
}

export async function openEmailComposeInBrowser() {
  const service = getWebService("gmail");
  if (!service?.composeUrl) return;
  const result = await invoke<OverlayActionResult>("overlay_open_url", {
    url: service.composeUrl,
  });
  if (result.ok) {
    setOverlaySuccess(
      {
        title: "Compose opened",
        summary: "Gmail compose opened in your browser. Nothing was sent.",
        applicationId: "gmail",
      },
      "Compose opened",
    );
    playEventSound("task-completed");
  } else {
    setOverlayError({ message: result.message });
    playEventSound("error");
  }
}

export async function confirmScheduleMeeting() {
  // No calendar API — do not claim scheduled.
  setOverlayError({
    code: "api-unavailable",
    message: "Meeting scheduling requires a connected calendar provider.",
  });
  playEventSound("error");
}

export async function openConnectFromOverlay() {
  try {
    await invoke("open_settings");
    await invoke("request_close");
  } catch (err) {
    console.error(err);
  }
}

export function updatePayload(payload: OverlayActionPayload) {
  setActionPayload(payload);
}

/** Dev helpers — force visual states without speech. */
export function debugSetOverlayState(key: string) {
  demoActive = false;
  clearSessionTimers();
  const map: Record<string, () => void> = {
    "1": () => setOverlayMode("listening", { status: "Listening...", expanded: false }),
    "2": () => setOverlayMode("thinking", { status: "Thinking...", expanded: false }),
    "3": () => setOverlayMode("responding", { status: "Responding...", expanded: false }),
    "4": () => void openApplication("gmail"),
    "5": () => void openApplication("spotify"),
    "6": () => void openApplication("youtube"),
    "7": () =>
      void beginEmailDraft({ kind: "draft-email", to: "julia@acme.com", subject: "Q2 Project Update" }),
    "8": () => void beginMeetingDraft("Team Sync"),
    "9": () => void beginTaskDraft("Update campaign deck"),
    e: () => {
      setOverlayError({ message: "Something went wrong", code: "demo" });
      void expandOverlayWindow(220);
    },
    s: () =>
      setOverlaySuccess(
        {
          title: "Email sent",
          summary: "Q2 Project Update was sent to julia@acme.com",
          destination: "julia@acme.com",
          openLabel: "View in Gmail",
          openUrl: "https://mail.google.com",
          applicationId: "gmail",
        },
        "Email sent",
        true,
      ),
  };
  map[key]?.();
}
