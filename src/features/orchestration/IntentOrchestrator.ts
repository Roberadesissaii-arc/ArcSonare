import { invoke } from "@tauri-apps/api/core";
import { navigate } from "../../stores/appStore";
import type {
  IntentContract,
  OrchestrationMiss,
  OrchestrationResult,
} from "./IntentContract";
import {
  classifyIntent,
  isOrchestratedDomain,
} from "./IntentClassifier";
import {
  mapIntentToCapability,
} from "./IntentCapabilityMap";
import {
  resolveConnection,
  sessionCapabilitySnapshot,
} from "./ConnectionBroker";
import { correctToolSelection } from "./ToolSelectionValidator";
import {
  disconnectedMessage,
  draftNotSentMessage,
  openConfirmation,
  resolveFailureMessage,
} from "./ResponsePolicy";
import { auditFromContract } from "./OrchestrationAudit";
import { parseEventFromText } from "./parseEventTime";
import {
  calendarCreateEvent,
  calendarListEvents,
  driveListFiles,
  gmailListMessages,
} from "../../services/GoogleWorkspaceService";
import {
  CONTENT_TTL_MS,
  contentCacheKey,
  getCached,
  invalidateContentCache,
  setCached,
  shouldBypassContentCache,
} from "./ServiceDataCache";
import { resolveCalendarQueryRange } from "./parseCalendarRange";

export type HandleOptions = {
  /** Model-proposed tool to validate (optional). */
  proposedCapabilityId?: string;
  /** Force content-cache bypass. */
  bypassCache?: boolean;
};

async function openAppById(appId: string): Promise<boolean> {
  try {
    const result = await invoke<{ ok: boolean; message: string }>(
      "overlay_open_service",
      { serviceId: appId },
    );
    return Boolean(result?.ok);
  } catch (err) {
    console.error("[ArcSonare] orchestrated open failed:", err);
    return false;
  }
}

function navigateArcPage(
  page: string,
): NonNullable<OrchestrationResult["navigatePage"]> | undefined {
  switch (page) {
    case "tasks":
    case "dashboard":
    case "agent":
    case "connect":
    case "settings":
      return page;
    default:
      return "dashboard";
  }
}

/** Honest yes/no for “is my Gmail connected?” — never opens the web app. */
async function connectionStatusResult(
  contract: IntentContract,
  capabilityId: string,
  service: "email" | "calendar" | "drive",
  started: number,
): Promise<OrchestrationResult> {
  // Live OAuth is ground truth — broker cache can lag after Connect.
  const { syncConnectionBrokerFromIntegrations, getConnectedIntegrationIds } =
    await import("../../services/integrationStatusService");
  await syncConnectionBrokerFromIntegrations().catch(() => undefined);

  const required =
    service === "email"
      ? ["email.read"]
      : service === "calendar"
        ? ["calendar.read"]
        : ["drive.read"];
  let resolved = resolveConnection({ service, requiredScopes: required });

  // If the broker still says disconnected, re-check live Connect state.
  if (resolved.status === "not-connected") {
    const live = await getConnectedIntegrationIds().catch(() => new Set());
    const integrationId =
      service === "email"
        ? "gmail"
        : service === "calendar"
          ? "googleCalendar"
          : "googleDrive";
    if (live.has(integrationId as never)) {
      resolved = {
        status: "ready",
        accountIds: ["google-shared"],
        provider: "google",
        missingScopes: [],
        message: "Connected (live OAuth).",
      };
    }
  }

  const label =
    service === "email"
      ? "Gmail"
      : service === "calendar"
        ? "Google Calendar"
        : "Google Drive";

  let text: string;
  let action = resolveFailureMessage(service, resolved).action;
  let resultStatus:
    | "success"
    | "disconnected"
    | "missing-scope"
    | "authentication-required" = "disconnected";

  if (resolved.status === "ready") {
    text = `Yes — ${label} is connected to ArcSonare.`;
    action = undefined;
    resultStatus = "success";
  } else if (
    resolved.status === "missing-scope" ||
    resolved.status === "authentication-required"
  ) {
    text = `${label} shows up in Connect, but ArcSonare doesn’t have permission to read it yet. Reconnect with Google and approve access. I did not open ${label}.`;
    resultStatus =
      resolved.status === "missing-scope"
        ? "missing-scope"
        : "authentication-required";
  } else {
    text = `No — ${label} isn’t connected. Open Connect and sign in with Google to link it. I did not open ${label}.`;
    action = disconnectedMessage(service).action;
    resultStatus = "disconnected";
  }

  const audit = auditFromContract(contract, {
    selectedCapabilityId: capabilityId,
    connectionStatus: resolved.status,
    connectionAccountId: resolved.accountIds[0],
    resultStatus,
    durationMs: Date.now() - started,
  });
  return {
    handled: true,
    contract,
    capabilityId,
    text,
    action,
    auditId: audit.id,
  };
}

async function executeCalendar(
  contract: IntentContract,
  capabilityId: string,
  started: number,
): Promise<OrchestrationResult> {
  if (capabilityId === "calendar.get_connection_status") {
    return await connectionStatusResult(contract, capabilityId, "calendar", started);
  }

  if (capabilityId === "calendar.create_event") {
    const resolved = resolveConnection({
      service: "calendar",
      requiredScopes: ["calendar.read"],
    });
    if (resolved.status !== "ready") {
      const fail = resolveFailureMessage("calendar", resolved);
      const audit = auditFromContract(contract, {
        selectedCapabilityId: capabilityId,
        connectionStatus: resolved.status,
        resultStatus: "disconnected",
        durationMs: Date.now() - started,
      });
      return {
        handled: true,
        contract,
        capabilityId,
        text: `${fail.text} I didn't create the event.`,
        action: fail.action,
        auditId: audit.id,
      };
    }

    // Never guess a time — ask instead.
    const parsed = parseEventFromText(contract.utterance);
    if (!parsed) {
      const audit = auditFromContract(contract, {
        selectedCapabilityId: capabilityId,
        connectionAccountId: resolved.accountIds[0],
        connectionStatus: "connected",
        resultStatus: "partial",
        durationMs: Date.now() - started,
      });
      return {
        handled: true,
        contract,
        capabilityId,
        text: "Sure — what's it for, and when?",
        auditId: audit.id,
      };
    }

    const result = await calendarCreateEvent({
      summary: parsed.title,
      start: parsed.start,
      end: parsed.end,
    });
    // A create invalidates any cached listing.
    invalidateContentCache("calendar");
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionAccountId: resolved.accountIds[0],
      connectionStatus: "connected",
      resultStatus: result.ok ? "success" : "failed",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: result.ok && parsed.assumedTime
        ? `${result.text} I put it at 9am — tell me if you'd like a different time.`
        : result.text,
      auditId: audit.id,
    };
  }

  if (capabilityId === "calendar.open_ui") {
    const ok = await openAppById("google-calendar");
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      resultStatus: ok ? "opened" : "failed",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: ok
        ? openConfirmation("Google Calendar")
        : "I couldn’t open Google Calendar.",
      openAppId: ok ? "google-calendar" : undefined,
      auditId: audit.id,
    };
  }

  if (capabilityId === "calendar.open_event") {
    const resolved = resolveConnection({
      service: "calendar",
      requiredScopes: ["calendar.read"],
    });
    if (resolved.status !== "ready") {
      const fail = resolveFailureMessage("calendar", resolved);
      const audit = auditFromContract(contract, {
        selectedCapabilityId: capabilityId,
        connectionStatus: resolved.status,
        resultStatus:
          resolved.status === "not-connected"
            ? "disconnected"
            : resolved.status === "authentication-required"
              ? "authentication-required"
              : resolved.status === "missing-scope"
                ? "missing-scope"
                : "failed",
        durationMs: Date.now() - started,
      });
      return {
        handled: true,
        contract,
        capabilityId,
        text:
          fail.text +
          (resolved.status === "not-connected"
            ? " I can’t identify your next meeting without a calendar connection."
            : ""),
        action: fail.action,
        auditId: audit.id,
      };
    }
    // Connected path reserved for real event open when API is wired.
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionAccountId: resolved.accountIds[0],
      connectionStatus: "connected",
      resultStatus: "partial",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: "Your calendar is connected, but opening a specific event isn’t available until the calendar API is fully wired.",
      auditId: audit.id,
    };
  }

  // Read / search / summarize
  const resolved = resolveConnection({
    service: "calendar",
    requiredScopes: ["calendar.read"],
  });
  if (resolved.status !== "ready") {
    const fail = resolveFailureMessage("calendar", resolved);
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionStatus: resolved.status,
      resultStatus:
        resolved.status === "not-connected" ? "disconnected" : "failed",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: fail.text,
      action: fail.action,
      auditId: audit.id,
    };
  }

  const accountId = resolved.accountIds[0];
  // Parse "August 8th" / today / tomorrow / next two weeks from the utterance.
  // Cache key MUST include the range or "today empty" poisons "August 8".
  const range = resolveCalendarQueryRange(contract.utterance);
  const cacheKey = contentCacheKey(
    "calendar",
    `${capabilityId}:${range.relativeExpression}:${range.timeMin.slice(0, 10)}`,
    accountId,
  );
  const bypass =
    shouldBypassContentCache(contract.utterance) ||
    contract.requestedData?.includes("latest") ||
    range.relativeExpression === "absolute_day";
  if (!bypass) {
    const cached = getCached<string>(cacheKey);
    if (cached) {
      const audit = auditFromContract(contract, {
        selectedCapabilityId: capabilityId,
        connectionAccountId: accountId,
        connectionStatus: "connected",
        resultStatus: "success",
        durationMs: Date.now() - started,
      });
      return {
        handled: true,
        contract,
        capabilityId,
        text: cached,
        auditId: audit.id,
      };
    }
  }

  // Real Calendar read for the resolved window (not always "now → end of today").
  const result = await calendarListEvents({
    maxResults: capabilityId === "calendar.get_next_event" ? 1 : 15,
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    rangeLabel: range.label,
  });

  if (!result.ok) {
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionAccountId: accountId,
      connectionStatus: "connected",
      resultStatus: "failed",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: result.text,
      action: disconnectedMessage("calendar").action,
      auditId: audit.id,
    };
  }

  setCached(cacheKey, result.text, CONTENT_TTL_MS.calendarList);
  const audit = auditFromContract(contract, {
    selectedCapabilityId: capabilityId,
    connectionAccountId: accountId,
    connectionStatus: "connected",
    resultStatus: "success",
    durationMs: Date.now() - started,
  });
  return {
    handled: true,
    contract,
    capabilityId,
    text: result.text,
    auditId: audit.id,
  };
}

async function executeEmail(
  contract: IntentContract,
  capabilityId: string,
  started: number,
): Promise<OrchestrationResult> {
  if (capabilityId === "email.get_connection_status") {
    return await connectionStatusResult(contract, capabilityId, "email", started);
  }

  if (capabilityId === "email.open_inbox_ui") {
    const ok = await openAppById("gmail");
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      resultStatus: ok ? "opened" : "failed",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: ok ? openConfirmation("Gmail") : "I couldn’t open Gmail.",
      openAppId: ok ? "gmail" : undefined,
      auditId: audit.id,
    };
  }

  if (capabilityId === "email.open_message") {
    const resolved = resolveConnection({
      service: "email",
      requiredScopes: ["email.read"],
    });
    if (resolved.status !== "ready") {
      const fail = resolveFailureMessage("email", resolved);
      const audit = auditFromContract(contract, {
        selectedCapabilityId: capabilityId,
        connectionStatus: resolved.status,
        resultStatus: "disconnected",
        durationMs: Date.now() - started,
      });
      return {
        handled: true,
        contract,
        capabilityId,
        text: `${fail.text} Would you like me to open your inbox instead?`,
        action: fail.action,
        auditId: audit.id,
      };
    }
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionAccountId: resolved.accountIds[0],
      connectionStatus: "connected",
      resultStatus: "partial",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: "Email is connected, but opening a specific message isn’t available until the email API is wired. I did not open Gmail as a substitute.",
      auditId: audit.id,
    };
  }

  if (capabilityId === "email.create_draft" || capabilityId === "email.reply_draft") {
    const resolved = resolveConnection({
      service: "email",
      requiredScopes: ["email.compose"],
    });
    if (resolved.status !== "ready") {
      // Draft UI prototype still available via overlay — but say connection needed for real drafts
      const fail = resolveFailureMessage("email", resolved);
      const audit = auditFromContract(contract, {
        selectedCapabilityId: capabilityId,
        connectionStatus: resolved.status,
        resultStatus: "disconnected",
        durationMs: Date.now() - started,
      });
      return {
        handled: true,
        contract,
        capabilityId,
        text: `${fail.text} I can still help you draft text here, but I can’t place it in your mailbox until email is connected.`,
        action: fail.action,
        auditId: audit.id,
      };
    }
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionAccountId: resolved.accountIds[0],
      connectionStatus: "connected",
      resultStatus: "partial",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: draftNotSentMessage(),
      auditId: audit.id,
    };
  }

  if (capabilityId === "email.send_draft") {
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      resultStatus: "failed",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: "Sending requires a connected email account and an existing draft. Nothing was sent.",
      action: disconnectedMessage("email").action,
      auditId: audit.id,
    };
  }

  // Read paths
  const resolved = resolveConnection({
    service: "email",
    requiredScopes: ["email.read"],
  });
  if (resolved.status !== "ready") {
    const fail = resolveFailureMessage("email", resolved);
    // Specialize latest-email copy
    const text =
      capabilityId === "email.get_latest_message"
        ? "Your email isn’t connected, so I can’t check your latest message."
        : fail.text;
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionStatus: resolved.status,
      resultStatus: "disconnected",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text,
      action: fail.action ?? disconnectedMessage("email").action,
      auditId: audit.id,
    };
  }

  const accountId = resolved.accountIds[0];
  const cacheKey = contentCacheKey("email", capabilityId, accountId);
  if (!shouldBypassContentCache(contract.utterance)) {
    const cached = getCached<string>(cacheKey);
    if (cached) {
      const audit = auditFromContract(contract, {
        selectedCapabilityId: capabilityId,
        connectionAccountId: accountId,
        connectionStatus: "connected",
        resultStatus: "success",
        durationMs: Date.now() - started,
      });
      return { handled: true, contract, capabilityId, text: cached, auditId: audit.id };
    }
  }

  // Real Gmail read. `unread` and `latest` narrow the same endpoint.
  const wantsUnread = capabilityId === "email.list_unread";
  const wantsLatest = capabilityId === "email.get_latest_message";
  const result = await gmailListMessages({
    maxResults: wantsLatest ? 1 : 8,
    query: wantsUnread ? "is:unread" : undefined,
  });

  if (!result.ok) {
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionAccountId: accountId,
      connectionStatus: "connected",
      resultStatus: "failed",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: result.text,
      action: disconnectedMessage("email").action,
      auditId: audit.id,
    };
  }

  setCached(cacheKey, result.text, CONTENT_TTL_MS.latestEmail);
  const audit = auditFromContract(contract, {
    selectedCapabilityId: capabilityId,
    connectionAccountId: accountId,
    connectionStatus: "connected",
    resultStatus: "success",
    durationMs: Date.now() - started,
  });
  return { handled: true, contract, capabilityId, text: result.text, auditId: audit.id };
}

async function executeDrive(
  contract: IntentContract,
  capabilityId: string,
  started: number,
): Promise<OrchestrationResult> {
  if (capabilityId === "drive.get_connection_status") {
    return await connectionStatusResult(contract, capabilityId, "drive", started);
  }

  if (capabilityId === "drive.open_ui") {
    try {
      await invoke("overlay_open_url", { url: "https://drive.google.com" });
    } catch {
      // Fall through with message
    }
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      resultStatus: "opened",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: openConfirmation("Google Drive"),
      auditId: audit.id,
    };
  }

  const resolved = resolveConnection({
    service: "drive",
    requiredScopes: ["drive.read"],
  });
  if (resolved.status !== "ready") {
    const fail = resolveFailureMessage("drive", resolved);
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      connectionStatus: resolved.status,
      resultStatus: "disconnected",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: fail.text,
      action: fail.action,
      auditId: audit.id,
    };
  }

  // Real Drive read.
  const result = await driveListFiles({ maxResults: 10 });
  const audit = auditFromContract(contract, {
    selectedCapabilityId: capabilityId,
    connectionAccountId: resolved.accountIds[0],
    connectionStatus: "connected",
    resultStatus: result.ok ? "success" : "failed",
    durationMs: Date.now() - started,
  });
  return {
    handled: true,
    contract,
    capabilityId,
    text: result.text,
    action: result.ok ? undefined : disconnectedMessage("drive").action,
    auditId: audit.id,
  };
}

/**
 * Main entry: classify → map → validate → execute.
 * Returns handled:false for domains the legacy overlay/assistant should keep.
 */
export async function handleOrchestratedRequest(
  utterance: string,
  options?: HandleOptions,
): Promise<OrchestrationResult | OrchestrationMiss> {
  const started = Date.now();
  const contract = classifyIntent(utterance);

  if (!isOrchestratedDomain(contract)) {
    return { handled: false };
  }

  let capabilityId = mapIntentToCapability(contract) ?? contract.capabilityId;
  let correction: OrchestrationResult extends never ? never : {
    proposedTool: string;
    correctedTool: string;
    reason: string;
  } | undefined;

  if (options?.proposedCapabilityId) {
    const fixed = correctToolSelection(contract, options.proposedCapabilityId);
    capabilityId = fixed.capabilityId;
    correction = fixed.correction;
  }

  if (!capabilityId) {
    return { handled: false };
  }

  // Snapshot for diagnostics (no secrets)
  void sessionCapabilitySnapshot(
    contract.domain === "calendar"
      ? ["calendar"]
      : contract.domain === "email"
        ? ["email"]
        : contract.domain === "drive"
          ? ["drive"]
          : [],
  );

  if (capabilityId === "arcsonare.navigate") {
    const page = navigateArcPage(contract.object ?? "dashboard");
    if (!page) {
      return { handled: false };
    }
    navigate(page);
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      resultStatus: "navigated",
      correctionApplied: correction,
      durationMs: Date.now() - started,
    });
    const label = page.charAt(0).toUpperCase() + page.slice(1);
    return {
      handled: true,
      contract,
      capabilityId,
      text: `Opened ${label}.`,
      navigatePage: page,
      auditId: audit.id,
    };
  }

  if (capabilityId === "tasks.list") {
    navigate("tasks");
    const audit = auditFromContract(contract, {
      selectedCapabilityId: capabilityId,
      resultStatus: "navigated",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      contract,
      capabilityId,
      text: "Here are your tasks in ArcSonare.",
      navigatePage: "tasks",
      auditId: audit.id,
    };
  }

  if (contract.domain === "calendar") {
    const result = await executeCalendar(contract, capabilityId, started);
    if (correction) {
      auditFromContract(contract, {
        selectedCapabilityId: capabilityId,
        correctionApplied: correction,
        resultStatus: "partial",
        durationMs: Date.now() - started,
      });
    }
    return result;
  }

  if (contract.domain === "email") {
    return executeEmail(contract, capabilityId, started);
  }

  if (contract.domain === "drive") {
    return executeDrive(contract, capabilityId, started);
  }

  return { handled: false };
}

/** Invalidate content caches after mutations (call from send/create/delete paths). */
export function onServiceMutation(
  service: "calendar" | "email" | "drive",
): void {
  invalidateContentCache(service);
}
