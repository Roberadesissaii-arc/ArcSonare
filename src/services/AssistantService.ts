/**
 * Routes assistant chat to the model selected in Settings → Models.
 * Respects DeepSeek, Ollama Local, and Ollama Cloud. Never silently switches providers.
 */
import { modelById } from "../config/modelRegistry";
import { getPrefs } from "../stores/settingsStore";
import { deepseekChat } from "./DeepSeekService";
import {
  ensureOllamaCloudModel,
  ensureOllamaModel,
  ollamaChat,
  ollamaCloudChat,
  type ChatMessage,
} from "./OllamaService";
import {
  assistantSystemContext,
  tryLocalAssistantTools,
} from "./assistantTools";
import { handleOrchestratedRequest } from "../features/orchestration/IntentOrchestrator";
import { ORCHESTRATION_SYSTEM_RULES } from "../features/orchestration/ModelCapabilityMatrix";
import { navigate } from "../stores/appStore";

export interface AssistantReply {
  text: string;
  /** Provider/model label for UI status. */
  sourceLabel: string;
  /** True when answered by a local deterministic tool (no LLM). */
  localTool?: string;
  /** Optional Connect action label for UI. */
  connectionActionLabel?: string;
}

export interface AssistantRouteInfo {
  provider: "ollama-local" | "ollama-cloud" | "deepseek" | "unsupported" | "none";
  displayName: string;
  modelName?: string;
}

/** Read the currently selected everyday assistant from prefs. */
export function getAssistantRoute(): AssistantRouteInfo {
  const role = modelById(getPrefs().models.roles.assistant);
  if (!role) {
    return { provider: "none", displayName: "No model selected" };
  }
  if (role.id === "ollama-local") {
    return {
      provider: "ollama-local",
      displayName: role.displayName,
      modelName: getPrefs().models.ollamaModel || undefined,
    };
  }
  if (role.id === "ollama-cloud") {
    return {
      provider: "ollama-cloud",
      displayName: role.displayName,
      modelName: getPrefs().models.ollamaCloudModel || undefined,
    };
  }
  if (role.provider === "deepseek") {
    return {
      provider: "deepseek",
      displayName: role.displayName,
      modelName: role.modelName,
    };
  }
  return {
    provider: "unsupported",
    displayName: role.displayName,
  };
}

function buildMessages(userText: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `${assistantSystemContext()}\n\n${ORCHESTRATION_SYSTEM_RULES}`,
    },
    { role: "user", content: userText },
  ];
}

/**
 * Ask the configured assistant.
 * @param forceLocal — when true (dashboard Local mode), always use Ollama local.
 */
export async function askAssistant(
  userText: string,
  options?: { forceLocal?: boolean },
): Promise<AssistantReply> {
  const text = userText.trim();
  if (!text) {
    throw new Error("Nothing to send.");
  }

  const local = tryLocalAssistantTools(text);
  if (local.handled) {
    return {
      text: local.reply,
      sourceLabel: "Local tools",
      localTool: local.toolId,
    };
  }

  // Intent Precision — connected-service read/open before any model call.
  const orchestrated = await handleOrchestratedRequest(text);
  if (orchestrated.handled) {
    if (orchestrated.navigatePage) {
      navigate(orchestrated.navigatePage);
    }
    return {
      text: orchestrated.action
        ? `${orchestrated.text} (${orchestrated.action.label})`
        : orchestrated.text,
      sourceLabel: "Intent orchestration",
      localTool: orchestrated.capabilityId,
      connectionActionLabel: orchestrated.action?.label,
    };
  }

  const messages = buildMessages(text);

  if (options?.forceLocal) {
    const ready = await ensureOllamaModel();
    if (!ready.ok) throw new Error(ready.message);
    const reply = await ollamaChat(messages, ready.model);
    return {
      text: reply,
      sourceLabel: `Ollama · ${ready.model}`,
    };
  }

  const route = getAssistantRoute();

  // Backend-enforced cloud gate from Settings → Data & Privacy.
  const allowCloud = getPrefs().dataPrivacy.allowCloud;
  if (
    !options?.forceLocal &&
    !allowCloud &&
    (route.provider === "deepseek" || route.provider === "ollama-cloud")
  ) {
    throw new Error(
      "Cloud processing is disabled in Settings → Data & Privacy. Enable it or choose Ollama (local).",
    );
  }

  if (route.provider === "deepseek") {
    const reply = await deepseekChat(messages, route.modelName);
    return {
      text: reply,
      sourceLabel: `DeepSeek · ${route.modelName ?? route.displayName}`,
    };
  }

  if (route.provider === "ollama-cloud") {
    const ready = await ensureOllamaCloudModel();
    if (!ready.ok) throw new Error(ready.message);
    const reply = await ollamaCloudChat(messages, ready.model);
    return {
      text: reply,
      sourceLabel: `Ollama Cloud · ${ready.model}`,
    };
  }

  if (route.provider === "ollama-local" || route.provider === "none") {
    const ready = await ensureOllamaModel();
    if (!ready.ok) {
      if (route.provider === "none") {
        throw new Error(
          "No default model selected. Choose one in Settings → Models.",
        );
      }
      throw new Error(ready.message);
    }
    const reply = await ollamaChat(messages, ready.model);
    return {
      text: reply,
      sourceLabel: `Ollama · ${ready.model}`,
    };
  }

  throw new Error(
    `${route.displayName} is selected, but chat for that provider is not wired yet. Choose Ollama Local, Ollama Cloud, or DeepSeek in Settings → Models.`,
  );
}
