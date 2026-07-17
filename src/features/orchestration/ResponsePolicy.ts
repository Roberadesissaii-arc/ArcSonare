/**
 * User-facing response strings for orchestration outcomes.
 */

import type { ConnectionAction, IntentContract } from "./IntentContract";
import type { ResolveOutput } from "./ConnectionBroker";

export function disconnectedMessage(
  domain: "calendar" | "email" | "drive",
): { text: string; action: ConnectionAction } {
  switch (domain) {
    case "calendar":
      return {
        text: "Your calendar isn’t connected, so I can’t read your events yet.",
        action: {
          service: "calendar",
          provider: "google",
          action: "connect",
          label: "Connect Calendar",
          navigateTo: "connect",
        },
      };
    case "email":
      return {
        text: "Your email isn’t connected, so I can’t check your messages yet.",
        action: {
          service: "email",
          provider: "google",
          action: "connect",
          label: "Connect Email",
          navigateTo: "connect",
        },
      };
    case "drive":
      return {
        text: "Google Drive isn’t connected, so I can’t list your files.",
        action: {
          service: "drive",
          provider: "google",
          action: "connect",
          label: "Connect Google Drive",
          navigateTo: "connect",
        },
      };
  }
}

export function resolveFailureMessage(
  domain: "calendar" | "email" | "drive",
  resolved: ResolveOutput,
): { text: string; action?: ConnectionAction } {
  if (resolved.status === "not-connected") {
    return disconnectedMessage(domain);
  }
  if (resolved.status === "authentication-required") {
    return {
      text: resolved.message,
      action: {
        service: domain,
        provider: resolved.provider ?? undefined,
        action: "reconnect",
        label: domain === "email" ? "Reconnect Email" : domain === "calendar" ? "Reconnect Calendar" : "Reconnect Drive",
        navigateTo: "connect",
      },
    };
  }
  if (resolved.status === "missing-scope") {
    return {
      text: resolved.message,
      action: {
        service: domain,
        provider: resolved.provider ?? undefined,
        action: "grant-permission",
        label: "Grant Permission",
        navigateTo: "connect",
      },
    };
  }
  if (resolved.status === "ambiguous-account") {
    return {
      text: resolved.message,
      action: {
        service: domain,
        action: "choose-account",
        label: "Choose Account",
        navigateTo: "connect",
      },
    };
  }
  if (resolved.status === "temporarily-unavailable") {
    return {
      text: resolved.message,
      action: {
        service: domain,
        action: "retry",
        label: "Retry",
      },
    };
  }
  return { text: resolved.message };
}

export function openConfirmation(label: string): string {
  return `I opened ${label}.`;
}

export function draftNotSentMessage(): string {
  return "I’ve prepared a draft for review. I won’t send it until you explicitly ask me to send.";
}

export function formatOrchestrationStatus(contract: IntentContract): string {
  if (contract.mode === "open") return "Opening...";
  if (contract.mode === "read" || contract.mode === "search" || contract.mode === "summarize") {
    return "Checking...";
  }
  if (contract.mode === "draft") return "Drafting...";
  if (contract.mode === "send") return "Sending...";
  return "Working...";
}
