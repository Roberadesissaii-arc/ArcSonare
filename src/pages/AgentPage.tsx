import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
} from "../components/Icons";
import { Dropdown } from "../components/settings/Dropdown";
import { AgentAnalyticsRow } from "../features/agents/AgentAnalyticsRow";
import { AgentCard } from "../features/agents/AgentCard";
import { AgentConstellation } from "../features/agents/AgentConstellation";
import { AgentCreationWizard } from "../features/agents/AgentCreationWizard";
import { AgentDetail } from "../features/agents/AgentDetail";
import { AgentSummaryGrid } from "../features/agents/AgentSummaryGrid";
import { ApprovalQueueCard } from "../features/agents/ApprovalQueueCard";
import { RecentAgentActivityCard } from "../features/agents/RecentAgentActivityCard";
import {
  AGENT_TEMPLATES,
  agentFromTemplate,
} from "../features/agents/agentTemplates";
import { canActivate as canActivateHealth } from "../features/agents/agentHealth";
import { agentAvatarSrc } from "../features/agents/agentAvatars";
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
import {
  filterAgents,
  groupAgents,
  sortAgents,
  summarizeAgents,
} from "../features/agents/agentSelectors";
import type {
  AgentFilter,
  AgentGroupMode,
  AgentSortMode,
  AgentViewMode,
} from "../features/agents/agentTypes";
import { addActivity } from "../stores/appStore";
import { updateTask, useTasks, type Task } from "../stores/taskStore";

const FILTERS: { id: AgentFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "unconfigured", label: "Not configured" },
  { id: "with-tasks", label: "With tasks" },
];

const SORT_OPTIONS: { value: AgentSortMode; label: string }[] = [
  { value: "last-active", label: "Last active" },
  { value: "name", label: "Name" },
  { value: "status", label: "Status" },
  { value: "workload", label: "Current workload" },
  { value: "completed", label: "Tasks completed" },
  { value: "health", label: "Health" },
  { value: "created", label: "Recently created" },
];

const GROUP_OPTIONS: { value: AgentGroupMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "status", label: "Status" },
  { value: "role", label: "Role" },
  { value: "model", label: "Model" },
  { value: "runtime", label: "Runtime" },
  { value: "health", label: "Health" },
];

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Premium agent-management workspace. */
export function AgentPage() {
  const agents = useAgents();
  const prefs = useAgentPrefs();
  const approvals = useApprovals();
  const tasks = useTasks();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 160);
  const [summaryFocus, setSummaryFocus] = useState<
    "none" | "waiting" | "failed" | "active" | "completed"
  >("none");
  const [wizardDraft, setWizardDraft] = useState<AgentConfig | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [openAgentId, setOpenAgentId] = useState<string | null>(
    prefs.lastSelectedId,
  );
  const [assignAgentId, setAssignAgentId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [approvalTick, setApprovalTick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const openAgent = agents.find((a) => a.id === openAgentId) ?? null;
  const assignAgent = agents.find((a) => a.id === assignAgentId) ?? null;

  const counts = useMemo(
    () => summarizeAgents(agents, tasks, approvals),
    [agents, tasks, approvals, approvalTick],
  );

  const effectiveFilter: AgentFilter =
    summaryFocus === "active" ? "active" : prefs.filter;

  const visible = useMemo(() => {
    let list = filterAgents(agents, effectiveFilter, debouncedQuery, tasks);
    if (summaryFocus === "failed") {
      list = list.filter((a) => (a.metrics?.tasksFailed ?? 0) > 0);
    }
    return sortAgents(list, prefs.sort, tasks);
  }, [
    agents,
    effectiveFilter,
    debouncedQuery,
    tasks,
    prefs.sort,
    summaryFocus,
  ]);

  const groups = useMemo(
    () => groupAgents(visible, prefs.group),
    [visible, prefs.group],
  );

  const filterCount = (id: AgentFilter) =>
    filterAgents(agents, id, "", tasks).length;

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
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

  return (
    <div className="agent-page">
      <header className="agent-hero">
        <div>
          <p className="agent-kicker">Agent workspace</p>
          <h1 className="agent-heading">Agents</h1>
          <p className="agent-lede">
            Build and manage specialized AI agents working for you.
            Configurations are real; external actions require connected tools
            and approval.
          </p>
        </div>
        <div className="agent-header-actions">
          <button
            type="button"
            className="btn agent-btn-secondary"
            onClick={() => setTemplatesOpen(true)}
          >
            Templates
          </button>
          <button
            type="button"
            className="btn btn-primary agent-btn-primary"
            onClick={() => setWizardDraft(blankAgent())}
          >
            <PlusIcon size={14} />
            Create agent
          </button>
        </div>
      </header>

      <AgentConstellation
        agents={agents}
        onOpen={setOpenAgentId}
        onCreate={() => setWizardDraft(blankAgent())}
      />

      <AgentSummaryGrid
        counts={counts}
        focus={summaryFocus}
        onFocus={(f) => {
          setSummaryFocus(f);
          if (f === "active") setAgentPrefs({ filter: "active" });
          if (f === "none") setAgentPrefs({ filter: "all" });
        }}
      />

      <div className="agent-main-layout">
        <div className="agent-main-column">
          <div className="agent-toolbar agent-surface">
            <div className="agent-toolbar-top">
              <label className="agent-search">
                <SearchIcon size={14} />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search agents..."
                  aria-label="Search agents"
                />
              </label>
              <div className="agent-toolbar-controls">
                <Dropdown
                  options={GROUP_OPTIONS}
                  value={prefs.group}
                  onChange={(group) => setAgentPrefs({ group })}
                  ariaLabel="Group agents"
                />
                <Dropdown
                  options={SORT_OPTIONS}
                  value={prefs.sort}
                  onChange={(sort) => setAgentPrefs({ sort })}
                  ariaLabel="Sort agents"
                />
                <div className="agent-view-toggle" role="group" aria-label="View">
                  <button
                    type="button"
                    className={prefs.view === "grid" ? "is-active" : undefined}
                    aria-pressed={prefs.view === "grid"}
                    aria-label="Grid view"
                    onClick={() =>
                      setAgentPrefs({ view: "grid" satisfies AgentViewMode })
                    }
                  >
                    <LayoutIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className={prefs.view === "list" ? "is-active" : undefined}
                    aria-pressed={prefs.view === "list"}
                    aria-label="List view"
                    onClick={() => setAgentPrefs({ view: "list" })}
                  >
                    <ListIcon size={14} />
                  </button>
                </div>
              </div>
            </div>
            <div className="agent-filters" role="tablist" aria-label="Filter agents">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={
                    (summaryFocus === "active" && f.id === "active") ||
                    (summaryFocus === "none" && prefs.filter === f.id)
                  }
                  className={`agent-filter${
                    (summaryFocus === "active" && f.id === "active") ||
                    (summaryFocus === "none" && prefs.filter === f.id)
                      ? " active"
                      : ""
                  }`}
                  onClick={() => {
                    setSummaryFocus("none");
                    setAgentPrefs({ filter: f.id });
                  }}
                >
                  {f.label}
                  <span className="agent-filter-count">{filterCount(f.id)}</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="agent-empty agent-surface">
              <h2>
                {agents.length === 0
                  ? "No agents yet"
                  : "No agents match this search."}
              </h2>
              <p>
                {agents.length === 0
                  ? "Create a specialized agent or start from a template."
                  : "Try clearing search or filters."}
              </p>
              <div className="agent-empty-actions">
                {agents.length === 0 ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setTemplatesOpen(true)}
                    >
                      Browse templates
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setWizardDraft(blankAgent())}
                    >
                      <PlusIcon size={14} />
                      Create agent
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setQuery("");
                      setSummaryFocus("none");
                      setAgentPrefs({ filter: "all" });
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
            </div>
          ) : (
            groups.map(([label, items]) => (
              <section key={label} className="agent-group">
                {prefs.group !== "none" ? (
                  <h2 className="agent-group-title">
                    {label} <span>{items.length}</span>
                  </h2>
                ) : null}
                <div
                  className={prefs.view === "grid" ? "agent-grid" : "agent-list"}
                >
                  {items.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      tasks={tasks}
                      selected={agent.id === openAgentId}
                      view={prefs.view}
                      onOpen={() => setOpenAgentId(agent.id)}
                      onToggle={(next) => toggleAgent(agent, next)}
                      onDelete={() => setConfirmDeleteId(agent.id)}
                      onAssign={() => setAssignAgentId(agent.id)}
                      onSetPrime={() => {
                        setPrimeAgent(agent.id);
                        addActivity(`${agent.name} is now the Prime Agent`, "agent");
                      }}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          <AgentAnalyticsRow agents={agents} tasks={tasks} />
        </div>

        <aside className="agent-rail-column">
          <RecentAgentActivityCard
            agents={agents}
            onViewAll={() => {
              if (agents[0]) setOpenAgentId(agents[0].id);
            }}
          />
          <ApprovalQueueCard
            approvals={approvals}
            agents={agents}
            onChanged={() => setApprovalTick((n) => n + 1)}
          />
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
