/**
 * Resolves spoken / typed phrases to top-overlay icon registry entries.
 * Prefers exact alias matches; refuses ambiguous partial-only hits.
 */

import {
  getIconById,
  TOP_OVERLAY_ICONS,
  type TopOverlayIconDefinition,
} from "../../config/topOverlayIconRegistry";
import { blocksBareAppOpen } from "../orchestration/IntentClassifier";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ResolveResult =
  | { kind: "exact"; entry: TopOverlayIconDefinition }
  | { kind: "ambiguous"; candidates: TopOverlayIconDefinition[]; question: string }
  | { kind: "none" };

/**
 * Match a phrase against aliases. Exact alias / display-name wins.
 * If multiple distinct apps match as whole-phrase aliases, ask to clarify.
 */
export function resolveApplicationPhrase(phrase: string): ResolveResult {
  const n = normalize(phrase);
  if (!n) return { kind: "none" };

  const exact: TopOverlayIconDefinition[] = [];
  for (const entry of TOP_OVERLAY_ICONS) {
    const names = [entry.displayName, ...entry.aliases].map(normalize);
    if (names.includes(n)) {
      exact.push(entry);
    }
  }

  const uniqueExact = dedupeById(exact);
  if (uniqueExact.length === 1) {
    return { kind: "exact", entry: uniqueExact[0] };
  }
  if (uniqueExact.length > 1) {
    return {
      kind: "ambiguous",
      candidates: uniqueExact,
      question: `Which did you mean: ${uniqueExact.map((e) => e.displayName).join(", ")}?`,
    };
  }

  // Contained alias match — only when a single app's alias appears as a
  // whole token phrase inside the input (not partial substrings like "code"
  // inside "encode").
  const tokenHits: TopOverlayIconDefinition[] = [];
  for (const entry of TOP_OVERLAY_ICONS) {
    for (const alias of [entry.displayName, ...entry.aliases]) {
      const a = normalize(alias);
      if (!a || a.length < 3) continue;
      const re = new RegExp(`(?:^|\\s)${escapeRegExp(a)}(?:$|\\s)`, "i");
      if (re.test(n)) {
        tokenHits.push(entry);
        break;
      }
    }
  }

  const uniqueTokens = dedupeById(tokenHits);
  if (uniqueTokens.length === 1) {
    return { kind: "exact", entry: uniqueTokens[0] };
  }
  if (uniqueTokens.length > 1) {
    return {
      kind: "ambiguous",
      candidates: uniqueTokens,
      question: `Which app did you mean: ${uniqueTokens.map((e) => e.displayName).join(", ")}?`,
    };
  }

  return { kind: "none" };
}

function dedupeById(entries: TopOverlayIconDefinition[]): TopOverlayIconDefinition[] {
  const seen = new Set<string>();
  const out: TopOverlayIconDefinition[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type ParsedIntent =
  | { kind: "open"; appId: string; entry: TopOverlayIconDefinition }
  | { kind: "search"; query: string }
  | { kind: "draft-email"; to?: string; subject?: string; body?: string }
  | { kind: "send-email" }
  | { kind: "schedule-meeting"; title?: string }
  | { kind: "create-task"; title: string }
  | { kind: "screen-context" }
  | { kind: "mention"; appId: string; entry: TopOverlayIconDefinition; question: string }
  | { kind: "clarify"; question: string; options: { id: string; label: string }[] }
  | { kind: "respond"; text: string };

/** Local demo contacts for voice email prototypes. */
const DEMO_CONTACTS: Record<string, { name: string; email: string }> = {
  "my boss": { name: "Kelvin", email: "kelvin@acme.com" },
  boss: { name: "Kelvin", email: "kelvin@acme.com" },
  kelvin: { name: "Kelvin", email: "kelvin@acme.com" },
  julia: { name: "Julia", email: "julia@acme.com" },
  "the team": { name: "Team", email: "team@acme.com" },
};

const OPEN_RE =
  /^(?:please\s+)?(?:open|launch|start|run)\s+(?:the\s+)?(.+?)(?:\s+app|\s+application|\s+website|\s+site)?\.?$/i;
const SEARCH_RE =
  /^(?:please\s+)?(?:search(?:\s+the\s+web)?(?:\s+for)?|google|look\s+up)\s+(.+)$/i;
const SEND_CONFIRM_RE =
  /^(?:please\s+)?(?:send(?:\s+it)?(?:\s+now)?|confirm(?:\s+send)?|yes(?:\s+send(?:\s+it)?)?)\.?$/i;
const MEETING_RE =
  /^(?:please\s+)?(?:schedule|set\s+up|book)\s+(?:a\s+)?(?:meeting|call|sync)(?:\s+(?:called|titled|for)\s+(.+))?\.?$/i;
const TASK_RE =
  /^(?:please\s+)?(?:create|add|make)\s+(?:a\s+)?task(?:\s+to\s+|\s+)(.+)$/i;
const SCREEN_RE =
  /^(?:please\s+)?(?:enable\s+)?screen\s+context(?:\s+(?:on|enabled))?\.?$/i;
const HOW_RE =
  /^(?:how\s+does|what\s+is|tell\s+me\s+about|explain)\s+(.+?)(?:\s+work)?\??$/i;

const EMAIL_PREFIX =
  /^(?:please\s+|i want you to\s+|can you\s+|could you\s+)?/i;

/** Resolve “my boss” / “Kelvin” style recipients for the email prototype. */
export function resolveDemoContact(raw: string | undefined): {
  display: string;
  email: string;
} | null {
  if (!raw?.trim()) return null;
  const key = normalize(raw);
  const hit = DEMO_CONTACTS[key];
  if (hit) return { display: hit.name, email: hit.email };
  // Bare first name or email address
  if (raw.includes("@")) return { display: raw.trim(), email: raw.trim() };
  const name = raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    display: name,
    email: `${normalize(raw).replace(/\s+/g, ".")}@acme.com`,
  };
}

/**
 * Parse spoken email requests:
 * “email my boss”, “email Kelvin and say how is the project going”,
 * “draft an email to Julia about Q2”.
 */
function parseEmailUtterance(text: string): Extract<ParsedIntent, { kind: "draft-email" }> | null {
  // Normalize STT quirks: “E-mail”, “mail Kelvin…”, leading fillers.
  const cleaned = text
    .replace(EMAIL_PREFIX, "")
    .replace(/\be[\s-]?mail\b/gi, "email")
    .replace(/\s+/g, " ")
    .trim();

  // draft/write/compose an email to X about/saying Y
  let m = cleaned.match(
    /^(?:draft|write|compose)\s+(?:an?\s+)?email(?:\s+to\s+(.+?))?(?:\s+(?:about|saying|that says)\s+(.+))?\.?$/i,
  );
  if (m) {
    return { kind: "draft-email", to: m[1]?.trim(), subject: undefined, body: m[2]?.trim() };
  }

  // email / mail X and say/tell them/ask Y
  m = cleaned.match(
    /^(?:send\s+)?(?:an?\s+)?(?:email|mail)(?:\s+to)?\s+(.+?)\s+and\s+(?:say|tell(?:\s+them)?|ask|write)\s+(.+)$/i,
  );
  if (m) {
    return { kind: "draft-email", to: m[1].trim(), body: m[2].replace(/\.$/, "").trim() };
  }

  // email X about Y
  m = cleaned.match(
    /^(?:send\s+)?(?:an?\s+)?(?:email|mail)(?:\s+to)?\s+(.+?)\s+about\s+(.+)$/i,
  );
  if (m) {
    return { kind: "draft-email", to: m[1].trim(), subject: m[2].replace(/\.$/, "").trim() };
  }

  // email X / email my boss / mail Kelvin
  m = cleaned.match(/^(?:send\s+)?(?:an?\s+)?(?:email|mail)(?:\s+to)?\s+(.+)$/i);
  if (m) {
    const rest = m[1].replace(/\.$/, "").trim();
    // Avoid treating bare “email” / app names as a draft (those open Gmail).
    if (!rest || /^(?:app|application|client|gmail|google\s*mail)$/i.test(rest)) {
      return null;
    }
    return { kind: "draft-email", to: rest };
  }

  return null;
}

/** True when the utterance is a spoken send confirmation. */
export function isSendConfirmUtterance(utterance: string): boolean {
  return SEND_CONFIRM_RE.test(utterance.trim());
}

/**
 * Parse a user utterance into a structured overlay intent.
 * Opening verbs open; informational phrasing only mentions.
 */
export function parseOverlayIntent(utterance: string): ParsedIntent {
  const text = utterance.trim();
  if (!text) return { kind: "respond", text: "" };

  if (SEND_CONFIRM_RE.test(text)) {
    return { kind: "send-email" };
  }

  const search = text.match(SEARCH_RE);
  if (search) {
    return { kind: "search", query: search[1].trim() };
  }

  const email = parseEmailUtterance(text);
  if (email) {
    return email;
  }

  const meeting = text.match(MEETING_RE);
  if (meeting) {
    return { kind: "schedule-meeting", title: meeting[1]?.trim() };
  }

  const task = text.match(TASK_RE);
  if (task) {
    return { kind: "create-task", title: task[1].replace(/\.$/, "").trim() };
  }

  if (SCREEN_RE.test(text)) {
    return { kind: "screen-context" };
  }

  const how = text.match(HOW_RE);
  if (how) {
    const resolved = resolveApplicationPhrase(how[1]);
    if (resolved.kind === "exact") {
      return {
        kind: "mention",
        appId: resolved.entry.id,
        entry: resolved.entry,
        question: text,
      };
    }
    if (resolved.kind === "ambiguous") {
      return {
        kind: "clarify",
        question: resolved.question,
        options: resolved.candidates.map((c) => ({ id: c.id, label: c.displayName })),
      };
    }
  }

  const open = text.match(OPEN_RE);
  if (open) {
    const resolved = resolveApplicationPhrase(open[1]);
    if (resolved.kind === "exact") {
      return { kind: "open", appId: resolved.entry.id, entry: resolved.entry };
    }
    if (resolved.kind === "ambiguous") {
      return {
        kind: "clarify",
        question: resolved.question,
        options: resolved.candidates.map((c) => ({ id: c.id, label: c.displayName })),
      };
    }
    return { kind: "respond", text: `I couldn't find an app named “${open[1].trim()}”.` };
  }

  // Bare app name → treat as open (common voice shortcut).
  // Never open from a read/query utterance (“what's on my calendar?”).
  if (!blocksBareAppOpen(text)) {
    const bare = resolveApplicationPhrase(text.replace(/\.$/, ""));
    if (bare.kind === "exact") {
      return { kind: "open", appId: bare.entry.id, entry: bare.entry };
    }
    if (bare.kind === "ambiguous") {
      return {
        kind: "clarify",
        question: bare.question,
        options: bare.candidates.map((c) => ({ id: c.id, label: c.displayName })),
      };
    }
  }

  return { kind: "respond", text };
}

export function iconForAppId(appId: string): string | undefined {
  return getIconById(appId)?.iconPath;
}
