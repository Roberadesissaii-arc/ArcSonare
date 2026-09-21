/**
 * The Thinking row, and the Thought row it becomes.
 *
 * Both live *inside* the assistant message they belong to. The previous version
 * was effectively a floating panel that accumulated every progress event —
 * "Thinking, Working, Thinking, Working" — and then vanished when the answer
 * arrived in what looked like a different card. Two problems in one: it read as
 * an execution log, and nothing connected the waiting to the answer.
 *
 * Now: one subtle line while the turn runs, showing only what is happening now.
 * When it finishes, the same message keeps a collapsed "Thought" row above the
 * answer, so the thinking visibly became the reply.
 *
 * There is no hidden reasoning here and none is implied. The expandable content
 * is the list of actions that actually ran.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";

/** Small class joiner. The project has no CSS framework and no `cn` helper. */
function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/** Words that must never reach a progress line. */
const FORBIDDEN =
  /\b(deepseek|openai|gpt|gemini|google\s+ai|anthropic|claude|llm|model|provider|token|prompt|natural\s+mode|system|assistant)\b/i;

/**
 * Turn a raw status into something safe to show.
 *
 * Statuses come from several layers — some already user-facing, some internal.
 * Rather than trust the caller, anything naming a vendor or an internal concept
 * collapses to the neutral line.
 */
export function safeProgressText(status: string | undefined): string {
  const raw = (status ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "Thinking";
  if (FORBIDDEN.test(raw)) return "Thinking";
  // Internal ids look like `filesystem.list_known_folder`.
  if (/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*\b/.test(raw)) return "Thinking";
  return raw.replace(/\.{3}$/, "…");
}

/** Live state: one shimmering line, and nothing else. */
export function ThinkingRow({ status }: { status?: string }) {
  return (
    <div className="thinking-row" role="status" aria-live="polite">
      <span className="thinking-row-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="thinking-row-label">{safeProgressText(status)}</span>
    </div>
  );
}

/**
 * Finished state: a quiet, collapsed record of what ran.
 *
 * Renders nothing when there is nothing to say — a turn that only talked did
 * not "think", and claiming otherwise would be decoration.
 */
export function ThoughtRow({ steps }: { steps?: string[] }) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;

  return (
    <div className={cn("thought-row", open && "is-open")}>
      <button
        type="button"
        className="thought-row-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight size={12} className="thought-row-chevron" aria-hidden="true" />
        <span>Thought</span>
      </button>
      {open ? (
        <ul className="thought-row-steps">
          {steps.map((step, i) => (
            <li key={`${step}-${i}`}>{step}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
