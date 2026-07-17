import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  DotsIcon,
  LayoutIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SparkleIcon,
  TrashIcon,
} from "../components/Icons";
import { Dropdown } from "../components/settings/Dropdown";
import { AskAgentPanel } from "../features/tasks/AskAgentPanel";
import { TaskSummaryGrid } from "../features/tasks/TaskSummaryGrid";
import type {
  TaskGroupMode,
  TaskSortMode,
  TaskViewMode,
} from "../features/tasks/taskTypes";
import {
  groupTasks,
  matchesTaskQuery,
  relativeTime,
  sortTasks,
  subtaskProgressLabel,
  summarizeCounts,
  computeTaskProgress,
} from "../features/tasks/taskUtils";
import { setTaskFilter, useAppState } from "../stores/appStore";
import {
  addSubtask,
  filterTasks,
  removeTask,
  setTaskPrefs,
  toggleCollapsedGroup,
  toggleSubtask,
  toggleTask,
  useTaskPrefs,
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

const SORT_OPTIONS: { value: TaskSortMode; label: string }[] = [
  { value: "due", label: "Due soon" },
  { value: "priority", label: "Priority" },
  { value: "created", label: "Recently created" },
  { value: "updated", label: "Recently updated" },
  { value: "progress", label: "Progress" },
  { value: "name", label: "Task name" },
  { value: "agent", label: "Agent" },
  { value: "manual", label: "Manual" },
];

const GROUP_OPTIONS: { value: TaskGroupMode; label: string }[] = [
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "agent", label: "Agent" },
  { value: "status", label: "Status" },
  { value: "none", label: "None" },
];

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

interface TasksPageProps {
  onCreateTask: () => void;
}

function useDebouncedValue(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Command-center Tasks workspace — atmospheric, dashboard-grade layout. */
export function TasksPage({ onCreateTask }: TasksPageProps) {
  const tasks = useTasks();
  const prefs = useTaskPrefs();
  const { taskFilter } = useAppState();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 180);
  const [selectedId, setSelectedId] = useState<string | null>(
    prefs.lastSelectedId,
  );
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [askAgentOpen, setAskAgentOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => summarizeCounts(tasks), [tasks]);

  const visible = useMemo(() => {
    const byFilter = filterTasks(tasks, taskFilter);
    const searched = byFilter.filter((t) =>
      matchesTaskQuery(t, debouncedQuery),
    );
    return sortTasks(searched, prefs.sort);
  }, [tasks, taskFilter, debouncedQuery, prefs.sort]);

  const groups = useMemo(
    () => groupTasks(visible, prefs.group),
    [visible, prefs.group],
  );

  const selected: Task | null =
    tasks.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    setTaskPrefs({ lastSelectedId: selectedId });
  }, [selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (!typing && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onCreateTask();
        return;
      }
      if (e.key === "Escape") {
        if (menuTaskId) {
          setMenuTaskId(null);
          return;
        }
        if (askAgentOpen) {
          setAskAgentOpen(false);
          return;
        }
        if (confirmDeleteId) {
          setConfirmDeleteId(null);
          return;
        }
        if (selectedId) {
          setSelectedId(null);
        }
        return;
      }
      if (typing) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (visible.length === 0) return;
        const idx = visible.findIndex((t) => t.id === selectedId);
        const next =
          e.key === "ArrowDown"
            ? visible[Math.min(idx + 1, visible.length - 1)] ?? visible[0]
            : visible[Math.max(idx - 1, 0)] ?? visible[0];
        setSelectedId(next.id);
        return;
      }
      if (e.key === "Enter" && selected) {
        // selection already open in panel
        return;
      }
      if (e.key === "Delete" && selectedId) {
        setConfirmDeleteId(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    visible,
    selectedId,
    selected,
    menuTaskId,
    askAgentOpen,
    confirmDeleteId,
    onCreateTask,
  ]);

  const selectTask = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
    setMenuTaskId(null);
  };

  const filterCount = (id: TaskFilter) =>
    id === "all" ? tasks.length : filterTasks(tasks, id).length;

  return (
    <div className={`tasks-page${selected ? " has-detail" : ""}`}>
      <header className="tasks-hero">
        <div className="tasks-hero-copy">
          <p className="tasks-kicker">Workspace</p>
          <h1 className="page-heading tasks-heading">Tasks</h1>
          <p className="page-lede tasks-lede">
            What needs attention next — priorities, due times, and the agents
            standing by to help.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary tasks-create"
          onClick={onCreateTask}
        >
          <PlusIcon size={14} />
          Create task
        </button>
      </header>

      <TaskSummaryGrid
        counts={summary}
        activeFilter={taskFilter}
        onFilter={setTaskFilter}
      />

      <div className="tasks-workspace">
        <div className="tasks-main" ref={listRef}>
          <div className="tasks-toolbar card sonare-card task-surface">
            <div className="task-toolbar-top">
              <div className="tasks-search">
                <SearchIcon size={15} />
                <input
                  ref={searchRef}
                  value={query}
                  placeholder="Search tasks, notes, or agents..."
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search tasks"
                />
              </div>
              <div className="task-toolbar-sort">
                <span className="task-toolbar-label">Sort</span>
                <Dropdown
                  options={SORT_OPTIONS}
                  value={prefs.sort}
                  onChange={(sort) => setTaskPrefs({ sort })}
                  ariaLabel="Sort tasks"
                />
              </div>
              <div className="task-toolbar-group">
                <span className="task-toolbar-label">Group</span>
                <Dropdown
                  options={GROUP_OPTIONS}
                  value={prefs.group}
                  onChange={(group) => setTaskPrefs({ group })}
                  ariaLabel="Group tasks"
                />
              </div>
              <div
                className="task-view-toggle"
                role="group"
                aria-label="View mode"
              >
                <button
                  type="button"
                  className={`task-view-btn${prefs.view === "list" ? " is-active" : ""}`}
                  aria-pressed={prefs.view === "list"}
                  aria-label="List view"
                  onClick={() => setTaskPrefs({ view: "list" satisfies TaskViewMode })}
                >
                  <ListIcon size={15} />
                </button>
                <button
                  type="button"
                  className={`task-view-btn${prefs.view === "grid" ? " is-active" : ""}`}
                  aria-pressed={prefs.view === "grid"}
                  aria-label="Grid view"
                  onClick={() => setTaskPrefs({ view: "grid" })}
                >
                  <LayoutIcon size={15} />
                </button>
              </div>
            </div>

            <div className="tasks-filters" role="radiogroup" aria-label="Task filter">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={taskFilter === f.id}
                  className={`tasks-filter${taskFilter === f.id ? " active" : ""}`}
                  onClick={() => setTaskFilter(f.id)}
                >
                  <span>{f.label}</span>
                  <span className="tasks-filter-count">{filterCount(f.id)}</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="tasks-empty card sonare-card">
              <span className="tasks-empty-icon" aria-hidden="true">
                <ListIcon size={22} />
              </span>
              <h2 className="tasks-empty-title">
                {debouncedQuery || taskFilter !== "all"
                  ? "No tasks match these filters."
                  : "You’re all caught up"}
              </h2>
              <p className="tasks-empty-text">
                {debouncedQuery || taskFilter !== "all"
                  ? "Try clearing search or filters to see more work."
                  : "Create a task or ask ArcSonare to help plan what’s next."}
              </p>
              <div className="tasks-empty-actions">
                {debouncedQuery || taskFilter !== "all" ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setQuery("");
                      setTaskFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onCreateTask}
                  >
                    <PlusIcon size={14} />
                    Create task
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              className={`tasks-groups${prefs.view === "grid" ? " is-grid" : ""}`}
            >
              {groups.map(([label, items]) => {
                const collapsed = prefs.collapsedGroups.includes(label);
                return (
                  <section key={label} className="tasks-group">
                    <button
                      type="button"
                      className="tasks-group-head"
                      onClick={() => toggleCollapsedGroup(label)}
                      aria-expanded={!collapsed}
                    >
                      {collapsed ? (
                        <ChevronRightIcon size={12} />
                      ) : (
                        <ChevronDownIcon size={12} />
                      )}
                      <h2 className="tasks-group-title">{label}</h2>
                      <span className="tasks-group-count">{items.length}</span>
                    </button>
                    {!collapsed ? (
                      <ul
                        className={`task-list${prefs.view === "grid" ? " task-grid" : ""}`}
                      >
                        {items.map((task) => (
                          <li key={task.id}>
                            <TaskRow
                              task={task}
                              selected={task.id === selectedId}
                              menuOpen={menuTaskId === task.id}
                              onToggle={() => toggleTask(task.id)}
                              onOpen={() => selectTask(task.id)}
                              onMenu={() =>
                                setMenuTaskId((id) =>
                                  id === task.id ? null : task.id,
                                )
                              }
                              onDelete={() => setConfirmDeleteId(task.id)}
                              onAskAgent={() => {
                                setSelectedId(task.id);
                                setAskAgentOpen(true);
                                setMenuTaskId(null);
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {selected ? (
          <TaskDetailPanel
            task={selected}
            onClose={() => setSelectedId(null)}
            onToggle={() => toggleTask(selected.id)}
            onDelete={() => setConfirmDeleteId(selected.id)}
            onAskAgent={() => setAskAgentOpen(true)}
            onAddSubtask={(title) => addSubtask(selected.id, title)}
            onToggleSubtask={(subId) => toggleSubtask(selected.id, subId)}
          />
        ) : (
          <aside
            className="task-detail task-detail-idle card sonare-card task-surface"
            aria-label="No task selected"
          >
            <span className="task-detail-idle-icon" aria-hidden="true">
              <ClockIcon size={22} />
            </span>
            <p className="task-detail-idle-title">Select a task</p>
            <p className="task-detail-idle-text">
              Open any row to review notes, priority, subtasks, and agent
              assignment.
            </p>
          </aside>
        )}
      </div>

      {selected && askAgentOpen ? (
        <AskAgentPanel
          task={selected}
          open={askAgentOpen}
          onClose={() => setAskAgentOpen(false)}
        />
      ) : null}

      {confirmDeleteId ? (
        <div
          className="modal-backdrop"
          onPointerDown={() => setConfirmDeleteId(null)}
        >
          <div
            className="modal"
            role="alertdialog"
            aria-label="Delete task"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Delete this task?</h2>
            <p className="page-lede" style={{ marginTop: 8 }}>
              This cannot be undone from the Tasks page.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmDeleteId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  removeTask(confirmDeleteId);
                  if (selectedId === confirmDeleteId) setSelectedId(null);
                  setConfirmDeleteId(null);
                }}
              >
                <TrashIcon size={13} />
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskProgress({ task }: { task: Task }) {
  const pct = computeTaskProgress(task);
  return (
    <div
      className="task-progress"
      aria-label={`${pct} percent complete`}
      title={subtaskProgressLabel(task)}
    >
      <span className="task-progress-pct">{pct}%</span>
      <span className="task-progress-track" aria-hidden="true">
        <span
          className="task-progress-fill"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

function TaskRow({
  task,
  selected,
  menuOpen,
  onToggle,
  onOpen,
  onMenu,
  onDelete,
  onAskAgent,
}: {
  task: Task;
  selected: boolean;
  menuOpen: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMenu: () => void;
  onDelete: () => void;
  onAskAgent: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPtr = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onMenu();
    };
    window.addEventListener("pointerdown", onPtr);
    return () => window.removeEventListener("pointerdown", onPtr);
  }, [menuOpen, onMenu]);

  const onRowKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <div
      className={`task-row pri-${task.priority}${task.completed ? " completed" : ""}${
        selected ? " selected" : ""
      }${task.urgent ? " is-urgent" : ""}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={onRowKey}
      aria-label={`${task.title}, ${task.urgent ? "urgent, " : ""}${PRIORITY_LABEL[task.priority]} priority, ${task.due ?? "no due date"}, ${computeTaskProgress(task)} percent complete`}
    >
      <button
        type="button"
        className={`task-check${task.completed ? " on" : ""}`}
        onClick={onToggle}
        aria-label={
          task.completed
            ? `Reopen "${task.title}"`
            : `Complete "${task.title}"`
        }
      >
        {task.completed ? <CheckIcon size={12} /> : null}
      </button>
      <button type="button" className="task-open" onClick={onOpen}>
        <span className="task-meta">
          <span className="task-title-row">
            <span className="task-title">{task.title}</span>
            {task.urgent ? (
              <span className="task-urgent-pill">Urgent</span>
            ) : null}
            {task.demo ? <span className="task-demo">Demo</span> : null}
            {task.activity.some((a) => a.type === "agent-suggestion") ? (
              <span className="task-ai-pill" title="AI suggestion available">
                <SparkleIcon size={10} />
              </span>
            ) : null}
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
      </button>
      <TaskProgress task={task} />
      <span className={`priority-badge pri-${task.priority}`}>
        {PRIORITY_LABEL[task.priority]}
      </span>
      <div className="task-more-wrap" ref={menuRef}>
        <button
          type="button"
          className="task-more-btn"
          aria-label={`More actions for ${task.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          <DotsIcon size={14} />
        </button>
        {menuOpen ? (
          <ul className="task-more-menu" role="menu">
            <li>
              <button type="button" role="menuitem" onClick={onOpen}>
                Open task
              </button>
            </li>
            <li>
              <button type="button" role="menuitem" onClick={onToggle}>
                {task.completed ? "Reopen" : "Mark complete"}
              </button>
            </li>
            <li>
              <button type="button" role="menuitem" onClick={onAskAgent}>
                Ask agent
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={onDelete}
              >
                Delete
              </button>
            </li>
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function TaskDetailPanel({
  task,
  onClose,
  onToggle,
  onDelete,
  onAskAgent,
  onAddSubtask,
  onToggleSubtask,
}: {
  task: Task;
  onClose: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onAskAgent: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const pct = computeTaskProgress(task);
  const doneSubs = task.subtasks.filter((s) => s.completed).length;

  return (
    <aside className="task-detail card sonare-card task-surface" aria-label="Selected task">
      <div className="task-detail-head">
        <span className="card-label">Selected task</span>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close details"
        >
          <CloseIcon size={15} />
        </button>
      </div>

      <div className="task-detail-title-row">
        <h2 className="task-detail-title">{task.title}</h2>
        {task.urgent ? <span className="task-urgent-pill">Urgent</span> : null}
        {task.activity.some((a) => a.type === "agent-suggestion") ? (
          <span className="task-ai-pill" aria-label="ArcSonare intelligence">
            <SparkleIcon size={12} />
          </span>
        ) : null}
      </div>
      {task.note ? (
        <p className="task-detail-note">{task.note}</p>
      ) : (
        <p className="task-detail-note muted">No notes yet.</p>
      )}

      <dl className="task-metadata-grid">
        <div className="task-metadata-col">
          <div className="task-detail-fact">
            <dt>
              <ClockIcon size={12} /> Due
            </dt>
            <dd>{task.due ?? "No due time"}</dd>
          </div>
          <div className="task-detail-fact">
            <dt>
              <BotIcon size={12} /> Owner / Agent
            </dt>
            <dd>
              {task.agent ?? "Unassigned"}
              {task.agent ? (
                <span className="task-agent-ready">Agent ready</span>
              ) : null}
            </dd>
          </div>
        </div>
        <div className="task-metadata-col">
          <div className="task-detail-fact">
            <dt>Priority</dt>
            <dd>
              <span className={`priority-dot sev-${task.priority}`} />
              {PRIORITY_LABEL[task.priority]}
            </dd>
          </div>
          <div className="task-detail-fact">
            <dt>Status</dt>
            <dd>
              {pct}% {task.completed ? "complete" : "in progress"}
            </dd>
          </div>
        </div>
      </dl>

      <section className="task-subtasks" aria-label="Subtasks">
        <div className="task-subtasks-head">
          <h3>
            Subtasks{" "}
            {task.subtasks.length > 0 ? (
              <span>
                {doneSubs}/{task.subtasks.length}
              </span>
            ) : null}
          </h3>
          <div className="task-progress task-progress-inline">
            <span className="task-progress-track" aria-hidden="true">
              <span
                className="task-progress-fill"
                style={{ width: `${pct}%` }}
              />
            </span>
          </div>
        </div>
        <ul className="task-subtask-list">
          {task.subtasks.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`task-check${s.completed ? " on" : ""}`}
                onClick={() => onToggleSubtask(s.id)}
                aria-label={
                  s.completed
                    ? `Reopen subtask ${s.title}`
                    : `Complete subtask ${s.title}`
                }
              >
                {s.completed ? <CheckIcon size={10} /> : null}
              </button>
              <span className={s.completed ? "is-done" : undefined}>
                {s.title}
              </span>
            </li>
          ))}
        </ul>
        <form
          className="task-subtask-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onAddSubtask(draft);
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add subtask"
            aria-label="Add subtask"
          />
          <button type="submit" className="btn" disabled={!draft.trim()}>
            Add
          </button>
        </form>
      </section>

      <section className="task-activity" aria-label="Recent activity">
        <h3>Recent activity</h3>
        <ul className="task-activity-list">
          {task.activity.slice(0, 8).map((a) => (
            <li key={a.id}>
              <span className="task-activity-node" aria-hidden="true" />
              <span className="task-activity-text">{a.text}</span>
              <span className="task-activity-time">
                {relativeTime(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="task-detail-actions task-action-bar">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Open task
        </button>
        <button type="button" className="btn" onClick={onToggle}>
          {task.completed ? "Reopen" : "Mark done"}
        </button>
        <button type="button" className="btn" onClick={onAskAgent}>
          Ask agent
        </button>
        {task.title.toLowerCase().includes("email") ||
        task.title.toLowerCase().includes("investor") ? (
          <button
            type="button"
            className="btn"
            onClick={onAskAgent}
            title="Opens Ask agent with draft context"
          >
            Draft reply
          </button>
        ) : null}
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          <TrashIcon size={13} />
          Delete
        </button>
      </div>
    </aside>
  );
}
