import type { AgentConfig } from "./agentStore";
import type { Task } from "../../stores/taskStore";
import {
  canActivate,
  capabilityTags,
  deriveAgentHealth,
  deriveAgentStatus,
  relativeTime,
  statusLabel,
} from "./agentHealth";
import type {
  AgentApproval,
  AgentFilter,
  AgentGroupMode,
  AgentSortMode,
} from "./agentTypes";

export function tasksForAgent(tasks: Task[], agent: AgentConfig): Task[] {
  return tasks.filter(
    (t) => t.agent && t.agent.toLowerCase() === agent.name.toLowerCase(),
  );
}

export function currentTaskForAgent(
  tasks: Task[],
  agent: AgentConfig,
): { title: string; progress: number; demo: boolean } | null {
  const assigned = tasksForAgent(tasks, agent).filter((t) => !t.completed);
  if (assigned.length > 0) {
    const t = assigned[0];
    const progress =
      t.subtasks.length > 0
        ? Math.round(
            (t.subtasks.filter((s) => s.completed).length / t.subtasks.length) *
              100,
          )
        : typeof t.progress === "number"
          ? t.progress
          : 0;
    return { title: t.title, progress, demo: false };
  }
  if (agent.demoCurrentTask) {
    return {
      title: agent.demoCurrentTask,
      progress: agent.demoProgress ?? 0,
      demo: true,
    };
  }
  return null;
}

export function filterAgents(
  agents: AgentConfig[],
  filter: AgentFilter,
  query: string,
  tasks: Task[],
): AgentConfig[] {
  const q = query.trim().toLowerCase();
  return agents.filter((agent) => {
    const status = deriveAgentStatus(agent);
    if (filter === "active" && !(agent.enabled && status !== "not-configured")) {
      return false;
    }
    if (filter === "paused" && agent.enabled) return false;
    if (filter === "unconfigured" && status !== "not-configured") return false;
    if (filter === "with-tasks" && tasksForAgent(tasks, agent).length === 0) {
      return false;
    }
    if (!q) return true;
    const model = agent.modelId ?? "";
    const voice = agent.voice.voiceId;
    const tags = capabilityTags(agent).join(" ");
    const current = currentTaskForAgent(tasks, agent)?.title ?? "";
    return (
      agent.name.toLowerCase().includes(q) ||
      agent.role.toLowerCase().includes(q) ||
      agent.description.toLowerCase().includes(q) ||
      model.toLowerCase().includes(q) ||
      voice.toLowerCase().includes(q) ||
      tags.toLowerCase().includes(q) ||
      current.toLowerCase().includes(q)
    );
  });
}

export function sortAgents(
  agents: AgentConfig[],
  mode: AgentSortMode,
  tasks: Task[],
): AgentConfig[] {
  const copy = [...agents];
  switch (mode) {
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "status":
      return copy.sort((a, b) =>
        statusLabel(deriveAgentStatus(a)).localeCompare(
          statusLabel(deriveAgentStatus(b)),
        ),
      );
    case "workload":
      return copy.sort(
        (a, b) =>
          tasksForAgent(tasks, b).filter((t) => !t.completed).length -
          tasksForAgent(tasks, a).filter((t) => !t.completed).length,
      );
    case "completed":
      return copy.sort(
        (a, b) =>
          (b.metrics?.tasksCompleted ?? 0) - (a.metrics?.tasksCompleted ?? 0),
      );
    case "health":
      return copy.sort((a, b) =>
        deriveAgentHealth(a).localeCompare(deriveAgentHealth(b)),
      );
    case "created":
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case "last-active":
    default:
      return copy.sort(
        (a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0),
      );
  }
}

export function groupAgents(
  agents: AgentConfig[],
  mode: AgentGroupMode,
): [string, AgentConfig[]][] {
  if (mode === "none") return [["All agents", agents]];
  const map = new Map<string, AgentConfig[]>();
  for (const agent of agents) {
    let key = "Other";
    if (mode === "status") key = statusLabel(deriveAgentStatus(agent));
    else if (mode === "role") key = agent.role || "Unspecified";
    else if (mode === "model") key = agent.modelId ?? "No model";
    else if (mode === "runtime") key = agent.runtimeType;
    else if (mode === "health") key = deriveAgentHealth(agent);
    const list = map.get(key) ?? [];
    list.push(agent);
    map.set(key, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function summarizeAgents(
  agents: AgentConfig[],
  tasks: Task[],
  approvals: AgentApproval[],
) {
  const active = agents.filter(
    (a) => a.enabled && deriveAgentStatus(a) !== "not-configured",
  ).length;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const completedToday = tasks.filter(
    (t) =>
      t.completed &&
      t.agent &&
      (t.updatedAt ?? t.createdAt) >= start.getTime(),
  ).length;
  const pending = approvals.filter((a) => a.status === "pending");
  const high = pending.filter((a) => a.priority === "high").length;
  const failed = agents.reduce((n, a) => n + (a.metrics?.tasksFailed ?? 0), 0);

  return {
    active,
    idleConfigured: agents.filter(
      (a) => a.enabled && deriveAgentStatus(a) === "idle",
    ).length,
    paused: agents.filter((a) => !a.enabled && a.modelId).length,
    completedToday,
    waiting: pending.length,
    waitingHigh: high,
    failed,
    total: agents.length,
  };
}

export {
  canActivate,
  capabilityTags,
  deriveAgentHealth,
  deriveAgentStatus,
  relativeTime,
  statusLabel,
};
