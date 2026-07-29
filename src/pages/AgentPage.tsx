import { useEffect, useMemo, useRef, useState } from "react";
import { BotIcon, ChevronDownIcon, ClockIcon } from "../components/Icons";
import { EmptyState } from "../components/EmptyState";
import { agentAvatarSrc } from "../features/agents/agentAvatars";
import { relativeTime } from "../features/agents/agentHealth";
import {
  appendAgentActivity,
  setPrimeAgent,
  setAgentPrefs,
  useAgentPrefs,
  useAgents,
  useApprovals,
  type AgentConfig,
  agentStatus,
} from "../features/agents/agentStore";
import { summarizeAgents } from "../features/agents/agentSelectors";
import { addActivity } from "../stores/appStore";
import { updateTask, useTasks, type Task } from "../stores/taskStore";

/** Premium agent-management workspace. */
export function AgentPage() {
  const agents = useAgents();
  const prefs = useAgentPrefs();
  const approvals = useApprovals();
  const tasks = useTasks();
  const [openAgentId, setOpenAgentId] = useState<string | null>(
    prefs.lastSelectedId,
  );
  const [teamActivityOpen, setTeamActivityOpen] = useState(false);
  const [assignAgentId, setAssignAgentId] = useState<string | null>(null);
  const [directoryHasMore, setDirectoryHasMore] = useState(false);
  const directoryScrollRef = useRef<HTMLDivElement>(null);

  const openAgent = agents.find((a) => a.id === openAgentId) ?? null;
  const assignAgent = agents.find((a) => a.id === assignAgentId) ?? null;
  const primeAgent = agents.find((agent) => agent.isPrime) ?? agents[0] ?? null;

  useEffect(() => {
    if (primeAgent && !agents.some((agent) => agent.isPrime)) {
      setPrimeAgent(primeAgent.id);
    }
  }, [agents, primeAgent]);

  const counts = useMemo(
    () => summarizeAgents(agents, tasks, approvals),
    [agents, tasks, approvals],
  );

  useEffect(() => {
    setAgentPrefs({ lastSelectedId: openAgentId });
  }, [openAgentId]);

  useEffect(() => {
    const scroller = directoryScrollRef.current;
    if (!scroller) return;

    const updateScrollCue = () => {
      const remaining =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      setDirectoryHasMore(remaining > 10);
    };
    const frame = window.requestAnimationFrame(updateScrollCue);
    const observer = new ResizeObserver(updateScrollCue);
    observer.observe(scroller);
    scroller.addEventListener("scroll", updateScrollCue, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", updateScrollCue);
    };
  }, [agents.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (assignAgentId) setAssignAgentId(null);
        else if (teamActivityOpen) setTeamActivityOpen(false);
        else if (openAgentId) setOpenAgentId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assignAgentId, teamActivityOpen, openAgentId]);

  const selectAgent = (agentId: string) => {
    setTeamActivityOpen(false);
    setOpenAgentId(agentId);
  };

  return (
    <div className="agent-page">
      <div className="agent-list-workspace">
        <aside className="agent-resource-panel agent-surface">
          <div className="agent-resource-head">
            <span className="agent-rail-label">Prime agent</span>
            <strong>{primeAgent?.name ?? "Not assigned"}</strong>
            <p>
              Receives new work, selects specialists, and supervises every
              handoff.
            </p>
          </div>
          <div className="agent-resource-stats">
            <div>
              <span>Specialists</span>
              <strong>{agents.length}</strong>
            </div>
            <div>
              <span>Ready</span>
              <strong>{counts.active + counts.idleConfigured}</strong>
            </div>
            <div>
              <span>Assigned</span>
              <strong>
                {tasks.filter((task) => Boolean(task.agent)).length}
              </strong>
            </div>
            <div>
              <span>Approvals</span>
              <strong>{counts.waiting}</strong>
            </div>
          </div>
          <div className="agent-resource-block">
            <span className="agent-rail-label">Team resources</span>
            {agents.slice(0, 3).map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`agent-resource-row${!teamActivityOpen && openAgentId === agent.id ? " active" : ""}`}
                onClick={() => selectAgent(agent.id)}
              >
                <span className="agent-resource-avatar">
                  {agentAvatarSrc(agent.avatarId) ? (
                    <img src={agentAvatarSrc(agent.avatarId)} alt="" />
                  ) : (
                    agent.initials
                  )}
                </span>
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.role}</small>
                </span>
                <i className={agent.enabled ? "online" : ""} />
              </button>
            ))}
          </div>
          <div className="agent-resource-summary">
            <span className="agent-rail-label">Delegation flow</span>
            <div className="agent-resource-meter"><span style={{ width: `${tasks.length ? (tasks.filter((task) => Boolean(task.agent)).length / tasks.length) * 100 : 0}%` }} /></div>
            <p><strong>{tasks.filter((task) => Boolean(task.agent)).length}</strong> assigned <span>{tasks.filter((task) => !task.agent).length} waiting</span></p>
          </div>
          <div className="agent-resource-foot">
            <span>
              <i /> Network ready
            </span>
            <small>{counts.completedToday} completed today</small>
          </div>
        </aside>

        <section className="agent-directory">
          <header className="agent-directory-head">
            <div>
              <span className="agent-rail-label">Agent workspace</span>
              <h1>Your agent team</h1>
              <p>
                Select a specialist to inspect resources, permissions, and
                current work.
              </p>
            </div>
            <button
              type="button"
              className={`btn agent-team-activity-trigger${teamActivityOpen ? " active" : ""}`}
              onClick={() => setTeamActivityOpen(true)}
            >
              <ClockIcon size={13} /> Team activity
            </button>
          </header>
          <div
            className="agent-card-list"
            ref={directoryScrollRef}
            onScroll={() => {
              const scroller = directoryScrollRef.current;
              if (!scroller) return;
              setDirectoryHasMore(
                scroller.scrollHeight -
                  scroller.scrollTop -
                  scroller.clientHeight >
                  10,
              );
            }}
          >
            {agents.map((agent) => {
              const assigned = tasks.filter(
                (task) => task.agent === agent.name && !task.completed,
              ).length;
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`agent-directory-card agent-surface${!teamActivityOpen && openAgentId === agent.id ? " selected" : ""}`}
                  onClick={() => selectAgent(agent.id)}
                >
                  <span className="agent-directory-avatar">
                    {agentAvatarSrc(agent.avatarId) ? (
                      <img src={agentAvatarSrc(agent.avatarId)} alt="" />
                    ) : (
                      agent.initials
                    )}
                  </span>
                  <span className="agent-directory-copy">
                    <span className="agent-directory-name">
                      {agent.name}
                      {agent.isPrime ? <em>Prime</em> : null}
                    </span>
                    <span className="agent-directory-role">{agent.role}</span>
                    <span className="agent-directory-description">
                      {agent.description}
                    </span>
                  </span>
                  <span className="agent-directory-meta">
                    <span
                      className={`agent-status-dot${agent.enabled ? " active" : ""}`}
                    >
                      {agentStatus(agent)}
                    </span>
                    <strong>{assigned}</strong>
                    <small>open tasks</small>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className={`agent-directory-scroll-cue${directoryHasMore ? " visible" : ""}`}
            aria-label="Scroll to more agents"
            onClick={() => {
              const scroller = directoryScrollRef.current;
              scroller?.scrollBy({
                top: Math.max(scroller.clientHeight * 0.72, 240),
                behavior: "smooth",
              });
            }}
          >
            <ChevronDownIcon size={17} />
          </button>
        </section>

        <aside className="agent-inspector agent-surface">
          {teamActivityOpen ? (
            <TeamActivityPanel agents={agents} onSelectAgent={selectAgent} />
          ) : openAgent ? (
            <>
              <div className="agent-inspector-hero">
                <span className="agent-inspector-avatar">
                  {agentAvatarSrc(openAgent.avatarId) ? (
                    <img src={agentAvatarSrc(openAgent.avatarId)} alt="" />
                  ) : (
                    openAgent.initials
                  )}
                </span>
                <span className="agent-rail-label">Selected agent</span>
                <h2>{openAgent.name}</h2>
                <p>{openAgent.role}</p>
                <span
                  className={`agent-inspector-status${openAgent.enabled ? " active" : ""}`}
                >
                  {agentStatus(openAgent)}
                </span>
              </div>
              <div className="agent-inspector-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setAssignAgentId(openAgent.id)}
                >
                  Assign task
                </button>
                {!openAgent.isPrime ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPrimeAgent(openAgent.id)}
                  >
                    Set as prime
                  </button>
                ) : null}
              </div>
              <div className="agent-inspector-section">
                <span className="agent-rail-label">Objective</span>
                <p>
                  {openAgent.instructions.objective || openAgent.description}
                </p>
              </div>
              <div className="agent-inspector-grid">
                <div>
                  <span>Model</span>
                  <strong>{openAgent.modelId || "Automatic"}</strong>
                </div>
                <div>
                  <span>Reasoning</span>
                  <strong>{openAgent.reasoningPreference}</strong>
                </div>
                <div>
                  <span>Memory</span>
                  <strong>{openAgent.memory.mode}</strong>
                </div>
                <div>
                  <span>Runtime</span>
                  <strong>{openAgent.runtimeType}</strong>
                </div>
              </div>
              <div className="agent-inspector-section">
                <span className="agent-rail-label">Resources</span>
                <div className="agent-permission-list">
                  {Object.entries(openAgent.permissions)
                    .slice(0, 6)
                    .map(([key, level]) => (
                      <span key={key}>
                        {key}
                        <em>{level}</em>
                      </span>
                    ))}
                </div>
              </div>
              <div className="agent-inspector-section">
                <span className="agent-rail-label">Recent activity</span>
                {openAgent.activity.slice(0, 5).map((entry, index) => (
                  <div
                    className="agent-activity-line"
                    key={`${entry.title}-${index}`}
                  >
                    <i />
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.summary}</small>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<BotIcon size={24} />}
              title="Select an agent"
              description="Choose a specialist to inspect its work, permissions, and resources."
            />
          )}
        </aside>
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

function TeamActivityPanel({
  agents,
  onSelectAgent,
}: {
  agents: AgentConfig[];
  onSelectAgent: (agentId: string) => void;
}) {
  const activity = agents
    .flatMap((agent) =>
      agent.activity.map((entry) => ({
        ...entry,
        agentId: agent.id,
        agentName: agent.name,
      })),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 12);

  return (
    <div className="agent-team-activity">
      <div className="agent-team-activity-head">
        <span className="agent-rail-label">Team overview</span>
        <h2>Team activity</h2>
        <p>See what every built-in specialist is doing and review recent work.</p>
      </div>

      <section className="agent-inspector-section">
        <span className="agent-rail-label">Current status</span>
        <div className="agent-team-status-list">
          {agents.slice(0, 4).map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelectAgent(agent.id)}
            >
              <span className="agent-team-status-avatar">
                {agentAvatarSrc(agent.avatarId) ? (
                  <img src={agentAvatarSrc(agent.avatarId)} alt="" />
                ) : (
                  agent.initials
                )}
              </span>
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </span>
              <em className={agent.enabled ? "active" : ""}>
                {agentStatus(agent)}
              </em>
            </button>
          ))}
        </div>
      </section>

      <section className="agent-inspector-section">
        <span className="agent-rail-label">History</span>
        {activity.length ? (
          <div className="agent-team-history">
            {activity.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectAgent(entry.agentId)}
              >
                <i />
                <span>
                  <strong>
                    {entry.agentName}
                    <em>{entry.title}</em>
                  </strong>
                  <small>{entry.summary}</small>
                  <time dateTime={entry.createdAt}>
                    {relativeTime(Date.parse(entry.createdAt))}
                  </time>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ClockIcon size={23} />}
            title="No activity yet"
            description="Agent work and assignments will appear here."
            compact
          />
        )}
      </section>
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
                      summary: `Assigned “${task.title}”.`,
                      status: "info",
                      taskId: task.id,
                    });
                    addActivity(
                      `Assigned “${task.title}” to ${agent.name}`,
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
