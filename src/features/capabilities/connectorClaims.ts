/**
 * Stopping the model from upgrading a connector's access level.
 *
 * Observed live: the registry said YouTube has **public read-only** access, and
 * the assistant reported "full read-only access". One word, and it inverts the
 * meaning — "public" says it cannot see your data, "full" says it can see all
 * of it. A user reading that would reasonably expect subscriptions and history
 * to work.
 *
 * The fact-check gate misses this because it is not a success/failure
 * contradiction; the action succeeded and the sentence is about scope. So scope
 * gets its own guard.
 *
 * The model still writes the sentence. It may not widen what the sentence
 * claims: absolute qualifiers are rewritten to the registry's own wording, and
 * a claim that cannot be repaired is rejected outright.
 */

/** Words that widen a scope claim beyond what any limited connector supports. */
const ABSOLUTE = /\b(full|fully|complete|completely|entire|total|unrestricted|unlimited|everything|all\s+(?:of\s+)?(?:its|the|your)?\s*(?:features|capabilities|tools|access|data))\b/gi;

/** Claims of account reach that a public-only credential cannot support. */
const ACCOUNT_SCOPED =
  /\b(your\s+(?:subscriptions?|watch\s+history|likes?|liked\s+videos?|private\s+playlists?|uploads?)|signed[- ]in\s+account|your\s+account'?s?\s+(?:videos?|data))\b/i;

export interface ConnectorClaimFacts {
  /** The registry's own wording, e.g. "Public read-only". */
  accessLevel: string;
  /** True when the connector cannot reach the user's own account data. */
  publicOnly: boolean;
  /** True when there are documented gaps — any absolute claim is then false. */
  limited: boolean;
}

export type ClaimVerdict =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * Derive the guard's inputs from a connector profile.
 *
 * `publicOnly` is inferred from the access level rather than hand-flagged, so a
 * connector whose wording changes carries its own constraint with it.
 */
export function claimFactsFor(input: {
  accessLevel: string;
  unavailable: string[];
}): ConnectorClaimFacts {
  return {
    accessLevel: input.accessLevel,
    publicOnly: /public/i.test(input.accessLevel),
    limited: input.unavailable.length > 0 || /read-only|public|limited/i.test(input.accessLevel),
  };
}

/**
 * Check, and where possible repair, a reply that describes a connector.
 *
 * Repair is preferred over rejection: rejecting sends the answer back to a
 * deterministic template and loses the natural phrasing that made these replies
 * worth generating. Only a claim with no safe substitution is refused.
 */
export function enforceConnectorClaims(
  text: string,
  facts: ConnectorClaimFacts,
): ClaimVerdict {
  let out = text;

  if (facts.limited) {
    // "full read-only access" → "public read-only access". The registry's own
    // qualifier replaces the model's, rather than the phrase being deleted,
    // so the sentence still reads naturally.
    const qualifier = facts.publicOnly ? "public" : "limited";
    out = out.replace(ABSOLUTE, (match) =>
      /^all\b/i.test(match) ? `the available ${match.replace(/^all\s+(?:of\s+)?(?:its|the|your)?\s*/i, "")}` : qualifier,
    );
    // Collapse a doubled qualifier produced by the substitution
    // ("public public read-only").
    out = out.replace(/\b(public|limited)\s+\1\b/gi, "$1");
  }

  if (facts.publicOnly && ACCOUNT_SCOPED.test(out)) {
    // No substitution can make "your subscriptions" true for a project-scoped
    // key. Refusing sends this to the deterministic path, which states the
    // access level correctly.
    return {
      ok: false,
      reason: "claimed account-scoped access on a public-only connector",
    };
  }

  return { ok: true, text: out };
}

/**
 * The exact sentence fragment the model should be given, so it has no reason to
 * invent a qualifier of its own.
 */
export function accessLevelSentence(input: {
  displayName: string;
  accessLevel: string;
  available: string[];
  unavailable: string[];
}): string {
  const lines = [`${input.displayName}: ${input.accessLevel}.`];
  if (input.available.length > 0) {
    lines.push(`Can: ${input.available.join(", ")}.`);
  } else {
    lines.push("No ArcSonare tools are implemented for it yet.");
  }
  if (input.unavailable.length > 0) {
    lines.push(`Cannot: ${input.unavailable.join(", ")}.`);
  }
  return lines.join(" ");
}
