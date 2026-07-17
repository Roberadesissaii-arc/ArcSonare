/**
 * Agent configuration store, persisted to localStorage. Seeded once with the
 * three demo agents (clearly flagged `demo`). Status is derived honestly: an
 * agent without an assigned model is "Not configured" — never "Active".
 */
import { useSyncExternalStore } from "react";

export type PermissionArea =
  | "tasks"
  | "calendar"
  | "email"
  | "files"
  | "screen-context"
  | "browser"
  | "integrations"
  | "notifications";

export type PermissionLevel = "deny" | "ask" | "read-only" | "allow";

export const PERMISSION_AREAS: {
  id: PermissionArea;
  label: string;
  highRisk: boolean;
}[] = [
  { id: "tasks", label: "Tasks", highRisk: false },
  { id: "calendar", label: "Calendar", highRisk: false },
  { id: "email", label: "Email", highRisk: true },
  { id: "files", label: "Files", highRisk: true },
  { id: "screen-context", label: "Screen Context", highRisk: true },
  { id: "browser", label: "Browser", highRisk: true },
  { id: "integrations", label: "Connected integrations", highRisk: true },
  { id: "notifications", label: "Notifications", highRisk: false },
];

export type MemoryMode = "none" | "session" | "local-long-term";

export type TriggerId =
  | "manual"
  | "schedule"
  | "task-assignment"
  | "notification"
  | "wake-phrase"
  | "screen-context"
  | "connected-app";

/** Triggers that actually fire in this build. Everything else is stored
 * configuration for the future agent runtime. */
export const SUPPORTED_TRIGGERS: TriggerId[] = ["manual"];

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  description: string;
  initials: string;
  accentColor: string;
  instructions: {
    system: string;
    objective: string;
    guidelines: string;
    tone: string;
    responseStyle: "concise" | "balanced" | "detailed";
    prohibited: string;
  };
  modelId: string | null;
  fallbackModelId: string | null;
  reasoningPreference: "fast" | "balanced" | "deep";
  costPreference: "economy" | "balanced" | "best";
  localOnly: boolean;
  voice: {
    enabled: boolean;
    voiceId: string;
    speed: number;
    allowInterruptions: boolean;
    volume: number;
  };
  permissions: Record<PermissionArea, PermissionLevel>;
  memory: {
    mode: MemoryMode;
    retention: "session" | "7d" | "30d" | "manual";
    allowedSources: string;
    excluded: string;
  };
  triggers: TriggerId[];
  enabled: boolean;
  demo: boolean;
  createdAt: number;
  lastActiveAt: number | null;
  /** Demo-only current task line (labeled in the UI). */
  demoCurrentTask?: string;
  demoProgress?: number;
}

export type AgentStatus =
  | "Ready"
  | "Running"
  | "Waiting for approval"
  | "Paused"
  | "Offline"
  | "Error"
  | "Not configured";

export function agentStatus(agent: AgentConfig): AgentStatus {
  if (!agent.modelId) return "Not configured";
  if (!agent.enabled) return "Paused";
  return "Ready";
}

export function defaultPermissions(): Record<PermissionArea, PermissionLevel> {
  const perms = {} as Record<PermissionArea, PermissionLevel>;
  for (const area of PERMISSION_AREAS) {
    // High-risk actions default to Ask every time; the rest to read-only.
    perms[area.id] = area.highRisk ? "ask" : "read-only";
  }
  return perms;
}

export function blankAgent(): AgentConfig {
  return {
    id: `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    role: "",
    description: "",
    initials: "",
    accentColor: "#916EFF",
    instructions: {
      system: "",
      objective: "",
      guidelines: "",
      tone: "Professional",
      responseStyle: "balanced",
      prohibited: "",
    },
    modelId: null,
    fallbackModelId: null,
    reasoningPreference: "balanced",
    costPreference: "balanced",
    localOnly: false,
    voice: {
      enabled: false,
      voiceId: "sonare",
      speed: 100,
      allowInterruptions: true,
      volume: 80,
    },
    permissions: defaultPermissions(),
    memory: {
      mode: "session",
      retention: "session",
      allowedSources: "",
      excluded: "",
    },
    triggers: ["manual"],
    enabled: false,
    demo: false,
    createdAt: Date.now(),
    lastActiveAt: null,
  };
}

const STORAGE_KEY = "arcsonare.agents.v1";

function seedAgents(): AgentConfig[] {
  const seed = (
    id: string,
    name: string,
    role: string,
    description: string,
    initials: string,
    demoCurrentTask: string,
    demoProgress: number,
  ): AgentConfig => ({
    ...blankAgent(),
    id,
    name,
    role,
    description,
    initials,
    demo: true,
    enabled: false,
    demoCurrentTask,
    demoProgress,
    createdAt: 0,
  });
  return [
    seed(
      "project-manager",
      "Project Manager",
      "Coordination",
      "Keeps tasks, owners and deadlines aligned.",
      "PM",
      "Reorder today's tasks around the launch briefing",
      66,
    ),
    seed(
      "research-analyst",
      "Research Analyst",
      "Research",
      "Scans sources and summarizes what changed.",
      "RA",
      "Market scan — 3 sources summarized",
      40,
    ),
    seed(
      "content-creator",
      "Content Creator",
      "Writing",
      "Drafts documents, decks and messages.",
      "CC",
      "Strategy deck outline waiting for review",
      85,
    ),
  ];
}

function load(): AgentConfig[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as AgentConfig[];
    }
  } catch (err) {
    console.error("[ArcSonare] failed to load agents:", err);
  }
  return seedAgents();
}

let agents: AgentConfig[] = load();
const listeners = new Set<() => void>();

function persistAndEmit() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  } catch (err) {
    console.error("[ArcSonare] failed to persist agents:", err);
  }
  listeners.forEach((l) => l());
}

export function addAgent(agent: AgentConfig) {
  agents = [agent, ...agents];
  persistAndEmit();
}

export function updateAgent(id: string, patch: Partial<AgentConfig>) {
  agents = agents.map((a) => (a.id === id ? { ...a, ...patch } : a));
  persistAndEmit();
}

export function removeAgent(id: string) {
  agents = agents.filter((a) => a.id !== id);
  persistAndEmit();
}

export function getAgents(): AgentConfig[] {
  return agents;
}

export function useAgents(): AgentConfig[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => agents,
  );
}
