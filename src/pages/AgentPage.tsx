import { useEffect, useMemo, useState } from "react";
import {
  PlusIcon,
} from "../components/Icons";
import { AgentConstellation } from "../features/agents/AgentConstellation";
import { AgentCreationWizard } from "../features/agents/AgentCreationWizard";
import { AgentDetail } from "../features/agents/AgentDetail";
import { ApprovalQueueCard } from "../features/agents/ApprovalQueueCard";
import { RecentAgentActivityCard } from "../features/agents/RecentAgentActivityCard";
import {
  AGENT_TEMPLATES,
  agentFromTemplate,
} from "../features/agents/agentTemplates";
import { agentAvatarSrc } from "../features/agents/agentAvatars";
import { canActivate as canActivateHealth } from "../features/agents/agentHealth";
import {
  appendAgentActivity,
  blankAgent,
  removeAgent,
  setPrimeAgent,
  setAgentPrefs,
  updateAgent,
  useAgentPrefs,
  useAgents,
  useApprovals,
  type AgentConfig,
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
  const [wizardDraft, setWizardDraft] = useState<AgentConfig | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [openAgentId, setOpenAgentId] = useState<string | null>(
    prefs.lastSelectedId,
  );
  const [assignAgentId, setAssignAgentId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [approvalTick, setApprovalTick] = useState(0);

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
    [agents, tasks, approvals, approvalTick],
  );

  useEffect(() => {
    setAgentPrefs({ lastSelectedId: openAgentId });
  }, [openAgentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (!typing && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setWizardDraft(blankAgent());
      }
      if (e.key === "Escape") {
        if (confirmDeleteId) setConfirmDeleteId(null);
        else if (assignAgentId) setAssignAgentId(null);
        else if (templatesOpen) setTemplatesOpen(false);
        else if (wizardDraft) setWizardDraft(null);
        else if (openAgentId) setOpenAgentId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    confirmDeleteId,
    assignAgentId,
    templatesOpen,
    wizardDraft,
    openAgentId,
  ]);

  const toggleAgent = (agent: AgentConfig, next: boolean) => {
    if (next) {
      const check = canActivateHealth(agent);
      if (!check.ok) {
        window.alert(check.reason ?? "Cannot activate this agent.");
        return;
      }
    }
    updateAgent(agent.id, { enabled: next });
    appendAgentActivity(agent.id, {
      type: next ? "activated" : "paused",
      title: next ? "Agent activated" : "Agent paused",
      summary: next
        ? `${agent.name} is enabled and idle — no autonomous runtime is executing yet.`
        : `${agent.name} was paused.`,
      status: "info",
    });
    addActivity(`${next ? "Enabled" : "Paused"} agent ${agent.name}`, "agent");
  };
  void toggleAgent;

  return (
    <div className="agent-page">
      <div className="agent-command-center">
        <aside className="agent-command-side agent-command-left">
          <section className="agent-prime-overview agent-surface">
            <span className="agent-rail-label">Prime agent</span>
            <strong>{primeAgent?.name ?? "Not assigned"}</strong>
            <p>Receives new work, selects specialists, and supervises every handoff.</p>
            <div className="agent-card-actions">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setTemplatesOpen(true)}
              >
                Templates
              </button>
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => setWizardDraft(blankAgent())}
              >
                <PlusIcon size={12} /> Create
              </button>
            </div>
            {primeAgent ? (
              <button
                type="button"
                className="agent-rail-link agent-prime-open"
                onClick={() => setOpenAgentId(primeAgent.id)}
              >
                Open command profile
              </button>
            ) : null}
          </section>
          <section className="agent-side-feature agent-surface tone-blue">
            <span className="agent-rail-label">Delegation flow</span>
            <strong>{tasks.filter((task) => Boolean(task.agent)).length}<small> assigned tasks</small></strong>
            <p>{tasks.filter((task) => !task.agent).length} waiting for the Prime Agent to route.</p>
            <div className="agent-side-meter"><span style={{ width: `${tasks.length ? (tasks.filter((task) => Boolean(task.agent)).length / tasks.length) * 100 : 0}%` }} /></div>
          </section>
          <section className="agent-side-feature agent-surface tone-green">
            <span className="agent-rail-label">Team capacity</span>
            <strong>{counts.active + counts.idleConfigured}<small> ready agents</small></strong>
            <p>{counts.paused} paused · {counts.failed} need attention</p>
            <div className="agent-mini-avatars">
              {agents.slice(0, 5).map((agent) => (
                <button key={agent.id} type="button" onClick={() => setOpenAgentId(agent.id)} aria-label={agent.name}>
                  {agentAvatarSrc(agent.avatarId) ? <img src={agentAvatarSrc(agent.avatarId)} alt="" /> : agent.initials}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className="agent-command-orbit">
          <div className="agent-command-title">
            <span>Agent command constellation</span>
            <strong>Your team, coordinated in real time</strong>
            <p>Specialists orbit the Prime Agent. Select any profile to inspect its role, workload, and permissions.</p>
          </div>
          <AgentConstellation
            agents={agents}
            onOpen={setOpenAgentId}
            onCreate={() => setWizardDraft(blankAgent())}
            centerStage
          />
        </div>

        <aside className="agent-command-side agent-command-right">
          <ApprovalQueueCard
            approvals={approvals}
            agents={agents}
            onChanged={() => setApprovalTick((n) => n + 1)}
          />
          <RecentAgentActivityCard
            agents={agents}
            onViewAll={() => {
              if (agents[0]) setOpenAgentId(agents[0].id);
            }}
          />
          <section className="agent-side-feature agent-surface tone-violet">
            <span className="agent-rail-label">Agent network</span>
            <strong>{agents.length}<small> specialists</small></strong>
            <p>{counts.waiting} approvals waiting · {counts.completedToday} completed today</p>
            <div className="agent-network-status"><span /> Network ready</div>
          </section>
        </aside>
      </div>

      {templatesOpen ? (
        <div className="modal-backdrop" onClick={() => setTemplatesOpen(false)}>
          <div
            className="modal template-gallery"
            role="dialog"
            aria-label="Agent templates"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="modal-title">Agent templates</span>
                <p className="template-gallery-lede">
                  Prefills identity and instructions. Permissions stay safe by
                  default — nothing is granted automatically.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setTemplatesOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="template-grid">
              {AGENT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card"
                  onClick={() => {
                    setTemplatesOpen(false);
                    setWizardDraft(agentFromTemplate(template));
                  }}
                >
                  <span className="agent-avatar template-avatar" aria-hidden="true">
                    {agentAvatarSrc(template.avatarId) ? (
                      <img src={agentAvatarSrc(template.avatarId)} alt="" />
                    ) : (
                      template.initials
                    )}
                  </span>
                  <span className="template-meta">
                    <span className="template-name">{template.name}</span>
                    <span className="template-role">{template.role}</span>
                    <span className="template-purpose">{template.purpose}</span>
                    <span className="template-note">
                      {template.recommendedPermissionNote}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {wizardDraft ? (
        <AgentCreationWizard
          draft={wizardDraft}
          onClose={() => setWizardDraft(null)}
          onCreated={(agent) => {
            setWizardDraft(null);
            setOpenAgentId(agent.id);
          }}
        />
      ) : null}

      {openAgent ? (
        <AgentDetail agent={openAgent} onClose={() => setOpenAgentId(null)} />
      ) : null}

      {assignAgent ? (
        <AssignTaskModal
          agent={assignAgent}
          tasks={tasks}
          onClose={() => setAssignAgentId(null)}
        />
      ) : null}

      {confirmDeleteId ? (
        <div
          className="modal-backdrop"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="modal"
            role="alertdialog"
            aria-label="Delete agent"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Delete this agent?</h2>
            <p className="page-lede" style={{ marginTop: 8 }}>
              Configuration will be removed. Assigned tasks keep their titles
              but lose this owner name.
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
                  removeAgent(confirmDeleteId);
                  if (openAgentId === confirmDeleteId) setOpenAgentId(null);
                  setConfirmDeleteId(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
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
