/**
 * Maps intent mode + domain → allowed capability ids and default selection.
 */

import type { IntentContract, IntentDomain, IntentMode, SideEffectClass } from "./IntentContract";

export type CapabilityDefinition = {
  id: string;
  domain: IntentDomain;
  modes: IntentMode[];
  sideEffect: SideEffectClass;
  /** Human description including negative rules for model tool catalogs. */
  description: string;
  requiresConnection: boolean;
  requiredScopes?: string[];
};

export const CAPABILITY_CATALOG: CapabilityDefinition[] = [
  {
    id: "calendar.list_events",
    domain: "calendar",
    modes: ["read", "summarize"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["calendar.read"],
    description:
      "Retrieve calendar events for a time range. Use when the user asks what is on their calendar, what meetings are scheduled, or wants a calendar summary. Does not open a calendar application. Do not use calendar.open_ui for information questions.",
  },
  {
    id: "calendar.get_next_event",
    domain: "calendar",
    modes: ["read"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["calendar.read"],
    description:
      "Retrieve the next upcoming calendar event. Use for “what’s next” / “next meeting”. Does not open the calendar UI.",
  },
  {
    id: "calendar.search_events",
    domain: "calendar",
    modes: ["search", "read"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["calendar.read"],
    description:
      "Search calendar events by query. Does not open the calendar application.",
  },
  {
    id: "calendar.open_ui",
    domain: "calendar",
    modes: ["open"],
    sideEffect: "reversible",
    requiresConnection: false,
    description:
      "Open the preferred calendar application or website. Use ONLY when the user explicitly asks to open, launch, go to, or take them to their calendar. Do not use for “what’s on my calendar”.",
  },
  {
    id: "calendar.open_event",
    domain: "calendar",
    modes: ["open"],
    sideEffect: "reversible",
    requiresConnection: true,
    requiredScopes: ["calendar.read"],
    description:
      "Open a specific calendar event after it has been identified. Requires a prior read step.",
  },
  {
    id: "calendar.get_connection_status",
    domain: "calendar",
    modes: ["read", "explain"],
    sideEffect: "none",
    requiresConnection: false,
    description: "Report whether a calendar account is connected to ArcSonare.",
  },
  {
    id: "email.get_latest_message",
    domain: "email",
    modes: ["read"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["email.read"],
    description:
      "Retrieve the latest inbox message. Use for “latest email” / “most recent email”. Do not open the email application unless the user also asks to open the message.",
  },
  {
    id: "email.get_inbox_summary",
    domain: "email",
    modes: ["read", "summarize"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["email.read"],
    description:
      "Summarize the inbox (unread count + recent messages). Use for “what’s in my Gmail/inbox”. Do not open Gmail.",
  },
  {
    id: "email.list_unread",
    domain: "email",
    modes: ["read", "search"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["email.read"],
    description:
      "List unread inbox messages. Use for “show unread emails”. Do not open Gmail.",
  },
  {
    id: "email.search_messages",
    domain: "email",
    modes: ["search", "read"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["email.read"],
    description: "Search email messages. Does not open the email application.",
  },
  {
    id: "email.summarize_messages",
    domain: "email",
    modes: ["summarize"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["email.read"],
    description: "Retrieve and summarize email messages for a range. Does not open Gmail.",
  },
  {
    id: "email.create_draft",
    domain: "email",
    modes: ["draft", "create"],
    sideEffect: "external-write",
    requiresConnection: true,
    requiredScopes: ["email.compose"],
    description:
      "Create an email draft for review. Never sends. Do not use email.send_* for draft/compose/write requests.",
  },
  {
    id: "email.reply_draft",
    domain: "email",
    modes: ["draft"],
    sideEffect: "external-write",
    requiresConnection: true,
    requiredScopes: ["email.compose"],
    description:
      "Create a reply draft to an existing message. Does not send until the user explicitly confirms sending.",
  },
  {
    id: "email.send_draft",
    domain: "email",
    modes: ["send"],
    sideEffect: "external-write",
    requiresConnection: true,
    requiredScopes: ["email.send"],
    description:
      "Send an existing draft. Use only when the user explicitly asks to send. Always requires confirmation policy.",
  },
  {
    id: "email.open_inbox_ui",
    domain: "email",
    modes: ["open"],
    sideEffect: "reversible",
    requiresConnection: false,
    description:
      "Open the preferred email application or web inbox. Use ONLY for explicit open/launch/go-to email requests. Do not use to answer questions about recent or unread mail.",
  },
  {
    id: "email.open_message",
    domain: "email",
    modes: ["open"],
    sideEffect: "reversible",
    requiresConnection: true,
    requiredScopes: ["email.read"],
    description:
      "Open a specific email message after it has been identified. Requires a prior get_latest or get_message step.",
  },
  {
    id: "email.get_connection_status",
    domain: "email",
    modes: ["read", "explain"],
    sideEffect: "none",
    requiresConnection: false,
    description: "Report whether an email account is connected to ArcSonare.",
  },
  {
    id: "drive.list",
    domain: "drive",
    modes: ["read", "search"],
    sideEffect: "read-only",
    requiresConnection: true,
    requiredScopes: ["drive.read"],
    description:
      "List or search Google Drive contents. Does not open Drive in a browser.",
  },
  {
    id: "drive.open_ui",
    domain: "drive",
    modes: ["open"],
    sideEffect: "reversible",
    requiresConnection: false,
    description:
      "Open Google Drive. Use only for explicit open/go-to requests.",
  },
  {
    id: "tasks.list",
    domain: "tasks",
    modes: ["read", "search"],
    sideEffect: "read-only",
    requiresConnection: false,
    description: "List ArcSonare tasks. Does not open an external task app.",
  },
  {
    id: "arcsonare.navigate",
    domain: "arcsonare",
    modes: ["navigate", "open"],
    sideEffect: "reversible",
    requiresConnection: false,
    description:
      "Navigate to an ArcSonare page (Dashboard, Tasks, Agent, Connect, Settings).",
  },
  {
    id: "applications.open",
    domain: "applications",
    modes: ["open", "focus"],
    sideEffect: "reversible",
    requiresConnection: false,
    description:
      "Open or focus a desktop/web application. Use only for explicit open/launch/go-to/focus verbs.",
  },
];

export function getCapability(id: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.find((c) => c.id === id);
}

/** Allowed capability ids for a contract (domain + mode). */
export function allowedCapabilitiesFor(contract: IntentContract): CapabilityDefinition[] {
  return CAPABILITY_CATALOG.filter(
    (c) =>
      c.domain === contract.domain &&
      c.modes.includes(contract.mode) &&
      // Never expose write/destructive tools for read-only intents
      !(
        (contract.sideEffect === "read-only" || contract.sideEffect === "none") &&
        (c.sideEffect === "external-write" ||
          c.sideEffect === "destructive" ||
          c.sideEffect === "privileged")
      ),
  );
}

/** Pick the primary capability for a classified contract. */
export function mapIntentToCapability(contract: IntentContract): string | undefined {
  if (contract.capabilityId) return contract.capabilityId;

  const { domain, mode, requestedData, object } = contract;

  if (domain === "calendar") {
    if (requestedData?.includes("connection") || object === "connection") {
      return "calendar.get_connection_status";
    }
    if (mode === "open") {
      return object === "event" || requestedData?.includes("next")
        ? "calendar.open_event"
        : "calendar.open_ui";
    }
    if (mode === "search") return "calendar.search_events";
    if (requestedData?.includes("next")) return "calendar.get_next_event";
    return "calendar.list_events";
  }

  if (domain === "email") {
    if (requestedData?.includes("connection") || object === "connection") {
      return "email.get_connection_status";
    }
    if (mode === "open") {
      return object === "message" || requestedData?.includes("latest")
        ? "email.open_message"
        : "email.open_inbox_ui";
    }
    if (mode === "draft") {
      return object === "reply" ? "email.reply_draft" : "email.create_draft";
    }
    if (mode === "send") return "email.send_draft";
    if (mode === "search") return "email.search_messages";
    if (mode === "summarize") return "email.summarize_messages";
    if (requestedData?.includes("unread")) return "email.list_unread";
    if (requestedData?.includes("latest")) return "email.get_latest_message";
    if (requestedData?.includes("inbox") || object === "gmail") {
      return "email.get_inbox_summary";
    }
    return "email.get_latest_message";
  }

  if (domain === "drive") {
    return mode === "open" ? "drive.open_ui" : "drive.list";
  }

  if (domain === "tasks") {
    return mode === "navigate" || (mode === "open" && contract.explicitOpen)
      ? "arcsonare.navigate"
      : "tasks.list";
  }

  if (domain === "arcsonare") return "arcsonare.navigate";
  if (domain === "applications" && (mode === "open" || mode === "focus")) {
    return "applications.open";
  }

  return undefined;
}
