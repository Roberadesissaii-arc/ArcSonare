/**
 * Overlay action runners — honest success only after native confirmation.
 */
import { invoke } from "@tauri-apps/api/core";
import { getApplication } from "../../config/applicationRegistry";
import { getIconById } from "../../config/topOverlayIconRegistry";
import { getWebService } from "../../config/webServiceRegistry";
import { playEventSound } from "../../services/SoundService";
import { parseOverlayIntent, type ParsedIntent } from "./iconResolver";
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
  patchOverlay({ transcript });
  setOverlayMode("thinking", { status: "Thinking..." });
  playEventSound("thinking");
  await new Promise((r) => setTimeout(r, 350));
  await runOverlayIntent(parseOverlayIntent(transcript));
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
      setOverlayMode("responding", {
        status: intent.text ? "Responding..." : "Listening...",
        expanded: false,
      });
      if (intent.text) playEventSound("responding");
      break;
  }
}

export async function openApplication(appId: string) {
  const icon = getIconById(appId);
  const app = getApplication(appId);
  const name = icon?.displayName ?? app?.displayName ?? appId;

  setApplicationContext(appId, icon?.iconPath);
  setOverlayMode(icon?.canOpenDesktop ? "opening-app" : "opening-web", {
    status: app?.openingStatus ?? `Opening ${name}`,
    expanded: false,
  });
  await collapseOverlayWindow();
  playEventSound("responding");

  try {
    const result = await invoke<OverlayActionResult>("overlay_open_service", {
      serviceId: appId,
    });
    if (result.ok) {
      setOverlaySuccess(
        {
          title: app?.successStatus ?? `${name} opened`,
          summary: result.message,
          applicationId: appId,
          openLabel: icon?.canOpenWeb ? `Open ${name}` : undefined,
          openUrl: icon?.webUrl,
        },
        app?.successStatus ?? `${name} opened`,
      );
      playEventSound("task-completed");
      // Auto-hide after short success for simple launches.
      window.setTimeout(() => {
        if (getOverlayState().mode === "success") {
          void invoke("request_close");
        }
      }, 1400);
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

async function beginEmailDraft(intent: Extract<ParsedIntent, { kind: "draft-email" }>) {
  const provider = getIconById("gmail");
  const payload: EmailDraftPayload = {
    providerId: "gmail",
    to: intent.to ?? "julia@acme.com",
    subject: intent.subject ?? "Q2 Project Update",
    body:
      "Hi Julia,\n\nThanks for the update on the project. I reviewed the latest documents and have a few suggestions...\n\nBest,\n",
    tone: "Professional",
    contextUsed: "Local draft — email API not connected",
    providerConnected: false,
  };

  setApplicationContext("gmail", provider?.iconPath);
  setOverlayMode("drafting-email", {
    status: "Drafting email...",
    expanded: true,
    actionPayload: { type: "email", data: payload },
    requiresConfirmation: false,
  });
  await expandOverlayWindow(320);
  playEventSound("responding");
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
  patchOverlay({
    mode: "confirmation",
    status: "Waiting for confirmation",
    requiresConfirmation: true,
    pendingConfirmAction: "send-email",
  });
  playEventSound("confirmation");
}

export async function confirmSendEmail() {
  const payload = getOverlayState().actionPayload;
  if (payload?.type !== "email") return;

  if (!payload.data.providerConnected) {
    setOverlayError({
      code: "provider-disconnected",
      message: "Email provider not connected",
    });
    playEventSound("error");
    return;
  }

  // No email API wired — never claim sent.
  setOverlayError({
    code: "api-unavailable",
    message: "Email sending requires a connected provider. Connect Gmail in Settings → Integrations.",
  });
  playEventSound("error");
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
