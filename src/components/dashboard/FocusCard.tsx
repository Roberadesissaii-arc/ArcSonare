import { useMemo, useState } from "react";
import { DotsIcon, ListIcon } from "../Icons";
import { EmptyState } from "../EmptyState";
import { addActivity, navigate } from "../../stores/appStore";
import { computeTaskProgress } from "../../features/tasks/taskUtils";
import { filterTasks, useTasks, type Task } from "../../stores/taskStore";

/** Focus block — next real open task, or empty CTA. */
export function FocusCard() {
  const tasks = useTasks();
  const focus = useMemo(() => pickFocusTask(tasks), [tasks]);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozed, setSnoozed] = useState(false);

  if (!focus) {
    return (
      <section className="card sonare-card focus-card">
        <div className="card-head">
          <span className="card-label">Focus</span>
        </div>
        <EmptyState
          icon={<ListIcon size={23} />}
          title="Nothing in focus"
          description="Your next priority will appear here."
          compact
        >
          <button
            type="button"
            className="btn-pill"
            onClick={() => navigate("tasks")}
          >
            Open Tasks
          </button>
        </EmptyState>
      </section>
    );
  }

  const progress = computeTaskProgress(focus);
  const nextSub = focus.subtasks.find((s) => !s.completed)?.title;

  return (
    <section className="card sonare-card focus-card">
      <div className="card-head">
        <span className="card-label">Focus</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Open task"
          onClick={() => navigate("tasks")}
        >
          <DotsIcon size={15} />
        </button>
      </div>

      <h2 className="card-title">{focus.title}</h2>
      <p className="card-text">
        {focus.note?.trim() ||
          (focus.due ? `Due ${focus.due}` : "Open task from your workspace.")}
      </p>

      <div
        className="focus-progress"
        aria-label={`${progress}% progress`}
      >
        <div className="focus-track">
          <span className="focus-line" style={{ width: `${progress}%` }} />
        </div>
        <div className="focus-progress-foot">
          <span className="focus-progress-text">{progress}% complete</span>
          {nextSub ? <span className="focus-next">Next: {nextSub}</span> : null}
        </div>
      </div>

      <div className="card-actions focus-actions">
        <button
          type="button"
          className="btn-pill"
          onClick={() => {
            setSnoozed(false);
            addActivity(`Opened focus task: ${focus.title}`, "task");
            navigate("tasks");
          }}
        >
          Open task
        </button>
        <div className="focus-snooze-wrap">
          <button
            type="button"
            className="text-action"
            onClick={() => setSnoozeOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={snoozeOpen}
          >
            {snoozed ? "Snoozed" : "Snooze"}
          </button>
          {snoozeOpen ? (
            <div className="mode-list" role="menu">
              {[15, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  role="menuitem"
                  className="mode-option"
                  onClick={() => {
                    setSnoozed(true);
                    setSnoozeOpen(false);
                    addActivity(`Snoozed ${focus.title} for ${m} min`, "system");
                  }}
                >
                  {m} minutes
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function pickFocusTask(tasks: Task[]): Task | null {
  const urgent = filterTasks(tasks, "urgent");
  if (urgent[0]) return urgent[0];
  const today = filterTasks(tasks, "today");
  if (today[0]) return today[0];
  const open = filterTasks(tasks, "open");
  return open[0] ?? null;
}
