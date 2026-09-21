/**
 * In-app model evaluation, run through the Rust broker.
 *
 * The Node harness needs `DEEPSEEK_API_KEY` in the shell because it lives
 * outside the app and cannot reach Tauri IPC. That means a second copy of the
 * credential in an environment variable — and this project has already lost a
 * key to an error message that echoed its own input.
 *
 * This runs the same evaluation from inside the app, where the credential never
 * leaves Rust. The frontend sends a prompt and the tool schemas built from the
 * production registry; the broker resolves the key, calls the provider, and
 * returns only the selection. No key, no headers, no raw response.
 *
 * Dev builds only — `eval_model_selection` is compiled out of release.
 */

import { invoke } from "@tauri-apps/api/core";
import { getConnectedIntegrationIds } from "../../services/integrationStatusService";
import { validateArguments } from "./capabilitySchemas";
import { getCapability } from "./capabilityRegistry";
import { retrieveCapabilities } from "./capabilityRouter";
import { capabilitiesForOrigin } from "./connectorRegistry";
import { toToolName } from "./providerToolAdapter";

interface BrokerSelection {
  selected_capability: string | null;
  arguments: Record<string, unknown>;
  text: string;
  provider_status: number;
  error_kind: string | null;
  duration_ms: number;
}

export interface EvalScenarioResult {
  prompt: string;
  origin: "chat" | "voice";
  connectorStates: string[];
  candidates: string[];
  selected: string | null;
  arguments: Record<string, unknown>;
  validation: "passed" | "failed" | "no-call";
  validationErrors?: string[];
  /** Recorded, never performed. */
  wouldExecute: string | null;
  browserWouldOpen: boolean;
  text: string;
  durationMs: number;
  errorKind: string | null;
}

const SYSTEM = [
  "You are ArcSonare, a Windows desktop assistant with real local tools.",
  "When a request matches a tool, call it. Never pretend you did something.",
  "YouTube questions are answered from the user's connected YouTube account with youtube.search — results appear inside the app.",
  "Only use web.search for YouTube when the user explicitly asks for a browser or a tab.",
  "Connection questions are connections.get_status or connections.list — never a search, never a browser.",
].join(" ");

const BROWSER_CAPABILITIES = new Set([
  "web.search",
  "web.open_url",
  "web.activate_listed_item",
  "youtube.open_result",
]);

export async function evalProviderAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>("eval_provider_available");
  } catch {
    return false;
  }
}

/**
 * Evaluate one prompt. Nothing is executed — the selected capability is
 * recorded and validated, then discarded.
 */
export async function evaluatePrompt(
  prompt: string,
  origin: "chat" | "voice" = "chat",
  model = "deepseek-v4-flash",
): Promise<EvalScenarioResult> {
  let connected: ReadonlySet<never> = new Set<never>();
  try {
    connected = (await getConnectedIntegrationIds()) as unknown as ReadonlySet<never>;
  } catch {
    // Treated as nothing connected, which is the safe direction.
  }

  const pool = capabilitiesForOrigin(origin, connected);
  const candidates = retrieveCapabilities(prompt, 8, { origin, connectedConnectors: connected })
    .map((r) => r.capability.id)
    .filter((id) => pool.some((c) => c.id === id));

  const tools = candidates
    .map((id) => getCapability(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      type: "function",
      function: { name: toToolName(c.id), description: c.description, parameters: c.inputSchema },
    }));

  const selection = await invoke<BrokerSelection>("eval_model_selection", {
    model,
    systemPrompt: SYSTEM,
    userPrompt: prompt,
    tools,
  });

  let validation: EvalScenarioResult["validation"] = "no-call";
  let validationErrors: string[] | undefined;
  if (selection.selected_capability) {
    const definition = getCapability(selection.selected_capability);
    if (!definition) {
      validation = "failed";
      validationErrors = ["capability does not exist"];
    } else {
      const outcome = validateArguments(definition.inputSchema, selection.arguments);
      validation = outcome.valid ? "passed" : "failed";
      if (!outcome.valid) validationErrors = outcome.errors;
    }
  }

  return {
    prompt,
    origin,
    connectorStates: [...(connected as ReadonlySet<string>)],
    candidates,
    selected: selection.selected_capability,
    arguments: selection.arguments,
    validation,
    validationErrors,
    // Recorded only. This module has no executor and cannot reach one.
    wouldExecute: validation === "passed" ? selection.selected_capability : null,
    browserWouldOpen:
      validation === "passed" &&
      selection.selected_capability !== null &&
      BROWSER_CAPABILITIES.has(selection.selected_capability),
    text: selection.text,
    durationMs: selection.duration_ms,
    errorKind: selection.error_kind,
  };
}

/** Expose the runner for developer use. Absent from release builds. */
export function installEvalConsoleHook(): void {
  if (typeof window === "undefined" || !import.meta.env.DEV) return;
  (window as unknown as Record<string, unknown>).__arcsonareEval = {
    available: evalProviderAvailable,
    run: evaluatePrompt,
    runAll: async (prompts: string[], origin: "chat" | "voice" = "chat") => {
      const out: EvalScenarioResult[] = [];
      for (const prompt of prompts) out.push(await evaluatePrompt(prompt, origin));
      return out;
    },
  };
}
