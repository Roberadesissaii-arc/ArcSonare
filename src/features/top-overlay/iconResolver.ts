/**
 * Resolves spoken / typed phrases to top-overlay icon registry entries.
 * Prefers exact alias matches; refuses ambiguous partial-only hits.
 */

import {
  getIconById,
  TOP_OVERLAY_ICONS,
  type TopOverlayIconDefinition,
} from "../../config/topOverlayIconRegistry";

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
  | { kind: "schedule-meeting"; title?: string }
  | { kind: "create-task"; title: string }
  | { kind: "screen-context" }
  | { kind: "mention"; appId: string; entry: TopOverlayIconDefinition; question: string }
  | { kind: "clarify"; question: string; options: { id: string; label: string }[] }
  | { kind: "respond"; text: string };

const OPEN_RE =
  /^(?:please\s+)?(?:open|launch|start|run)\s+(?:the\s+)?(.+?)(?:\s+app|\s+application|\s+website|\s+site)?\.?$/i;
const SEARCH_RE =
  /^(?:please\s+)?(?:search(?:\s+the\s+web)?(?:\s+for)?|google|look\s+up)\s+(.+)$/i;
const EMAIL_RE =
  /^(?:please\s+)?(?:draft|write|compose)\s+(?:an?\s+)?email(?:\s+to\s+(.+?))?(?:\s+about\s+(.+))?\.?$/i;
const MEETING_RE =
  /^(?:please\s+)?(?:schedule|set\s+up|book)\s+(?:a\s+)?(?:meeting|call|sync)(?:\s+(?:called|titled|for)\s+(.+))?\.?$/i;
const TASK_RE =
  /^(?:please\s+)?(?:create|add|make)\s+(?:a\s+)?task(?:\s+to\s+|\s+)(.+)$/i;
const SCREEN_RE =
  /^(?:please\s+)?(?:enable\s+)?screen\s+context(?:\s+(?:on|enabled))?\.?$/i;
const HOW_RE =
  /^(?:how\s+does|what\s+is|tell\s+me\s+about|explain)\s+(.+?)(?:\s+work)?\??$/i;

/**
 * Parse a user utterance into a structured overlay intent.
 * Opening verbs open; informational phrasing only mentions.
 */
export function parseOverlayIntent(utterance: string): ParsedIntent {
  const text = utterance.trim();
  if (!text) return { kind: "respond", text: "" };

  const search = text.match(SEARCH_RE);
  if (search) {
    return { kind: "search", query: search[1].trim() };
  }

  const email = text.match(EMAIL_RE);
  if (email) {
    return {
      kind: "draft-email",
      to: email[1]?.trim(),
      subject: email[2]?.trim(),
    };
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

  return { kind: "respond", text };
}

export function iconForAppId(appId: string): string | undefined {
  return getIconById(appId)?.iconPath;
}
