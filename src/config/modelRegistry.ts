/**
 * Model and provider registry.
 *
 * Logos come from the local model asset library (copied + sanitized into
 * src/assets/models/). Capability data is entered here by hand from public
 * provider documentation — never inferred from a logo. `availability` is
 * honest: every cloud model is "requires-key" until a credential is stored,
 * and Ollama is "requires-local" until a local runtime is detected (no
 * detection exists yet, so it stays unconfigured).
 */
import anthropicLogo from "../assets/models/anthropic.svg";
import claudeLogo from "../assets/models/claude.svg";
import deepseekLogo from "../assets/models/deepseek.svg";
import geminiLogo from "../assets/models/gemini.svg";
import grokLogo from "../assets/models/grok.svg";
import ollamaLogo from "../assets/models/ollama.svg";
import openaiLogo from "../assets/models/openai.svg";

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "ollama";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  logo: string;
  /** How the provider is configured. */
  configuration: "api-key" | "local-runtime";
  description: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    logo: anthropicLogo,
    configuration: "api-key",
    description: "Claude models via the Anthropic API.",
  },
  {
    id: "openai",
    name: "OpenAI",
    logo: openaiLogo,
    configuration: "api-key",
    description: "GPT, transcription and speech models via the OpenAI API.",
  },
  {
    id: "google",
    name: "Google",
    logo: geminiLogo,
    configuration: "api-key",
    description:
      "Gemini text models via the Gemini API (Google AI Studio key). Text chat only — no image, video, or robotics models.",
  },
  {
    id: "xai",
    name: "xAI",
    logo: grokLogo,
    configuration: "api-key",
    description: "Grok models via the xAI API.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    logo: deepseekLogo,
    configuration: "api-key",
    description: "DeepSeek V4 models via the OpenAI-compatible API.",
  },
  {
    id: "ollama",
    name: "Ollama",
    logo: ollamaLogo,
    /** Local runtime + optional Cloud API key (configured in the provider panel). */
    configuration: "local-runtime",
    description: "Local models on this computer, or Ollama Cloud with an API key.",
  },
];

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  modelName: string;
  displayName: string;
  logo: string;
  description: string;
  capabilities: string[];
  contextType: "standard" | "long" | "realtime";
  supportsText: boolean;
  supportsImage: boolean;
  supportsAudioInput: boolean;
  supportsAudioOutput: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  locality: "cloud" | "local";
}

export const MODELS: ModelInfo[] = [
  {
    id: "claude-fable-5",
    provider: "anthropic",
    modelName: "claude-fable-5",
    displayName: "Claude Fable 5",
    logo: claudeLogo,
    description: "Anthropic's most capable model for deep reasoning and agents.",
    capabilities: ["Text", "Vision", "Tools", "Reasoning"],
    contextType: "long",
    supportsText: true,
    supportsImage: true,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: true,
    locality: "cloud",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    modelName: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    logo: claudeLogo,
    description: "Fast, balanced Claude for everyday assistant work.",
    capabilities: ["Text", "Vision", "Tools", "Reasoning"],
    contextType: "long",
    supportsText: true,
    supportsImage: true,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: true,
    locality: "cloud",
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    modelName: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    logo: claudeLogo,
    description: "Lowest-latency Claude for quick commands.",
    capabilities: ["Text", "Vision", "Tools"],
    contextType: "standard",
    supportsText: true,
    supportsImage: true,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: false,
    locality: "cloud",
  },
  {
    id: "gpt-5",
    provider: "openai",
    modelName: "gpt-5",
    displayName: "GPT-5",
    logo: openaiLogo,
    description: "OpenAI's flagship general model.",
    capabilities: ["Text", "Vision", "Tools", "Reasoning"],
    contextType: "long",
    supportsText: true,
    supportsImage: true,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: true,
    locality: "cloud",
  },
  {
    id: "gpt-realtime",
    provider: "openai",
    modelName: "gpt-realtime",
    displayName: "GPT Realtime",
    logo: openaiLogo,
    description: "Speech-to-speech conversation model.",
    capabilities: ["Audio in", "Audio out", "Tools", "Realtime"],
    contextType: "realtime",
    supportsText: true,
    supportsImage: false,
    supportsAudioInput: true,
    supportsAudioOutput: true,
    supportsTools: true,
    supportsReasoning: false,
    locality: "cloud",
  },
  {
    id: "whisper-transcribe",
    provider: "openai",
    modelName: "gpt-4o-transcribe",
    displayName: "GPT-4o Transcribe",
    logo: openaiLogo,
    description: "Speech recognition for voice input.",
    capabilities: ["Audio in", "Transcription"],
    contextType: "standard",
    supportsText: false,
    supportsImage: false,
    supportsAudioInput: true,
    supportsAudioOutput: false,
    supportsTools: false,
    supportsReasoning: false,
    locality: "cloud",
  },
  {
    id: "google-gemini",
    provider: "google",
    modelName: "gemini-3.5-flash",
    displayName: "Google Gemini",
    logo: geminiLogo,
    description:
      "Gemini text chat via the Gemini API. Pick the exact model in Configure Google.",
    capabilities: ["Text", "Tools", "Reasoning"],
    contextType: "long",
    supportsText: true,
    supportsImage: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: true,
    locality: "cloud",
  },
  {
    id: "grok-4",
    provider: "xai",
    modelName: "grok-4",
    displayName: "Grok 4",
    logo: grokLogo,
    description: "xAI's reasoning model with live knowledge.",
    capabilities: ["Text", "Vision", "Tools", "Reasoning"],
    contextType: "long",
    supportsText: true,
    supportsImage: true,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: true,
    locality: "cloud",
  },
  {
    id: "deepseek-v4-flash",
    provider: "deepseek",
    modelName: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    logo: deepseekLogo,
    description: "Fast DeepSeek model for everyday assistant work.",
    capabilities: ["Text", "Tools", "Reasoning"],
    contextType: "long",
    supportsText: true,
    supportsImage: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: true,
    locality: "cloud",
  },
  {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    modelName: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    logo: deepseekLogo,
    description: "Stronger DeepSeek model for deeper reasoning.",
    capabilities: ["Text", "Tools", "Reasoning"],
    contextType: "long",
    supportsText: true,
    supportsImage: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: true,
    locality: "cloud",
  },
  {
    id: "ollama-local",
    provider: "ollama",
    modelName: "(installed models)",
    displayName: "Ollama (local)",
    logo: ollamaLogo,
    description: "Runs models you have installed locally via ollama serve. Private by design.",
    capabilities: ["Text", "Local", "Tools"],
    contextType: "standard",
    supportsText: true,
    supportsImage: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: false,
    locality: "local",
  },
  {
    id: "ollama-cloud",
    provider: "ollama",
    modelName: "(cloud models)",
    displayName: "Ollama Cloud",
    logo: ollamaLogo,
    description:
      "Runs larger models on ollama.com with your API key. Same Ollama API, hosted remotely.",
    capabilities: ["Text", "Cloud", "Tools"],
    contextType: "long",
    supportsText: true,
    supportsImage: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    supportsTools: true,
    supportsReasoning: true,
    locality: "cloud",
  },
];


/** Gemini text models selectable under Configure Google (not separate cards). */
export const GOOGLE_GEMINI_MODELS: { id: string; label: string; description: string }[] = [
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", description: "Frontier everyday / coding" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", description: "High-volume, cost-sensitive" },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", description: "Most capable reasoning" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", description: "Fast Gemini 3" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Advanced 2.5 reasoning" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Balanced 2.5 chat" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", description: "Fastest budget 2.5" },
];

export function modelById(id: string | null | undefined): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function providerById(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id)!;
}

/** Model roles with human labels/descriptions (ids match prefs.models.roles). */
export const MODEL_ROLE_INFO: {
  id: import("./prefs").ModelRole;
  label: string;
  description: string;
  /** Filters the candidate models for this role. */
  fits: (m: ModelInfo) => boolean;
}[] = [
  {
    id: "assistant",
    label: "Everyday assistant",
    description: "The default model for general requests.",
    fits: (m) => m.supportsText,
  },
  {
    id: "fast",
    label: "Fast commands",
    description: "Low-latency model for quick, simple tasks.",
    fits: (m) => m.supportsText,
  },
  {
    id: "reasoning",
    label: "Complex reasoning",
    description: "Deep step-by-step planning and analysis.",
    fits: (m) => m.supportsReasoning,
  },
  {
    id: "research",
    label: "Research",
    description: "Long-context reading and synthesis.",
    fits: (m) => m.supportsText && m.contextType === "long",
  },
  {
    id: "screen",
    label: "Screen understanding",
    description: "Analyzes Screen Context captures.",
    fits: (m) => m.supportsImage,
  },
  {
    id: "image",
    label: "Image understanding",
    description: "Understands attached images.",
    fits: (m) => m.supportsImage,
  },
  {
    id: "transcription",
    label: "Speech recognition",
    description: "Turns your voice into text.",
    fits: (m) => m.supportsAudioInput,
  },
  {
    id: "speech",
    label: "Speech generation",
    description: "Speaks ArcSonare's responses.",
    fits: (m) => m.supportsAudioOutput,
  },
  {
    id: "background",
    label: "Background agent tasks",
    description: "Runs agent work in the background.",
    fits: (m) => m.supportsTools,
  },
];
