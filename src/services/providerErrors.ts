/**
 * Turning a failed provider call into something the user can act on.
 *
 * Two things went wrong before this existed:
 *
 *  1. Tauri's `invoke` rejects with a plain **string**, not an `Error`. Code
 *     doing `err instanceof Error ? err.message : "The model request failed."`
 *     therefore threw away the real reason and showed the generic fallback.
 *     The backend was already saying "No API key saved for deepseek. Add one
 *     in Settings → Voice & AI keys." — the user just never saw it.
 *
 *  2. On a fresh install nothing is connected, so the first thing a new user
 *     met was "model-request-failed". Not connected is a normal state, not an
 *     error, and it should read like setup guidance.
 */

/** Read a message out of anything a rejected promise might carry. */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const maybe = err as { message?: unknown; error?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
    if (typeof maybe.error === "string") return maybe.error;
  }
  return "";
}

/** True when the failure is "you haven't connected this provider yet". */
export function isNotConnected(err: unknown): boolean {
  const text = errorText(err).toLowerCase();
  return (
    text.includes("no api key saved") ||
    text.includes("not connected") ||
    text.includes("no default model selected") ||
    text.includes("credential store unavailable")
  );
}

/**
 * A sentence to show the user. Setup problems get setup wording; everything
 * else keeps the provider's own message, which is more specific than any
 * generic line we could invent.
 *
 * Deliberately does NOT name a model when nothing is connected. Which provider
 * happens to be pre-selected is an implementation detail — telling a new user
 * "DeepSeek V4 Flash isn't connected" reads as though they were supposed to
 * have chosen DeepSeek. They choose whichever model they want.
 */
export function describeProviderError(err: unknown, _providerName?: string): string {
  const raw = errorText(err);
  if (isNotConnected(err)) {
    return "No AI key yet. Open Settings → Voice & AI keys and save OpenAI (voice) and DeepSeek (chat).";
  }
  if (!raw) {
    return "That didn't go through. Try again in a moment.";
  }
  return raw;
}
