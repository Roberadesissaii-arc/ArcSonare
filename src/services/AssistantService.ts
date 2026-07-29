/**
 * Routes assistant chat to the model selected in Settings → Models.
 * One everyday-assistant choice is used for dashboard chat and the voice overlay.
 * Respects DeepSeek, Google (Gemini), Ollama Local, and Ollama Cloud.
 */
import { modelById } from "../config/modelRegistry";
import { getPrefs } from "../stores/settingsStore";
import { deepseekChat } from "./DeepSeekService";
import { geminiChat } from "./GeminiService";
import {
  ensureOllamaCloudModel,
  ensureOllamaModel,
  ollamaChat,
  ollamaChatStream,
  ollamaCloudChat,
  type ChatMessage,
} from "./OllamaService";
import {
  assistantSystemContext,
} from "./assistantTools";
import { handleOrchestratedRequest } from "../features/orchestration/IntentOrchestrator";
import { ORCHESTRATION_SYSTEM_RULES } from "../features/orchestration/ModelCapabilityMatrix";
import { navigate } from "../stores/appStore";
import { setVoiceStatus } from "../stores/voiceStore";
import {
  getOverlayState,
  setOverlayMode,
} from "../features/top-overlay/overlayStore";

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
  provider:
    | "ollama-local"
    | "ollama-cloud"
    | "deepseek"
    | "google"
    | "unsupported"
    | "none";
  displayName: string;
  modelName?: string;
}

/** Read the currently selected everyday assistant from prefs (chat + overlay). */
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
  if (role.id === "google-gemini" || role.provider === "google") {
    return {
      provider: "google",
      displayName: role.displayName,
      modelName:
        getPrefs().models.googleModel?.trim() ||
        role.modelName ||
        "gemini-3.5-flash",
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
 * Dashboard Voice Action + top overlay both show Thinking while the model runs.
 * Always updates voice status; refreshes the overlay whenever that window is up.
 */
function signalAssistantThinking() {
  setVoiceStatus("thinking");
  const overlay = getOverlayState();
  if (
    overlay.visible ||
    (overlay.mode !== "hidden" && overlay.mode !== "closing")
  ) {
    setOverlayMode("thinking", {
      status: "Thinking...",
      expanded: false,
    });
  }
}

/**
 * Ask the configured assistant.
 * @param forceLocal — when true (dashboard Local mode), always use Ollama local.
 * @param skipCapabilities — when true, skip the capability engine (overlay already ran it).
 *
 * Actions go through the capability engine so the model calls tools and remembers
 * results. Pure chat uses the selected model with session action memory.
 */
export async function askAssistant(
  userText: string,
  options?: {
    forceLocal?: boolean;
    skipCapabilities?: boolean;
    /** Plain-chat only — called with each reply chunk as it streams in (Ollama local). */
    onChunk?: (delta: string) => void;
  },
): Promise<AssistantReply> {
  const text = userText.trim();
  if (!text) {
    throw new Error("Nothing to send.");
  }

  if (!options?.skipCapabilities) {
    // Dynamic import avoids a static cycle with capabilityEngine → getAssistantRoute.
    const { handleCapabilityRequest } = await import(
      "../features/capabilities/capabilityEngine"
    );
    signalAssistantThinking();
    const capability = await handleCapabilityRequest(text, {
      origin: "chat",
      onProgress: (message) => {
        const overlay = getOverlayState();
        if (overlay.visible || (overlay.mode !== "hidden" && overlay.mode !== "closing")) {
          setOverlayMode(
            message.startsWith("Opening") ? "opening-app" : "thinking",
            { status: message.startsWith("Opening") ? message : "Thinking..." },
          );
        }
      },
    });
    if (capability.handled && capability.responseText) {
      const route = getAssistantRoute();
      const modelOwned =
        capability.run?.route === "model-tool-call" ||
        capability.run?.route === "multi-step-plan";
      return {
        text: capability.responseText,
        sourceLabel: modelOwned
          ? `${route.displayName} · tools`
          : "ArcSonare tools",
        localTool: capability.result?.capabilityId,
      };
    }
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
      connectionActionLabel: orchestrated.action?.label,
    };
  }

  const messages = buildMessages(text);
  signalAssistantThinking();

  if (options?.forceLocal) {
    const ready = await ensureOllamaModel();
    if (!ready.ok) throw new Error(ready.message);
    const reply = options.onChunk
      ? await ollamaChatStream(messages, options.onChunk, ready.model)
      : await ollamaChat(messages, ready.model);
    return {
      text: reply,
      sourceLabel: `Ollama · ${ready.model}`,
    };
  }

  const route = getAssistantRoute();

  // Backend-enforced cloud gate from Settings → Data & Privacy.
  // Local Ollama remains available when cloud processing is off.
  const allowCloud = getPrefs().dataPrivacy.allowCloud;
  const cloudBlocked =
    !options?.forceLocal &&
    !allowCloud &&
    (route.provider === "deepseek" ||
      route.provider === "ollama-cloud" ||
      route.provider === "google");

  if (route.provider === "deepseek" && !cloudBlocked) {
    const reply = await deepseekChat(messages, route.modelName);
    return {
      text: reply,
      sourceLabel: `DeepSeek · ${route.modelName ?? route.displayName}`,
    };
  }

  if (route.provider === "google" && !cloudBlocked) {
    const reply = await geminiChat(messages, route.modelName);
    return {
      text: reply,
      sourceLabel: `Google · ${route.modelName ?? route.displayName}`,
    };
  }

  if (route.provider === "ollama-cloud" && !cloudBlocked) {
    const ready = await ensureOllamaCloudModel();
    if (!ready.ok) throw new Error(ready.message);
    const reply = await ollamaCloudChat(messages, ready.model);
    return {
      text: reply,
      sourceLabel: `Ollama Cloud · ${ready.model}`,
    };
  }

  // Local path: selected Ollama local, no model, or cloud blocked → try Ollama.
  if (
    route.provider === "ollama-local" ||
    route.provider === "none" ||
    cloudBlocked
  ) {
    const ready = await ensureOllamaModel();
    if (!ready.ok) {
      if (cloudBlocked) {
        throw new Error(
          "Cloud processing is off, and Ollama (local) is not available. Enable cloud in Settings → Data & Privacy, or start Ollama.",
        );
      }
      if (route.provider === "none") {
        throw new Error(
          "No default model selected. Choose one in Settings → Models.",
        );
      }
      throw new Error(ready.message);
    }
    const reply = options?.onChunk
      ? await ollamaChatStream(messages, options.onChunk, ready.model)
      : await ollamaChat(messages, ready.model);
    return {
      text: reply,
      sourceLabel: cloudBlocked
        ? `Ollama · ${ready.model} (local fallback)`
        : `Ollama · ${ready.model}`,
    };
  }

  throw new Error(
    `${route.displayName} is selected, but chat for that provider is not wired yet. Choose Ollama Local, Ollama Cloud, DeepSeek, or Google (Gemini) in Settings → Models.`,
  );
}
