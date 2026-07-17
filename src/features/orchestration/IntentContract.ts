/**
 * Canonical intent contract for ArcSonare orchestration.
 * Produced before any external capability runs.
 */

export type IntentMode =
  | "answer"
  | "read"
  | "search"
  | "summarize"
  | "open"
  | "navigate"
  | "focus"
  | "create"
  | "draft"
  | "update"
  | "send"
  | "delete"
  | "execute"
  | "confirm"
  | "cancel"
  | "explain"
  | "compare"
  | "unknown";

export type SideEffectClass =
  | "none"
  | "read-only"
  | "reversible"
  | "external-write"
  | "destructive"
  | "privileged";

export type IntentDomain =
  | "calendar"
  | "email"
  | "tasks"
  | "files"
  | "applications"
  | "windows"
  | "screen"
  | "clipboard"
  | "web"
  | "drive"
  | "arcsonare"
  | "general";

export type IntentPresentation =
  | "brief-answer"
  | "detailed-answer"
  | "list"
  | "summary"
  | "open-ui"
  | "artifact";

export type IntentContract = {
  mode: IntentMode;
  domain: IntentDomain;
  object?: string;
  requestedData?: string[];
  requestedAction?: string;
  /** Capability id from IntentCapabilityMap (when known). */
  capabilityId?: string;
  timeRange?: {
    start?: string;
    end?: string;
    relativeExpression?: string;
  };
  filters?: Record<string, unknown>;
  sourcePreference?: string;
  presentation: IntentPresentation;
  sideEffect: SideEffectClass;
  explicitOpen: boolean;
  explicitSend: boolean;
  explicitDelete: boolean;
  explicitConfirmation: boolean;
  confidence: number;
  ambiguity?: {
    reason: string;
    alternatives: IntentMode[];
  };
  /** Original utterance (trimmed). */
  utterance: string;
};

export type ConnectionStatus =
  | "unknown"
  | "checking"
  | "connected"
  | "connected-limited"
  | "expired"
  | "authentication-required"
  | "disconnected"
  | "error"
  | "unsupported";

export type ConnectedServiceKind =
  | "email"
  | "calendar"
  | "drive"
  | "contacts"
  | "chat"
  | "tasks";

export type ConnectedAccount = {
  id: string;
  provider: "google" | "microsoft" | "slack" | "notion" | "github" | "linear" | "other";
  accountLabel?: string;
  emailAddress?: string;
  services: ConnectedServiceKind[];
  scopes: string[];
  status: ConnectionStatus;
  lastValidatedAt?: string;
  validationExpiresAt?: string;
  lastSuccessfulRequestAt?: string;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

export type ConnectionAction = {
  service: string;
  provider?: string;
  action: "connect" | "reconnect" | "grant-permission" | "choose-account" | "retry";
  label: string;
  /** ArcSonare navigation target. */
  navigateTo?: "connect" | "settings";
};

export type OrchestrationResult = {
  handled: true;
  contract: IntentContract;
  capabilityId?: string;
  text: string;
  action?: ConnectionAction;
  /** When true, overlay should open an application after the message. */
  openAppId?: string;
  /** When set, navigate ArcSonare to this page. */
  navigatePage?: "dashboard" | "tasks" | "agent" | "connect" | "settings";
  auditId: string;
};

export type OrchestrationMiss = {
  handled: false;
};
