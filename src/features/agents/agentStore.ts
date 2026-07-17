/**
 * Agent configuration store, persisted to localStorage. Seeded once with the
 * three demo agents (clearly flagged `demo`). Status is derived honestly: an
 * agent without an assigned model is "Not configured" — never "Active".
 */
import { useSyncExternalStore } from "react";
import { deriveAgentStatus } from "./agentHealth";
import {
  DEFAULT_AGENT_PREFS,
  emptyMetrics,
  type AgentActivity,
  type AgentApproval,
  type AgentMetrics,
  type AgentPrefs,
  type AgentRuntimeType,
} from "./agentTypes";

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

/** Triggers that actually fire in this build. */
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
  runtimeType: AgentRuntimeType;
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
  updatedAt: number;
  lastActiveAt: number | null;
  /** Demo illustration only — labeled in the UI, not live execution. */
  demoCurrentTask?: string;
  demoProgress?: number;
  currentTaskId?: string;
  activity: AgentActivity[];
  metrics: AgentMetrics;
}

export type AgentStatus =
  | "Ready"
  | "Running"
  | "Waiting for approval"
  | "Paused"
  | "Offline"
  | "Error"
  | "Not configured";

/** Legacy display string for older UI; prefer deriveAgentStatus + statusLabel. */
export function agentStatus(agent: AgentConfig): AgentStatus {
  const s = deriveAgentStatus(agent);
  if (s === "not-configured") return "Not configured";
  if (s === "paused" || s === "inactive") return "Paused";
  if (s === "waiting-approval") return "Waiting for approval";
  if (s === "error") return "Error";
  if (s === "offline") return "Offline";
  if (s === "working") return "Running";
  return "Ready";
}

export function defaultPermissions(): Record<PermissionArea, PermissionLevel> {
  const perms = {} as Record<PermissionArea, PermissionLevel>;
  for (const area of PERMISSION_AREAS) {
    perms[area.id] = area.highRisk ? "ask" : "read-only";
  }
  return perms;
}

function newActivityId(): string {
  return `aact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function blankAgent(): AgentConfig {
  const now = Date.now();
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
    runtimeType: "manual",
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
    createdAt: now,
    updatedAt: now,
    lastActiveAt: null,
    activity: [],
    metrics: emptyMetrics(),
  };
}

const STORAGE_KEY = "arcsonare.agents.v2";
const LEGACY_KEY = "arcsonare.agents.v1";
const PREFS_KEY = "arcsonare.agents.prefs.v1";
const APPROVALS_KEY = "arcsonare.agentApprovals.v1";
const SCHEMA_VERSION = 2;

function normalizeAgent(raw: Partial<AgentConfig> & { id: string }): AgentConfig {
  const base = blankAgent();
  return {
    ...base,
    ...raw,
    id: raw.id,
    instructions: { ...base.instructions, ...(raw.instructions ?? {}) },
    voice: { ...base.voice, ...(raw.voice ?? {}) },
    memory: { ...base.memory, ...(raw.memory ?? {}) },
    permissions: { ...base.permissions, ...(raw.permissions ?? {}) },
    runtimeType: raw.runtimeType ?? (raw.localOnly ? "local" : "manual"),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? Date.now(),
    activity: Array.isArray(raw.activity) ? raw.activity : [],
    metrics: raw.metrics ?? emptyMetrics(),
  };
}

function seedAgents(): AgentConfig[] {
  const seed = (
    id: string,
    name: string,
    role: string,
    description: string,
    initials: string,
    accentColor: string,
    demoCurrentTask: string,
    demoProgress: number,
  ): AgentConfig =>
    normalizeAgent({
      ...blankAgent(),
      id,
      name,
      role,
      description,
      initials,
      accentColor,
      demo: true,
      enabled: false,
      demoCurrentTask,
      demoProgress,
      createdAt: Date.now() - 86_400_000,
      updatedAt: Date.now() - 3_600_000,
      activity: [
        {
          id: newActivityId(),
          agentId: id,
          type: "created",
          title: "Agent created",
          summary: `${name} template was added to the workspace.`,
          status: "info",
          createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        },
      ],
    });

  return [
    seed(
      "project-manager",
      "Project Manager",
      "Coordination",
      "Keeps tasks, owners and deadlines aligned.",
      "PM",
      "#9565FF",
      "Reorder today's tasks around the launch briefing",
      66,
    ),
    seed(
      "research-analyst",
      "Research Analyst",
      "Research",
      "Scans sources and summarizes what changed.",
      "RA",
      "#5995F2",
      "Market scan — 3 sources summarized",
      40,
    ),
    seed(
      "content-creator",
      "Content Creator",
      "Writing",
      "Drafts documents, decks and messages.",
      "CC",
      "#43BCD3",
      "Strategy deck outline waiting for review",
      85,
    ),
  ];
}

function load(): AgentConfig[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { agents?: unknown } | unknown[];
      if (Array.isArray(parsed)) {
        return parsed.map((a) =>
          normalizeAgent(a as Partial<AgentConfig> & { id: string }),
        );
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { agents?: unknown }).agents)
      ) {
        return ((parsed as { agents: unknown[] }).agents).map((a) =>
          normalizeAgent(a as Partial<AgentConfig> & { id: string }),
        );
      }
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = (JSON.parse(legacy) as unknown[]).map((a) =>
        normalizeAgent(a as Partial<AgentConfig> & { id: string }),
      );
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: SCHEMA_VERSION, agents: migrated }),
      );
      return migrated;
    }
  } catch (err) {
    console.error("[ArcSonare] failed to load agents:", err);
  }
  return seedAgents();
}

function loadPrefs(): AgentPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) {
      return { ...DEFAULT_AGENT_PREFS, ...(JSON.parse(raw) as Partial<AgentPrefs>) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_AGENT_PREFS };
}

function loadApprovals(): AgentApproval[] {
  try {
    const raw = window.localStorage.getItem(APPROVALS_KEY);
    if (raw) return JSON.parse(raw) as AgentApproval[];
  } catch {
    // ignore
  }
  return [];
}

let agents: AgentConfig[] = load();
let prefs: AgentPrefs = loadPrefs();
let approvals: AgentApproval[] = loadApprovals();
const listeners = new Set<() => void>();
const prefsListeners = new Set<() => void>();
const approvalListeners = new Set<() => void>();

function persistAgents() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, agents }),
    );
  } catch (err) {
    console.error("[ArcSonare] failed to persist agents:", err);
  }
}

function emitAgents() {
  persistAgents();
  listeners.forEach((l) => l());
}

function emitPrefs() {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
  prefsListeners.forEach((l) => l());
}

function emitApprovals() {
  try {
    window.localStorage.setItem(APPROVALS_KEY, JSON.stringify(approvals));
  } catch {
    // ignore
  }
  approvalListeners.forEach((l) => l());
}

export function addAgent(agent: AgentConfig) {
  const now = Date.now();
  const withMeta: AgentConfig = {
    ...normalizeAgent(agent),
    createdAt: agent.createdAt || now,
    updatedAt: now,
    activity:
      agent.activity && agent.activity.length > 0
        ? agent.activity
        : [
            {
              id: newActivityId(),
              agentId: agent.id,
              type: "created",
              title: "Agent created",
              summary: `${agent.name || "Agent"} was created.`,
              status: "info",
              createdAt: new Date(now).toISOString(),
            },
          ],
  };
  agents = [withMeta, ...agents];
  emitAgents();
}

export function updateAgent(id: string, patch: Partial<AgentConfig>) {
  agents = agents.map((a) =>
    a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a,
  );
  emitAgents();
}

export function removeAgent(id: string) {
  agents = agents.filter((a) => a.id !== id);
  approvals = approvals.filter((a) => a.agentId !== id);
  if (prefs.lastSelectedId === id) {
    prefs = { ...prefs, lastSelectedId: null };
    emitPrefs();
  }
  emitApprovals();
  emitAgents();
}

export function appendAgentActivity(
  agentId: string,
  entry: Omit<AgentActivity, "id" | "agentId" | "createdAt"> & {
    createdAt?: string;
  },
) {
  const activity: AgentActivity = {
    id: newActivityId(),
    agentId,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    type: entry.type,
    title: entry.title,
    summary: entry.summary,
    status: entry.status,
    taskId: entry.taskId,
  };
  agents = agents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          activity: [activity, ...a.activity].slice(0, 40),
          updatedAt: Date.now(),
          lastActiveAt: Date.now(),
        }
      : a,
  );
  emitAgents();
}

export function setAgentPrefs(patch: Partial<AgentPrefs>) {
  prefs = { ...prefs, ...patch };
  emitPrefs();
}

export function getApprovals(): AgentApproval[] {
  return approvals;
}

export function approveRequest(id: string): AgentApproval | null {
  const current = approvals.find((a) => a.id === id && a.status === "pending");
  if (!current) return null;
  const updated: AgentApproval = { ...current, status: "approved" };
  approvals = approvals.map((a) => (a.id === id ? updated : a));
  emitApprovals();
  appendAgentActivity(updated.agentId, {
    type: "approval-approved",
    title: "Approval granted",
    summary: updated.title,
    status: "success",
    taskId: updated.taskId,
  });
  return updated;
}

export function rejectRequest(id: string, reason?: string): AgentApproval | null {
  const current = approvals.find((a) => a.id === id && a.status === "pending");
  if (!current) return null;
  const updated: AgentApproval = {
    ...current,
    status: "rejected",
    rejectReason: reason,
  };
  approvals = approvals.map((a) => (a.id === id ? updated : a));
  emitApprovals();
  appendAgentActivity(updated.agentId, {
    type: "approval-rejected",
    title: "Approval rejected",
    summary: updated.title,
    status: "warning",
    taskId: updated.taskId,
  });
  return updated;
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

export function useAgentPrefs(): AgentPrefs {
  return useSyncExternalStore(
    (cb) => {
      prefsListeners.add(cb);
      return () => {
        prefsListeners.delete(cb);
      };
    },
    () => prefs,
  );
}

export function useApprovals(): AgentApproval[] {
  return useSyncExternalStore(
    (cb) => {
      approvalListeners.add(cb);
      return () => {
        approvalListeners.delete(cb);
      };
    },
    () => approvals,
  );
}

export { deriveAgentStatus, statusLabel } from "./agentHealth";
export type { AgentActivity, AgentApproval, AgentPrefs } from "./agentTypes";
