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

export interface AssistantReply {
  text: string;
  /** Provider/model label for UI status. */
  sourceLabel: string;
  /** True when answered by a local deterministic tool (no LLM). */
  localTool?: string;
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
    { role: "system", content: assistantSystemContext() },
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
