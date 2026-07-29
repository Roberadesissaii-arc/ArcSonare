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
import { EmptyState } from "../components/EmptyState";
import { Dropdown } from "../components/settings/Dropdown";
import { AskAgentPanel } from "../features/tasks/AskAgentPanel";
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

/** Tasks workspace — same 3-left/2-right card grid and floating center as
 * the Dashboard and Agent pages. */
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
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

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

  const agentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (t.agent) map.set(t.agent, (map.get(t.agent) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks]);
  const assignedCount = tasks.filter((t) => Boolean(t.agent)).length;
  const unassignedCount = tasks.length - assignedCount;
  const topAgent = agentCounts[0] ?? null;

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
      if (e.key === "Delete" && selectedId) {
        setConfirmDeleteId(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    visible,
    selectedId,
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
    <div className="dashboard">
      <div className="dashboard-col side-column dashboard-left">
        <section
          className="card sonare-card task-left-rail"
          style={{ gridRow: "span 3", overflowY: "auto" }}
        >
          <div className="card-head">
            <span className="card-label">Views</span>
          </div>
          <div
            className="task-rail-filters"
            role="radiogroup"
            aria-label="Task filter"
            style={{ gap: 4 }}
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={taskFilter === f.id}
                className={`task-rail-filter${taskFilter === f.id ? " active" : ""}`}
                style={{ minHeight: 34 }}
                onClick={() => setTaskFilter(f.id)}
              >
                <span className="task-rail-filter-dot" aria-hidden="true" />
                <span>{f.label}</span>
                <span className="task-rail-filter-count">{filterCount(f.id)}</span>
              </button>
            ))}
          </div>

          <span className="agent-rail-label" style={{ display: "block", margin: "18px 0 10px" }}>
            Daily pulse
          </span>
          <div className="task-pulse">
            <div className="task-pulse-head">
              <span>Completed</span>
              <span>
                {summary.completed}/{tasks.length}
              </span>
            </div>
            <div className="task-pulse-track">
              <span
                style={{
                  width: `${tasks.length ? (summary.completed / tasks.length) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="task-pulse-grid">
              <span>
                <b>{summary.open}</b> Open
              </span>
              <span>
                <b>{summary.today}</b> Today
              </span>
              <span>
                <b>{summary.urgent}</b> Urgent
              </span>
            </div>
          </div>

          <div className="agent-resource-summary">
            <span className="agent-rail-label">Assigned to agents</span>
            <div className="agent-resource-meter">
              <span
                style={{
                  width: `${tasks.length ? (assignedCount / tasks.length) * 100 : 0}%`,
                }}
              />
            </div>
            <p>
              <strong>{assignedCount}</strong> assigned{" "}
              <span>{unassignedCount} unassigned</span>
            </p>
          </div>
          <div className="agent-resource-foot">
            {topAgent ? (
              <>
                <span>{topAgent[0]}</span>
                <small>
                  {topAgent[1]} task{topAgent[1] === 1 ? "" : "s"}
                </small>
              </>
            ) : (
              <span>No agent assigned yet</span>
            )}
          </div>
        </section>
      </div>

      <div className="dashboard-center">
        <section className="agent-directory">
          <header className="agent-directory-head">
            <div>
              <span className="agent-rail-label">Workspace</span>
              <h1>Mission queue</h1>
              <p>
                {visible.length} tasks in this view · choose one to inspect or
                delegate.
              </p>
            </div>
          </header>

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
            <div className="task-view-toggle" role="group" aria-label="View mode">
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

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {visible.length === 0 ? (
              <EmptyState
                icon={<ListIcon size={23} />}
                title={
                  debouncedQuery || taskFilter !== "all"
                    ? "No matching tasks"
                    : "You’re all caught up"
                }
                description={
                  debouncedQuery || taskFilter !== "all"
                    ? "Clear the search or filters to see more work."
                    : "Create a task and it will appear here."
                }
              >
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
              </EmptyState>
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
        </section>
      </div>

      <div className="dashboard-col side-column dashboard-right">
        <section className="card sonare-card">
          <div className="card-head">
            <span className="card-label">Selected task</span>
            {selected ? (
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setConfirmDeleteId(selected.id)}
                  aria-label={`Delete "${selected.title}"`}
                >
                  <TrashIcon size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close details"
                >
                  <CloseIcon size={15} />
                </button>
              </div>
            ) : null}
          </div>
          {selected ? (
            <>
              <div className="agent-inspector-hero">
                <h2>{selected.title}</h2>
                <p>
                  {selected.due ?? "No due time"}
                  {selected.agent ? ` · ${selected.agent}` : ""}
                </p>
                <span
                  className={`agent-inspector-status${selected.completed ? " active" : ""}`}
                >
                  {selected.completed
                    ? "Completed"
                    : `${computeTaskProgress(selected)}% complete`}
                </span>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    justifyContent: "center",
                    flexWrap: "wrap",
                    marginTop: 10,
                  }}
                >
                  <span className={`priority-badge pri-${selected.priority}`}>
                    {PRIORITY_LABEL[selected.priority]}
                  </span>
                  {selected.urgent ? (
                    <span className="task-urgent-pill">Urgent</span>
                  ) : null}
                </div>
              </div>
              <div className="agent-inspector-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => toggleTask(selected.id)}
                >
                  {selected.completed ? "Reopen" : "Mark done"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAskAgentOpen(true)}
                >
                  Ask agent
                </button>
              </div>
              {selected.title.toLowerCase().includes("email") ||
              selected.title.toLowerCase().includes("investor") ? (
                <button
                  type="button"
                  className="btn"
                  style={{ width: "100%" }}
                  onClick={() => setAskAgentOpen(true)}
                  title="Opens Ask agent with draft context"
                >
                  Draft reply
                </button>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={<ClockIcon size={24} />}
              title="Select a task"
              description="Choose a task from the queue to see its details."
              compact
            />
          )}
        </section>

        <section className="card sonare-card" style={{ gridRow: "span 2" }}>
          {selected ? (
            <div style={{ height: "100%", overflowY: "auto" }}>
              {selected.note ? (
                <p className="task-detail-note" style={{ marginBottom: 14 }}>
                  {selected.note}
                </p>
              ) : null}
              <div className="task-subtasks-head">
                <h3>
                  Subtasks{" "}
                  {selected.subtasks.length > 0 ? (
                    <span>
                      {selected.subtasks.filter((s) => s.completed).length}/
                      {selected.subtasks.length}
                    </span>
                  ) : null}
                </h3>
                <div className="task-progress task-progress-inline">
                  <span className="task-progress-track" aria-hidden="true">
                    <span
                      className="task-progress-fill"
                      style={{ width: `${computeTaskProgress(selected)}%` }}
                    />
                  </span>
                </div>
              </div>
              <ul className="task-subtask-list">
                {selected.subtasks.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`task-check${s.completed ? " on" : ""}`}
                      onClick={() => toggleSubtask(selected.id, s.id)}
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
                  if (!subtaskDraft.trim()) return;
                  addSubtask(selected.id, subtaskDraft);
                  setSubtaskDraft("");
                }}
              >
                <input
                  value={subtaskDraft}
                  onChange={(e) => setSubtaskDraft(e.target.value)}
                  placeholder="Add subtask"
                  aria-label="Add subtask"
                />
                <button
                  type="submit"
                  className="btn"
                  disabled={!subtaskDraft.trim()}
                >
                  Add
                </button>
              </form>

              <div className="agent-inspector-section">
                <span className="agent-rail-label">Recent activity</span>
                {selected.activity.slice(0, 8).map((a) => (
                  <div className="agent-activity-line" key={a.id}>
                    <i />
                    <span>
                      <strong>{a.text}</strong>
                      <small>{relativeTime(a.createdAt)}</small>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<BotIcon size={24} />}
              title="Nothing selected yet"
              description="Subtasks, notes, and activity for the chosen task will show up here."
              compact
            />
          )}
        </section>
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
