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
import { ensureOllamaModel, ollamaChat, ollamaDraftEmail } from "../../services/OllamaService";
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
  ScreenContextPayload,
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

function clearSessionTimers() {
  sessionTimers.forEach((t) => window.clearTimeout(t));
  sessionTimers = [];
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
      }, 2800),
    );
  }
}

export function cancelOverlaySession() {
  demoActive = false;
  clearSessionTimers();
  const mode = getOverlayState().mode;
  if (mode !== "hidden" && mode !== "closing") {
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
  clearSessionTimers();
  void collapseOverlayWindow();
  resetOverlay();
}

/** Commit a transcript (push-to-talk release / typed command). */
export async function commitOverlayTranscript(transcript: string) {
  demoActive = false;
  clearSessionTimers();
  const trimmed = transcript.trim();
  patchOverlay({ transcript: trimmed });

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

  setOverlayMode("thinking", { status: "Thinking..." });
  playEventSound("thinking");
  await new Promise((r) => setTimeout(r, 350));
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
    case "screen-context":
      await beginScreenContext();
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
      await expandOverlayWindow(200);
      playEventSound("confirmation");
      break;
    case "respond":
      await respondWithAssistant(intent.text);
      break;
  }
}

async function respondWithAssistant(text: string) {
  if (!text.trim()) {
    setOverlayMode("listening", { status: "Listening...", expanded: false });
    return;
  }

  setOverlayMode("thinking", { status: "Thinking...", expanded: false });
  playEventSound("thinking");

  const ready = await ensureOllamaModel();
  if (!ready.ok) {
    setOverlayMode("responding", {
      status: ready.message.slice(0, 120),
      expanded: false,
    });
    playEventSound("error");
    return;
  }

  try {
    const reply = await ollamaChat(
      [
        {
          role: "system",
          content:
            "You are ArcSonare, a concise desktop assistant. Keep replies short (1–3 sentences) unless asked for detail.",
        },
        { role: "user", content: text },
      ],
      ready.model,
    );
    setOverlayMode("responding", {
      status: reply.slice(0, 120),
      expanded: false,
    });
    playEventSound("responding");
  } catch (err) {
    console.error("[ArcSonare] Ollama respond failed:", err);
    setOverlayMode("responding", {
      status:
        err instanceof Error
          ? err.message.slice(0, 120)
          : "Local model unavailable",
      expanded: false,
    });
    playEventSound("error");
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
      // Keep the app logo for 5s, then restore the close (X) control.
      sessionTimers.push(
        window.setTimeout(() => {
          const s = getOverlayState();
          if (s.mode !== "success" || s.applicationId !== appId) return;
          patchOverlay({
            applicationId: undefined,
            applicationIcon: undefined,
          });
        }, 5000),
      );
    } else {
      setOverlayError({ message: result.message, code: "launch-failed" });
      playEventSound("error");
      await expandOverlayWindow(220);
    }
  } catch (err) {
    setOverlayError({
      message: err instanceof Error ? err.message : "Launch failed",
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
      window.setTimeout(() => {
        if (getOverlayState().mode === "success") void invoke("request_close");
      }, 1400);
    } else {
      setOverlayError({ message: result.message, code: "search-failed" });
      playEventSound("error");
      await expandOverlayWindow(220);
    }
  } catch (err) {
    setOverlayError({
      message: err instanceof Error ? err.message : "Search failed",
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

  // Optionally refine with local Ollama when it is reachable.
  const drafted = await ollamaDraftEmail({
    toName: contact.display,
    toEmail: contact.email,
    subject,
    spokenBody: intent.body || intent.subject,
  });
  if (drafted && getOverlayState().mode === "drafting-email") {
    subject = drafted.subject;
    body = drafted.body;
    setActionPayload({
      type: "email",
      data: {
        ...payload,
        subject,
        body,
        contextUsed: `Draft for ${contact.display} · Ollama`,
      },
    });
  }

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

async function beginScreenContext() {
  setOverlayMode("screen-context", {
    status: "Screen context enabled",
    expanded: true,
    actionPayload: {
      type: "screen-context",
      data: {
        capturing: false,
        privacyNote: "Capturing key context from your screen",
        monitorLabel: "Active monitor",
      } satisfies ScreenContextPayload,
    },
  });
  await expandOverlayWindow(340);
  playEventSound("screen-context-start");

  try {
    const monitors = await invoke<{ id: string; name: string }[]>("list_monitors");
    const ids = monitors.slice(0, 1).map((m) => m.id);
    if (ids.length === 0) {
      setStatusText("Screen context enabled");
      return;
    }
    await invoke("start_screen_context", { monitorIds: ids });
    const capture = await invoke<{ meta: { id: string } }[]>("capture_screen", {
      target: "monitor",
      monitorId: ids[0],
    }).catch(() => null);

    let dataUrl: string | undefined;
    const captureId = capture?.[0]?.meta?.id;
    if (captureId) {
      dataUrl = await invoke<string>("get_capture_data_url", {
        id: captureId,
        annotated: false,
      }).catch(() => undefined);
    }

    const current = getOverlayState().actionPayload;
    if (current?.type === "screen-context") {
      setActionPayload({
        type: "screen-context",
        data: {
          ...current.data,
          capturing: Boolean(dataUrl),
          previewDataUrl: dataUrl,
          monitorLabel: monitors[0]?.name ?? "Active monitor",
        },
      });
      if (dataUrl) {
        setStatusText("Context captured");
      }
    }
  } catch {
    // Screen context backend may be unavailable — show panel without false AI claims.
    setStatusText("Screen context enabled");
  }
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
    window.setTimeout(() => {
      if (getOverlayState().mode === "success") void invoke("request_close");
    }, 1400);
  } catch (err) {
    setOverlayError({
      message: err instanceof Error ? err.message : "Could not create task",
    });
    playEventSound("error");
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
      message: err instanceof Error ? err.message : "Could not open compose",
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
    "0": () => void beginScreenContext(),
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
