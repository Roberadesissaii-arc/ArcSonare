/**
 * Route native actions through the Rust interaction planner.
 *
 * The model still picks a capability, but it no longer decides *how* that
 * capability happens. "Open the ArcSonare folder" becomes a typed ActionRequest;
 * Rust plans a strategy, executes exactly one attempt, verifies the
 * postcondition and decides whether a fallback is allowed. Strategy selection
 * deliberately never crosses back into TypeScript â€” a webview that could name
 * its own strategy would be one prompt injection away from choosing the cursor.
 *
 * Capabilities not listed here keep their existing direct path; this is a
 * routing change, not a second command engine.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ToolResult, ToolResultStatus } from "./capabilityTypes";
import { desktopItemName, mentionsDesktop } from "../../services/desktopIconGuard";

type ActionIntent =
  | "open-folder"
  | "open-file"
  | "launch-application"
  | "focus-application"
  | "close-application"
  | "create-folder"
  | "open-url"
  | "open-system-settings"
  | "media-control"
  | "highlight-target"
  | "click-target"
  | "select-list-item"
  | "unknown";

type ExecutionStrategy =
  | "native-os"
  | "internal-capability"
  | "application-adapter"
  | "ui-automation"
  | "browser-automation"
  | "keyboard-automation"
  | "visual-interaction"
  | "user-confirmation"
  | "unsupported";

type ActionStatus =
  | "succeeded"
  | "partially-completed"
  | "needs-confirmation"
  | "not-found"
  | "denied"
  | "unsafe"
  | "unsupported"
  | "not-ready"
  | "failed";

interface ActionTarget {
  kind:
    | "path"
    | "application"
    | "url"
    | "system-settings"
    | "window"
    | "media"
    | "visual-description"
    | "none";
  [key: string]: unknown;
}

interface ActionRequest {
  requestId: string;
  intent: ActionIntent;
  target: ActionTarget;
  parameters?: unknown;
  source: "chat" | "voice" | "overlay" | "internal";
  confirmationState?: "not-required" | "pending" | "confirmed" | "rejected";
}

export interface ActionResult {
  requestId: string;
  planId: string;
  intent: ActionIntent;
  strategyUsed?: ExecutionStrategy;
  status: ActionStatus;
  verification: { verified: boolean; method: string; details?: unknown };
  attempts: Array<{ strategy: ExecutionStrategy; status: string; summary: string }>;
  message?: string;
  reasonCode: string;
  toolResult?: ToolResult;
}

/** Capability ids whose execution now goes through the planner. */
const PLANNED_CAPABILITIES = new Set([
  "applications.open",
  "applications.focus",
  "filesystem.open_item",
  "web.open_url",
  "system.open_settings",
]);

export function isPlannedCapability(capabilityId: string): boolean {
  return PLANNED_CAPABILITIES.has(capabilityId);
}

/**
 * Capabilities that act on what is on screen, and so belong to a visual plan.
 *
 * `screen.understand` is deliberately absent: describing the screen changes
 * nothing, needs no cursor and has no outcome to verify, so wrapping it in a
 * plan would be ceremony.
 */
const VISUAL_CAPABILITIES = new Set([
  "screen.click_target",
  "screen.highlight_target",
]);

export function isVisualCapability(capabilityId: string): boolean {
  return VISUAL_CAPABILITIES.has(capabilityId);
}

const KNOWN_FOLDERS = new Set([
  "desktop",
  "documents",
  "downloads",
  "pictures",
  "videos",
  "music",
  "home",
]);

/**
 * Split a path-ish argument into "known folder + name" when it is one.
 *
 * The model writes "desktop/ArcSonare" or a full path interchangeably. Handing
 * the known-folder half to Rust lets it resolve a redirected Desktop (OneDrive)
 * that a literal `C:\Users\x\Desktop` would miss.
 */
function pathTarget(args: Record<string, unknown>): ActionTarget {
  const raw = typeof args.path === "string" ? args.path.trim() : "";
  if (raw) {
    const segments = raw.split(/[\\/]+/).filter(Boolean);
    const head = segments[0]?.toLowerCase() ?? "";
    // Only treat it as a known folder when it is clearly not an absolute path.
    if (!/^[a-z]:$/i.test(head) && !raw.startsWith("\\\\") && KNOWN_FOLDERS.has(head)) {
      return {
        kind: "path",
        knownFolder: head,
        name: segments.slice(1).join("\\") || null,
        path: null,
      };
    }
    return { kind: "path", path: raw, name: null, knownFolder: null };
  }
  const name = typeof args.name === "string" ? args.name : null;
  const folder = typeof args.folder === "string" ? args.folder.toLowerCase() : "";
  return {
    kind: "path",
    path: null,
    name,
    knownFolder: KNOWN_FOLDERS.has(folder) ? folder : null,
  };
}

/**
 * Describe what "show me X" is pointing at, as precisely as the words allow.
 *
 * A named item on the Desktop is a lookup with an exact answer — Windows knows
 * every icon's rectangle — so it is sent as a path, and the planner routes it to
 * the shell rather than to a camera. Sending it as a visual description is what
 * put a border around four unrelated icons: it told the planner the only way to
 * find the books folder was to recognise it in a photograph.
 *
 * Anything else really is a recognition problem and stays a description.
 */
export function highlightTarget(target: string): ActionTarget {
  const text = target.trim();
  if (mentionsDesktop(text)) {
    const name = desktopItemName(text);
    if (name) {
      return { kind: "path", path: null, name, knownFolder: "desktop" };
    }
  }
  return { kind: "visual-description", description: text, displayId: null };
}

function requestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build the typed request for a capability call, or null when this capability
 * is not planner-routed.
 */
export function toActionRequest(
  capabilityId: string,
  args: Record<string, unknown>,
  source: "chat" | "voice",
): ActionRequest | null {
  const base = { requestId: requestId(), source } as const;
  switch (capabilityId) {
    case "applications.open":
      return {
        ...base,
        intent: "launch-application",
        target: {
          kind: "application",
          appName: String(args.query ?? args.target_id ?? ""),
          appId: typeof args.target_id === "string" ? args.target_id : null,
        },
      };
    case "applications.focus":
      return {
        ...base,
        intent: "focus-application",
        target: {
          kind: "application",
          appName: String(args.query ?? ""),
          appId: null,
        },
      };
    case "filesystem.open_item": {
      // Both route natively; the distinction is only so the plan, the audit
      // trail and the status line say what actually happened.
      const raw = typeof args.path === "string" ? args.path : "";
      const looksLikeFile = /\.[a-z0-9]{1,8}$/i.test(raw.replace(/[\\/]+$/, ""));
      return {
        ...base,
        intent: looksLikeFile ? "open-file" : "open-folder",
        target: pathTarget(args),
      };
    }
    case "web.open_url":
      return {
        ...base,
        intent: "open-url",
        target: { kind: "url", url: String(args.url ?? "") },
      };
    case "system.open_settings":
      return {
        ...base,
        intent: "open-system-settings",
        target: { kind: "system-settings", page: String(args.page ?? "settings") },
      };
    // Visual intents. The target is a description, never a coordinate â€” the
    // planner has no idea where the thing is, and neither does this side.
    case "screen.highlight_target":
      return {
        ...base,
        intent: "highlight-target",
        target: highlightTarget(String(args.target ?? "")),
      };
    case "screen.click_target":
      return {
        ...base,
        // "Point at it" and "press it" are different acts, and the plan has to
        // know which: only one of them needs a verifier and the cursor.
        intent:
          args.click === false || args.click === "false"
            ? "highlight-target"
            : "click-target",
        target: {
          kind: "visual-description",
          description: String(args.target ?? ""),
          displayId: null,
        },
      };
    default:
      return null;
  }
}

const STATUS_MAP: Record<ActionStatus, ToolResultStatus> = {
  succeeded: "success",
  "partially-completed": "partial",
  "needs-confirmation": "needs-confirmation",
  "not-found": "not-found",
  denied: "denied",
  unsafe: "denied",
  unsupported: "unsupported",
  "not-ready": "unsupported",
  failed: "error",
};

/**
 * Present an ActionResult as the ToolResult the rest of the engine expects.
 *
 * When Rust ran a real capability its result is passed through untouched â€” the
 * response composer, audit trail and ambiguity confirmations all depend on that
 * exact shape. Only the plan metadata is attached alongside.
 */
export function toToolResult(capabilityId: string, action: ActionResult): ToolResult {
  const planData = {
    planId: action.planId,
    requestId: action.requestId,
    intent: action.intent,
    strategyUsed: action.strategyUsed ?? null,
    reasonCode: action.reasonCode,
    attempts: action.attempts,
  };

  if (action.toolResult) {
    const inner = action.toolResult;
    return {
      ...inner,
      data: {
        ...((inner.data as Record<string, unknown> | undefined) ?? {}),
        plan: planData,
      },
    };
  }

  const now = new Date().toISOString();
  const status = STATUS_MAP[action.status] ?? "error";
  return {
    callId: action.planId,
    capabilityId,
    status,
    summary: action.message ?? "ArcSonare could not complete that.",
    data: { plan: planData },
    evidence: {
      verified: action.verification.verified,
      method: action.verification.method,
      details: action.verification.details as Record<string, unknown> | undefined,
    },
    error:
      status === "success" || status === "partial"
        ? undefined
        : {
            code: action.reasonCode,
            message: action.message ?? action.reasonCode,
            recoverable: status !== "denied",
          },
    startedAt: now,
    completedAt: now,
    durationMs: 0,
  };
}

/**
 * What Rust decided should happen next.
 *
 * `requires-vision` is not a failure and not a finished action â€” it is work the
 * assistant loop owns, because finding something on screen needs a model call.
 * Keeping it as its own case is what stops "you finish this" from being read as
 * "we could not".
 */
export interface VisualExecutionRequest {
  correlationId: string;
  requestId: string;
  planId: string;
  intent: ActionIntent;
  targetDescription: string;
  requiresClick: boolean;
  requiresOverlay: boolean;
  expectedOutcome: { kind: string; [key: string]: unknown };
  riskLevel: "low" | "moderate" | "high" | "destructive";
}

export type PlanDisposition =
  | ({ disposition: "executed" } & ActionResult)
  | ({ disposition: "requires-vision" } & VisualExecutionRequest)
  | ({ disposition: "unsupported" } & ActionResult);

/** Ask Rust what to do, without it doing the visual part itself. */
export function planAndDispatchAction(
  capabilityId: string,
  args: Record<string, unknown>,
  source: "chat" | "voice",
): Promise<PlanDisposition | null> {
  const request = toActionRequest(capabilityId, args, source);
  if (!request) return Promise.resolve(null);
  return invoke<PlanDisposition>("plan_and_dispatch_action", { request });
}

/**
 * Fold a completed visual action back into the plan that asked for it.
 *
 * The identifiers travel intact: a visual result that arrives under a fresh
 * request id is a result nobody can join to the thing the user actually asked
 * for. And a click that was sent but not verified is reported as partial, never
 * as completed â€” the planner must not treat it as done.
 */
export function completeVisualAction(
  request: VisualExecutionRequest,
  visual: {
    status: string;
    sideEffectPossible: boolean;
    summary: string;
    displayId?: number;
    verification?: { verified: boolean; detail: string } | null;
  },
): ActionResult {
  const status: ActionStatus =
    visual.status === "verified-succeeded" || visual.status === "preview-succeeded"
      ? "succeeded"
      : visual.sideEffectPossible
        ? "partially-completed"
        : visual.status === "screen-changed-before-action"
          ? "not-found"
          : "failed";
  return {
    requestId: request.requestId,
    planId: request.planId,
    intent: request.intent,
    strategyUsed: "visual-interaction",
    status,
    verification: {
      verified: visual.verification?.verified ?? false,
      method: visual.verification ? "state-readback" : "not-verifiable",
    },
    attempts: [
      {
        strategy: "visual-interaction",
        status: visual.status,
        summary: visual.summary,
      },
    ],
    message: visual.summary,
    reasonCode: visual.status.toUpperCase().replace(/-/g, "_"),
  };
}

// `executeThroughPlanner` was here. It called `plan_and_execute_action`, which
// runs a plan and returns a finished result â€” fine for native actions, but it
// leaves no room for the third answer a visual plan needs ("this one is yours
// to carry out"). Everything now goes through `planAndDispatchAction` and the
// central switch in capabilityEngine.ts, so there is one path rather than one
// for the actions that could finish in Rust and another for the ones that
// could not.

export interface AvailableCapabilitiesSnapshot {
  nativeFilesystem: boolean;
  nativeApplicationLaunch: boolean;
  nativeUrlLaunch: boolean;
  nativeWindowControl: boolean;
  mediaControl: boolean;
  keyboardAutomation: boolean;
  applicationAdapter: boolean;
  uiAutomation: boolean;
  browserAutomation: boolean;
  visualInteraction: boolean;
  visualMigration: { complete: boolean; blockingStep: string | null };
}

export function getAvailableCapabilities(): Promise<AvailableCapabilitiesSnapshot> {
  return invoke<AvailableCapabilitiesSnapshot>("get_available_capabilities");
}

/** Human-readable progress line for a strategy, for the UI status area. */
export function strategyStatusLine(
  intent: ActionIntent,
  strategy: ExecutionStrategy | undefined,
): string {
  if (strategy === "visual-interaction") return "Locating it on screen...";
  if (strategy === "ui-automation") return "Using accessibility controls...";
  if (strategy === "keyboard-automation") return "Sending a shortcut...";
  switch (intent) {
    case "open-folder":
    case "open-file":
      return "Opening it directly...";
    case "launch-application":
      return "Launching it directly...";
    case "focus-application":
      return "Focusing the existing window...";
    case "open-url":
      return "Opening the link...";
    case "open-system-settings":
      return "Opening Windows settings...";
    default:
      return "Working...";
  }
}
