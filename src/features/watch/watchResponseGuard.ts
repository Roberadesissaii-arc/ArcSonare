/**
 * The final-response guard for Watch-scoped turns.
 *
 * The reported failure, verbatim:
 *
 *   "I can do things on your PC — open apps and websites, take screenshots…"
 *
 * That sentence is true of ArcSonare and wrong as an answer, because the
 * conversation was scoped to one watched application. The prompt tells the
 * model not to do it; this catches the case where it does anyway.
 *
 * The guard is deliberately narrow. It runs only on capability questions in a
 * scoped conversation, and it only rejects claims that are checkably false
 * against the ability list — it never rewrites prose it merely dislikes.
 */
import type { ApplicationAbilities } from "./watchAbilityTypes";
import { availableNow, unsupported } from "./watchAbilityTypes";

/** Questions whose answer must come from the watched application. */
const CAPABILITY_QUESTION =
  /\b(?:what\s+(?:can|could)\s+(?:you|i)\s+(?:do|control|see|help)|what\s+are\s+you\s+able|what\s+do\s+you\s+(?:see|know|have\s+access)|help\s+me\s+with\s+(?:this|it)|what\s+can\s+i\s+do\s+(?:in|with)\s+(?:this|it)|what(?:'s| is)\s+(?:going\s+on|happening)|what(?:'s| is)\s+wrong|why\s+does\s+it\s+keep)\b/i;

export function isWatchCapabilityQuestion(text: string): boolean {
  return CAPABILITY_QUESTION.test(text.trim());
}

/**
 * Phrases that name ArcSonare's global feature set.
 *
 * Matched only as *offers* — "I can take screenshots" — so a factual mention
 * ("I can't take a screenshot of that") does not trip the guard.
 */
const GLOBAL_OFFERS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:take|capture)\s+(?:a\s+)?screenshots?\b/i, label: "screenshots" },
  { pattern: /\bopen\s+(?:apps?|applications?|websites?|programs?)\b/i, label: "opening applications" },
  { pattern: /\b(?:manage|create|add)\s+(?:your\s+)?tasks?\b/i, label: "task management" },
  { pattern: /\b(?:check|read|manage)\s+(?:your\s+)?(?:calendar|schedule)\b/i, label: "calendar" },
  { pattern: /\b(?:read|check|send)\s+(?:your\s+)?(?:email|gmail|mail)\b/i, label: "email" },
  { pattern: /\bsearch\s+the\s+web\b/i, label: "web search" },
  { pattern: /\b(?:browse|manage)\s+(?:your\s+)?files?\b/i, label: "file management" },
  { pattern: /\bthings\s+on\s+your\s+pc\b/i, label: "generic PC abilities" },
];

/** A negation immediately before the phrase makes it a limitation, not an offer. */
function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return /\b(?:can'?t|cannot|won'?t|not able to|no way to|unable to|don'?t)\b[^.]*$/.test(
    before,
  );
}

export interface GuardVerdict {
  ok: boolean;
  /** Machine-readable reasons, for the regeneration prompt and diagnostics. */
  violations: string[];
  /** What to tell the model when asking it again. */
  correction: string | null;
}

/**
 * Check a response against the scoped ability list.
 *
 * Returns `ok` when the conversation is not scoped, or the question was not a
 * capability question — global behaviour is correct in both cases.
 */
export function checkWatchResponse(input: {
  responseText: string;
  requestText: string;
  abilities: ApplicationAbilities[];
}): GuardVerdict {
  const { responseText, requestText, abilities } = input;
  if (abilities.length === 0) return { ok: true, violations: [], correction: null };
  if (!isWatchCapabilityQuestion(requestText)) {
    return { ok: true, violations: [], correction: null };
  }

  const violations: string[] = [];

  // 1. Global offers, not negated.
  for (const { pattern, label } of GLOBAL_OFFERS) {
    const match = pattern.exec(responseText);
    if (match && !isNegated(responseText, match.index)) {
      violations.push(`offers "${label}", which is not part of this conversation`);
    }
  }

  // 2. The watched application must be named. An answer about Discord that
  //    never says Discord is not identifiably about Discord.
  const namesOne = abilities.some((app) =>
    new RegExp(`\\b${escapeRegex(app.displayName)}\\b`, "i").test(responseText),
  );
  if (!namesOne) {
    violations.push(
      `never names ${abilities.map((a) => a.displayName).join(" or ")}`,
    );
  }

  // 3. Nothing the adapter has explicitly declared impossible.
  for (const app of abilities) {
    for (const ability of unsupported(app)) {
      const claim = claimPattern(ability.label);
      if (claim && claim.test(responseText) && !isNegated(responseText, responseText.search(claim))) {
        violations.push(
          `claims "${ability.label}" for ${app.displayName}, which the adapter cannot do`,
        );
      }
    }
  }

  // 4. A closed application must not be described as actionable now.
  for (const app of abilities) {
    if (app.running) continue;
    if (availableNow(app).length === 0 && !/\b(?:not running|isn'?t running|closed|reopen)\b/i.test(responseText)) {
      violations.push(
        `does not say that ${app.displayName} is not running, so the abilities listed cannot be used yet`,
      );
    }
  }

  if (violations.length === 0) {
    return { ok: true, violations: [], correction: null };
  }
  return { ok: false, violations, correction: buildCorrection(abilities, violations) };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A pattern that would indicate the model claimed this unsupported ability.
 *
 * Built from the ability's own distinctive words rather than the whole phrase,
 * because the model will paraphrase. Returns null when the label has no words
 * specific enough to match on — a guard that fires on common words would reject
 * correct answers.
 */
function claimPattern(label: string): RegExp | null {
  const distinctive = label
    .toLowerCase()
    .split(/\W+/)
    .filter(
      (word) =>
        word.length > 4 &&
        ![
          "message",
          "window",
          "application",
          "content",
          "through",
          "channel",
          "arbitrary",
          "command",
          "history",
          "other",
          "files",
        ].includes(word),
    );
  if (distinctive.length === 0) return null;
  return new RegExp(`\\b${distinctive.map(escapeRegex).join("\\b.{0,40}\\b")}\\b`, "i");
}

/** The instruction handed back to the model for one more attempt. */
function buildCorrection(
  abilities: ApplicationAbilities[],
  violations: string[],
): string {
  const lines = [
    "That answer was wrong for this conversation:",
    ...violations.map((v) => `  - it ${v}`),
    "",
    "This conversation is scoped to:",
  ];
  for (const app of abilities) {
    lines.push(`  ${app.displayName}${app.running ? "" : " (not running)"}`);
    const now = availableNow(app);
    if (now.length > 0) {
      for (const ability of now) lines.push(`    - ${ability.label}`);
    } else {
      lines.push("    - nothing until it is reopened");
    }
  }
  lines.push("");
  lines.push(
    "Answer again using only those points. Name the application. Do not mention " +
      "ArcSonare's other abilities.",
  );
  return lines.join("\n");
}
