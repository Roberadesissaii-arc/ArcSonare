/**
 * Pure text matcher for “what’s running?” / watch questions.
 * Kept free of icon / catalog imports so Node evals can import it.
 */

/**
 * True when the user is asking what apps/sites are open or running —
 * including casual forms the capability router used to mishandle.
 */
export function isRunningAppsQuestion(text: string): boolean {
  const q = text.trim().toLowerCase().replace(/[?.!]+$/g, "").trim();
  if (!q) return false;
  // Direct forms
  if (
    /^(?:what(?:'s| is| are)?|which)\s+(?:apps?|applications?|programs?|software)?\s*(?:is|are)?\s*(?:currently\s+)?(?:open|running|active)(?:\s+right\s+now)?$/.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /^(?:what(?:'s| is)|which)\s+(?:open|running)(?:\s+right\s+now)?$/.test(q)
  ) {
    return true;
  }
  if (
    /^(?:what apps are running|what(?:'s| is) (?:open|running)(?: right now)?|what am i (?:running|watching)|what(?:'s| is) watching)$/.test(
      q,
    )
  ) {
    return true;
  }
  // Browser / site focused
  if (
    /^(?:which|what)\s+browser(?:\s+is\s+(?:open|running))?$/.test(q) ||
    /^(?:is\s+)?(?:chrome|edge|firefox|brave|youtube|amazon|netflix|zoom|teams)\s+(?:open|running)\??$/.test(
      q,
    ) ||
    /^(?:what(?:'s| is)\s+on\s+)?(?:youtube|amazon|netflix)\b/.test(q)
  ) {
    return true;
  }
  // Loose: "what's running on my pc/computer"
  if (
    /what(?:'s| is| are).*(?:running|open).*(?:app|program|browser|pc|computer|machine|desktop)?/.test(
      q,
    ) &&
    !/process list|task manager/.test(q)
  ) {
    return true;
  }
  return false;
}
