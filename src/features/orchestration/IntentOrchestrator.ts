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
import {
  CONTENT_TTL_MS,
  contentCacheKey,
  getCached,
  invalidateContentCache,
  setCached,
  shouldBypassContentCache,
} from "./ServiceDataCache";

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

async function executeCalendar(
  contract: IntentContract,
  capabilityId: string,
  started: number,
): Promise<OrchestrationResult> {
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
  const cacheKey = contentCacheKey("calendar", capabilityId, accountId);
  const bypass =
    shouldBypassContentCache(contract.utterance) ||
    contract.requestedData?.includes("latest");
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

  // API not implemented — honest partial success once connected metadata exists.
  const text =
    "Your calendar connection is recorded, but event reading isn’t available until the calendar provider API is wired. I did not open the calendar app.";
  setCached(cacheKey, text, CONTENT_TTL_MS.calendarList);
  const audit = auditFromContract(contract, {
    selectedCapabilityId: capabilityId,
    connectionAccountId: accountId,
    connectionStatus: "connected",
    resultStatus: "partial",
    durationMs: Date.now() - started,
  });
  return {
    handled: true,
    contract,
    capabilityId,
    text,
    auditId: audit.id,
  };
}

async function executeEmail(
  contract: IntentContract,
  capabilityId: string,
  started: number,
): Promise<OrchestrationResult> {
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

  const text =
    "Your email connection is recorded, but reading messages isn’t available until the email provider API is wired. I did not open Gmail.";
  setCached(cacheKey, text, CONTENT_TTL_MS.latestEmail);
  const audit = auditFromContract(contract, {
    selectedCapabilityId: capabilityId,
    connectionAccountId: accountId,
    connectionStatus: "connected",
    resultStatus: "partial",
    durationMs: Date.now() - started,
  });
  return { handled: true, contract, capabilityId, text, auditId: audit.id };
}

async function executeDrive(
  contract: IntentContract,
  capabilityId: string,
  started: number,
): Promise<OrchestrationResult> {
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
    text: "Drive is connected in metadata, but listing files isn’t available until the Drive API is wired. I did not open Google Drive.",
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
