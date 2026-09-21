/**
 * What "it" means.
 *
 * Observed failure: "press it" with nothing to refer back to routed a vision
 * click at the invented target "play button" — the router had a hard-coded
 * `?? "play button"` fallback. Inventing a target is worse than admitting
 * ignorance, because the click lands somewhere.
 *
 * Three outcomes, and the caller must handle all three:
 *
 *   resolved   — exactly one compatible entity
 *   ambiguous  — several; ask which, act on none
 *   none       — nothing compatible; ask, act on none
 *
 * There is deliberately no fourth "best guess" outcome.
 *
 * Dependency-free, like the ledger it reads: `capabilityRouter` imports this and
 * must stay importable under plain Node.
 */

import {
  referableEntities,
  type ConversationEntity,
  type EntityType,
} from "./conversationContext";

/** Phrases that mean "the thing we were just talking about". */
const PRONOUNS =
  /^(?:it|that|this|that one|this one|the one|the same|same one)$/i;

/** "the folder", "the file", "the task" — a pronoun that also names a type. */
const TYPED_PHRASES: { pattern: RegExp; types: EntityType[] }[] = [
  { pattern: /^the (?:folder|directory)$/i, types: ["folder", "desktop-item"] },
  { pattern: /^the file$/i, types: ["file", "desktop-item", "document"] },
  { pattern: /^the (?:task|todo)$/i, types: ["task"] },
  { pattern: /^the (?:app|application|program)$/i, types: ["application"] },
  { pattern: /^the (?:document|doc)$/i, types: ["document", "file"] },
  { pattern: /^the (?:window)$/i, types: ["window"] },
  { pattern: /^the (?:button|control)$/i, types: ["control", "visual-target"] },
];

/** "the first one", "the second one", "the 3rd" — pick by position. */
const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, one: 1,
  second: 2, "2nd": 2, two: 2,
  third: 3, "3rd": 3, three: 3,
  fourth: 4, "4th": 4, four: 4,
  fifth: 5, "5th": 5, five: 5,
};
const ORDINAL_PHRASE =
  /^the\s+(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|one|two|three|four|five)\s*(?:one|item|result)?$/i;

/**
 * Which entity types an action can sensibly apply to.
 *
 * This is what stops "mark it urgent" resolving to a folder and "highlight it"
 * resolving to a task. An action not listed here accepts anything, because a
 * missing entry should not silently narrow a resolution to nothing.
 */
const ACTION_TYPES: { pattern: RegExp; types: EntityType[] }[] = [
  {
    pattern: /\b(?:highlight|point (?:to|at)|show me where|outline)\b/i,
    types: ["desktop-item", "folder", "file", "visual-target", "control", "window", "application"],
  },
  {
    pattern: /\b(?:click|press|tap|push)\b/i,
    types: ["control", "visual-target"],
  },
  {
    pattern: /\b(?:open|launch|start|run)\b/i,
    types: ["folder", "file", "desktop-item", "application", "document", "search-result"],
  },
  {
    pattern: /\b(?:mark|complete|reopen|prioriti[sz]e|due|urgent|assign|rename)\b/i,
    types: ["task"],
  },
  {
    pattern: /\b(?:delete|remove|trash)\b/i,
    types: ["task", "file", "folder", "desktop-item"],
  },
];

export type ReferenceResolution =
  | { kind: "not-a-reference"; literal: string }
  | { kind: "resolved"; entity: ConversationEntity }
  | { kind: "ambiguous"; candidates: ConversationEntity[] }
  | { kind: "none"; requestedTypes: EntityType[] };

/** Is this phrase a back-reference rather than a name? */
export function isReferencePhrase(phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return (
    PRONOUNS.test(p) ||
    ORDINAL_PHRASE.test(p) ||
    TYPED_PHRASES.some((t) => t.pattern.test(p))
  );
}

/** Types an action is willing to act on; empty means "any". */
export function typesForAction(action: string): EntityType[] {
  const hit = ACTION_TYPES.find((a) => a.pattern.test(action));
  return hit ? hit.types : [];
}

/**
 * Resolve a possibly-referential phrase against the conversation.
 *
 * `action` is the full user utterance (or at least the verb), used only to
 * decide type compatibility — "highlight it" and "mark it urgent" mean different
 * things by "it".
 */
export function resolveReference(
  phrase: string,
  action: string,
  now = Date.now(),
): ReferenceResolution {
  const p = phrase.trim();
  if (!p) return { kind: "none", requestedTypes: [] };

  // A real name is not a reference. "press the play button" names its target.
  if (!isReferencePhrase(p)) return { kind: "not-a-reference", literal: p };

  const actionTypes = typesForAction(action);

  // "the folder" narrows further than the action alone.
  const typed = TYPED_PHRASES.find((t) => t.pattern.test(p));
  const wanted = typed
    ? actionTypes.length
      ? typed.types.filter((t) => actionTypes.includes(t))
      : typed.types
    : actionTypes;

  const all = referableEntities(now);
  const compatible = wanted.length ? all.filter((e) => wanted.includes(e.type)) : all;

  if (compatible.length === 0) return { kind: "none", requestedTypes: wanted };

  // Ordinals index into the compatible set in the order they were mentioned,
  // which is the order the user heard them — oldest first, not newest first.
  const ordinalMatch = p.match(ORDINAL_PHRASE);
  if (ordinalMatch) {
    const n = ORDINALS[ordinalMatch[1].toLowerCase()];
    const inMentionOrder = compatible.slice().reverse();
    const picked = n ? inMentionOrder[n - 1] : undefined;
    return picked
      ? { kind: "resolved", entity: picked }
      : { kind: "none", requestedTypes: wanted };
  }

  // One clear winner.
  if (compatible.length === 1) return { kind: "resolved", entity: compatible[0] };

  // Several. If the newest came from a strictly later turn than the next one,
  // the user has been talking about it since — that is a real signal, not a
  // tiebreak. Same turn means they were introduced together ("find A and B"),
  // and picking either would be a coin toss.
  const [newest, next] = compatible;
  if (newest.sourceTurn > next.sourceTurn) {
    return { kind: "resolved", entity: newest };
  }

  return { kind: "ambiguous", candidates: compatible.slice(0, 4) };
}

/** The question to ask when a reference is ambiguous. */
export function clarificationQuestion(
  action: string,
  candidates: ConversationEntity[],
): string {
  const verb = /highlight/i.test(action)
    ? "highlight"
    : /open/i.test(action)
      ? "open"
      : /click|press|tap/i.test(action)
        ? "press"
        : "use";
  const labels = candidates.map((c) => `the ${c.label}`);
  const list =
    labels.length <= 2
      ? labels.join(" or ")
      : `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
  return `Do you want me to ${verb} ${list}?`;
}

/** The question to ask when there is nothing to refer to. */
export function missingContextQuestion(action: string): string {
  if (/click|press|tap|push/i.test(action)) {
    return "I'm not sure what you want me to press. Tell me the button or item.";
  }
  if (/highlight|point/i.test(action)) {
    return "I'm not sure what you want me to highlight. Tell me the item.";
  }
  if (/open|launch/i.test(action)) {
    return "I'm not sure what you want me to open. Tell me the file, folder, or app.";
  }
  return "I'm not sure what you're referring to. Tell me which item you mean.";
}
