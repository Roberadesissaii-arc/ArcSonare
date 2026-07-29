/**
 * Capability engine orchestrator.
 *
 *   user request → deterministic router → capability retrieval → model tool
 *   selection (only when necessary) → validation → risk/confirmation policy →
 *   native execution → verification → structured ToolResult → audit → reply.
 *
 * Voice and chat share this single engine; a model sentence is never treated
 * as an executed action.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCapability } from "./capabilityRegistry";
import {
  retrieveCapabilities,
  routeDeterministic,
} from "./capabilityRouter";
import { validateArguments } from "./capabilitySchemas";
import {
  composeResponse,
  composeSpokenResponse,
} from "./capabilityResponseComposer";
import {
  deepSeekAdapter,
  ollamaAdapter,
  buildJsonFallbackPrompt,
  parseJsonFallback,
  compactToolResult,
  toToolName,
  type ChatTurn,
  type ProviderToolAdapter,
} from "./providerToolAdapter";
import {
  executeFrontendCapability,
  describeTaskDelete,
} from "./frontendExecutors";
import {
  finishRun,
  getRun,
  patchRun,
  startRun,
} from "./capabilityRunStore";
import {
  getAliasPreference,
  recordAliasFailure,
  recordAliasSuccess,
  recordCapabilitySuccess,
  forgetAlias,
} from "./capabilityMemory";
import {
  formatSessionActionContext,
  getRecentSessionActions,
  recordSessionAction,
} from "./actionSessionMemory";
import type {
  CapabilityConfirmation,
  CapabilityRun,
  ParsedToolCall,
  ToolResult,
} from "./capabilityTypes";
import { addActivity } from "../../stores/appStore";
import { getPrefs } from "../../stores/settingsStore";
import { getAssistantRoute } from "../../services/AssistantService";
import {
  ensureOllamaModel,
  ollamaCloudChat,
} from "../../services/OllamaService";

/** Strip internal tool ids so users never see system.get_local_datetime etc. */
function sanitizeUserFacingText(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*\b/gi, "the system")
    .replace(/\b(I will call|calling|call(?:ed)?)\s+the system\b/gi, "I'll check")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isTimeOrDateQuestion(text: string): boolean {
  const q = text.trim().toLowerCase();
  return (
    /\b(what(?:'s| is) the (?:current )?time|what time is it|current time)\b/.test(q) ||
    /\b(what(?:'s| is) (?:the )?(?:current )?date|what day is it|today(?:'s date)?)\b/.test(q) ||
    /\b(timezone)\b/.test(q)
  );
}

const MAX_TOOL_STEPS = 5;
const MAX_TOOL_STEPS_COMPLEX = 8;

export interface EngineOutcome {
  /** False → the request is conversation, not an action; caller uses chat. */
  handled: boolean;
  run?: CapabilityRun;
  responseText?: string;
  spokenText?: string;
  result?: ToolResult;
  /** Present when the run paused for user approval / disambiguation. */
  pendingConfirmation?: CapabilityConfirmation;
}

export interface EngineOptions {
  origin: "chat" | "voice";
  conversationId?: string;
  voiceSessionId?: string;
  /** Progress callback for UI status lines ("Opening Spotify..."). */
  onProgress?: (message: string, capabilityId?: string) => void;
}

// Pending continuations for confirmation round-trips, keyed by run id.
interface PendingExecution {
  capabilityId: string;
  args: Record<string, unknown>;
  token?: string;
  request: string;
  options: EngineOptions;
  /** Resume data for a paused model loop. */
  modelLoop?: {
    adapter: ProviderToolAdapter | null;
    model: string;
    turns: ChatTurn[];
    toolNames: string[];
    stepsUsed: number;
  };
  /** Ambiguity candidates (choose-one) instead of an approve/deny. */
  candidates?: Array<{ id?: string; label: string }>;
}

const pendingByRun = new Map<string, PendingExecution>();

function progress(options: EngineOptions, message: string, capabilityId?: string) {
  options.onProgress?.(message, capabilityId);
}

function statusLineFor(capabilityId: string, args: Record<string, unknown>): string {
  switch (capabilityId) {
    case "applications.open":
      return `Opening ${String(args.query ?? args.target_id ?? "application")}...`;
    case "applications.focus":
      return `Focusing ${String(args.query ?? "window")}...`;
    case "applications.close":
      return `Closing ${String(args.query ?? "application")}...`;
    case "filesystem.list_known_folder":
      return `Checking your ${String(args.folder ?? "folder")}...`;
    case "filesystem.create_directory":
      return "Creating folder...";
    case "filesystem.find":
      return `Searching for ${String(args.query ?? "")}...`;
    case "filesystem.delete":
      return "Preparing delete...";
    case "screen.capture":
      return "Taking screenshot...";
    case "tasks.create":
      return "Creating task...";
    case "arcsonare.navigate":
      return `Opening ${String(args.page ?? "page")}...`;
    case "web.search":
      return "Searching the web...";
    default:
      return "Working...";
  }
}

// ---------------------------------------------------------------------------
// Native / frontend execution
// ---------------------------------------------------------------------------

async function executeCapability(
  capabilityId: string,
  args: Record<string, unknown>,
  runId: string,
  request: string,
  token?: string,
): Promise<ToolResult> {
  const definition = getCapability(capabilityId);
  if (definition?.executor === "frontend") {
    return executeFrontendCapability(capabilityId, args);
  }
  return invoke<ToolResult>("capability_execute", {
    capabilityId,
    args,
    runId,
    userRequestSummary: request.slice(0, 200),
    confirmationToken: token ?? null,
  });
}

/** Resolve router placeholders (__known_parent / __find_target). */
async function resolveSpecialArgs(
  capabilityId: string,
  args: Record<string, unknown>,
  runId: string,
  request: string,
): Promise<
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; result: ToolResult }
> {
  const out = { ...args };

  if (typeof out.__known_parent === "string") {
    const folder = out.__known_parent;
    delete out.__known_parent;
    const resolved = await executeCapability(
      "filesystem.resolve_known_folder",
      { folder },
      runId,
      request,
    );
    const path = (resolved.data as { path?: string } | undefined)?.path;
    if (resolved.status !== "success" || !path) {
      return { ok: false, result: resolved };
    }
    out.parent_path = path;
  }

  if (typeof out.__find_target === "string") {
    const query = out.__find_target;
    delete out.__find_target;
    const found = await executeCapability(
      "filesystem.find",
      { query, limit: 5 },
      runId,
      request,
    );
    const results =
      ((found.data as { results?: Array<{ path?: string; name?: string }> } | undefined)
        ?.results ?? []);
    if (found.status === "not-found" || results.length === 0) {
      return { ok: false, result: found };
    }
    // Prefer exact name matches; require a single unambiguous target.
    const exact = results.filter(
      (r) => (r.name ?? "").toLowerCase() === query.toLowerCase(),
    );
    const pool = exact.length > 0 ? exact : results;
    if (pool.length > 1 && capabilityId === "filesystem.delete") {
      return {
        ok: false,
        result: {
          ...found,
          status: "needs-confirmation",
          summary: `I found ${pool.length} items named like "${query}". Which one?`,
          data: {
            confirmation: {
              reason: "ambiguous",
              candidates: pool.slice(0, 4).map((r) => ({ id: r.path, label: r.path })),
            },
          },
        },
      };
    }
    out.paths = [pool[0].path];
  }

  return { ok: true, args: out };
}

function extractConfirmation(
  runId: string,
  capabilityId: string,
  result: ToolResult,
): CapabilityConfirmation | null {
  const data = result.data as
    | {
        confirmation?: {
          token?: string;
          title?: string;
          description?: string;
          riskLevel?: string;
          affectedItems?: Array<{ name: string; path?: string; itemType?: string }>;
          reversible?: boolean;
          consequence?: string;
          expiresAt?: string;
          reason?: string;
          candidates?: Array<{ id?: string; label?: string; displayName?: string; title?: string; window_id?: string }>;
        };
        reason?: string;
        candidates?: Array<{ id?: string; label?: string; displayName?: string; title?: string; window_id?: string; targetType?: string }>;
      }
    | undefined;
  const conf = data?.confirmation;
  const rawCandidates = conf?.candidates ?? data?.candidates;
  const candidates = rawCandidates?.map((c) => ({
    id: c.id ?? (c as { window_id?: string }).window_id,
    label:
      (c as { displayName?: string }).displayName ??
      (c as { title?: string }).title ??
      c.label ??
      String(c.id ?? ""),
  }));
  return {
    token: conf?.token,
    runId,
    capabilityId,
    title: conf?.title ?? result.summary,
    description: conf?.description ?? "",
    riskLevel: (conf?.riskLevel as CapabilityConfirmation["riskLevel"]) ?? "sensitive",
    affectedItems: conf?.affectedItems ?? [],
    reversible: conf?.reversible ?? true,
    consequence: conf?.consequence ?? "",
    expiresAt: conf?.expiresAt,
    candidates,
  };
}

/** Frontend confirmation policy for sensitive ops without a native gate. */
function needsFrontendConfirmation(capabilityId: string): boolean {
  const def = getCapability(capabilityId);
  if (!def) return false;
  if (def.id === "tasks.delete") return true;
  return def.confirmation === "before-execution" || def.confirmation === "always"
    ? def.executor === "frontend" || def.riskLevel === "sensitive"
    : false;
}

function buildFrontendConfirmation(
  runId: string,
  capabilityId: string,
  args: Record<string, unknown>,
): CapabilityConfirmation {
  if (capabilityId === "tasks.delete") {
    const described = describeTaskDelete(args);
    return {
      runId,
      capabilityId,
      title: described ? `Delete task "${described.title}"?` : "Delete this task?",
      description: "The task will be removed from ArcSonare.",
      riskLevel: "destructive",
      affectedItems: described ? [{ name: described.title }] : [],
      reversible: false,
      consequence: "This only deletes the ArcSonare task, not any external content.",
    };
  }
  const label = String(args.query ?? args.window_id ?? "");
  return {
    runId,
    capabilityId,
    title:
      capabilityId === "applications.close" || capabilityId === "windows.close"
        ? `Close ${label}?`
        : `Run ${capabilityId}?`,
    description:
      capabilityId === "applications.close"
        ? "Unsaved work in that app may prompt before closing."
        : "",
    riskLevel: "sensitive",
    affectedItems: label ? [{ name: label }] : [],
    reversible: true,
    consequence: "",
  };
}

// ---------------------------------------------------------------------------
// Single-capability run (deterministic path)
// ---------------------------------------------------------------------------

async function runSingleCapability(
  run: CapabilityRun,
  capabilityId: string,
  rawArgs: Record<string, unknown>,
  request: string,
  options: EngineOptions,
  token?: string,
): Promise<EngineOutcome> {
  const definition = getCapability(capabilityId);
  patchRun(run.id, {
    state: "routing",
    selectedCapabilityIds: [capabilityId],
    riskLevel: definition?.riskLevel ?? "read-only",
  });

  // Application alias memory: reuse the user's confirmed preference.
  let args = { ...rawArgs };
  let aliasUsed: ReturnType<typeof getAliasPreference> = null;
  if (capabilityId === "applications.open" && typeof args.query === "string") {
    aliasUsed = getAliasPreference(args.query);
    if (aliasUsed) {
      args.target_id = aliasUsed.targetId;
      if (aliasUsed.targetType === "web") args.preference = "web-first";
    }
  }

  // Resolve router placeholders (known folders, delete targets).
  const resolved = await resolveSpecialArgs(capabilityId, args, run.id, request);
  if (!resolved.ok) {
    const text = composeResponse(resolved.result, request);
    if (resolved.result.status === "needs-confirmation") {
      const confirmation = extractConfirmation(run.id, capabilityId, resolved.result);
      if (confirmation) {
        pendingByRun.set(run.id, {
          capabilityId,
          args,
          request,
          options,
          candidates: confirmation.candidates,
        });
        patchRun(run.id, {
          state: "awaiting-confirmation",
          confirmationRequired: true,
          confirmationStatus: "pending",
          pendingConfirmation: confirmation,
        });
        return {
          handled: true,
          run: getRun(run.id),
          responseText: text,
          spokenText: text,
          result: resolved.result,
          pendingConfirmation: confirmation,
        };
      }
    }
    finishRun(run.id, resolved.result, text);
    return {
      handled: true,
      run: getRun(run.id),
      responseText: text,
      spokenText: composeSpokenResponse(resolved.result, request),
      result: resolved.result,
    };
  }
  args = resolved.args;

  // Local validation before anything native runs.
  if (definition) {
    const validation = validateArguments(definition.inputSchema, args);
    if (!validation.valid) {
      const errResult: ToolResult = {
        callId: "invalid",
        capabilityId,
        status: "error",
        summary: `Arguments were rejected: ${validation.errors.join("; ")}`,
        evidence: { verified: false, method: "not-verifiable" },
        error: {
          code: "invalid-arguments",
          message: validation.errors.join("; "),
          recoverable: true,
        },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
      const text = composeResponse(errResult, request);
      finishRun(run.id, errResult, text);
      return { handled: true, run: getRun(run.id), responseText: text, result: errResult };
    }
  }

  // Frontend confirmation policy (task deletion, app close).
  if (!token && needsFrontendConfirmation(capabilityId)) {
    const confirmation = buildFrontendConfirmation(run.id, capabilityId, args);
    pendingByRun.set(run.id, { capabilityId, args, request, options });
    patchRun(run.id, {
      state: "awaiting-confirmation",
      confirmationRequired: true,
      confirmationStatus: "pending",
      pendingConfirmation: confirmation,
    });
    return {
      handled: true,
      run: getRun(run.id),
      responseText: confirmation.title,
      spokenText: confirmation.title,
      pendingConfirmation: confirmation,
    };
  }

  patchRun(run.id, { state: "executing" }, statusLineFor(capabilityId, args), iconKeyFor(args));
  progress(options, statusLineFor(capabilityId, args), capabilityId);

  const result = await executeCapability(capabilityId, args, run.id, request, token);

  // Native confirmation round-trip (destructive delete, overwrite, ambiguity).
  if (result.status === "needs-confirmation") {
    const confirmation = extractConfirmation(run.id, capabilityId, result);
    if (confirmation) {
      pendingByRun.set(run.id, {
        capabilityId,
        args,
        token: confirmation.token,
        request,
        options,
        candidates: confirmation.candidates,
      });
      patchRun(run.id, {
        state: "awaiting-confirmation",
        confirmationRequired: true,
        confirmationStatus: "pending",
        pendingConfirmation: confirmation,
      });
      const text = result.summary;
      return {
        handled: true,
        run: getRun(run.id),
        responseText: text,
        spokenText: text,
        result,
        pendingConfirmation: confirmation,
      };
    }
  }

  patchRun(run.id, { state: "verifying" });

  // Application alias learning — only after a VERIFIED success.
  if (capabilityId === "applications.open" && typeof rawArgs.query === "string") {
    const data = result.data as { target_id?: string; method?: string } | undefined;
    if (result.status === "success" && data?.target_id) {
      recordAliasSuccess(
        rawArgs.query,
        data.target_id,
        data.method === "web-fallback" ? "web" : "native",
        Boolean(aliasUsed?.confirmedByUser),
      );
    } else if (result.status === "error") {
      recordAliasFailure(rawArgs.query);
    }
  }
  if (result.status === "success") {
    recordCapabilitySuccess(capabilityId);
  }
  recordSessionAction(request, capabilityId, result);

  const text = composeResponse(result, request);
  finishRun(run.id, result, text);
  logActivity(capabilityId, result, options);
  return {
    handled: true,
    run: getRun(run.id),
    responseText: text,
    spokenText: composeSpokenResponse(result, request),
    result,
  };
}

function iconKeyFor(args: Record<string, unknown>): string | undefined {
  const q = args.query ?? args.target_id;
  return typeof q === "string" ? q : undefined;
}

function logActivity(_capabilityId: string, result: ToolResult, options: EngineOptions) {
  // Operational summary only — no reasoning, no file contents.
  void _capabilityId;
  if (result.status === "success" || result.status === "partial") {
    try {
      addActivity(result.summary.slice(0, 140), options.origin === "voice" ? "voice" : "command");
    } catch {
      // Activity log is best-effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Preference commands ("always open X in the browser", "forget ...")
// ---------------------------------------------------------------------------

async function handlePreferenceCommand(
  text: string,
  options: EngineOptions,
): Promise<EngineOutcome | null> {
  const q = text.toLowerCase().replace(/[?.!]+$/g, "").trim();

  const forget = q.match(/^forget (?:my )?(.+?)(?: preference)?$/);
  if (forget && /preference|alias|choice/.test(q + " preference")) {
    const target = forget[1].replace(/\s*(preference|alias|choice)\s*$/, "").trim();
    const removed = forgetAlias(target);
    const message = removed
      ? `Forgot your preference for "${target}".`
      : `You don't have a saved preference for "${target}".`;
    const run = startRun(text, "deterministic", { voiceSessionId: options.voiceSessionId });
    const result: ToolResult = {
      callId: "pref",
      capabilityId: "arcsonare.preferences",
      status: removed ? "success" : "not-found",
      summary: message,
      evidence: { verified: true, method: "state-readback" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    finishRun(run.id, result, message);
    return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result };
  }

  const always = q.match(
    /^always (?:open|use) (?:the )?(.+?) (?:in (?:the )?(browser|web)|(?:as |in )?(?:the )?(desktop app|app|native))$/,
  );
  if (always) {
    const query = always[1].trim();
    const wantWeb = Boolean(always[2]);
    const run = startRun(text, "deterministic", { voiceSessionId: options.voiceSessionId });
    const resolved = await executeCapability(
      "applications.resolve",
      { query, preference: wantWeb ? "web-first" : "native-first" },
      run.id,
      text,
    );
    const data = resolved.data as
      | { resolved?: { id?: string; displayName?: string } | null; candidates?: Array<{ id: string; displayName: string }> }
      | undefined;
    const target = data?.resolved ?? data?.candidates?.[0];
    if (!target?.id) {
      const message = `I couldn't find "${query}" to save a preference for.`;
      finishRun(run.id, resolved, message);
      return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result: resolved };
    }
    recordAliasSuccess(query, target.id, wantWeb ? "web" : "native", true);
    const message = `Got it — I'll ${wantWeb ? "use the web version of" : "use the desktop app for"} ${
      (target as { displayName?: string }).displayName ?? query
    } from now on.`;
    const result: ToolResult = {
      ...resolved,
      summary: message,
    };
    finishRun(run.id, result, message);
    return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Compound deterministic requests ("create a folder ... and take a screenshot")
// ---------------------------------------------------------------------------

function splitCompound(text: string): string[] {
  const parts = text
    .split(/(?:,\s*then\s+|\s+and then\s+|,\s+and\s+|\s+then\s+)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > MAX_TOOL_STEPS) return [text];
  return parts;
}

// ---------------------------------------------------------------------------
// Model tool loop (Stage 2)
// ---------------------------------------------------------------------------

const TOOL_SYSTEM_PROMPT = [
  "You are ArcSonare, a native Windows assistant with real local capabilities.",
  "When a user request matches an available tool, YOU must call the tool — never pretend you did something, and never ask the user to do it manually.",
  "Never claim inability before checking the available tools. Never claim completion before a successful tool result.",
  "Never guess current system state (time, files, apps, windows); read it through tools.",
  "Never invent files, folders, applications, windows, screenshots, or tasks. Never generate shell commands.",
  "To create a folder: first call filesystem.resolve_known_folder (desktop/documents/downloads/…) if needed, then filesystem.create_directory with parent_path + name.",
  "Use the smallest relevant set of tools. Ask a concise clarifying question only when a required argument is genuinely ambiguous.",
  "After tool results arrive, report exactly what happened — including the full path when a folder or file was created.",
  "If the user asks what you did or where something is, use the recent-actions context and/or tools — do not guess.",
  "Keep replies to one or two sentences.",
].join(" ");

function toolSystemPromptWithMemory(): string {
  const memory = formatSessionActionContext();
  return memory ? `${TOOL_SYSTEM_PROMPT}\n\n${memory}` : TOOL_SYSTEM_PROMPT;
}

interface ModelRoute {
  adapter: ProviderToolAdapter | null;
  model: string;
  cloudBlocked?: boolean;
  unavailable?: string;
}

async function resolveModelRoute(): Promise<ModelRoute> {
  const route = getAssistantRoute();
  const allowCloud = getPrefs().dataPrivacy.allowCloud;

  const localRoute = async (): Promise<ModelRoute> => {
    const ready = await ensureOllamaModel();
    if (!ready.ok) return { adapter: null, model: "", unavailable: ready.message };
    return { adapter: ollamaAdapter, model: ready.model };
  };

  if (route.provider === "deepseek") {
    if (!allowCloud) return localRoute();
    return { adapter: deepSeekAdapter, model: route.modelName ?? "deepseek-v4-flash" };
  }
  if (route.provider === "google") {
    // Gemini is wired for chat replies; tool-calling uses the chat path instead.
    if (!allowCloud) return localRoute();
    return { adapter: null, model: "" };
  }
  if (route.provider === "ollama-local" || route.provider === "none") {
    return localRoute();
  }
  if (route.provider === "ollama-cloud") {
    if (!allowCloud) return localRoute();
    // No native tool endpoint wired — strict JSON fallback.
    return { adapter: null, model: getPrefs().models.ollamaCloudModel || "" };
  }
  return { adapter: null, model: "", unavailable: `${route.displayName} does not support tool calling yet.` };
}

async function runModelToolLoop(
  run: CapabilityRun,
  request: string,
  options: EngineOptions,
): Promise<EngineOutcome> {
  const complex = /\b(and|then)\b/i.test(request);
  const limit = complex ? 8 : 6;
  const retrieved = retrieveCapabilities(request, limit);
  if (retrieved.length === 0) {
    // Nothing action-like — conversation.
    patchRun(run.id, { state: "cancelled" });
    return { handled: false };
  }
  const tools = retrieved.map((r) => r.capability);
  patchRun(run.id, {
    state: "planning",
    selectedCapabilityIds: tools.map((t) => t.id),
  });

  const routeInfo = await resolveModelRoute();
  if (routeInfo.cloudBlocked) {
    const message =
      "Cloud processing is disabled in Settings → Data & Privacy, and this request needs the model to pick a tool. Enable cloud or switch to Ollama (local).";
    const result: ToolResult = {
      callId: "blocked",
      capabilityId: "capability-engine",
      status: "denied",
      summary: message,
      evidence: { verified: false, method: "not-verifiable" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    finishRun(run.id, result, message);
    return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result };
  }
  if (!routeInfo.adapter && !routeInfo.model) {
    // Google Gemini: no tool adapter yet — fall through to plain askAssistant chat.
    if (getAssistantRoute().provider === "google") {
      patchRun(run.id, { state: "cancelled" });
      return { handled: false };
    }
    const message = routeInfo.unavailable ?? "No model is available for tool selection.";
    const result: ToolResult = {
      callId: "unavailable",
      capabilityId: "capability-engine",
      status: "error",
      summary: message,
      evidence: { verified: false, method: "not-verifiable" },
      error: { code: "provider-unavailable", message, recoverable: true },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    finishRun(run.id, result, message);
    return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result };
  }

  const turns: ChatTurn[] = [
    { role: "system", content: toolSystemPromptWithMemory() },
    { role: "user", content: request },
  ];
  return continueModelLoop(run, request, options, {
    adapter: routeInfo.adapter,
    model: routeInfo.model,
    turns,
    toolNames: tools.map((t) => t.id),
    stepsUsed: 0,
  });
}

async function continueModelLoop(
  run: CapabilityRun,
  request: string,
  options: EngineOptions,
  loop: NonNullable<PendingExecution["modelLoop"]>,
): Promise<EngineOutcome> {
  const tools = loop.toolNames
    .map((id) => getCapability(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const maxSteps = /\b(and|then)\b/i.test(request) ? MAX_TOOL_STEPS_COMPLEX : MAX_TOOL_STEPS;
  let lastResult: ToolResult | undefined;
  let invalidRetries = 0;

  while (loop.stepsUsed < maxSteps) {
    progress(options, "Thinking...");
    let reply;
    try {
      if (loop.adapter) {
        reply = await loop.adapter.chat(loop.turns, tools, loop.model);
      } else {
        // JSON fallback (Ollama Cloud): one strict object, validated locally.
        const systemPrompt = `${toolSystemPromptWithMemory()}\n${buildJsonFallbackPrompt(tools)}`;
        const conversation = loop.turns
          .filter((t) => t.role !== "system")
          .map((t) => ({ role: t.role === "tool" ? "user" : t.role, content: t.role === "tool" ? `Tool result: ${t.content}` : t.content }));
        const raw = await ollamaCloudChat(
          [{ role: "system", content: systemPrompt }, ...conversation],
          loop.model,
        );
        reply = parseJsonFallback(raw);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "The model request failed.";
      const result: ToolResult = {
        callId: "model-error",
        capabilityId: "capability-engine",
        status: "error",
        summary: message,
        evidence: { verified: false, method: "not-verifiable" },
        error: { code: "model-request-failed", message, recoverable: true },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
      finishRun(run.id, result, message);
      return { handled: true, run: getRun(run.id), responseText: message, result };
    }

    if (reply.toolCalls.length === 0) {
      // Nudge once when the request looks actionable but the model only talked.
      const actionable =
        !lastResult &&
        invalidRetries < 1 &&
        /\b(create|make|add|delete|remove|trash|open|launch|find|locate|list|show|take|capture|write|save)\b/i.test(
          request,
        ) &&
        tools.some(
          (t) =>
            t.category === "filesystem" ||
            t.category === "applications" ||
            t.riskLevel !== "read-only",
        );
      if (actionable) {
        loop.turns.push({
          role: "assistant",
          content: reply.text?.trim() || "",
        });
        loop.turns.push({
          role: "user",
          content:
            "You must call one of the available tools to complete this. Do not only describe the steps.",
        });
        invalidRetries += 1;
        continue;
      }

      // Final text from the model. Prefer verified tool results over narration
      // (models often mention tool ids or apologize about a failed first call).
      if (lastResult?.status === "success") {
        const text = composeResponse(lastResult, request);
        finishRun(run.id, lastResult, text);
        return {
          handled: true,
          run: getRun(run.id),
          responseText: text,
          spokenText: composeSpokenResponse(lastResult, request),
          result: lastResult,
        };
      }

      const text = sanitizeUserFacingText(
        reply.text?.trim() || (lastResult ? composeResponse(lastResult, request) : ""),
      );
      if (!text && !lastResult) {
        // Pure miss — let the caller fall through to conversational chat.
        patchRun(run.id, { state: "cancelled" });
        return { handled: false };
      }

      // Time/date must never surface a failed tool narrative — read the clock.
      if (
        lastResult?.status === "error" &&
        isTimeOrDateQuestion(request)
      ) {
        return runSingleCapability(
          run,
          "system.get_local_datetime",
          { format: "spoken", include_timezone: /\btimezone\b/i.test(request) },
          request,
          options,
        );
      }

      if (lastResult) {
        finishRun(run.id, lastResult, text || composeResponse(lastResult, request));
      } else {
        patchRun(run.id, { state: "completed", responseText: text });
      }
      return {
        handled: true,
        run: getRun(run.id),
        responseText: text || lastResult?.summary || "",
        spokenText: lastResult
          ? composeSpokenResponse(lastResult, request)
          : text,
        result: lastResult,
      };
    }

    // Execute tool calls (sequential; parallel calls run in order).
    const assistantTurn: ChatTurn = {
      role: "assistant",
      content: reply.text ?? "",
      toolCalls: reply.toolCalls.map((c) => ({
        id: c.id,
        name: toToolName(c.capabilityId),
        arguments: JSON.stringify(c.arguments),
      })),
    };
    loop.turns.push(assistantTurn);

    for (const call of reply.toolCalls) {
      const outcome = await executeModelToolCall(run, call, request, options, loop);
      if (outcome.pause) {
        return outcome.engineOutcome;
      }
      lastResult = outcome.result;
      if (outcome.invalid) {
        invalidRetries += 1;
        if (invalidRetries > 1) {
          const message =
            "The model kept selecting invalid tool arguments, so nothing was executed.";
          const result = outcome.result;
          finishRun(run.id, result, message);
          return { handled: true, run: getRun(run.id), responseText: message, result };
        }
      }
    }
    loop.stepsUsed += 1;
  }

  const message = lastResult
    ? `${composeResponse(lastResult, request)} (Stopped after ${maxSteps} tool steps — say "continue" to keep going.)`
    : "I stopped before executing anything — the request needed too many steps.";
  if (lastResult) finishRun(run.id, lastResult, message);
  return { handled: true, run: getRun(run.id), responseText: message, result: lastResult };
}

async function executeModelToolCall(
  run: CapabilityRun,
  call: ParsedToolCall,
  request: string,
  options: EngineOptions,
  loop: NonNullable<PendingExecution["modelLoop"]>,
): Promise<{
  result: ToolResult;
  invalid?: boolean;
  pause?: boolean;
  engineOutcome: EngineOutcome;
}> {
  const definition = getCapability(call.capabilityId);
  const feedback = (result: ToolResult): void => {
    loop.turns.push({
      role: "tool",
      toolCallId: call.id,
      content: JSON.stringify(compactToolResult(result)),
    });
  };

  // Unknown or invalid → validation error back to the model (retry once).
  if (!definition || !loop.toolNames.includes(call.capabilityId)) {
    const result: ToolResult = {
      callId: call.id,
      capabilityId: call.capabilityId,
      status: "error",
      summary: `"${call.capabilityId}" is not one of the provided tools.`,
      evidence: { verified: false, method: "not-verifiable" },
      error: { code: "unknown-tool", message: "Tool not in the provided set.", recoverable: true },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    feedback(result);
    return { result, invalid: true, engineOutcome: { handled: true } };
  }
  const validation = validateArguments(definition.inputSchema, call.arguments);
  if (!validation.valid) {
    const result: ToolResult = {
      callId: call.id,
      capabilityId: call.capabilityId,
      status: "error",
      summary: `Invalid arguments: ${validation.errors.join("; ")}`,
      evidence: { verified: false, method: "not-verifiable" },
      error: {
        code: "invalid-arguments",
        message: validation.errors.join("; "),
        recoverable: true,
      },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    feedback(result);
    return { result, invalid: true, engineOutcome: { handled: true } };
  }

  patchRun(
    run.id,
    { state: "executing", selectedCapabilityIds: [call.capabilityId] },
    statusLineFor(call.capabilityId, call.arguments),
  );
  progress(options, statusLineFor(call.capabilityId, call.arguments), call.capabilityId);

  const result = await executeCapability(call.capabilityId, call.arguments, run.id, request);

  if (result.status === "needs-confirmation") {
    const confirmation = extractConfirmation(run.id, call.capabilityId, result);
    if (confirmation) {
      pendingByRun.set(run.id, {
        capabilityId: call.capabilityId,
        args: call.arguments,
        token: confirmation.token,
        request,
        options,
        modelLoop: loop,
        candidates: confirmation.candidates,
      });
      patchRun(run.id, {
        state: "awaiting-confirmation",
        confirmationRequired: true,
        confirmationStatus: "pending",
        pendingConfirmation: confirmation,
      });
      return {
        result,
        pause: true,
        engineOutcome: {
          handled: true,
          run: getRun(run.id),
          responseText: result.summary,
          spokenText: result.summary,
          result,
          pendingConfirmation: confirmation,
        },
      };
    }
  }

  if (result.status === "success") recordCapabilitySuccess(call.capabilityId);
  recordSessionAction(request, call.capabilityId, result);
  logActivity(call.capabilityId, result, options);
  feedback(result);
  return { result, engineOutcome: { handled: true } };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Follow-ups about actions already taken this session ("where did I create
 * that folder?") must NOT re-enter tool selection — create/folder keywords
 * would retrieve mutation tools and the model might act again. Fall through
 * to conversational chat, which has session-action memory in the system prompt.
 */
function isSessionActionFollowUp(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q || getRecentSessionActions(1).length === 0) return false;
  if (
    /\b(create|make|new|delete|remove|trash|open|launch|start|write|save|rename|move|copy)\b/.test(
      q,
    ) &&
    !/\b(where|what|which|when|did you|have you|you (just )?(create|made|did)|that (folder|file)|the (folder|file) you)\b/.test(
      q,
    )
  ) {
    // Fresh action request, not a follow-up.
    return false;
  }
  return (
    /\bwhere (did|was|is) (that|the|it|you|i)\b/.test(q) ||
    /\bwhere did (you|i) (create|make|put|save)\b/.test(q) ||
    /\bwhat (did you|was that|folder|file|path)\b/.test(q) ||
    /\bwhich (folder|file|path)\b/.test(q) ||
    /\b(that|the) (folder|file) you (just )?(created|made|wrote)\b/.test(q) ||
    /\b(remind me|tell me) where\b/.test(q) ||
    /\b(did you|have you) (create|make|write|save)\b/.test(q)
  );
}

/**
 * Entry point for chat and voice. Returns handled=false when the request is
 * pure conversation (the caller then uses plain chat).
 */
export async function handleCapabilityRequest(
  text: string,
  options: EngineOptions,
): Promise<EngineOutcome> {
  const trimmed = text.trim();
  if (!trimmed) return { handled: false };

  // Preference commands (always/forget) run before everything.
  const preference = await handlePreferenceCommand(trimmed, options);
  if (preference) return preference;

  // Follow-ups about recent verified actions → conversation + memory.
  if (isSessionActionFollowUp(trimmed)) {
    return { handled: false };
  }

  // Connected-service intents (Gmail / Calendar / Drive / …) belong to the
  // IntentOrchestrator — never let applications.open steal “what's on my
  // Gmail?” or “is my Gmail connected?”.
  const { classifyIntent, isOrchestratedDomain } = await import(
    "../orchestration/IntentClassifier"
  );
  if (isOrchestratedDomain(classifyIntent(trimmed))) {
    return { handled: false };
  }

  // Compound deterministic requests become a small sequential plan.
  const segments = splitCompound(trimmed);
  if (segments.length > 1) {
    const routes = segments.map((s) => routeDeterministic(s));
    if (routes.every((r) => r !== null)) {
      return runCompoundPlan(trimmed, segments, options);
    }
  }

  // Stage 1: deterministic.
  const deterministic = routeDeterministic(trimmed);
  if (deterministic) {
    const run = startRun(trimmed, "deterministic", {
      conversationId: options.conversationId,
      voiceSessionId: options.voiceSessionId,
    });
    return runSingleCapability(
      run,
      deterministic.capabilityId,
      deterministic.arguments,
      trimmed,
      options,
    );
  }

  // Stage 2: retrieval + model tool selection.
  const run = startRun(trimmed, "model-tool-call", {
    conversationId: options.conversationId,
    voiceSessionId: options.voiceSessionId,
  });
  const outcome = await runModelToolLoop(run, trimmed, options);
  if (!outcome.handled) {
    // Conversation — drop the placeholder run silently.
    patchRun(run.id, { state: "cancelled" });
  }
  return outcome;
}

async function runCompoundPlan(
  request: string,
  segments: string[],
  options: EngineOptions,
): Promise<EngineOutcome> {
  const run = startRun(request, "multi-step-plan", {
    conversationId: options.conversationId,
    voiceSessionId: options.voiceSessionId,
  });
  const summaries: string[] = [];
  let lastOutcome: EngineOutcome | undefined;
  for (const [index, segment] of segments.entries()) {
    const route = routeDeterministic(segment);
    if (!route) break;
    const stepRun = startRun(segment, "deterministic", {
      conversationId: options.conversationId,
      voiceSessionId: options.voiceSessionId,
    });
    const outcome = await runSingleCapability(
      stepRun,
      route.capabilityId,
      route.arguments,
      segment,
      options,
    );
    lastOutcome = outcome;
    if (outcome.pendingConfirmation) {
      // Pause the whole plan on a confirmation; report progress so far.
      const text = [
        summaries.length > 0 ? `Done so far: ${summaries.join(" ")}` : "",
        outcome.responseText ?? "",
      ]
        .filter(Boolean)
        .join(" ");
      patchRun(run.id, { state: "awaiting-confirmation" });
      return { ...outcome, responseText: text };
    }
    const ok =
      outcome.result?.status === "success" || outcome.result?.status === "partial";
    summaries.push(
      `${index + 1}. ${outcome.responseText ?? outcome.result?.summary ?? "(no result)"}`,
    );
    if (!ok) {
      const text = `I stopped after step ${index + 1} of ${segments.length}:\n${summaries.join("\n")}`;
      if (outcome.result) finishRun(run.id, outcome.result, text);
      return { handled: true, run: getRun(run.id), responseText: text, result: outcome.result };
    }
  }
  const text = summaries.join("\n");
  if (lastOutcome?.result) {
    finishRun(run.id, lastOutcome.result, text);
  }
  return {
    handled: true,
    run: getRun(run.id),
    responseText: text,
    spokenText: `Done — ${segments.length} steps completed.`,
    result: lastOutcome?.result,
  };
}

/**
 * Resolve a pending confirmation. `approvedId` selects a candidate for
 * ambiguity confirmations; `approved=false` cancels.
 */
export async function resolvePendingConfirmation(
  runId: string,
  approved: boolean,
  approvedId?: string,
): Promise<EngineOutcome> {
  const pending = pendingByRun.get(runId);
  pendingByRun.delete(runId);
  if (!pending) {
    return { handled: true, responseText: "That confirmation has expired." };
  }
  const run = getRun(runId);
  if (!run) {
    return { handled: true, responseText: "That run no longer exists." };
  }
  if (!approved) {
    const result: ToolResult = {
      callId: "cancelled",
      capabilityId: pending.capabilityId,
      status: "cancelled",
      summary: "Cancelled — nothing was changed.",
      evidence: { verified: true, method: "state-readback" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    patchRun(runId, { state: "cancelled", confirmationStatus: "rejected" });
    finishRun(runId, result, result.summary);
    return {
      handled: true,
      run: getRun(runId),
      responseText: result.summary,
      spokenText: result.summary,
      result,
    };
  }

  patchRun(runId, { confirmationStatus: "approved", pendingConfirmation: undefined });

  // Ambiguity selection: re-run with the chosen target.
  let args = pending.args;
  if (approvedId && pending.candidates?.length) {
    if (pending.capabilityId === "applications.open") {
      args = { ...args, target_id: approvedId };
      delete (args as Record<string, unknown>).query;
      // The user explicitly picked this target — learn it as confirmed.
      if (typeof pending.args.query === "string") {
        recordAliasSuccess(pending.args.query, approvedId, "native", true);
      }
    } else if (pending.capabilityId === "filesystem.delete") {
      args = { ...args, paths: [approvedId] };
    } else if (pending.capabilityId === "screen.capture") {
      args = { ...args, target: "window", window_id: approvedId, application_query: null };
    } else if (pending.capabilityId.startsWith("tasks.")) {
      args = { ...args, task_id: approvedId, title_query: null };
    }
  }

  if (pending.modelLoop) {
    // Resume the paused model loop with the executed result.
    const result = await executeCapability(
      pending.capabilityId,
      args,
      runId,
      pending.request,
      pending.token,
    );
    pending.modelLoop.turns.push({
      role: "tool",
      toolCallId: "confirmed",
      content: JSON.stringify(compactToolResult(result)),
    });
    logActivity(pending.capabilityId, result, pending.options);
    return continueModelLoop(run, pending.request, pending.options, pending.modelLoop);
  }

  // "user-approved" is a sentinel for frontend-confirmed capabilities that
  // have no native token; it prevents re-prompting in the confirm gate.
  return runSingleCapability(
    run,
    pending.capabilityId,
    args,
    pending.request,
    pending.options,
    pending.token ?? "user-approved",
  );
}

export function hasPendingConfirmation(runId: string): boolean {
  return pendingByRun.has(runId);
}
