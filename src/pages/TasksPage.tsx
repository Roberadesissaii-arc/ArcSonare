import { useMemo, useState } from "react";
import { CheckIcon, ChevronRightIcon, PlusIcon, SearchIcon, TrashIcon } from "../components/Icons";
import { setTaskFilter, useAppState } from "../stores/appStore";
import {
  filterTasks,
  removeTask,
  toggleTask,
  useTasks,
  type Task,
  type TaskFilter,
} from "../stores/taskStore";

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "urgent", label: "Urgent" },
  { id: "completed", label: "Completed" },
];

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

interface TasksPageProps {
  onCreateTask: () => void;
}

export function TasksPage({ onCreateTask }: TasksPageProps) {
  const tasks = useTasks();
  const { taskFilter } = useAppState();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const byFilter = filterTasks(tasks, taskFilter);
    const q = query.trim().toLowerCase();
    if (!q) return byFilter;
    return byFilter.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.note?.toLowerCase().includes(q) ||
        t.agent?.toLowerCase().includes(q),
    );
  }, [tasks, taskFilter, query]);

  const selected: Task | null =
    tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div className={`tasks-page${selected ? " has-detail" : ""}`}>
      <div className="tasks-main">
        <div className="page-top">
          <h1 className="page-heading">Tasks</h1>
          <button type="button" className="btn btn-primary" onClick={onCreateTask}>
            <PlusIcon size={14} />
            Create task
          </button>
        </div>

        <div className="tasks-toolbar">
          <div className="tasks-search">
            <SearchIcon size={14} />
            <input
              value={query}
              placeholder="Search tasks"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search tasks"
            />
          </div>
          <div className="segmented" role="radiogroup" aria-label="Task filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={taskFilter === f.id}
                className={`segment${taskFilter === f.id ? " active" : ""}`}
                onClick={() => setTaskFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="tasks-empty">No tasks match this view.</p>
        ) : (
          <ul className="task-list">
            {visible.map((task) => (
              <li key={task.id}>
                <div
                  className={`task-row${task.completed ? " completed" : ""}${
                    task.id === selectedId ? " selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className={`task-check${task.completed ? " on" : ""}`}
                    onClick={() => toggleTask(task.id)}
                    aria-label={
                      task.completed
                        ? `Reopen "${task.title}"`
                        : `Complete "${task.title}"`
                    }
                  >
                    {task.completed ? <CheckIcon size={12} /> : null}
                  </button>
                  <button
                    type="button"
                    className="task-open"
                    onClick={() =>
                      setSelectedId(task.id === selectedId ? null : task.id)
                    }
                  >
                    <span className="task-meta">
                      <span className="task-title">{task.title}</span>
                      <span className="task-sub">
                        {task.due ? <span>{task.due}</span> : null}
                        {task.agent ? <span>· {task.agent}</span> : null}
                        {task.demo ? <span className="task-demo">Demo</span> : null}
                      </span>
                    </span>
                    <span className={`priority-badge pri-${task.priority}`}>
                      {PRIORITY_LABEL[task.priority]}
                    </span>
                    <ChevronRightIcon size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected ? (
        <aside className="task-detail" aria-label="Task details">
          <div className="card-head">
            <span className="card-label">Task</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setSelectedId(null)}
              aria-label="Close details"
            >
              <ChevronRightIcon size={15} />
            </button>
          </div>
          <h2 className="card-title">{selected.title}</h2>
          {selected.note ? <p className="card-text">{selected.note}</p> : null}
          <dl className="detail-grid">
            <dt>Priority</dt>
            <dd>
              <span className={`severity-dot sev-${selected.priority}`} />
              {PRIORITY_LABEL[selected.priority]}
            </dd>
            <dt>Due</dt>
            <dd>{selected.due ?? "No due time"}</dd>
            <dt>Agent</dt>
            <dd>{selected.agent ?? "Unassigned"}</dd>
            <dt>Status</dt>
            <dd>{selected.completed ? "Completed" : "Open"}</dd>
          </dl>
          <div className="card-actions">
            <button
              type="button"
              className="btn"
              onClick={() => toggleTask(selected.id)}
            >
              {selected.completed ? "Reopen" : "Mark complete"}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                removeTask(selected.id);
                setSelectedId(null);
              }}
            >
              <TrashIcon size={13} />
              Delete
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
