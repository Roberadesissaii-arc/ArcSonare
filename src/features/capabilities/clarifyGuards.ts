/**
 * Guards that turn an under-specified request into a question instead of a
 * wrong action.
 *
 * Kept dependency-free (no Tauri, no stores) so tests can import the real
 * implementations rather than copying them — a duplicated copy in the test
 * harness silently drifted out of sync with this logic once already.
 */

/**
 * "Create a task" with no title.
 *
 * Without this the request falls through to plain chat, where the model has no
 * task tool bound and fabricates a success ("I've created a new task… Task
 * Title: [Untitled]"). Returns the question to ask, or null when the request
 * does carry a title and should be created normally.
 */
export function needsTaskTitle(text: string): string | null {
  const q = text.trim().toLowerCase().replace(/[?!.]+$/, "").replace(/\s+/g, " ");

  // Must be about creating a task…
  if (!/\b(?:create|add|make|new|set up|start)\b[\w\s]*\btasks?\b/.test(q)) return null;
  // …but not about listing/showing existing ones.
  if (/\b(?:list|show|what|which|how many|my tasks|due)\b/.test(q)) return null;

  // Strip the request framing; whatever remains would be the title.
  const remainder = q
    .replace(/^(?:hey |ok |please |can you |could you |would you |will you |i want you to |i need you to |i'd like you to )+/g, "")
    .replace(/\b(?:create|add|make|set up|start)\b/g, " ")
    .replace(/\b(?:a|an|the|new|another|quick)\b/g, " ")
    .replace(/\btasks?\b/g, " ")
    .replace(/\b(?:for|to)\s+me\b/g, " ")
    .replace(/\bplease\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Anything meaningful left → it has a title; let the normal path create it.
  if (remainder.length > 2) return null;

  return "Sure — what should the task be?";
}

/**
 * A search that names a destination but no search terms ("search youtube").
 *
 * Previously this reached web.search with a junk query built from the leftover
 * preposition and failed schema validation, surfacing
 * "invalid-arguments: I couldn't find a valid search query".
 */
export function needsSearchQuery(text: string): string | null {
  const q = text.trim().toLowerCase().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
  if (!/^(?:search|google|look up)\b/.test(q)) return null;

  const remainder = q
    .replace(/^(?:search|google|look up)\b/, " ")
    .replace(/\b(?:the\s+web|on|in|at|for)\b/g, " ")
    .replace(/\b(?:youtube|github|google|bing)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (remainder.length > 1) return null;
  const site = /\byoutube\b/.test(q)
    ? "YouTube"
    : /\bgithub\b/.test(q)
      ? "GitHub"
      : null;
  return site ? `What should I search for on ${site}?` : "What should I search for?";
}
