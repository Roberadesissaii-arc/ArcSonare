/**
 * Shared capability-engine types. Mirrors the Rust `ToolResult` contract —
 * a model-generated sentence is never treated as execution.
 */

export type CapabilityRiskLevel =
  | "read-only"
  | "reversible"
  | "sensitive"
  | "destructive"
  | "privileged";

export type CapabilityRunState =
  | "received"
  | "routing"
  | "planning"
  | "awaiting-confirmation"
  | "executing"
  | "verifying"
  | "completed"
  | "partially-completed"
  | "denied"
  | "cancelled"
  | "failed";

export type ToolResultStatus =
  | "success"
  | "partial"
  | "needs-confirmation"
  | "cancelled"
  | "denied"
  | "not-found"
  | "unsupported"
  | "timeout"
  | "error";

export interface ToolError {
  code: string;
  message: string;
  recoverable: boolean;
  userAction?: string;
  technicalDetails?: string;
}

export interface VerificationEvidence {
  verified: boolean;
  method:
    | "return-code"
    | "filesystem-postcondition"
    | "process-detected"
    | "window-detected"
    | "artifact-validated"
    | "state-readback"
    | "not-verifiable"
    | string;
  details?: Record<string, unknown>;
}

export interface ToolArtifact {
  id: string;
  kind: "image" | "file" | "folder" | "url" | "application" | "task";
  displayName: string;
  path?: string;
  localUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ToolResult<T = unknown> {
  callId: string;
  capabilityId: string;
  status: ToolResultStatus;
  summary: string;
  data?: T;
  evidence: VerificationEvidence;
  artifacts?: ToolArtifact[];
  warnings?: string[];
  error?: ToolError;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface CapabilityConfirmation {
  /** Native token when the backend issued one (destructive ops). */
  token?: string;
  /**
   * The Rust-owned pending action this question belongs to.
   *
   * Carried on the confirmation so the overlay can answer a question the main
   * window raised, and vice versa: both windows resolve one action id through
   * Rust rather than each looking in its own heap for a run it never saw.
   */
  actionId?: string;
  runId: string;
  capabilityId: string;
  title: string;
  description: string;
  riskLevel: CapabilityRiskLevel;
  affectedItems: Array<{ name: string; path?: string; itemType?: string }>;
  reversible: boolean;
  consequence: string;
  expiresAt?: string;
  /** Ambiguity resolutions carry the candidate list instead. */
  candidates?: Array<{ id?: string; label: string; detail?: string }>;
}

export type JSONSchema = Record<string, unknown>;

export interface CapabilityDefinition {
  id: string;
  version: number;
  displayName: string;
  description: string;
  category:
    | "system"
    | "applications"
    | "filesystem"
    | "windows"
    | "screen"
    | "clipboard"
    | "web"
    | "arcsonare"
    | "tasks"
    | "location"
    /**
     * Watched applications. A separate category because these capabilities are
     * only offered when the user is watching the application they act on —
     * `system.*` and `applications.*` are always available, and conflating them
     * would put Spotify transport controls in front of a model that has no
     * Spotify to control.
     */
    | "watched-app";
  aliases: string[];
  intentExamples: string[];
  negativeExamples?: string[];
  keywords: string[];
  riskLevel: CapabilityRiskLevel;
  confirmation: "never" | "when-ambiguous" | "before-execution" | "always";
  availability: "available" | "disabled" | "unsupported" | "unhealthy";
  inputSchema: JSONSchema;
  resultSchema: JSONSchema;
  supportsVoice: boolean;
  supportsChat: boolean;
  supportsDeterministicRouting: boolean;
  canChain: boolean;
  timeoutMs: number;
  requiredPermissions: string[];
  requiredSettings?: string[];
  requiredCapabilities?: string[];
  /** "native" → Rust capability_execute; "frontend" → local TS executor. */
  executor: "native" | "frontend";
  verifier?: string;
  /**
   * Catalog id of the application this capability acts on.
   *
   * Present only on watched-application capabilities. The retrieval gate uses
   * it to withhold the capability unless that application is actually being
   * watched and actually running — so the model is never offered a Spotify
   * transport control with Spotify closed, and never has to explain away a tool
   * it was just shown.
   */
  watchedApplicationId?: string;
}

export interface CapabilityStep {
  id: string;
  capabilityId: string;
  arguments: Record<string, unknown>;
  state: CapabilityRunState;
  result?: ToolResult;
}

export interface CapabilityRun {
  id: string;
  conversationId?: string;
  voiceSessionId?: string;
  userRequest: string;
  route: "deterministic" | "model-tool-call" | "multi-step-plan";
  selectedCapabilityIds: string[];
  state: CapabilityRunState;
  riskLevel: CapabilityRiskLevel;
  confirmationRequired: boolean;
  confirmationStatus?:
    | "not-required"
    | "pending"
    | "approved"
    | "rejected"
    | "expired";
  startedAt: string;
  completedAt?: string;
  steps: CapabilityStep[];
  finalResult?: ToolResult;
  /** Composed user-facing text (from real results only). */
  responseText?: string;
  pendingConfirmation?: CapabilityConfirmation;
}

export interface ParsedToolCall {
  id: string;
  capabilityId: string;
  arguments: Record<string, unknown>;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: Array<{
    id: string;
    capabilityId: string;
    arguments: Record<string, unknown>;
    dependsOn: string[];
    continueOnFailure: boolean;
    confirmationGroup?: string;
  }>;
}

export interface CapabilityHealth {
  capabilityId: string;
  status: "healthy" | "degraded" | "unavailable" | "disabled";
  checkedAt: string;
  message?: string;
}

export interface ApplicationAliasMemory {
  normalizedRequest: string;
  targetId: string;
  targetType: "native" | "web" | "protocol";
  confirmedByUser: boolean;
  successfulLaunches: number;
  failedLaunches: number;
  lastUsedAt: string;
}
