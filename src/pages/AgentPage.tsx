import { useEffect, useMemo, useState, Component, type ReactNode } from "react";
import { Bot, Link2, Unplug } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import {
  AGENT_DEPARTMENTS,
  AgentListGrid,
  type AgentDepartmentId,
} from "../components/agents/AgentListGrid";
import { agentAvatarSrc } from "../features/agents/agentAvatars";
import {
  appendAgentActivity,
  hydrateAgentsFromDb,
  setPrimeAgent,
  setAgentPrefs,
  useAgentPrefs,
  useAgents,
  type AgentConfig,
  agentStatus,
} from "../features/agents/agentStore";
import { addActivity } from "../stores/appStore";
import { updateTask, useTasks, type Task } from "../stores/taskStore";

type DepartmentFilter = "all" | AgentDepartmentId;

class LocalBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error("[AgentPage] crash:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="dashboard connect-workspace-root" data-page="agent">
          <div className="dashboard-center connect-center" style={{ padding: 24 }}>
            <h1>Agent page error</h1>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxWidth: 720,
                fontSize: 12,
                color: "#e56c73",
              }}
            >
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
            <button
              type="button"
              className="btn"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function statusOf(agent: AgentConfig): string {
  try {
    return agentStatus(agent);
  } catch {
    return "Ready";
  }
}

/** Public export — always wrapped so a crash shows the real stack. */
export function AgentPage() {
  return (
    <LocalBoundary>
      <AgentPageInner />
    </LocalBoundary>
  );
}

function AgentPageInner() {
  const agentsRaw = useAgents();
  const agents = Array.isArray(agentsRaw) ? agentsRaw.filter(Boolean) : [];
  const prefs = useAgentPrefs();
  const tasksRaw = useTasks();
  const tasks = Array.isArray(tasksRaw) ? tasksRaw.filter(Boolean) : [];

  const [openAgentId, setOpenAgentId] = useState<string | null>(
    () => prefs?.lastSelectedId ?? null,
  );
  const [departmentFilter, setDepartmentFilter] =
    useState<DepartmentFilter>("all");
  const [assignAgentId, setAssignAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (agents.length > 0) return;
    void hydrateAgentsFromDb().catch((e) =>
      console.error("[AgentPage] hydrate failed", e),
    );
  }, [agents.length]);

  useEffect(() => {
    if ((prefs?.lastSelectedId ?? null) === openAgentId) return;
    setAgentPrefs({ lastSelectedId: openAgentId });
  }, [openAgentId, prefs?.lastSelectedId]);

  const openAgent = agents.find((a) => a.id === openAgentId) ?? null;
  const assignAgent = agents.find((a) => a.id === assignAgentId) ?? null;
  const primeAgent = agents.find((a) => a.isPrime) ?? agents[0] ?? null;

  const assignmentByAgentName = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const task of tasks) {
      if (task.completed || !task.agent) continue;
      const key = String(task.agent);
      const list = map.get(key) ?? [];
      list.push(String(task.title || "Untitled"));
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const openTasks = useMemo(
    () => tasks.filter((t) => !t.completed),
    [tasks],
  );
  const assignedTaskCount = openTasks.filter((t) =>
    Boolean(t.agent && String(t.agent).trim()),
  ).length;
  const unassignedTaskCount = openTasks.length - assignedTaskCount;
  const onWorkCount = agents.filter(
    (a) => (assignmentByAgentName.get(a.name)?.length ?? 0) > 0,
  ).length;

  const linkedTitles = openAgent
    ? (assignmentByAgentName.get(openAgent.name) ?? [])
    : [];

  return (
    <div className="dashboard connect-workspace-root" data-page="agent">
      {/* LEFT — 3 cards like Connect */}
      <div className="dashboard-col side-column dashboard-left">
        <section className="card sonare-card connect-rail-card connect-rail-views">
          <div className="connect-rail-block">
            <span className="connect-rail-heading">Views</span>
            <div className="connect-rail-filters" role="radiogroup">
              <button
                type="button"
                role="radio"
                aria-checked
                className="connect-rail-filter active"
              >
                <span className="connect-rail-filter-dot" aria-hidden="true" />
                <span className="connect-rail-filter-text">
                  <strong>All</strong>
                  <small>Full specialist roster</small>
                </span>
                <span className="connect-rail-filter-count">
                  {agents.length}
                </span>
              </button>
            </div>
          </div>
        </section>

        <section className="card sonare-card connect-rail-card connect-rail-categories-card">
          <div className="connect-rail-block">
            <span className="connect-rail-heading">Departments</span>
            <div className="connect-rail-categories" role="list">
              <button
                type="button"
                role="listitem"
                className={`connect-rail-category${
                  departmentFilter === "all" ? " active" : ""
                }`}
                onClick={() => setDepartmentFilter("all")}
              >
                <span>All departments</span>
                <span className="connect-rail-category-count">
                  {agents.length}
                </span>
              </button>
              {AGENT_DEPARTMENTS.map((dept) => {
                const count = dept.agentIds.filter((id) =>
                  agents.some((a) => a.id === id),
                ).length;
                return (
                  <button
                    key={dept.id}
                    type="button"
                    role="listitem"
                    className={`connect-rail-category${
                      departmentFilter === dept.id ? " active" : ""
                    }`}
                    onClick={() => setDepartmentFilter(dept.id)}
                  >
                    <span>{dept.title}</span>
                    <span className="connect-rail-category-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="card sonare-card connect-rail-card connect-rail-pulse">
          <div className="connect-rail-block">
            <span className="connect-rail-heading">Delegation pulse</span>
            <div className="connect-pulse">
              <div className="connect-pulse-head">
                <span>Open tasks linked</span>
                <span>
                  {assignedTaskCount}/{openTasks.length}
                </span>
              </div>
              <div className="connect-pulse-track">
                <span
                  style={{
                    width: `${
                      openTasks.length
                        ? (assignedTaskCount / openTasks.length) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="connect-pulse-grid">
                <span>
                  <b>{onWorkCount}</b> On work
                </span>
                <span>
                  <b>{assignedTaskCount}</b> Tasks linked
                </span>
                <span>
                  <b>{unassignedTaskCount}</b> Unassigned
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* CENTER */}
      <div className="dashboard-center connect-center">
        <section className="connect-directory">
          <header className="agent-directory-head connect-directory-head">
            <div className="connect-directory-title">
              <span className="connect-rail-heading">Agent workspace</span>
              <h1>Your agent team</h1>
              <p>
                {agents.length} specialists · 3 departments · 6 per department
              </p>
            </div>
          </header>

          <AgentListGrid
            agents={agents}
            selectedId={openAgentId}
            onSelect={setOpenAgentId}
            assignmentByAgentName={assignmentByAgentName}
            departmentFilter={departmentFilter}
          />
        </section>
      </div>

      {/* RIGHT */}
      <div className="dashboard-col side-column dashboard-right">
        <section className="card sonare-card connect-inspector-hero">
          {openAgent ? (
            <>
              <div className="connect-inspector-top">
                <span className="connect-icon-slot agent-card-avatar-slot">
                  {agentAvatarSrc(openAgent.avatarId) ? (
                    <img
                      className="connect-icon agent-card-avatar-img"
                      src={agentAvatarSrc(openAgent.avatarId)}
                      alt=""
                      draggable={false}
                    />
                  ) : (
                    <span className="agent-list-card-avatar-fallback">
                      {openAgent.initials || "?"}
                    </span>
                  )}
                </span>
                <span className="connect-rail-heading">Selected agent</span>
                <h2>{openAgent.name || "Unnamed"}</h2>
                <p>{openAgent.role || "Specialist"}</p>
                <span
                  className={`connect-inspector-status${
                    openAgent.enabled ? " active" : ""
                  }`}
                >
                  {statusOf(openAgent)}
                </span>
              </div>
              <p className="connect-inspector-desc">
                {openAgent.description ||
                  openAgent.instructions?.objective ||
                  "Specialist ready for workspace tasks."}
              </p>
              <div className="connect-inspector-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAssignAgentId(openAgent.id)}
                >
                  <Link2 size={13} /> Assign task
                </button>
                {!openAgent.isPrime && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPrimeAgent(openAgent.id)}
                  >
                    Set as prime
                  </button>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Unplug size={24} />}
              title="Select an agent"
              description="Choose a specialist from the center grid."
              compact
            />
          )}
        </section>

        <section className="card sonare-card agent-inspector-panel">
          {openAgent ? (
            <div className="agent-inspector-fill">
              <span className="connect-rail-heading">Linked now</span>
              {linkedTitles.length > 0 ? (
                <div className="agent-linked-list">
                  {linkedTitles.map((title) => (
                    <div key={title} className="agent-linked-static">
                      <strong>{title}</strong>
                      <small>Open task assigned to this agent</small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="agent-linked-empty">
                  <p className="connect-inspector-empty">
                    No open tasks linked to {openAgent.name}.
                  </p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setAssignAgentId(openAgent.id)}
                  >
                    <Link2 size={13} /> Link a task
                  </button>
                </div>
              )}

              <span className="connect-rail-heading">Resources</span>
              <div className="agent-permission-list agent-permission-list-roomy">
                {Object.entries(openAgent.permissions ?? {}).map(
                  ([key, level]) => (
                    <span key={key}>
                      {key}
                      <em>{String(level)}</em>
                    </span>
                  ),
                )}
              </div>

              <div className="agent-inspector-foot">
                <span>
                  <i />{" "}
                  {primeAgent?.id === openAgent.id
                    ? "Prime agent"
                    : "Specialist"}
                </span>
                <small>{linkedTitles.length} linked</small>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Bot size={24} />}
              title="Nothing selected yet"
              description="Linked tasks and resources will show here."
              compact
            />
          )}
        </section>
      </div>

      {assignAgent ? (
        <AssignTaskModal
          agent={assignAgent}
          tasks={tasks}
          onClose={() => setAssignAgentId(null)}
        />
      ) : null}
    </div>
  );
}

function AssignTaskModal({
  agent,
  tasks,
  onClose,
}: {
  agent: AgentConfig;
  tasks: Task[];
  onClose: () => void;
}) {
  const open = tasks.filter((t) => !t.completed);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label={`Assign task to ${agent.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title">Assign task to {agent.name}</h2>
          <button type="button" className="btn btn-small" onClick={onClose}>
            Close
          </button>
        </div>
        {open.length === 0 ? (
          <p className="card-text">No open tasks available to assign.</p>
        ) : (
          <ul className="agent-assign-list">
            {open.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="agent-assign-row"
                  onClick={() => {
                    updateTask(task.id, { agent: agent.name });
                    appendAgentActivity(agent.id, {
                      type: "task-assigned",
                      title: "Task assigned",
                      summary: `Assigned "${task.title}".`,
                      status: "info",
                      taskId: task.id,
                    });
                    addActivity(
                      `Assigned "${task.title}" to ${agent.name}`,
                      "agent",
                    );
                    onClose();
                  }}
                >
                  <span>{task.title}</span>
                  <span className="agent-assign-meta">
                    {task.agent ? `Currently: ${task.agent}` : "Unassigned"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
