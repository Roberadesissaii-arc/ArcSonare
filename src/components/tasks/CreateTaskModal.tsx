import { useEffect, useRef, useState } from "react";
import { CloseIcon, PlusIcon, TrashIcon } from "../Icons";
import { addActivity } from "../../stores/appStore";
import {
  appendAgentActivity,
  useAgents,
} from "../../features/agents/agentStore";
import {
  addSubtask,
  createTaskDurable,
  type DueBucket,
  type TaskPriority,
} from "../../stores/taskStore";

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
}

const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

/** Today / tomorrow as `yyyy-mm-dd`, for the date shortcuts. */
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bucket a chosen date so grouping and the Today/Upcoming views stay correct. */
function bucketForDate(date: string): DueBucket {
  if (!date) return "none";
  return date === isoDate(0) ? "today" : "upcoming";
}

/** "Today, 2:30 PM" / "Fri 8 Aug" — the human label stored on the task. */
function dueLabel(date: string, time: string): string | undefined {
  if (!date) return undefined;
  const when = new Date(`${date}T${time || "09:00"}`);
  if (Number.isNaN(when.getTime())) return undefined;
  const timePart = time
    ? when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
  const dayPart =
    date === isoDate(0)
      ? "Today"
      : date === isoDate(1)
        ? "Tomorrow"
        : when.toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
  return timePart ? `${dayPart}, ${timePart}` : dayPart;
}

/** Local task creation — writes to the persisted task store only. */
export function CreateTaskModal({ open, onClose }: CreateTaskModalProps) {
  const agents = useAgents();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [agent, setAgent] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  /** Set when the write did not reach the database; the dialog stays open. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setNote("");
      setPriority("medium");
      setDueDate("");
      setDueTime("");
      setAgent("");
      setUrgent(false);
      setTagDraft("");
      setTags([]);
      setSubtaskDraft("");
      setSubtasks([]);
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

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, "");
    if (!t || tags.includes(t) || tags.length >= 6) return;
    setTags([...tags, t]);
    setTagDraft("");
  };

  const addSub = () => {
    const s = subtaskDraft.trim();
    if (!s || subtasks.length >= 10) return;
    setSubtasks([...subtasks, s]);
    setSubtaskDraft("");
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setSaveError(null);
    // The same canonical create the assistant uses. Every entry point shares it
    // so none of them can report a task saved that was not.
    const outcome = await createTaskDurable({
      title: trimmed,
      note: note.trim() || undefined,
      priority,
      due: dueLabel(dueDate, dueTime),
      dueBucket: bucketForDate(dueDate),
      agent: agent || undefined,
      urgent,
      tags,
    });
    setSaving(false);
    if (!outcome.success) {
      // Stay open with the user's input intact: a dialog that closes on a failed
      // save loses the work and implies it succeeded.
      setSaveError("That task couldn't be saved. Nothing was created.");
      return;
    }
    const created = outcome.task;
    // Subtasks go through the store so each gets its own id and activity entry.
    for (const s of subtasks) addSubtask(created.id, s);
    addActivity(`Created task "${trimmed}"`, "task");
    // Keep Agent workspace "Linked now" in sync when created with an assignee.
    if (agent) {
      const match = agents.find((a) => a.name === agent || a.id === agent);
      if (match) {
        appendAgentActivity(match.id, {
          type: "task-assigned",
          title: "Task assigned",
          summary: `Assigned "${trimmed}".`,
          status: "info",
          taskId: created.id,
        });
      }
      addActivity(`Assigned "${trimmed}" to ${agent}`, "agent");
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className="modal modal-task-create"
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

        {/* Scrolls only when the form outgrows the viewport, and keeps bottom
            padding so nothing sits flush against the edge. */}
        <div className="modal-body">
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
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          />

          <label className="modal-label" htmlFor="task-note">
            Details
          </label>
          <textarea
            id="task-note"
            className="modal-input modal-textarea"
            value={note}
            placeholder="Context, links, acceptance criteria…"
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
                    className={`segment segment-pri-${p}${priority === p ? " active" : ""}`}
                    onClick={() => setPriority(p)}
                  >
                    {p[0].toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-field">
              <span className="modal-label">Urgent</span>
              <div className="modal-toggle-row">
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
                <span className="modal-hint">
                  {urgent ? "Shown in the Urgent view" : "Normal handling"}
                </span>
              </div>
            </div>
          </div>

          {/* A real date and time, not just a Today/Upcoming bucket. */}
          <span className="modal-label">Due</span>
          <div className="modal-due-row">
            <input
              type="date"
              className="modal-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="Due date"
            />
            <input
              type="time"
              className="modal-input"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              aria-label="Due time"
              disabled={!dueDate}
            />
          </div>
          <div className="modal-quick-dates">
            <button type="button" onClick={() => setDueDate(isoDate(0))}>
              Today
            </button>
            <button type="button" onClick={() => setDueDate(isoDate(1))}>
              Tomorrow
            </button>
            <button type="button" onClick={() => setDueDate(isoDate(7))}>
              Next week
            </button>
            {dueDate ? (
              <button
                type="button"
                className="is-clear"
                onClick={() => {
                  setDueDate("");
                  setDueTime("");
                }}
              >
                Clear
              </button>
            ) : null}
          </div>

          <label className="modal-label" htmlFor="task-agent">
            Assign to
          </label>
          <select
            id="task-agent"
            className="modal-input modal-select"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="">Nobody — I'll handle it</option>
            {/* Real agents from the workspace, not a hardcoded sample list. */}
            {agents.map((a) => (
              <option key={a.id} value={a.name || a.id}>
                {a.name || "Unnamed agent"}
              </option>
            ))}
          </select>

          <span className="modal-label">Subtasks</span>
          {subtasks.length ? (
            <ul className="modal-chip-list">
              {subtasks.map((s, i) => (
                <li key={`${s}-${i}`}>
                  <span>{s}</span>
                  <button
                    type="button"
                    aria-label={`Remove subtask ${s}`}
                    onClick={() => setSubtasks(subtasks.filter((_, x) => x !== i))}
                  >
                    <TrashIcon size={11} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="modal-inline-add">
            <input
              className="modal-input"
              value={subtaskDraft}
              placeholder="Break it into steps…"
              onChange={(e) => setSubtaskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSub();
                }
              }}
            />
            <button
              type="button"
              onClick={addSub}
              disabled={!subtaskDraft.trim()}
              aria-label="Add subtask"
            >
              <PlusIcon size={14} />
            </button>
          </div>

          <span className="modal-label">Tags</span>
          {tags.length ? (
            <div className="modal-tag-row">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="modal-tag"
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  aria-label={`Remove tag ${t}`}
                >
                  #{t}
                  <CloseIcon size={9} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="modal-inline-add">
            <input
              className="modal-input"
              value={tagDraft}
              placeholder="Add a tag…"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
            />
            <button
              type="button"
              onClick={addTag}
              disabled={!tagDraft.trim()}
              aria-label="Add tag"
            >
              <PlusIcon size={14} />
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <span className="modal-shortcut-hint">Ctrl + Enter to create</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {saveError ? (
            <span className="modal-error" role="alert">
              {saveError}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!title.trim() || saving}
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}
