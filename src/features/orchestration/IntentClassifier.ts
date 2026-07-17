/**
 * Deterministic intent classifier. Preserves user verbs: read ≠ open.
 */

import type {
  IntentContract,
  IntentMode,
  IntentPresentation,
  SideEffectClass,
} from "./IntentContract";
import { mapIntentToCapability } from "./IntentCapabilityMap";

const OPEN_VERBS =
  /\b(?:open|launch|start|go\s+to|take\s+me\s+to|navigate\s+to|bring\s+up|switch\s+to|focus|open\s+in\s+browser|open\s+the\s+website|open\s+the\s+desktop\s+app|show\s+the\s+application)\b/i;

const READ_VERBS =
  /\b(?:what(?:'?s|\s+is|\s+are)?|which|who|when|how\s+many|tell\s+me|list|show(?:\s+me)?|summarize|summary|check|review|read|find|search|latest|next|upcoming|unread|due|available|scheduled|do\s+i\s+have|anything)\b/i;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function base(
  utterance: string,
  partial: Omit<IntentContract, "utterance" | "capabilityId"> & {
    capabilityId?: string;
  },
): IntentContract {
  const contract: IntentContract = {
    ...partial,
    utterance: utterance.trim(),
  };
  contract.capabilityId = mapIntentToCapability(contract);
  return contract;
}

function presentationFor(mode: IntentMode): IntentPresentation {
  if (mode === "open" || mode === "navigate" || mode === "focus") return "open-ui";
  if (mode === "summarize") return "summary";
  if (mode === "search" || mode === "read") return "list";
  return "brief-answer";
}

function sideEffectFor(mode: IntentMode): SideEffectClass {
  switch (mode) {
    case "answer":
    case "explain":
    case "compare":
    case "confirm":
    case "cancel":
    case "unknown":
      return "none";
    case "read":
    case "search":
    case "summarize":
      return "read-only";
    case "open":
    case "navigate":
    case "focus":
      return "reversible";
    case "draft":
    case "create":
    case "update":
    case "send":
      return "external-write";
    case "delete":
      return "destructive";
    case "execute":
      return "privileged";
    default:
      return "none";
  }
}

function hasExplicitOpen(n: string): boolean {
  return OPEN_VERBS.test(n);
}

function looksLikeRead(n: string): boolean {
  return READ_VERBS.test(n) && !hasExplicitOpen(n);
}

/** ArcSonare internal page navigation. */
function tryNavigate(n: string, utterance: string): IntentContract | null {
  const page =
    /\b(?:go\s+to|open|take\s+me\s+to|show|navigate\s+to)\s+(?:the\s+)?(tasks?|dashboard|agent|connect|settings)\b/.exec(
      n,
    ) ||
    /^(?:tasks?|dashboard|agent|connect|settings)$/.exec(n);
  if (!page) return null;
  const raw = (page[1] ?? page[0]).replace(/s$/, "");
  const object =
    raw === "task"
      ? "tasks"
      : raw === "setting"
        ? "settings"
        : raw;
  return base(utterance, {
    mode: "navigate",
    domain: "arcsonare",
    object,
    presentation: "open-ui",
    sideEffect: "reversible",
    explicitOpen: true,
    explicitSend: false,
    explicitDelete: false,
    explicitConfirmation: false,
    confidence: 0.95,
  });
}

function tryCalendar(n: string, utterance: string): IntentContract | null {
  const aboutCalendar =
    /\b(calendar|schedule|agenda|meetings?|events?)\b/.test(n) ||
    /\bgoogle\s+calendar\b/.test(n) ||
    /\bwhat\s+do\s+i\s+have\s+(today|tomorrow|this\s+week)\b/.test(n) ||
    /\bdo\s+i\s+have\s+anything\b/.test(n);
  if (!aboutCalendar) return null;

  // Explicit open calendar UI (not “open my next meeting”)
  if (
    /\b(open|launch|go\s+to|take\s+me\s+to|bring\s+up)\s+(?:my\s+)?(?:google\s+)?calendar\b/.test(
      n,
    )
  ) {
    return base(utterance, {
      mode: "open",
      domain: "calendar",
      object: "calendar",
      presentation: "open-ui",
      sideEffect: "reversible",
      explicitOpen: true,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.96,
    });
  }

  // Open next meeting / open next event
  if (hasExplicitOpen(n) && /\b(next\s+meeting|next\s+event|my\s+next\s+meeting)\b/.test(n)) {
    return base(utterance, {
      mode: "open",
      domain: "calendar",
      object: "event",
      requestedData: ["next"],
      presentation: "open-ui",
      sideEffect: "reversible",
      explicitOpen: true,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.93,
    });
  }

  // Compound: tell me what's on calendar and open it
  if (looksLikeRead(n) && hasExplicitOpen(n) && /\band\s+(?:then\s+)?open\b/.test(n)) {
    return base(utterance, {
      mode: "read",
      domain: "calendar",
      requestedData: ["today"],
      timeRange: { relativeExpression: "today" },
      presentation: "list",
      sideEffect: "read-only",
      explicitOpen: true,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.9,
      ambiguity: {
        reason: "Compound read then open — execute list_events first; open_ui only after summary.",
        alternatives: ["open"],
      },
    });
  }

  // Next event
  if (/\b(next\s+(?:meeting|event|on\s+my\s+calendar)|what(?:'?s|\s+is)\s+next)\b/.test(n)) {
    return base(utterance, {
      mode: "read",
      domain: "calendar",
      requestedData: ["next"],
      presentation: "brief-answer",
      sideEffect: "read-only",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.95,
    });
  }

  // Tomorrow / this week / today / general calendar read
  if (
    looksLikeRead(n) ||
    /\b(on\s+my\s+calendar|my\s+calendar|my\s+schedule|my\s+agenda|do\s+i\s+have)\b/.test(n)
  ) {
    let relative = "today";
    if (/\btomorrow\b/.test(n)) relative = "tomorrow";
    else if (/\bthis\s+week\b/.test(n)) relative = "this_week";
    else if (/\bafter\s+\d/.test(n) || /\bafter\s+(?:noon|4|four)\b/.test(n)) relative = "today_after";

    return base(utterance, {
      mode: /\bsummarize\b/.test(n) ? "summarize" : "read",
      domain: "calendar",
      requestedData: [relative === "today" ? "today" : relative],
      timeRange: { relativeExpression: relative },
      presentation: "list",
      sideEffect: "read-only",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.94,
    });
  }

  // Bare “calendar” with open verb already handled; bare “calendar” alone → open shortcut
  if (/^(?:my\s+)?(?:google\s+)?calendar$/.test(n)) {
    return base(utterance, {
      mode: "open",
      domain: "calendar",
      presentation: "open-ui",
      sideEffect: "reversible",
      explicitOpen: true,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.85,
    });
  }

  return null;
}

function tryEmail(n: string, utterance: string): IntentContract | null {
  // Send confirmations may omit the word “email”.
  if (
    /^(?:please\s+)?(?:send(?:\s+it)?(?:\s+now)?|send\s+the\s+(?:email|reply|draft)|send\s+that\s+reply)\.?$/.test(
      n,
    )
  ) {
    return base(utterance, {
      mode: "send",
      domain: "email",
      presentation: "artifact",
      sideEffect: "external-write",
      explicitOpen: false,
      explicitSend: true,
      explicitDelete: false,
      explicitConfirmation: true,
      confidence: 0.92,
    });
  }

  const aboutEmail =
    /\b(email|emails|inbox|gmail|mail|message|messages|reply)\b/.test(n);
  if (!aboutEmail) return null;

  // Explicit open inbox
  if (
    /\b(open|launch|go\s+to|take\s+me\s+to|bring\s+up)\s+(?:my\s+)?(?:gmail|inbox|email|mail)\b/.test(
      n,
    ) ||
    /^(?:open|launch)\s+(?:my\s+)?(?:gmail|inbox)$/.test(n)
  ) {
    // Unless “open my latest email/message”
    if (!/\b(latest|most\s+recent|last)\b/.test(n)) {
      return base(utterance, {
        mode: "open",
        domain: "email",
        object: "inbox",
        presentation: "open-ui",
        sideEffect: "reversible",
        explicitOpen: true,
        explicitSend: false,
        explicitDelete: false,
        explicitConfirmation: false,
        confidence: 0.96,
      });
    }
  }

  // Open latest email
  if (hasExplicitOpen(n) && /\b(latest|most\s+recent|last)\b/.test(n) && /\b(email|mail|message)\b/.test(n)) {
    return base(utterance, {
      mode: "open",
      domain: "email",
      object: "message",
      requestedData: ["latest"],
      presentation: "open-ui",
      sideEffect: "reversible",
      explicitOpen: true,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.93,
    });
  }

  // Send
  if (/\b(send(?:\s+it|\s+the\s+(?:email|reply|draft))?|send\s+that\s+reply)\b/.test(n) &&
      !/\bdraft\b/.test(n)) {
    return base(utterance, {
      mode: "send",
      domain: "email",
      presentation: "artifact",
      sideEffect: "external-write",
      explicitOpen: false,
      explicitSend: true,
      explicitDelete: false,
      explicitConfirmation: true,
      confidence: 0.9,
    });
  }

  // Draft / reply draft
  if (/\b(draft|compose|prepare|write)\b/.test(n) && /\b(email|reply|message)\b/.test(n)) {
    const isReply = /\breply\b/.test(n);
    return base(utterance, {
      mode: "draft",
      domain: "email",
      object: isReply ? "reply" : "email",
      requestedData: isReply && /\blatest\b/.test(n) ? ["latest"] : undefined,
      presentation: "artifact",
      sideEffect: "external-write",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.93,
    });
  }

  if (/\breply\s+to\b/.test(n) && !/\bsend\b/.test(n)) {
    return base(utterance, {
      mode: "draft",
      domain: "email",
      object: "reply",
      requestedData: /\blatest\b/.test(n) ? ["latest"] : undefined,
      presentation: "artifact",
      sideEffect: "external-write",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.92,
    });
  }

  // Unread
  if (/\bunread\b/.test(n)) {
    return base(utterance, {
      mode: "read",
      domain: "email",
      requestedData: ["unread"],
      presentation: "list",
      sideEffect: "read-only",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.95,
    });
  }

  // Latest
  if (/\b(latest|most\s+recent|last)\b/.test(n) && /\b(email|mail|message)\b/.test(n)) {
    return base(utterance, {
      mode: "read",
      domain: "email",
      requestedData: ["latest"],
      presentation: "brief-answer",
      sideEffect: "read-only",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.95,
    });
  }

  // Inbox / Gmail contents
  if (
    /\b(what(?:'?s|\s+is)\s+in\s+my\s+(?:gmail|inbox|email)|check\s+my\s+(?:gmail|inbox|email|mail)|what(?:'?s|\s+is)\s+in\s+gmail)\b/.test(
      n,
    ) ||
    /\b(show|list|check)\s+(?:my\s+)?(?:inbox|gmail|emails?)\b/.test(n)
  ) {
    return base(utterance, {
      mode: "read",
      domain: "email",
      object: "gmail",
      requestedData: ["inbox"],
      presentation: "summary",
      sideEffect: "read-only",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.94,
    });
  }

  // Generic “check my email” / “look at my inbox”
  if (
    looksLikeRead(n) ||
    /\b(check|look\s+at|review)\s+my\s+(email|inbox|mail|gmail)\b/.test(n)
  ) {
    return base(utterance, {
      mode: "read",
      domain: "email",
      requestedData: ["inbox"],
      presentation: "summary",
      sideEffect: "read-only",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.9,
    });
  }

  // Bare gmail → open shortcut
  if (/^(?:my\s+)?gmail$/.test(n)) {
    return base(utterance, {
      mode: "open",
      domain: "email",
      object: "inbox",
      presentation: "open-ui",
      sideEffect: "reversible",
      explicitOpen: true,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.88,
    });
  }

  return null;
}

function tryDrive(n: string, utterance: string): IntentContract | null {
  if (!/\b(google\s+drive|gdrive|my\s+drive)\b/.test(n) && !/\bdrive\b/.test(n)) {
    return null;
  }
  // Avoid false positives like “driver”
  if (/\bdriver\b/.test(n) && !/\bgoogle\s+drive\b/.test(n)) return null;

  if (hasExplicitOpen(n) && /\b(drive|google\s+drive)\b/.test(n)) {
    return base(utterance, {
      mode: "open",
      domain: "drive",
      presentation: "open-ui",
      sideEffect: "reversible",
      explicitOpen: true,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.93,
    });
  }

  if (looksLikeRead(n) || /\b(what(?:'?s|\s+is)\s+in|list|show|find)\b/.test(n)) {
    return base(utterance, {
      mode: "read",
      domain: "drive",
      presentation: "list",
      sideEffect: "read-only",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.9,
    });
  }

  return null;
}

function tryTasks(n: string, utterance: string): IntentContract | null {
  if (!/\btasks?\b/.test(n)) return null;
  if (/\b(list|show|what|due|my\s+tasks)\b/.test(n) && !hasExplicitOpen(n)) {
    return base(utterance, {
      mode: "read",
      domain: "tasks",
      presentation: "list",
      sideEffect: "read-only",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.9,
    });
  }
  return null;
}

/**
 * Classify an utterance into an IntentContract.
 * Prefer read-only when ambiguous between read and open.
 */
export function classifyIntent(utterance: string): IntentContract {
  const text = utterance.trim();
  const n = normalize(text);

  if (!n) {
    return base(text, {
      mode: "unknown",
      domain: "general",
      presentation: "brief-answer",
      sideEffect: "none",
      explicitOpen: false,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0,
    });
  }

  const nav = tryNavigate(n, text);
  if (nav) return nav;

  const cal = tryCalendar(n, text);
  if (cal) return cal;

  const email = tryEmail(n, text);
  if (email) return email;

  const drive = tryDrive(n, text);
  if (drive) return drive;

  const tasks = tryTasks(n, text);
  if (tasks) return tasks;

  // Explicit open with remaining app names left to overlay resolver
  if (hasExplicitOpen(n)) {
    return base(text, {
      mode: "open",
      domain: "applications",
      presentation: "open-ui",
      sideEffect: "reversible",
      explicitOpen: true,
      explicitSend: false,
      explicitDelete: false,
      explicitConfirmation: false,
      confidence: 0.55,
    });
  }

  return base(text, {
    mode: "answer",
    domain: "general",
    presentation: presentationFor("answer"),
    sideEffect: sideEffectFor("answer"),
    explicitOpen: false,
    explicitSend: false,
    explicitDelete: false,
    explicitConfirmation: false,
    confidence: 0.4,
  });
}

/** True when this utterance must be handled by the orchestration layer. */
export function isOrchestratedDomain(contract: IntentContract): boolean {
  if (contract.domain === "calendar" || contract.domain === "email" || contract.domain === "drive") {
    return true;
  }
  if (contract.domain === "arcsonare" && contract.mode === "navigate") return true;
  if (contract.domain === "tasks" && contract.mode === "read") return true;
  return false;
}

/** Defense: never treat a read-flavored utterance as a bare app-open. */
export function blocksBareAppOpen(utterance: string): boolean {
  const n = normalize(utterance);
  if (!n) return false;
  if (hasExplicitOpen(n) && !looksLikeRead(n)) return false;
  return looksLikeRead(n) || /\b(on\s+my\s+calendar|in\s+my\s+gmail|my\s+inbox|unread|latest\s+email)\b/.test(n);
}
