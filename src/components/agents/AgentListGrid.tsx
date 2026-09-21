import { Bot, ChevronRight } from "lucide-react";
import { agentAvatarSrc } from "../../features/agents/agentAvatars";
import { agentStatus, type AgentConfig } from "../../features/agents/agentStore";
import { EmptyState } from "../EmptyState";

function activityLine(agent: AgentConfig): string {
  try {
    const activity = Array.isArray(agent?.activity) ? agent.activity : [];
    const latest = activity[0];
    return (
      latest?.summary ||
      agent?.demoCurrentTask ||
      agent?.description ||
      "No recent activity"
    );
  } catch {
    return "No recent activity";
  }
}

export type AgentDepartmentId = "command" | "research" | "operations";

export interface AgentDepartment {
  id: AgentDepartmentId;
  title: string;
  glyph: string;
  agentIds: readonly string[];
}

/** 3 departments × 6 agents = 18 specialists. */
export const AGENT_DEPARTMENTS: readonly AgentDepartment[] = [
  {
    id: "command",
    title: "Command & collaboration",
    glyph: "◎",
    agentIds: [
      "project-manager",
      "executive-assistant",
      "email-assistant",
      "meeting-assistant",
      "content-creator",
      "schedule-coordinator",
    ],
  },
  {
    id: "research",
    title: "Research & intelligence",
    glyph: "◈",
    agentIds: [
      "research-analyst",
      "data-analyst",
      "screen-analyst",
      "knowledge-librarian",
      "security-auditor",
      "briefing-writer",
    ],
  },
  {
    id: "operations",
    title: "Operations & delivery",
    glyph: "▦",
    agentIds: [
      "file-organizer",
      "workflow-automator",
      "code-reviewer",
      "customer-support",
      "sales-assistant",
      "qa-tester",
    ],
  },
];

export function iconForAgent(_agent: AgentConfig) {
  return Bot;
}

interface AgentListGridProps {
  agents: AgentConfig[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  assignmentByAgentName?: Map<string, string[]>;
  departmentFilter?: AgentDepartmentId | "all";
}

/** Connect layout: sections of up to 6 cards, 3 per row. */
export function AgentListGrid({
  agents,
  selectedId,
  onSelect,
  assignmentByAgentName,
  departmentFilter = "all",
}: AgentListGridProps) {
  const list = Array.isArray(agents) ? agents.filter(Boolean) : [];

  if (list.length === 0) {
    return (
      <div className="connect-directory-empty">
        <EmptyState
          icon={<Bot size={26} />}
          title="No agents available"
          description="Default specialists will appear here once the workspace finishes loading."
        />
      </div>
    );
  }

  const byId = new Map(list.map((agent) => [agent.id, agent]));
  const known = new Set(
    AGENT_DEPARTMENTS.flatMap((section) => [...section.agentIds]),
  );
  const extras = list.filter((agent) => agent.id && !known.has(agent.id));

  const departments =
    departmentFilter === "all"
      ? AGENT_DEPARTMENTS
      : AGENT_DEPARTMENTS.filter((d) => d.id === departmentFilter);

  const sections = [
    ...departments
      .map((section) => ({
        id: section.id,
        title: section.title,
        glyph: section.glyph,
        agents: section.agentIds
          .map((id) => byId.get(id))
          .filter((agent): agent is AgentConfig => Boolean(agent)),
      }))
      .filter((section) => section.agents.length > 0),
    ...(departmentFilter === "all" && extras.length
      ? [
          {
            id: "other",
            title: "Additional specialists",
            glyph: "·",
            agents: extras,
          },
        ]
      : []),
  ];

  return (
    <div className="connect-sections">
      {sections.map((section) => (
        <section className="connect-section" key={section.id}>
          <header className="connect-section-header">
            <span className="connect-section-glyph" aria-hidden="true">
              {section.glyph}
            </span>
            <h2>{section.title}</h2>
            <span className="connect-section-count">
              {section.agents.length}
            </span>
          </header>
          <div className="connect-grid">
            {section.agents.map((agent) => {
              const src = agentAvatarSrc(agent.avatarId);
              const assigned =
                assignmentByAgentName?.get(agent.name) ??
                assignmentByAgentName?.get(agent.id) ??
                [];
              let statusLabel = "Ready";
              try {
                statusLabel = agentStatus(agent);
              } catch {
                statusLabel = "Ready";
              }
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`connect-card${
                    agent.id === selectedId ? " is-selected" : ""
                  }`}
                  onClick={() => onSelect(agent.id)}
                >
                  <span className="connect-icon-slot agent-card-avatar-slot">
                    {src ? (
                      <img
                        className="connect-icon agent-card-avatar-img"
                        src={src}
                        alt=""
                        draggable={false}
                      />
                    ) : (
                      <span className="agent-list-card-avatar-fallback">
                        {agent.initials ||
                          (agent.name ? agent.name.slice(0, 2) : "?")}
                      </span>
                    )}
                  </span>
                  <div className="connect-meta">
                    <div className="connect-card-name-row">
                      <span className="connect-name">
                        {agent.name || "Unnamed agent"}
                      </span>
                      {agent.isPrime ? (
                        <span className="agent-list-card-prime-tag">Prime</span>
                      ) : null}
                    </div>
                    <p className="connect-description">
                      {assigned.length
                        ? `On: ${assigned[0]}${
                            assigned.length > 1
                              ? ` +${assigned.length - 1}`
                              : ""
                          }`
                        : activityLine(agent)}
                    </p>
                  </div>
                  <span
                    className={`connect-card-add${
                      agent.id === selectedId ? " is-connected" : ""
                    }`}
                    aria-hidden="true"
                    title={statusLabel}
                  >
                    <ChevronRight size={17} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
