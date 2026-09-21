/**
 * Watched-application types. Mirrors the Rust model in `src-tauri/src/watch`.
 *
 * Rust is the authority for all of this. These interfaces exist so the UI and
 * the context broker can read a snapshot without re-deriving it, never so the
 * frontend can hold its own competing copy — that was the previous design, and
 * it is why the voice overlay and the main window disagreed.
 */

export type WatchState =
  | "watching"
  | "paused"
  | "app-closed"
  | "permission-required"
  | "adapter-unavailable"
  | "adapter-error"
  | "disconnected"
  | "stale";

export type AdapterHealth =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unavailable"
  | "error";

export type InstanceState = "running" | "minimized" | "stopped";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RunningAppInstance {
  id: string;
  instanceKey: string;
  appCatalogId: string;
  processId: number;
  executablePath?: string;
  executableName: string;
  /** Opaque window id (`w<hex>`). Never a raw HWND. */
  windowId?: string;
  windowTitle?: string;
  windowBounds?: WindowBounds;
  monitorId?: string;
  workspaceIdentity?: string;
  parentProcessId?: number;
  state: InstanceState;
  startedAt?: string;
  lastSeenAt: string;
}

/**
 * What ArcSonare may read from one watched application.
 *
 * Every field is a separate decision because they carry different risks: a
 * window title is not the same disclosure as the body of a message, and
 * consenting to one must not imply the other.
 */
export interface PrivacyPolicy {
  appIdentity: boolean;
  windowTitle: boolean;
  visibleControls: boolean;
  visibleText: boolean;
  documentIdentity: boolean;
  notifications: boolean;
  messageContent: boolean;
  terminalOutput: boolean;
  sourceCode: boolean;
  screenshots: boolean;
  shareWithModelProvider: boolean;
  redactPaths: boolean;
}

export interface WatchedApplication {
  id: string;
  appCatalogId: string;
  displayName: string;
  state: WatchState;
  preferredInstanceKey?: string;
  privacyPolicy: PrivacyPolicy;
  enabledContextProviders: string[];
  enabledActionProviders: string[];
  adapterId?: string;
  adapterHealth: AdapterHealth;
  adapterMessage?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  instances: RunningAppInstance[];
}

export interface WatchSnapshot {
  watched: WatchedApplication[];
  /** Everything recognised and running — the complete list, never a slice. */
  running: RunningAppInstance[];
  capturedAt: string;
}

export type InstanceResolution =
  | { kind: "resolved"; instance: RunningAppInstance; reason: string }
  | { kind: "ambiguous"; candidates: RunningAppInstance[] }
  | { kind: "notRunning"; displayName: string };

export interface ResolvedWatchContext {
  application: WatchedApplication;
  resolution: InstanceResolution;
}

export interface ResolveOutcome {
  candidates: ResolvedWatchContext[];
  needsClarification: boolean;
  capturedAt: string;
}

export type WatchEventKind =
  | "watched-app-added"
  | "watched-app-removed"
  | "watched-app-updated"
  | "app-instance-started"
  | "app-instance-stopped"
  | "app-instance-rebound"
  | "app-context-updated"
  | "app-adapter-error"
  | "active-watched-app-changed";

export interface WatchEvent {
  kind: WatchEventKind;
  appCatalogId?: string;
  instanceKey?: string;
  conversationId?: string;
  message?: string;
  at: string;
}

/** Every event a window must react to, named so a listener cannot miss one. */
export const WATCH_EVENT_KINDS: readonly WatchEventKind[] = [
  "watched-app-added",
  "watched-app-removed",
  "watched-app-updated",
  "app-instance-started",
  "app-instance-stopped",
  "app-instance-rebound",
  "app-context-updated",
  "app-adapter-error",
  "active-watched-app-changed",
] as const;

/** Row state shown in the Running Apps list. */
export type WatchRowState =
  | "running"
  | "watching"
  | "paused"
  | "closed"
  | "needs-permission"
  | "limited-support"
  | "adapter-unavailable"
  | "error";

/**
 * How one row should present itself.
 *
 * Derived rather than stored: a row's appearance must follow from the watch
 * state and the adapter's real health, so it cannot claim "Watching" for an
 * application whose adapter has failed.
 */
export function rowState(
  watched: WatchedApplication | undefined,
  isRunning: boolean,
  hasAdapter: boolean,
): WatchRowState {
  if (!watched) return "running";
  switch (watched.state) {
    case "paused":
      return "paused";
    case "app-closed":
      return "closed";
    case "permission-required":
      return "needs-permission";
    case "adapter-unavailable":
      return "adapter-unavailable";
    case "adapter-error":
      return "error";
    default:
      break;
  }
  if (watched.adapterHealth === "error") return "error";
  if (watched.adapterHealth === "unavailable") return "adapter-unavailable";
  if (!isRunning) return "closed";
  if (!hasAdapter) return "limited-support";
  return "watching";
}

export const ROW_STATE_LABEL: Record<WatchRowState, string> = {
  running: "Running",
  watching: "Watching",
  paused: "Paused",
  closed: "Closed",
  "needs-permission": "Needs permission",
  "limited-support": "Limited support",
  "adapter-unavailable": "Adapter unavailable",
  error: "Error",
};
