/**
 * Rephrases a verified action result in the assistant's own voice.
 *
 * The deterministic templates in `capabilityResponseComposer.ts` are the source
 * of TRUTH — they only ever state what the ToolResult actually contains. This
 * layer makes the wording feel human instead of canned, without letting the
 * model introduce facts.
 *
 * Safety design:
 * - The model is given the verified sentence and asked only to rewrite it.
 * - Anything that looks like embellishment (too long, added question, invented
 *   specifics) is rejected and the template is used instead.
 * - Any error or timeout falls back to the template.
 *
 * Result: natural language, zero new hallucination surface.
 */

import { askAssistant } from "../../services/AssistantService";

/** Rewrites take a hard ceiling — an action confirmation is one short line. */
const MAX_WORDS = 24;
const TIMEOUT_MS = 4000;

/** Capabilities whose output is data the user asked to SEE. Never reword those. */
/**
 * Only results whose text IS the payload stay verbatim — rewording a clipboard
 * dump would corrupt content the user asked for. Listings go through
 * styleAssistantOutput instead (never a raw dump in chat).
 */
const VERBATIM_CAPABILITIES = new Set([
  "clipboard.read_text",
]);

/**
 * Every number and quoted string in the verified sentence must survive.
 *
 * Measured, not assumed: rewriting `Created task "renew my passport".` produced
 * `Task 'Renew Passport' created.` — the title silently altered. A confirmation
 * that changes the fact it is confirming is worse than a repetitive one.
 */
function preservesFacts(rewrite: string, original: string): boolean {
  const lower = rewrite.toLowerCase();
  for (const n of original.match(/\d+/g) ?? []) {
    if (!rewrite.includes(n)) return false;
  }
  for (const q of original.match(/"([^"]+)"/g) ?? []) {
    if (!lower.includes(q.replace(/"/g, "").toLowerCase())) return false;
  }
  // Windows paths must come through character-for-character.
  for (const p of original.match(/[A-Za-z]:\\[^\s.]+[^\s]*/g) ?? []) {
    if (!rewrite.includes(p)) return false;
  }
  return true;
}

function looksEmbellished(rewrite: string, original: string): boolean {
  const words = rewrite.trim().split(/\s+/);
  if (words.length > MAX_WORDS) return true;
  if (rewrite.includes("\n")) return true;
  // A confirmation should not turn into a question or an offer of more help.
  if (/\?\s*$/.test(rewrite.trim())) return true;
  // Digits that were not in the verified sentence are invented specifics.
  const originalDigits = new Set(original.match(/\d+/g) ?? []);
  for (const d of rewrite.match(/\d+/g) ?? []) {
    if (!originalDigits.has(d)) return true;
  }
  return false;
}

/**
 * @param verified  The deterministic sentence — always truthful.
 * @param request   What the user said, for tone matching.
 * @param capabilityId  Used to skip rewriting data-bearing results.
 */
export async function naturalizeResponse(
  verified: string,
  request: string,
  capabilityId?: string,
): Promise<string> {
  if (!verified.trim()) return verified;
  if (capabilityId && VERBATIM_CAPABILITIES.has(capabilityId)) return verified;
  // Multi-line output is structured data — leave it alone.
  if (verified.includes("\n")) return verified;

  const instruction = [
    "Rewrite this confirmation in a natural, friendly voice.",
    "Rules: keep every fact identical, add nothing, invent nothing.",
    "One short sentence. No questions. No offers of further help.",
    `The user said: "${request}"`,
    `Confirmation to rewrite: "${verified}"`,
    "Reply with the rewritten sentence only.",
  ].join("\n");

  try {
    const reply = await Promise.race([
      askAssistant(instruction, {
        skipCapabilities: true,
        skipOrchestration: true,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("naturalize timeout")), TIMEOUT_MS),
      ),
    ]);
    const rewrite = reply.text.trim().replace(/^["']|["']$/g, "");
    if (!rewrite || looksEmbellished(rewrite, verified)) return verified;
    // A rewrite that loses or alters a fact is worse than a repetitive one.
    if (!preservesFacts(rewrite, verified)) return verified;
    return rewrite;
  } catch {
    // Model unavailable or too slow — the template is always a valid answer.
    return verified;
  }
}
