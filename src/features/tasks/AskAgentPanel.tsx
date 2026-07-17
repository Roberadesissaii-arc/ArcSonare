import { useEffect, useId, useState } from "react";
import { CloseIcon, SendIcon, SparkleIcon } from "../../components/Icons";
import type { Task } from "../../stores/taskStore";
import { computeTaskProgress } from "./taskUtils";

interface AskAgentPanelProps {
  task: Task;
  open: boolean;
  onClose: () => void;
}

const SUGGESTIONS = [
  "What should I do next?",
  "Summarize progress",
  "Identify blockers",
  "Prepare an update",
  "Reprioritize subtasks",
];

/**
 * Task-aware composer. Does not claim the agent completed external work —
 * messages stay local until a real agent runtime is connected.
 */
export function AskAgentPanel({ task, open, onClose }: AskAgentPanelProps) {
  const titleId = useId();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setStatus(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const send = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setStatus(
      "Message prepared with this task’s context. Agent runtime is not connected yet — nothing was sent externally.",
    );
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className="modal ask-agent-modal"
        role="dialog"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="ask-agent-kicker">Ask agent</p>
            <h2 id={titleId} className="modal-title">
              Ask {task.agent ?? "an agent"} about “{task.title}”
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="ask-agent-context">
          <p>
            Progress {computeTaskProgress(task)}%
            {task.subtasks.length > 0
              ? ` · ${task.subtasks.filter((s) => s.completed).length}/${task.subtasks.length} subtasks`
              : null}
          </p>
          {task.note ? <p className="ask-agent-note">{task.note}</p> : null}
        </div>

        <div className="ask-agent-suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="ask-agent-chip"
              onClick={() => setPrompt(s)}
            >
              <SparkleIcon size={12} />
              {s}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="field-label">Your prompt</span>
          <textarea
            className="field-input"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask about blockers, next steps, or a draft update…"
          />
        </label>

        {status ? <p className="ask-agent-status">{status}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={send}
            disabled={!prompt.trim()}
          >
            <SendIcon size={13} />
            Prepare message
          </button>
        </div>
      </div>
    </div>
  );
}
