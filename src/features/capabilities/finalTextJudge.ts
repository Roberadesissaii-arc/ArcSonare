/**
 * The gate between "the model owns phrasing" and "the model owns nothing else".
 *
 * After a tool succeeds, the model has seen the verified result and written a
 * reply. That sentence is what makes an answer read as written rather than
 * assembled — but it is also the one place a model could quietly contradict
 * what actually happened. So it is checked, and a rejection is recorded with a
 * reason rather than silently swallowed.
 *
 * Its own module so it stays pure and testable without loading the engine.
 */

export type FinalTextVerdict = { ok: true } | { ok: false; reason: string };

export function judgeFinalText(
  candidate: string,
  verifiedFacts: string,
): FinalTextVerdict {
  const text = candidate.trim();
  if (!text) return { ok: false, reason: "model-returned-empty" };
  if (text.length > 600) return { ok: false, reason: "model-text-too-long" };
  // Internal ids must never reach the user, and their presence means the model
  // is narrating machinery rather than answering.
  if (/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]{2,}\b/.test(text.replace(/\.\s/g, " "))) {
    return { ok: false, reason: "model-leaked-internal-id" };
  }
  if (
    /\b(deepseek|openai|gpt-|gemini|anthropic|claude|llm|tool call|function call)\b/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "model-leaked-provider-metadata" };
  }
  // A success the model narrates as a failure (or the reverse) is the
  // contradiction that matters most.
  const factsFailed =
    /\b(couldn'?t|could not|failed|not found|unable|no .* found)\b/i.test(
      verifiedFacts,
    );
  const textFailed =
    /\b(couldn'?t|could not|failed|unable|wasn'?t able|no luck)\b/i.test(text);
  if (textFailed && !factsFailed) return { ok: false, reason: "model-claimed-failure" };
  if (factsFailed && !textFailed) return { ok: false, reason: "model-claimed-success" };
  return { ok: true };
}
