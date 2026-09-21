/**
 * The Watch Context Broker.
 *
 * Assembles, for one request, only the watched applications that could
 * plausibly answer it — with their real instances, a fresh adapter snapshot,
 * the actions that genuinely exist, and any connected-service data that
 * cooperates with them.
 *
 * The subtractive part is the point. The previous prompt injected every
 * detected application's window title into every request, watched or not, which
 * meant a browser tab's title reached a cloud provider because the user once
 * opened the Dashboard. Here, an application contributes nothing unless it is
 * watched, live, and relevant — and what it contributes is filtered by its own
 * privacy policy before it is composed into text.
 */
import type { ToolResult } from "../capabilities/capabilityTypes";
import { adapterFor } from "./adapters/adapterRegistry";
import { currentScopeVersion, isScopeVersionStale } from "./watchScopeStore";
import type { AdapterSnapshot } from "./adapters/adapterTypes";
import {
  capabilitiesForWatchContext,
  instanceKeyFor,
} from "./watchCapabilityGate";
import {
  getWatchSnapshot,
  refreshWatchSnapshot,
  resolveWatchContext,
} from "./watchStore";
import type {
  InstanceResolution,
  ResolvedWatchContext,
  RunningAppInstance,
  WatchedApplication,
} from "./watchTypes";

export interface WatchedAppContext {
  application: WatchedApplication;
  /** Null when the application is watched but not running, or ambiguous. */
  instance: RunningAppInstance | null;
  resolution: InstanceResolution;
  snapshot: AdapterSnapshot | null;
  /** Capability ids the model may use for this application right now. */
  capabilityIds: string[];
  /** Data from a connected integration that pairs with this application. */
  connectorContext: Record<string, unknown> | null;
  freshness: { capturedAt: string; ageMs: number };
}

export interface WatchContextResult {
  contexts: WatchedAppContext[];
  /** True when the caller must ask which application before acting. */
  needsClarification: boolean;
  capturedAt: string;
}

/** How long a snapshot may be reused before it is read again. */
const SNAPSHOT_TTL_MS = 4_000;

/**
 * Cached adapter reads, keyed by instance *and* the scope generation they were
 * taken under.
 *
 * The generation is part of the key rather than something checked afterwards,
 * so a read that began before the user switched applications cannot be written
 * back over a key the new scope would look up. Clearing the map on a switch
 * handles what has already landed; the key handles what is still in the air.
 */
const snapshotCache = new Map<
  string,
  { snapshot: AdapterSnapshot; at: number }
>();

function cacheKey(instanceKey: string, version: number): string {
  return `${instanceKey}@v${version}`;
}

/**
 * Build context for one request.
 *
 * `requestText` is used for relevance ranking only. It is never sent anywhere;
 * the ranking runs in Rust against the watched list.
 */
export async function buildWatchContext(input: {
  requestText: string;
  conversationId?: string;
  appCatalogId?: string;
  /** Skip adapter reads. Used when only the capability list is needed. */
  metadataOnly?: boolean;
}): Promise<WatchContextResult> {
  let outcome;
  try {
    outcome = await resolveWatchContext({
      requestText: input.requestText,
      conversationId: input.conversationId,
      appCatalogId: input.appCatalogId,
    });
  } catch (err) {
    console.error("[ArcSonare] watch resolve failed:", err);
    return { contexts: [], needsClarification: false, capturedAt: new Date().toISOString() };
  }

  const contexts = await Promise.all(
    outcome.candidates.map((candidate) =>
      buildOne(candidate, Boolean(input.metadataOnly), outcome.capturedAt),
    ),
  );

  return {
    contexts,
    needsClarification: outcome.needsClarification,
    capturedAt: outcome.capturedAt,
  };
}

async function buildOne(
  candidate: ResolvedWatchContext,
  metadataOnly: boolean,
  capturedAt: string,
): Promise<WatchedAppContext> {
  const { application, resolution } = candidate;
  const instance =
    resolution.kind === "resolved" ? resolution.instance : null;

  const capabilityIds = capabilitiesForWatchContext([application]).map((c) => c.id);

  let snapshot: AdapterSnapshot | null = null;
  if (instance && !metadataOnly) {
    snapshot = await readSnapshot(application, instance);
  }

  return {
    application,
    instance,
    resolution,
    snapshot,
    capabilityIds,
    connectorContext: null,
    freshness: {
      capturedAt,
      ageMs: Math.max(0, Date.now() - Date.parse(capturedAt)),
    },
  };
}

/** Read one adapter, honouring the TTL so a follow-up turn does not re-walk. */
async function readSnapshot(
  application: WatchedApplication,
  instance: RunningAppInstance,
): Promise<AdapterSnapshot | null> {
  const adapter = adapterFor(instance);
  if (!adapter) return null;

  const version = currentScopeVersion();
  const key = cacheKey(instance.instanceKey, version);
  const cached = snapshotCache.get(key);
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) {
    return cached.snapshot;
  }
  try {
    const snapshot = await adapter.getSnapshot(instance, { application });
    // The read may have taken long enough for the user to change the active
    // set. Its result describes a scope that no longer exists, so it is
    // dropped rather than cached or returned.
    if (isScopeVersionStale(version)) return null;
    snapshotCache.set(key, { snapshot, at: Date.now() });
    return snapshot;
  } catch (err) {
    console.error(`[ArcSonare] ${adapter.id} snapshot failed:`, err);
    return null;
  }
}

/** Forget cached reads — called when a watch changes or an app closes. */
export function invalidateWatchSnapshots(instanceKey?: string): void {
  if (!instanceKey) {
    snapshotCache.clear();
    return;
  }
  // One instance, across every generation it was cached under.
  for (const key of [...snapshotCache.keys()]) {
    if (key.startsWith(`${instanceKey}@v`)) snapshotCache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Prompt text
// ---------------------------------------------------------------------------

/**
 * The watched-application block for a model prompt.
 *
 * Three properties this must have, each learned from a specific failure:
 *
 *  - **Only watched applications.** Not every process title.
 *  - **Only permitted content.** The adapter already filtered by policy; this
 *    must not reach around it into `instance.windowTitle`.
 *  - **Explicit limits.** When an adapter cannot read something, the prompt
 *    says so, because a model given a partial picture with no note about the
 *    gap fills the gap in.
 */
export function formatWatchContextForModel(result: WatchContextResult): string {
  if (result.contexts.length === 0) {
    return "No watched applications are relevant to this request.";
  }

  const lines: string[] = [
    "WATCHED APPLICATIONS (the user chose these; treat them as the subject of ambiguous requests):",
  ];

  for (const context of result.contexts) {
    const { application, instance, resolution, snapshot } = context;

    if (resolution.kind === "notRunning") {
      lines.push(
        `- ${application.displayName}: watched, but NOT RUNNING right now. ` +
          `Do not act on it. Offer to open it if the user wants that.`,
      );
      continue;
    }
    if (resolution.kind === "ambiguous") {
      const options = resolution.candidates
        .map((c) => c.workspaceIdentity ?? c.windowTitle ?? c.executableName)
        .filter(Boolean);
      lines.push(
        `- ${application.displayName}: ${resolution.candidates.length} instances are open ` +
          `(${options.join("; ")}). ASK which one before acting — do not choose.`,
      );
      continue;
    }

    const identity = instance?.workspaceIdentity
      ? ` — ${instance.workspaceIdentity}`
      : "";
    lines.push(`- ${application.displayName}${identity}: watching, running.`);
    if (instance) {
      lines.push(`    instance_key: ${instance.instanceKey}`);
    }
    if (snapshot) {
      lines.push(`    state: ${snapshot.summary}`);
      for (const limit of snapshot.limitations) {
        lines.push(`    cannot read: ${limit}`);
      }
    } else if (instance) {
      lines.push(
        `    state: only window metadata is available — no adapter can read inside this application.`,
      );
    }
    if (context.capabilityIds.length > 0) {
      lines.push(`    tools: ${context.capabilityIds.join(", ")}`);
    }
  }

  if (result.needsClarification) {
    lines.push(
      "More than one watched application could answer this. Ask which one rather than choosing.",
    );
  }
  lines.push(
    "Every tool above needs the instance_key printed with its application. " +
      "Never infer an application's contents from its window title. " +
      "If a tool reports it cannot read something, say that — do not fill it in.",
  );

  return lines.join("\n");
}

/**
 * A short answer to "what is going on?" across watched applications.
 *
 * Only reports what was actually observed. There is no background-event log
 * being replayed here — claiming "Spotify paused while you were away" would
 * require having watched it pause, and nothing does that.
 */
export async function summarizeWatchedApplications(): Promise<string> {
  await refreshWatchSnapshot();
  const { watched } = getWatchSnapshot();
  if (watched.length === 0) {
    return "You aren't watching any applications right now.";
  }

  const parts: string[] = [];
  for (const application of watched) {
    if (application.state === "app-closed" || application.instances.length === 0) {
      parts.push(`${application.displayName} — watched, not running.`);
      continue;
    }
    if (application.state === "paused") {
      parts.push(`${application.displayName} — watching paused.`);
      continue;
    }
    const key = instanceKeyFor(application);
    if (!key) {
      parts.push(
        `${application.displayName} — ${application.instances.length} windows open.`,
      );
      continue;
    }
    const instance = application.instances.find((i) => i.instanceKey === key)!;
    const adapter = adapterFor(instance);
    if (!adapter) {
      parts.push(`${application.displayName} — running (window metadata only).`);
      continue;
    }
    try {
      const snapshot = await adapter.getSnapshot(instance, { application });
      parts.push(`${application.displayName} — ${snapshot.summary}`);
    } catch {
      parts.push(`${application.displayName} — running, but its adapter did not answer.`);
    }
  }
  return parts.join("\n");
}

/** Whether a tool result came back honest-but-empty rather than broken. */
export function isHonestlyUnavailable(result: ToolResult | null): boolean {
  return (
    result?.status === "unsupported" ||
    (result?.status === "not-found" && !result.error?.recoverable)
  );
}
