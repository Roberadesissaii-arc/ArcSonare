/**
 * Agent domain types for the Agent workspace.
 * Configuration ≠ runtime availability ≠ active execution.
 */
export type AgentStatus =
  | "not-configured"
  | "inactive"
  | "active"
  | "idle"
  | "paused"
  | "working"
  | "waiting-approval"
  | "warning"
  | "error"
  | "offline";

export type AgentHealth =
  | "healthy"
  | "idle"
  | "warning"
  | "error"
  | "offline"
  | "not-configured";

export type AgentRuntimeType = "local" | "cloud" | "hybrid" | "manual";

export type AgentRuntimeStatus =
  | "unavailable"
  | "stopped"
  | "starting"
  | "ready"
  | "running"
  | "error";

export type AgentFilter =
  | "all"
  | "active"
  | "paused"
  | "unconfigured"
  | "with-tasks";

export type AgentSortMode =
  | "last-active"
  | "name"
  | "status"
  | "workload"
  | "completed"
  | "health"
  | "created";

export type AgentGroupMode =
  | "none"
  | "status"
  | "role"
  | "model"
  | "runtime"
  | "health";

export type AgentViewMode = "grid" | "list";

export type AgentActivityType =
  | "created"
  | "configured"
  | "activated"
  | "paused"
  | "task-assigned"
  | "task-started"
  | "task-updated"
  | "tool-used"
  | "draft-created"
  | "approval-requested"
  | "approval-approved"
  | "approval-rejected"
  | "task-completed"
  | "action-failed"
  | "runtime-error";

export interface AgentActivity {
  id: string;
  agentId: string;
  taskId?: string;
  type: AgentActivityType;
  title: string;
  summary: string;
  status: "info" | "success" | "warning" | "error";
  createdAt: string;
}

export interface AgentDayMetric {
  date: string;
  utilizationPercent?: number;
  tasksCompleted: number;
  tasksFailed: number;
}

export interface AgentMetrics {
  tasksAssigned: number;
  tasksCompleted: number;
  tasksFailed: number;
  approvalsRequested: number;
  approvalsPending: number;
  averageCompletionTimeMs?: number;
  utilizationPercent?: number;
  successRatePercent?: number;
  lastSevenDays: AgentDayMetric[];
}

export type AgentApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "executed"
  | "failed";

export interface AgentApproval {
  id: string;
  agentId: string;
  taskId?: string;
  actionType: string;
  title: string;
  summary: string;
  priority: "high" | "medium" | "low";
  requestedAt: string;
  expiresAt?: string;
  status: AgentApprovalStatus;
  rejectReason?: string;
}

export interface AgentPrefs {
  filter: AgentFilter;
  sort: AgentSortMode;
  group: AgentGroupMode;
  view: AgentViewMode;
  lastSelectedId: string | null;
}

export const DEFAULT_AGENT_PREFS: AgentPrefs = {
  filter: "all",
  sort: "name",
  group: "none",
  view: "grid",
  lastSelectedId: null,
};

export function emptyMetrics(): AgentMetrics {
  return {
    tasksAssigned: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    approvalsRequested: 0,
    approvalsPending: 0,
    lastSevenDays: [],
  };
}
