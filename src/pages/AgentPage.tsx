import { useMemo, useState } from "react";
import { PlusIcon, SearchIcon } from "../components/Icons";
import { Toggle } from "../components/settings/Toggle";
import { modelById } from "../config/modelRegistry";
import { VOICE_PROFILES } from "../features/voice/VoiceSelector";
import {
  agentStatus,
  blankAgent,
  PERMISSION_AREAS,
  updateAgent,
  useAgents,
  type AgentConfig,
} from "../features/agents/agentStore";
import {
  AGENT_TEMPLATES,
  agentFromTemplate,
} from "../features/agents/agentTemplates";
import { AgentCreationWizard } from "../features/agents/AgentCreationWizard";
import { AgentDetail } from "../features/agents/AgentDetail";
import { addActivity, useAppState } from "../stores/appStore";
import { useTasks } from "../stores/taskStore";

const STATUS_TONE: Record<string, string> = {
  Ready: "green",
  Running: "violet",
  "Waiting for approval": "yellow",
  Paused: "muted",
  Offline: "muted",
  Error: "red",
  "Not configured": "muted",
};

type AgentFilter = "all" | "active" | "paused" | "unconfigured";

/** The agent-management workspace. */
export function AgentPage() {
  const agents = useAgents();
  const { activity } = useAppState();
  const tasks = useTasks();
  const [wizardDraft, setWizardDraft] = useState<AgentConfig | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("all");

  const openAgent = agents.find((a) => a.id === openAgentId) ?? null;

  const summary = useMemo(() => {
    const statuses = agents.map((a) => agentStatus(a));
    return {
      active: agents.filter(
        (a) => a.enabled && agentStatus(a) !== "Not configured",
      ).length,
      completedToday: 0,
      waiting: statuses.filter((s) => s === "Waiting for approval").length,
      failed: statuses.filter((s) => s === "Error").length,
      total: agents.length,
    };
  }, [agents]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((agent) => {
      const status = agentStatus(agent);
      if (filter === "active" && !(agent.enabled && status !== "Not configured")) {
        return false;
      }
      if (filter === "paused" && agent.enabled) return false;
      if (filter === "unconfigured" && status !== "Not configured") return false;
      if (!q) return true;
      return (
        agent.name.toLowerCase().includes(q) ||
        agent.role.toLowerCase().includes(q) ||
        agent.description.toLowerCase().includes(q)
      );
    });
  }, [agents, query, filter]);

  const toggleAgent = (agent: AgentConfig) => {
    const next = !agent.enabled;
    updateAgent(agent.id, { enabled: next });
    addActivity(`${next ? "Enabled" : "Paused"} agent ${agent.name}`, "agent");
  };

  return (
    <div className="agent-page">
      <div className="page-top">
        <div>
          <h1 className="page-heading">Agent</h1>
          <p className="page-lede agent-lede">
            Build and manage specialized AI agents working for you. No agent
            runtime executes yet — configurations are real, actions are not.
          </p>
        </div>
        <div className="agent-header-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setTemplatesOpen(true)}
          >
            Templates
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setWizardDraft(blankAgent())}
          >
            <PlusIcon size={14} />
            Create agent
          </button>
        </div>
      </div>

      <div className="agent-summary-strip">
        <div className="agent-summary-card">
          <span className="agent-summary-value">{summary.active}</span>
          <span className="agent-summary-label">Active agents</span>
        </div>
        <div className="agent-summary-card">
          <span className="agent-summary-value">{summary.completedToday}</span>
          <span className="agent-summary-label">Tasks completed today</span>
        </div>
        <div className="agent-summary-card">
          <span className="agent-summary-value">{summary.waiting}</span>
          <span className="agent-summary-label">Waiting for approval</span>
        </div>
        <div className="agent-summary-card">
          <span className="agent-summary-value">{summary.failed}</span>
          <span className="agent-summary-label">Failed actions</span>
        </div>
      </div>

      <div className="agent-toolbar">
        <label className="agent-search">
          <SearchIcon size={14} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents…"
            aria-label="Search agents"
          />
        </label>
        <div className="agent-filters" role="tablist" aria-label="Filter agents">
          {(
            [
              ["all", "All"],
              ["active", "Active"],
              ["paused", "Paused"],
              ["unconfigured", "Not configured"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`agent-filter${filter === id ? " active" : ""}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="agent-result-count">
          {filteredAgents.length} of {summary.total}
        </span>
      </div>

      <div className="agent-layout">
        <div className="agent-main">
          {filteredAgents.length === 0 ? (
            <div className="agent-empty">
              <p className="card-text">
                {agents.length === 0
                  ? "No agents yet. Start from a template or create one from scratch."
                  : "No agents match this filter."}
              </p>
              {agents.length === 0 ? (
                <div className="agent-empty-actions">
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
                </div>
              ) : null}
            </div>
          ) : (
            <div className="agent-grid">
              {filteredAgents.map((agent) => {
                const status = agentStatus(agent);
                const model = modelById(agent.modelId);
                const tools = PERMISSION_AREAS.filter(
                  (a) => agent.permissions[a.id] !== "deny",
                ).length;
                return (
                  <section key={agent.id} className="card sonare-card agent-card">
                    <div className="agent-card-head">
                      <span
                        className="agent-avatar"
                        style={{
                          boxShadow: `inset 0 0 0 1px ${agent.accentColor}55`,
                          background: `linear-gradient(160deg, ${agent.accentColor}22, #1a2122)`,
                        }}
                        aria-hidden="true"
                      >
                        {agent.initials}
                      </span>
                      <span className="agent-names">
                        <span className="agent-card-title">{agent.name}</span>
                        <span className="agent-card-role">{agent.role}</span>
                      </span>
                      <Toggle
                        checked={agent.enabled}
                        onChange={() => toggleAgent(agent)}
                        label={`${agent.name} enabled`}
                      />
                    </div>

                    <span
                      className={`agent-status-pill tone-${STATUS_TONE[status] ?? "muted"}`}
                    >
                      {status}
                      {agent.demo ? " · demo" : ""}
                    </span>

                    <p className="agent-card-desc">
                      {agent.description || agent.role}
                    </p>

                    <dl className="agent-card-facts">
                      <div>
                        <dt>Model</dt>
                        <dd>{model?.displayName ?? "Not assigned"}</dd>
                      </div>
                      <div>
                        <dt>Voice</dt>
                        <dd>
                          {agent.voice.enabled
                            ? (VOICE_PROFILES.find(
                                (v) => v.id === agent.voice.voiceId,
                              )?.name ?? "On")
                            : "Off"}
                        </dd>
                      </div>
                      <div>
                        <dt>Tools</dt>
                        <dd>{tools} areas</dd>
                      </div>
                    </dl>

                    {agent.demoCurrentTask ? (
                      <div className="agent-current">
                        <span className="agent-current-label">
                          Demo task · {agent.demoCurrentTask}
                        </span>
                        <span className="agent-progress">
                          <span
                            className="agent-progress-fill"
                            style={{
                              width: `${agent.demoProgress ?? 0}%`,
                              background: agent.accentColor,
                            }}
                          />
                        </span>
                      </div>
                    ) : null}

                    <div className="card-actions agent-card-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setOpenAgentId(agent.id)}
                      >
                        Open details
                      </button>
                      <span className="agent-last-active">
                        {agent.lastActiveAt
                          ? `Active ${new Date(agent.lastActiveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                          : "Never ran"}
                      </span>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <aside className="agent-rail">
          <section className="card sonare-card agent-rail-card">
            <span className="card-label">Recent activity</span>
            {activity.length === 0 ? (
              <p className="card-text">No activity yet.</p>
            ) : (
              <ul className="timeline-list">
                {activity.slice(0, 8).map((entry) => (
                  <li key={entry.id} className="timeline-row">
                    <span
                      className={`timeline-dot src-${entry.source}`}
                      aria-hidden="true"
                    />
                    <span className="timeline-text">{entry.text}</span>
                    <span className="timeline-time">
                      {new Date(entry.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card sonare-card agent-rail-card">
            <span className="card-label">Approval queue</span>
            <p className="card-text">
              Nothing waits for approval. Agent actions requiring confirmation
              will appear here once the runtime ships.
            </p>
          </section>

          <section className="card sonare-card agent-rail-card">
            <span className="card-label">Performance</span>
            <dl className="detail-grid">
              <dt>Open tasks</dt>
              <dd>{tasks.filter((t) => !t.completed).length}</dd>
              <dt>Agents configured</dt>
              <dd>{agents.filter((a) => a.modelId).length}</dd>
              <dt>Model runs</dt>
              <dd>0 (no backend)</dd>
            </dl>
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
                    {template.initials}
                  </span>
                  <span className="template-meta">
                    <span className="template-name">{template.name}</span>
                    <span className="template-role">{template.role}</span>
                    <span className="template-purpose">{template.purpose}</span>
                    <span className="template-note">
                      {template.recommendedPermissionNote}
                    </span>
                    <span className="template-tags">
                      <span className="template-tag">
                        {template.suggestedModelRole}
                      </span>
                      <span className="template-tag">
                        {template.suggestedTools.length} tools
                      </span>
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
    </div>
  );
}
