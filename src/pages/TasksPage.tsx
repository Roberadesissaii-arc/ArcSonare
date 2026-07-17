import { useMemo, useState, type ReactNode } from "react";
import {
  BotIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  ZapIcon,
} from "../components/Icons";
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

function groupLabel(task: Task): string {
  if (task.completed) return "Completed";
  if (task.dueBucket === "today" || task.urgent) return "Today";
  if (task.dueBucket === "upcoming") return "Upcoming";
  return "Backlog";
}

function groupOrder(label: string): number {
  if (label === "Today") return 0;
  if (label === "Upcoming") return 1;
  if (label === "Backlog") return 2;
  return 3;
}

/** Command-center Tasks workspace — atmospheric, dashboard-grade layout. */
export function TasksPage({ onCreateTask }: TasksPageProps) {
  const tasks = useTasks();
  const { taskFilter } = useAppState();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const open = tasks.filter((t) => !t.completed);
    return {
      open: open.length,
      today: open.filter((t) => t.dueBucket === "today").length,
      urgent: open.filter((t) => t.urgent).length,
      done: tasks.filter((t) => t.completed).length,
    };
  }, [tasks]);

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

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of visible) {
      const key =
        taskFilter === "all" || taskFilter === "completed"
          ? groupLabel(task)
          : FILTERS.find((f) => f.id === taskFilter)?.label ?? "Tasks";
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => groupOrder(a[0]) - groupOrder(b[0]));
  }, [visible, taskFilter]);

  const selected: Task | null =
    tasks.find((t) => t.id === selectedId) ?? null;

  // Keep selection honest if the task was deleted/filtered away.
  const selectedVisible =
    selected && visible.some((t) => t.id === selected.id) ? selected : selected;

  return (
    <div className={`tasks-page${selectedVisible ? " has-detail" : ""}`}>
      <header className="tasks-hero">
        <div className="tasks-hero-copy">
          <p className="tasks-kicker">Workspace</p>
          <h1 className="page-heading tasks-heading">Tasks</h1>
          <p className="page-lede tasks-lede">
            What needs attention next — priorities, due times, and the agents
            standing by to help.
          </p>
        </div>
        <button type="button" className="btn btn-primary tasks-create" onClick={onCreateTask}>
          <PlusIcon size={14} />
          Create task
        </button>
      </header>

      <div className="tasks-summary-strip" aria-label="Task summary">
        <SummaryCard
          icon={<ListIcon size={15} />}
          value={summary.open}
          label="Open"
          tone="neutral"
        />
        <SummaryCard
          icon={<CalendarIcon size={15} />}
          value={summary.today}
          label="Due today"
          tone="violet"
        />
        <SummaryCard
          icon={<ZapIcon size={15} />}
          value={summary.urgent}
          label="Urgent"
          tone="red"
        />
        <SummaryCard
          icon={<CheckIcon size={15} />}
          value={summary.done}
          label="Completed"
          tone="green"
        />
      </div>

      <div className="tasks-workspace">
        <div className="tasks-main">
          <div className="tasks-toolbar card sonare-card">
            <div className="tasks-search">
              <SearchIcon size={15} />
              <input
                value={query}
                placeholder="Search title, note, or agent…"
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search tasks"
              />
            </div>
            <div className="tasks-filters" role="radiogroup" aria-label="Task filter">
              {FILTERS.map((f) => {
                const count =
                  f.id === "all"
                    ? tasks.length
                    : filterTasks(tasks, f.id).length;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={taskFilter === f.id}
                    className={`tasks-filter${taskFilter === f.id ? " active" : ""}`}
                    onClick={() => setTaskFilter(f.id)}
                  >
                    <span>{f.label}</span>
                    <span className="tasks-filter-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="tasks-empty card sonare-card">
              <span className="tasks-empty-icon" aria-hidden="true">
                <ListIcon size={22} />
              </span>
              <h2 className="tasks-empty-title">Nothing in this view</h2>
              <p className="tasks-empty-text">
                {query
                  ? "Try a different search, or clear the filter."
                  : "Create a task to start filling this workspace."}
              </p>
              <button type="button" className="btn btn-primary" onClick={onCreateTask}>
                <PlusIcon size={14} />
                Create task
              </button>
            </div>
          ) : (
            <div className="tasks-groups">
              {groups.map(([label, items]) => (
                <section key={label} className="tasks-group">
                  <div className="tasks-group-head">
                    <h2 className="tasks-group-title">{label}</h2>
                    <span className="tasks-group-count">{items.length}</span>
                  </div>
                  <ul className="task-list">
                    {items.map((task) => (
                      <li key={task.id}>
                        <TaskRow
                          task={task}
                          selected={task.id === selectedId}
                          onToggle={() => toggleTask(task.id)}
                          onOpen={() =>
                            setSelectedId(task.id === selectedId ? null : task.id)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        {selectedVisible ? (
          <TaskDetailPanel
            task={selectedVisible}
            onClose={() => setSelectedId(null)}
            onToggle={() => toggleTask(selectedVisible.id)}
            onDelete={() => {
              removeTask(selectedVisible.id);
              setSelectedId(null);
            }}
          />
        ) : (
          <aside className="task-detail task-detail-idle card sonare-card" aria-hidden="true">
            <span className="task-detail-idle-icon" aria-hidden="true">
              <ClockIcon size={22} />
            </span>
            <p className="task-detail-idle-title">Select a task</p>
            <p className="task-detail-idle-text">
              Open any row to review notes, priority, and agent assignment.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  tone: "neutral" | "violet" | "red" | "green";
}) {
  return (
    <div className={`tasks-summary-card tone-${tone}`}>
      <span className="tasks-summary-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="tasks-summary-meta">
        <span className="tasks-summary-value">{value}</span>
        <span className="tasks-summary-label">{label}</span>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  selected,
  onToggle,
  onOpen,
}: {
  task: Task;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={`task-row pri-${task.priority}${task.completed ? " completed" : ""}${
        selected ? " selected" : ""
      }${task.urgent ? " is-urgent" : ""}`}
    >
      <button
        type="button"
        className={`task-check${task.completed ? " on" : ""}`}
        onClick={onToggle}
        aria-label={
          task.completed ? `Reopen "${task.title}"` : `Complete "${task.title}"`
        }
      >
        {task.completed ? <CheckIcon size={12} /> : null}
      </button>
      <button type="button" className="task-open" onClick={onOpen}>
        <span className="task-meta">
          <span className="task-title-row">
            <span className="task-title">{task.title}</span>
            {task.urgent ? <span className="task-urgent-pill">Urgent</span> : null}
            {task.demo ? <span className="task-demo">Demo</span> : null}
          </span>
          <span className="task-sub">
            {task.due ? (
              <span className="task-chip">
                <ClockIcon size={11} />
                {task.due}
              </span>
            ) : (
              <span className="task-chip muted">No due time</span>
            )}
            {task.agent ? (
              <span className="task-chip">
                <BotIcon size={11} />
                {task.agent}
              </span>
            ) : null}
          </span>
        </span>
        <span className={`priority-badge pri-${task.priority}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
      </button>
    </div>
  );
}

function TaskDetailPanel({
  task,
  onClose,
  onToggle,
  onDelete,
}: {
  task: Task;
  onClose: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <aside className="task-detail card sonare-card" aria-label="Task details">
      <div className="task-detail-head">
        <span className="card-label">Task detail</span>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close details"
        >
          <CloseIcon size={15} />
        </button>
      </div>

      <div className={`task-detail-priority-bar pri-${task.priority}`} aria-hidden="true" />

      <h2 className="task-detail-title">{task.title}</h2>
      {task.note ? <p className="task-detail-note">{task.note}</p> : (
        <p className="task-detail-note muted">No notes yet.</p>
      )}

      <dl className="task-detail-grid">
        <div className="task-detail-fact">
          <dt>Priority</dt>
          <dd>
            <span className={`priority-dot sev-${task.priority}`} />
            {PRIORITY_LABEL[task.priority]}
          </dd>
        </div>
        <div className="task-detail-fact">
          <dt>Due</dt>
          <dd>{task.due ?? "No due time"}</dd>
        </div>
        <div className="task-detail-fact">
          <dt>Agent</dt>
          <dd>{task.agent ?? "Unassigned"}</dd>
        </div>
        <div className="task-detail-fact">
          <dt>Status</dt>
          <dd>{task.completed ? "Completed" : task.urgent ? "Urgent" : "Open"}</dd>
        </div>
      </dl>

      <div className="task-detail-actions">
        <button type="button" className="btn btn-primary" onClick={onToggle}>
          {task.completed ? "Reopen task" : "Mark complete"}
        </button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          <TrashIcon size={13} />
          Delete
        </button>
      </div>
    </aside>
  );
}
