import type { AgentConfig } from "./agentStore";
import type { AgentHealth, AgentStatus } from "./agentTypes";

/**
 * Derives display status from configuration + enable flag.
 * Never returns "working" / "running" without a real runtime.
 */
export function deriveAgentStatus(agent: AgentConfig): AgentStatus {
  if (!agent) return "not-configured";
  if (!agent.modelId) return "not-configured";
  if (!agent.enabled) return "paused";
  // Configured + enabled, but no autonomous runtime exists yet.
  return "idle";
}

/**
 * Health from dependencies. Local agent runtime is not shipped —
 * configured agents report Idle (ready for assignment), not Healthy-running.
 */
export function deriveAgentHealth(agent: AgentConfig): AgentHealth {
  if (!agent.modelId) return "not-configured";
  if (!agent.enabled) return "idle";
  return "idle";
}

export function statusLabel(status: AgentStatus): string {
  switch (status) {
    case "not-configured":
      return "Not configured";
    case "waiting-approval":
      return "Approval needed";
    case "inactive":
      return "Inactive";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function healthLabel(health: AgentHealth): string {
  switch (health) {
    case "not-configured":
      return "Not configured";
    default:
      return health.charAt(0).toUpperCase() + health.slice(1);
  }
}

/** Capability tags derived from role + non-deny permissions. Honest, not decorative. */
export function capabilityTags(agent: AgentConfig): string[] {
  const tags: string[] = [];
  const role = agent.role.toLowerCase();
  if (role.includes("coord") || role.includes("project") || role.includes("assist")) {
    tags.push("Planning", "Tracking");
  }
  if (role.includes("research") || role.includes("screen")) {
    tags.push("Research", "Summarize");
  }
  if (role.includes("writ") || role.includes("content") || role.includes("commun")) {
    tags.push("Writing", "Editing");
  }
  if (role.includes("meet")) tags.push("Agendas");
  if (role.includes("file")) tags.push("Files");
  if (role.includes("email") || role.includes("commun")) tags.push("Drafts");

  if (agent.permissions.tasks !== "deny" && !tags.includes("Tracking")) {
    tags.push("Tasks");
  }
  if (agent.permissions.calendar !== "deny") tags.push("Calendar");
  if (agent.permissions.browser !== "deny" && !tags.includes("Research")) {
    tags.push("Browser");
  }

  const unique = [...new Set(tags)];
  return unique.slice(0, 5);
}

export function canActivate(agent: AgentConfig): { ok: boolean; reason?: string } {
  if (!agent.modelId) {
    return { ok: false, reason: "Assign a model before activating this agent." };
  }
  return { ok: true };
}

export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "Never ran";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
