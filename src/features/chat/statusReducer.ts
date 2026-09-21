/**
 * Turning a stream of progress events into one thing worth showing.
 *
 * The engine emits status on every loop iteration, so a single request produces
 * something like:
 *
 *   Thinking… → Searching YouTube… → Thinking… → Writing the answer…
 *
 * Rendered as history that reads as an execution log — "Thinking, Working,
 * Thinking, Working" — which tells the user nothing and looks like a debug
 * console. What they actually need is the one thing happening now, and
 * afterwards a short honest account of what happened.
 *
 * So this collapses the stream into exactly two products:
 *
 *   `current` — the single live line, shown while the turn runs.
 *   `steps`   — the meaningful actions only, kept for the collapsed Thought row.
 *
 * Generic waiting never enters `steps`: "Thinking" is not something that
 * happened, it is the absence of something happening.
 */

export interface StatusEvent {
  message: string;
  capabilityId?: string;
}

export interface ReducedStatus {
  /** The one line to show right now. */
  current: string;
  /** Meaningful actions, in order, without repeats. Safe to show. */
  steps: string[];
}

/** Waiting states — real, but not an account of anything. */
const GENERIC = /^(thinking|working|one moment|please wait)\b/i;

/**
 * Real work, but not something the user did.
 *
 * Composing the reply happens on every turn including pure conversation, so
 * recording it as a step gave a plain "7 times 6 is 42" answer a Thought row
 * whose entire content was "Wrote the reply" — a disclosure that discloses
 * nothing. It stays valid as the *current* line; it just never becomes history.
 */
const NOT_A_STEP = /^(writing the answer|formatting|composing)\b/i;

/** Vendor and internal-id leaks never reach a status line. */
const UNSAFE =
  /\b(deepseek|openai|gpt|gemini|anthropic|claude|llm|provider|token|prompt)\b/i;

function isInternalId(text: string): boolean {
  return /\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*\b/.test(text);
}

/**
 * Normalise one raw event into a user-facing line.
 *
 * Capability-specific wording wins when the engine gave us the capability, so
 * "Working..." during a YouTube search becomes "Searching YouTube…" rather than
 * a shrug.
 */
export function labelForStatus(event: StatusEvent): string {
  const raw = (event.message ?? "").replace(/\s+/g, " ").trim();
  const byCapability = capabilityLabel(event.capabilityId);
  if (byCapability && (!raw || GENERIC.test(raw) || raw === "Working...")) {
    return byCapability;
  }
  if (!raw) return byCapability ?? "Thinking";
  if (UNSAFE.test(raw) || isInternalId(raw)) return byCapability ?? "Thinking";
  if (GENERIC.test(raw)) return "Thinking";
  return raw.replace(/\.{3}$/, "…");
}

function capabilityLabel(capabilityId?: string): string | null {
  if (!capabilityId) return null;
  if (capabilityId.startsWith("tasks.")) return "Updating your task…";
  if (capabilityId.startsWith("connections.")) return "Checking the connection…";
  if (capabilityId === "web.search") return "Searching the web…";
  if (capabilityId === "web.answer_question") return "Looking it up…";
  if (capabilityId === "desktop.find_item" || capabilityId === "filesystem.find") {
    return "Looking for it…";
  }
  if (capabilityId.startsWith("filesystem.")) return "Reading your files…";
  if (capabilityId === "screen.capture") return "Taking a screenshot…";
  if (capabilityId.startsWith("screen.")) return "Looking at your screen…";
  if (capabilityId.startsWith("applications.")) return "Opening that app…";
  if (capabilityId.startsWith("email.")) return "Reading your Gmail…";
  if (capabilityId.startsWith("calendar.")) return "Checking your calendar…";
  return null;
}

/**
 * Collapse a run of events.
 *
 * Repeats are dropped rather than stacked: emitting the same state twice means
 * the same thing is still happening, not that a second thing happened.
 */
export function reduceStatus(events: StatusEvent[]): ReducedStatus {
  const steps: string[] = [];
  let current = "Thinking";

  for (const event of events) {
    const label = labelForStatus(event);
    current = label;
    if (GENERIC.test(label) || NOT_A_STEP.test(label)) continue;
    if (steps[steps.length - 1] === label) continue;
    steps.push(label);
  }

  return { current, steps };
}

/**
 * The completed account, phrased in the past tense.
 *
 * "Searching YouTube…" while it runs becomes "Searched YouTube" once it has.
 * Nothing here is reasoning — it is the list of actions that actually ran.
 */
export function thoughtSteps(steps: string[]): string[] {
  return steps.map((step) =>
    step
      .replace(/…$/, "")
      .replace(/^Searching\b/, "Searched")
      .replace(/^Looking for it$/, "Located it")
      .replace(/^Looking at your screen$/, "Looked at your screen")
      .replace(/^Looking it up$/, "Looked it up")
      .replace(/^Reading\b/, "Read")
      .replace(/^Checking\b/, "Checked")
      .replace(/^Updating\b/, "Updated")
      .replace(/^Opening\b/, "Opened")
      .replace(/^Taking\b/, "Took")
      .replace(/^Writing the answer$/, "Wrote the reply"),
  );
}
