/**
 * Removes trailing assistant filler from a model reply.
 *
 * The system prompt forbids closers like "How can I assist you today?", and
 * larger models obey it. Small local models (llama3.2:3B) reattach them anyway
 * — three separate prompt revisions failed to stop it. Stripping is
 * deterministic, costs nothing, and cannot regress.
 *
 * Only trailing sentences are considered, and only when other content exists,
 * so a reply that is *genuinely* asking something is never gutted.
 */

const FILLER_PATTERNS: RegExp[] = [
  /^(?:so\s+)?(?:how|what)\s+can\s+i\s+(?:help|assist)(?:\s+you)?(?:\s+with)?(?:\s+today)?\??$/i,
  /^what\s+(?:can|would)\s+i\s+do\s+for\s+you(?:\s+today)?\??$/i,
  /^(?:is\s+there\s+)?anything\s+else(?:\s+i\s+can\s+(?:help|assist)\s+(?:you\s+)?with)?\??$/i,
  /^let\s+me\s+know\s+if\s+(?:you\s+(?:need|have)|there'?s)\b.*$/i,
  /^feel\s+free\s+to\s+(?:ask|reach\s+out)\b.*$/i,
  /^(?:i'?m\s+)?(?:here|happy)\s+to\s+help\b.*$/i,
  /^(?:just\s+)?(?:let|tell)\s+me\s+(?:know|what)\b.*$/i,
  /^what(?:'?s| is)\s+on\s+your\s+mind(?:\s+today)?\??$/i,
  /^how\s+about\s+you\??$/i,
];

/** Splits on sentence boundaries, keeping the terminator with each sentence. */
function sentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
}

export function stripTrailingFiller(reply: string): string {
  const original = reply.trim();
  if (!original) return reply;

  const parts = sentences(original);
  // Nothing to strip from a single sentence — that sentence IS the answer.
  if (parts.length < 2) return original;

  let end = parts.length;
  while (end > 1) {
    const candidate = parts[end - 1].trim().replace(/^[-–—\s]+/, "");
    if (!candidate) {
      end--;
      continue;
    }
    if (FILLER_PATTERNS.some((p) => p.test(candidate))) {
      end--;
      continue;
    }
    break;
  }

  if (end === parts.length) return original;
  const kept = parts.slice(0, end).join("").trim();
  // Never return an empty reply — if everything looked like filler, keep it.
  return kept || original;
}
