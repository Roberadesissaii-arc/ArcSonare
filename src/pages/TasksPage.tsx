import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CalendarDays,
  Check,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Expand,
  Inbox,
  Link2,
  ListFilter,
  ListTodo,
  MoreHorizontal,
  Pin,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { ArcSonareLogo } from "../components/brand/ArcSonareLogo";
import {
  loadAccountProfile,
  PROFILE_CHANGED_EVENT,
} from "../features/account/accountProfile";
import { AskAgentPanel } from "../features/tasks/AskAgentPanel";
import type { TaskSortMode } from "../features/tasks/taskTypes";
import {
  computeTaskProgress,
  groupTasks,
  matchesTaskQuery,
  relativeTime,
  sortTasks,
  summarizeCounts,
} from "../features/tasks/taskUtils";
import { addActivity, setTaskFilter, useAppState } from "../stores/appStore";
import {
  addSubtask,
  createTaskDurable,
  filterTasks,
  removeTask,
  setTaskPrefs,
  toggleCollapsedGroup,
  toggleSubtask,
  toggleTask,
  updateTask,
  useTaskPrefs,
  useTasks,
  type Task,
  type TaskFilter,
  type TaskPriority,
} from "../stores/taskStore";

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;
const SORT_CYCLE: TaskSortMode[] = ["due", "priority", "created"];

type TaskViewId = TaskFilter | "assigned";

type ViewDefinition = {
  id: TaskViewId;
  label: string;
  /**
   * `size?: number | string` because these are lucide icons, and lucide's own
   * `LucideProps` declares exactly that — `14` and `"1em"` are both valid.
   *
   * The narrower `ComponentType<{ size?: number }>` used elsewhere in the app
   * (for the hand-written components in `Icons.tsx`) does not accept a lucide
   * icon: React's `FunctionComponent` carries `propTypes?: WeakValidationMap<P>`,
   * which is invariant in `P`, so `FunctionComponent<LucideProps>` is not
   * assignable to `FunctionComponent<{ size?: number }>` however compatible the
   * props otherwise look. Widening to lucide's real signature is the accurate
   * type, not a loosening — the alternative is casting away a genuine mismatch.
   */
  icon: ComponentType<{ size?: number | string }>;
};

const TASK_VIEWS: ViewDefinition[] = [
  { id: "all", label: "All", icon: ListTodo },
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "upcoming", label: "Upcoming", icon: CalendarClock },
  { id: "assigned", label: "Assigned to me", icon: UserRound },
  { id: "urgent", label: "Urgent", icon: AlertTriangle },
  { id: "completed", label: "Completed", icon: CheckSquare2 },
];

interface TasksPageProps {
  onCreateTask: () => void;
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function taskCategory(task: Task): string {
  const category = task.tags.find((tag) => !/gmail|drive|calendar/i.test(tag));
  if (category) return titleCase(category);
  if (task.agent) return "Agent workflow";
  if (task.urgent) return "Command & collaboration";
  return "Personal workspace";
}

function taskSource(task: Task): {
  label: string;
  kind: "agent" | "calendar" | "drive" | "manual";
} {
  if (task.agent) return { label: task.agent, kind: "agent" };
  const joined = `${task.tags.join(" ")} ${task.note ?? ""}`.toLowerCase();
  if (joined.includes("calendar")) return { label: "Calendar", kind: "calendar" };
  if (joined.includes("drive")) return { label: "Google Drive", kind: "drive" };
  return { label: "Manual", kind: "manual" };
}

function linkedService(task: Task): string {
  const joined = `${task.tags.join(" ")} ${task.note ?? ""}`.toLowerCase();
  if (joined.includes("drive")) return "Google Drive";
  if (joined.includes("calendar")) return "Google Calendar";
  if (joined.includes("gmail")) return "Gmail";
  return "ArcSonare workspace";
}

function SourceGlyph({
  kind,
  size = 14,
  manualAvatar,
}: {
  kind: ReturnType<typeof taskSource>["kind"];
  size?: number;
  manualAvatar?: string;
}) {
  if (kind === "agent") return <Sparkles size={size} />;
  if (kind === "calendar") return <CalendarDays size={size} />;
  if (kind === "drive") return <Link2 size={size} />;
  if (manualAvatar) {
    return (
      <img
        className="task-v2-source-profile-photo"
        src={manualAvatar}
        alt=""
        draggable={false}
      />
    );
  }
  return <ArcSonareLogo size={Math.max(16, size + 3)} />;
}

function formatDue(task: Task): string {
  if (!task.due) return "—";
  const raw = task.due.trim();
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw.replace(/,\s*/g, " · ");

  const date = new Date(parsed);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const key = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (key(date) === key(today)) return `Today · ${time}`;
  if (key(date) === key(tomorrow)) return `Tomorrow · ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

function formatCreated(at: number): string {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isOverdue(task: Task): boolean {
  if (task.completed || !task.due) return false;
  const parsed = Date.parse(task.due);
  return Number.isFinite(parsed) && parsed < Date.now();
}

export function TasksPage({ onCreateTask }: TasksPageProps) {
  const tasks = useTasks();
  const prefs = useTaskPrefs();
  const { taskFilter } = useAppState();
  const [accountProfile, setAccountProfile] = useState(loadAccountProfile);
  const [selectedId, setSelectedId] = useState<string | null>(prefs.lastSelectedId);
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [askAgentOpen, setAskAgentOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState("");
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [subtaskAddOpen, setSubtaskAddOpen] = useState(false);
  const [inspectorPinned, setInspectorPinned] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [inspectorMore, setInspectorMore] = useState(false);
  const [undoTaskId, setUndoTaskId] = useState<string | null>(null);

  const summary = useMemo(() => summarizeCounts(tasks), [tasks]);
  const activeView: TaskViewId = assignedOnly ? "assigned" : taskFilter;

  const visible = useMemo(() => {
    const filtered = assignedOnly
      ? tasks.filter((task) => Boolean(task.agent) && !task.completed)
      : filterTasks(tasks, taskFilter);
    const searched = filtered.filter((task) => {
      if (!query.trim()) return true;
      if (matchesTaskQuery(task, query)) return true;
      const extra = `${taskCategory(task)} ${taskSource(task).label} ${linkedService(task)}`.toLowerCase();
      return extra.includes(query.trim().toLowerCase());
    });
    return sortTasks(searched, prefs.sort);
  }, [assignedOnly, prefs.sort, query, taskFilter, tasks]);

  const groups = useMemo(() => {
    const grouped = groupTasks(visible, "due");
    if (activeView !== "all" && activeView !== "open") return grouped;

    const byLabel = new Map(grouped);
    const stable: [string, Task[]][] = ["Today", "Upcoming", "No due date"].map(
      (label) => [label, byLabel.get(label) ?? []],
    );
    const completed = byLabel.get("Completed");
    if (completed?.length) stable.push(["Completed", completed]);
    return stable;
  }, [activeView, visible]);
  const showStableGroupShells =
    !query.trim() && (activeView === "all" || activeView === "open");
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const openTasks = tasks.filter((task) => !task.completed);
  const overdueCount = openTasks.filter(isOverdue).length;
  const noDueCount = openTasks.filter((task) => task.dueBucket === "none").length;
  const maxInsight = Math.max(tasks.length, 1);

  const filterCount = (view: TaskViewId) => {
    if (view === "all") return tasks.length;
    if (view === "assigned") return tasks.filter((task) => Boolean(task.agent) && !task.completed).length;
    return filterTasks(tasks, view).length;
  };

  useEffect(() => {
    setTaskPrefs({ lastSelectedId: selectedId });
  }, [selectedId]);

  useEffect(() => {
    const refreshProfile = () => setAccountProfile(loadAccountProfile());
    window.addEventListener(PROFILE_CHANGED_EVENT, refreshProfile);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, refreshProfile);
  }, []);

  useEffect(() => {
    if (prefs.view !== "list") setTaskPrefs({ view: "list" });
  }, [prefs.view]);

  useEffect(() => {
    setSubtaskAddOpen(false);
    setSubtaskDraft("");
    setInspectorMore(false);
  }, [selectedId]);

  useEffect(() => {
    if (!undoTaskId) return;
    const timeout = window.setTimeout(() => setUndoTaskId(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [undoTaskId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (event.key === "Escape" && query) {
        event.preventDefault();
        setQuery("");
        return;
      }
      if (!typing && event.key.toLowerCase() === "n") {
        event.preventDefault();
        onCreateTask();
        return;
      }
      if (event.key === "Escape") {
        if (menuTaskId) return setMenuTaskId(null);
        if (askAgentOpen) return setAskAgentOpen(false);
        if (confirmDeleteId) return setConfirmDeleteId(null);
        if (selectedId && !inspectorPinned) setSelectedId(null);
        return;
      }
      if (typing || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
      event.preventDefault();
      if (visible.length === 0) return;
      const index = visible.findIndex((task) => task.id === selectedId);
      const next =
        event.key === "ArrowDown"
          ? visible[Math.min(index + 1, visible.length - 1)] ?? visible[0]
          : visible[Math.max(index - 1, 0)] ?? visible[0];
      setSelectedId(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    askAgentOpen,
    confirmDeleteId,
    inspectorPinned,
    menuTaskId,
    onCreateTask,
    query,
    selectedId,
    visible,
  ]);

  const selectView = (view: TaskViewId) => {
    if (view === "assigned") {
      setAssignedOnly(true);
      setTaskFilter("all");
    } else {
      setAssignedOnly(false);
      setTaskFilter(view);
    }
  };

  const toggleWithUndo = (task: Task) => {
    toggleTask(task.id);
    setUndoTaskId(task.id);
    addActivity(
      task.completed ? `Reopened "${task.title}"` : `Completed "${task.title}"`,
      "task",
    );
  };

  const submitQuickAdd = async () => {
    const title = quickAdd.trim();
    if (!title) return;
    const outcome = await createTaskDurable({
      title,
      priority: "medium",
      dueBucket: "none",
      urgent: false,
    });
    if (outcome.success) {
      setQuickAdd("");
      setQuickAddError(null);
    } else {
      setQuickAddError("Couldn't save that task.");
    }
  };

  const cycleSort = () => {
    const index = SORT_CYCLE.indexOf(prefs.sort);
    const next = SORT_CYCLE[(index + 1 + SORT_CYCLE.length) % SORT_CYCLE.length];
    setTaskPrefs({ sort: next });
  };

  const selectedProgress = selected ? computeTaskProgress(selected) : 0;
  const selectedDone = selected?.subtasks.filter((subtask) => subtask.completed).length ?? 0;

  return (
    <div
      className={`dashboard connect-workspace-root tasks-workspace-root task-v2-root${
        selected ? " has-inspector" : " no-inspector"
      }${inspectorExpanded ? " inspector-expanded" : ""}`}
      data-page="tasks"
    >
      <aside className="task-v2-left" aria-label="Task navigation">
        <section className="card sonare-card task-v2-panel task-v2-views-panel">
          <span className="task-v2-kicker">Views</span>
          <div className="task-v2-view-list" role="radiogroup" aria-label="Task views">
            {TASK_VIEWS.map((view) => {
              const Icon = view.icon;
              const active = activeView === view.id;
              return (
                <button
                  key={view.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`task-v2-view view-${view.id}${active ? " is-active" : ""}`}
                  onClick={() => selectView(view.id)}
                >
                  <Icon size={15} />
                  <span>{view.label}</span>
                  <strong>{filterCount(view.id)}</strong>
                </button>
              );
            })}
          </div>

          <div className="task-v2-divider" />
          <span className="task-v2-kicker">Quick add</span>
          <form
            className="task-v2-quick-add"
            onSubmit={(event) => {
              event.preventDefault();
              void submitQuickAdd();
            }}
          >
            <input
              value={quickAdd}
              onChange={(event) => {
                setQuickAdd(event.target.value);
                if (quickAddError) setQuickAddError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.shiftKey) {
                  event.preventDefault();
                  onCreateTask();
                }
              }}
              placeholder="Add a task…"
              aria-label="Quick add a task"
            />
            <button type="submit" disabled={!quickAdd.trim()} aria-label="Add task">
              <Plus size={15} />
            </button>
          </form>
          {quickAddError ? <p className="task-v2-error">{quickAddError}</p> : null}
        </section>

        <section className="card sonare-card task-v2-panel task-v2-insights-panel">
          <div className="task-v2-panel-head">
            <span className="task-v2-kicker">Focus insights</span>
          </div>
          <div className="task-v2-insights">
            {[
              { label: "Open tasks", value: summary.open, tone: "violet" },
              { label: "Due today", value: summary.today, tone: "violet" },
              { label: "Overdue", value: overdueCount, tone: "red" },
              { label: "No due date", value: noDueCount, tone: "violet" },
              { label: "Completed", value: summary.completed, tone: "green" },
            ].map((item) => (
              <div className={`task-v2-insight is-${item.tone}`} key={item.label}>
                <div><span>{item.label}</span><strong>{item.value}</strong></div>
                <span className="task-v2-insight-track">
                  <i style={{ width: `${Math.max(4, (item.value / maxInsight) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main className="task-v2-center">
        <header className="task-v2-workspace-head">
          <div>
            <span className="task-v2-eyebrow">Task workspace</span>
            <h1>Mission queue</h1>
            <p>Stay focused. Prioritize what matters most.</p>
          </div>
          <div className="task-v2-workspace-tools">
            <label className="task-v2-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks…"
                aria-label="Search tasks"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                  <X size={13} />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              className="task-v2-list-tool"
              onClick={cycleSort}
              title={`Sorted by ${prefs.sort}. Click to change.`}
              aria-label={`Change task sort. Currently ${prefs.sort}`}
            >
              <ListFilter size={17} />
            </button>
          </div>
        </header>

        <section className="task-v2-queue" aria-label="Mission queue">
          {visible.length === 0 && !showStableGroupShells ? (
            <div className="task-v2-empty">
              <EmptyState
                icon={<Inbox size={24} />}
                title={query ? "No tasks found" : "No matching tasks"}
                description={query ? "Try a different search." : "Choose another view or create a task."}
                compact
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQuery("");
                    selectView("all");
                  }}
                >
                  Clear filters
                </button>
              </EmptyState>
            </div>
          ) : (
            <div className="task-v2-groups">
              {groups.map(([label, items]) => {
                const collapsed = prefs.collapsedGroups.includes(label);
                return (
                  <section className="task-v2-group" key={label}>
                    <button
                      type="button"
                      className="task-v2-group-head"
                      onClick={() => toggleCollapsedGroup(label)}
                      aria-expanded={!collapsed}
                    >
                      <CalendarDays size={14} />
                      <span>{label}</span>
                      <strong>{items.length}</strong>
                      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {!collapsed ? (
                      items.length > 0 ? (
                        <ul className="task-v2-list" role="listbox" aria-label={`${label} tasks`}>
                          {items.map((task) => (
                          <li key={task.id}>
                            <TaskRow
                              task={task}
                              manualAvatar={accountProfile.avatarDataUrl}
                              selected={task.id === selectedId}
                              menuOpen={menuTaskId === task.id}
                              onToggle={() => toggleWithUndo(task)}
                              onOpen={() => {
                                setSelectedId(task.id);
                                setMenuTaskId(null);
                              }}
                              onMenu={() =>
                                setMenuTaskId((current) => (current === task.id ? null : task.id))
                              }
                              onDelete={() => setConfirmDeleteId(task.id)}
                              onAskAgent={() => {
                                setSelectedId(task.id);
                                setAskAgentOpen(true);
                                setMenuTaskId(null);
                              }}
                              onCyclePriority={() => {
                                const next: Record<TaskPriority, TaskPriority> = {
                                  high: "medium",
                                  medium: "low",
                                  low: "high",
                                };
                                updateTask(task.id, { priority: next[task.priority] });
                                setMenuTaskId(null);
                              }}
                              onDuplicate={() => {
                                void createTaskDurable({
                                  title: `${task.title} copy`,
                                  note: task.note,
                                  priority: task.priority,
                                  due: task.due,
                                  dueBucket: task.dueBucket,
                                  urgent: task.urgent,
                                  tags: task.tags,
                                });
                                setMenuTaskId(null);
                              }}
                            />
                          </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="task-v2-group-empty">No tasks in this section.</div>
                      )
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {selected ? (
        <aside className="task-v2-right" aria-label="Selected task inspector">
          <section className="card sonare-card task-v2-panel task-v2-selected-panel">
            <div className="task-v2-inspector-head">
              <span className="task-v2-kicker">Selected task</span>
              <div>
                <button
                  type="button"
                  className={inspectorPinned ? "is-active" : undefined}
                  onClick={() => setInspectorPinned((value) => !value)}
                  aria-label={inspectorPinned ? "Unpin inspector" : "Pin inspector"}
                ><Pin size={14} /></button>
                <button
                  type="button"
                  className={inspectorExpanded ? "is-active" : undefined}
                  onClick={() => setInspectorExpanded((value) => !value)}
                  aria-label={inspectorExpanded ? "Restore inspector width" : "Expand inspector"}
                ><Expand size={14} /></button>
                <button type="button" onClick={() => setSelectedId(null)} aria-label="Close inspector">
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="task-v2-selected-title-row">
              <h2>{selected.title}</h2>
              <span className={`task-v2-priority pri-${selected.priority}`}>
                {PRIORITY_LABEL[selected.priority]}
              </span>
            </div>
            <p className="task-v2-category"><Sparkles size={13} />{taskCategory(selected)}</p>

            <dl className="task-v2-facts">
              <div><dt>Status</dt><dd><span className="task-v2-status-pill">{selected.completed ? "Completed" : "Open"}</span></dd></div>
              <div><dt>Due</dt><dd><CalendarDays size={14} />{formatDue(selected)}</dd></div>
              <div>
                <dt>Source</dt>
                <dd>
                  <span className={`task-v2-source-icon is-${taskSource(selected).kind}${
                    taskSource(selected).kind === "manual" && accountProfile.avatarDataUrl
                      ? " has-profile"
                      : ""
                  }`}>
                    <SourceGlyph
                      kind={taskSource(selected).kind}
                      size={13}
                      manualAvatar={accountProfile.avatarDataUrl}
                    />
                  </span>
                  {taskSource(selected).label}
                </dd>
              </div>
              <div><dt>Linked service</dt><dd><span className="task-v2-source-icon is-service"><Link2 size={13} /></span>{linkedService(selected)}</dd></div>
              <div><dt>Created</dt><dd><Clock3 size={14} />{formatCreated(selected.createdAt)}</dd></div>
            </dl>

            <button
              type="button"
              className="task-v2-focus-btn"
              onClick={() => addActivity(`Started focus on "${selected.title}"`, "task")}
            >
              <Play size={15} fill="currentColor" />
              Start focus
            </button>

            <div className="task-v2-inspector-actions">
              <button type="button" onClick={() => setAskAgentOpen(true)}><UserPlus size={14} />Assign</button>
              <button type="button" onClick={() => toggleWithUndo(selected)}><Check size={15} />{selected.completed ? "Reopen" : "Mark done"}</button>
              <div className="task-v2-inspector-more-wrap">
                <button
                  type="button"
                  aria-label="More task actions"
                  onClick={() => setInspectorMore((value) => !value)}
                ><MoreHorizontal size={16} /></button>
                {inspectorMore ? (
                  <div className="task-v2-inspector-menu">
                    <button type="button" onClick={() => setConfirmDeleteId(selected.id)}>
                      <Trash2 size={13} />Delete task
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="card sonare-card task-v2-panel task-v2-detail-panel">
            <div className="task-v2-detail-scroll">
              <div className="task-v2-subtasks-head">
                <span className="task-v2-kicker">Subtasks <b>{selectedDone}/{selected.subtasks.length}</b></span>
                <strong>{selectedProgress}%</strong>
              </div>
              <div className="task-v2-subtask-progress"><span style={{ width: `${selectedProgress}%` }} /></div>

              {selected.subtasks.length > 0 ? (
                <ul className="task-v2-subtask-list">
                  {selected.subtasks.map((subtask) => (
                    <li key={subtask.id}>
                      <button
                        type="button"
                        className={subtask.completed ? "is-done" : undefined}
                        onClick={() => toggleSubtask(selected.id, subtask.id)}
                        aria-label={subtask.completed ? `Reopen ${subtask.title}` : `Complete ${subtask.title}`}
                      >
                        {subtask.completed ? <Check size={12} /> : null}
                      </button>
                      <span className={subtask.completed ? "is-done" : undefined}>{subtask.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="task-v2-subtask-empty">No subtasks yet. Break this task into smaller steps.</p>
              )}

              {subtaskAddOpen ? (
                <form
                  className="task-v2-subtask-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!subtaskDraft.trim()) return;
                    addSubtask(selected.id, subtaskDraft.trim());
                    setSubtaskDraft("");
                    setSubtaskAddOpen(false);
                  }}
                >
                  <input
                    autoFocus
                    value={subtaskDraft}
                    onChange={(event) => setSubtaskDraft(event.target.value)}
                    placeholder="Describe the next step"
                  />
                  <button type="submit" disabled={!subtaskDraft.trim()}>Add</button>
                </form>
              ) : (
                <button type="button" className="task-v2-add-subtask" onClick={() => setSubtaskAddOpen(true)}>
                  <Plus size={14} />Add subtask
                </button>
              )}

              <div className="task-v2-activity-head">
                <span className="task-v2-kicker">Activity</span>
                <button type="button">View all</button>
              </div>
              <div className="task-v2-activity-list">
                {(selected.activity ?? []).slice(0, 5).map((entry) => (
                  <div className="task-v2-activity-row" key={entry.id}>
                    <span className={`task-v2-activity-icon is-${entry.actorType}`}>
                      {entry.actorType === "agent" ? <Bot size={13} /> : entry.actorType === "system" ? <Sparkles size={13} /> : <CircleUserRound size={13} />}
                    </span>
                    <span>
                      <strong>{entry.actorType === "agent" ? selected.agent ?? "ArcSonare agent" : entry.actorType === "system" ? "ArcSonare" : "You"}</strong>
                      <span>{entry.text}</span>
                      <small>{relativeTime(entry.createdAt)}</small>
                    </span>
                  </div>
                ))}
                {selected.activity.length === 0 ? <p className="task-v2-activity-empty">Activity will appear here.</p> : null}
              </div>
            </div>
          </section>
        </aside>
      ) : null}

      {undoTaskId ? (
        <div className="task-v2-undo" role="status">
          <span>Task updated</span>
          <button
            type="button"
            onClick={() => {
              toggleTask(undoTaskId);
              setUndoTaskId(null);
            }}
          >Undo</button>
        </div>
      ) : null}

      {selected && askAgentOpen ? (
        <AskAgentPanel task={selected} open={askAgentOpen} onClose={() => setAskAgentOpen(false)} />
      ) : null}

      {confirmDeleteId ? (
        <div className="modal-backdrop" onPointerDown={() => setConfirmDeleteId(null)}>
          <div
            className="modal"
            role="alertdialog"
            aria-label="Delete task"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2 className="modal-title">Delete this task?</h2>
            <p className="page-lede" style={{ marginTop: 8 }}>This cannot be undone from the Tasks page.</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  removeTask(confirmDeleteId);
                  if (selectedId === confirmDeleteId) setSelectedId(null);
                  setConfirmDeleteId(null);
                }}
              >
                <Trash2 size={13} />Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  manualAvatar,
  selected,
  menuOpen,
  onToggle,
  onOpen,
  onMenu,
  onDelete,
  onAskAgent,
  onCyclePriority,
  onDuplicate,
}: {
  task: Task;
  manualAvatar: string;
  selected: boolean;
  menuOpen: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMenu: () => void;
  onDelete: () => void;
  onAskAgent: () => void;
  onCyclePriority: () => void;
  onDuplicate: () => void;
}) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const source = taskSource(task);

  useEffect(() => {
    if (!menuOpen || !menuButtonRef.current) {
      setMenuStyle(null);
      return;
    }
    const placeMenu = () => {
      if (!menuButtonRef.current) return;
      const rect = menuButtonRef.current.getBoundingClientRect();
      const menuWidth = 184;
      const openUp = window.innerHeight - rect.bottom < 210;
      setMenuStyle({
        position: "fixed",
        left: Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
        width: menuWidth,
        zIndex: 10060,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    };
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuButtonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onMenu();
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen, onMenu]);

  const onRowKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  const menu =
    menuOpen && menuStyle
      ? createPortal(
          <ul className="task-v2-more-menu" role="menu" ref={menuRef} style={menuStyle}>
            <li><button type="button" role="menuitem" onClick={onOpen}>Open details</button></li>
            <li><button type="button" role="menuitem" onClick={onToggle}>{task.completed ? "Reopen" : "Mark complete"}</button></li>
            <li><button type="button" role="menuitem" onClick={onCyclePriority}>Change priority</button></li>
            <li><button type="button" role="menuitem" onClick={onAskAgent}>Assign agent</button></li>
            <li><button type="button" role="menuitem" onClick={onDuplicate}>Duplicate</button></li>
            <li><button type="button" role="menuitem" className="is-danger" onClick={onDelete}>Delete</button></li>
          </ul>,
          document.body,
        )
      : null;

  return (
    <div
      className={`task-v2-row pri-${task.priority}${selected ? " is-selected" : ""}${task.completed ? " is-completed" : ""}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onRowKey}
      title={task.title}
    >
      <button
        type="button"
        className={`task-v2-check${task.completed ? " is-done" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
      >
        {task.completed ? <Check size={12} /> : null}
      </button>

      <span className="task-v2-row-info">
        <strong>{task.title}</strong>
        <small>{taskCategory(task)}</small>
      </span>
      <span className={`task-v2-row-due${isOverdue(task) ? " is-overdue" : ""}`}>
        {task.due ? <CalendarDays size={13} /> : null}{formatDue(task)}
      </span>
      <span className="task-v2-row-source">
        <span className={`task-v2-source-icon is-${source.kind}${
          source.kind === "manual" && manualAvatar ? " has-profile" : ""
        }`}>
          <SourceGlyph kind={source.kind} size={13} manualAvatar={manualAvatar} />
        </span>
        <span>{source.label}</span>
      </span>
      <span className={`task-v2-priority pri-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
      <button
        type="button"
        ref={menuButtonRef}
        className="task-v2-more-btn"
        onClick={(event) => {
          event.stopPropagation();
          onMenu();
        }}
        aria-label={`More actions for ${task.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <MoreHorizontal size={16} />
      </button>
      {menu}
    </div>
  );
}
