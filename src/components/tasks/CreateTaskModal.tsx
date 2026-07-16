import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "../Icons";
import { addActivity } from "../../stores/appStore";
import { addTask, type DueBucket, type TaskPriority } from "../../stores/taskStore";

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
}

const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];
const AGENT_OPTIONS = [
  "None",
  "Project Manager",
  "Research Analyst",
  "Content Creator",
];

/** Local task creation — writes to the persisted task store only. */
export function CreateTaskModal({ open, onClose }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [bucket, setBucket] = useState<DueBucket>("today");
  const [agent, setAgent] = useState("None");
  const [urgent, setUrgent] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setNote("");
      setPriority("medium");
      setBucket("today");
      setAgent("None");
      setUrgent(false);
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    addTask({
      title: trimmed,
      note: note.trim() || undefined,
      priority,
      due: bucket === "today" ? "Today" : bucket === "upcoming" ? "Upcoming" : undefined,
      dueBucket: bucket,
      agent: agent === "None" ? undefined : agent,
      urgent,
    });
    addActivity(`Created task "${trimmed}"`, "task");
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Create task"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title">Create task</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <label className="modal-label" htmlFor="task-title">
          Title
        </label>
        <input
          id="task-title"
          ref={titleRef}
          className="modal-input"
          value={title}
          placeholder="What needs to happen?"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />

        <label className="modal-label" htmlFor="task-note">
          Note
        </label>
        <textarea
          id="task-note"
          className="modal-input modal-textarea"
          value={note}
          placeholder="Optional details"
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="modal-row">
          <div className="modal-field">
            <span className="modal-label">Priority</span>
            <div className="segmented" role="radiogroup" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={priority === p}
                  className={`segment${priority === p ? " active" : ""}`}
                  onClick={() => setPriority(p)}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="modal-field">
            <span className="modal-label">Due</span>
            <div className="segmented" role="radiogroup" aria-label="Due">
              {(["today", "upcoming", "none"] as DueBucket[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={bucket === b}
                  className={`segment${bucket === b ? " active" : ""}`}
                  onClick={() => setBucket(b)}
                >
                  {b === "today" ? "Today" : b === "upcoming" ? "Upcoming" : "None"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-row">
          <div className="modal-field">
            <label className="modal-label" htmlFor="task-agent">
              Agent
            </label>
            <select
              id="task-agent"
              className="modal-input modal-select"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
            >
              {AGENT_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="modal-field">
            <span className="modal-label">Urgent</span>
            <button
              type="button"
              className={`toggle${urgent ? " on" : ""}`}
              role="switch"
              aria-checked={urgent}
              aria-label="Mark as urgent"
              onClick={() => setUrgent((v) => !v)}
            >
              <span className="toggle-thumb" />
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!title.trim()}
            onClick={submit}
          >
            Create task
          </button>
        </div>
      </div>
    </div>
  );
}
