/**
 * Declared tool-calling capabilities per configured model.
 * Used to choose native tools vs structured/deterministic fallback.
 */

export type ModelToolCapabilities = {
  providerId: string;
  modelId: string;
  nativeFunctionCalling: boolean;
  strictJsonSchema: boolean;
  parallelToolCalls: boolean;
  sequentialToolCalls: boolean;
  forcedToolChoice: boolean;
  streamingToolCalls: boolean;
  realtimeToolCalls: boolean;
  structuredOutput: boolean;
  maximumRecommendedTools?: number;
  argumentReliability: "high" | "medium" | "low";
  testedAt?: string;
};

/** Known ArcSonare model ids from modelRegistry. */
export const MODEL_CAPABILITY_MATRIX: ModelToolCapabilities[] = [
  {
    providerId: "openai",
    modelId: "gpt-4o",
    nativeFunctionCalling: true,
    strictJsonSchema: true,
    parallelToolCalls: true,
    sequentialToolCalls: true,
    forcedToolChoice: true,
    streamingToolCalls: true,
    realtimeToolCalls: false,
    structuredOutput: true,
    argumentReliability: "high",
  },
  {
    providerId: "anthropic",
    modelId: "claude-sonnet",
    nativeFunctionCalling: true,
    strictJsonSchema: true,
    parallelToolCalls: false,
    sequentialToolCalls: true,
    forcedToolChoice: true,
    streamingToolCalls: true,
    realtimeToolCalls: false,
    structuredOutput: true,
    argumentReliability: "high",
  },
  {
    providerId: "google",
    modelId: "gemini",
    nativeFunctionCalling: true,
    strictJsonSchema: true,
    parallelToolCalls: true,
    sequentialToolCalls: true,
    forcedToolChoice: true,
    streamingToolCalls: true,
    realtimeToolCalls: false,
    structuredOutput: true,
    argumentReliability: "medium",
  },
  {
    providerId: "deepseek",
    modelId: "deepseek-chat",
    nativeFunctionCalling: true,
    strictJsonSchema: false,
    parallelToolCalls: false,
    sequentialToolCalls: true,
    forcedToolChoice: false,
    streamingToolCalls: false,
    realtimeToolCalls: false,
    structuredOutput: true,
    argumentReliability: "medium",
  },
];

export function getModelToolCapabilities(
  modelId: string,
): ModelToolCapabilities | undefined {
  return MODEL_CAPABILITY_MATRIX.find((m) => m.modelId === modelId);
}

/**
 * Runtime instruction injected for all models (provider-independent).
 */
export const ORCHESTRATION_SYSTEM_RULES = `You are ArcSonare, a connected native assistant.

Preserve the user's operation:
- Questions about data require read tools — never open an application as a substitute.
- Open/launch/go-to requests use open tools.
- Draft/compose/prepare never send.
- Send requires an explicit send request and confirmation.
- Delete requires confirmation.

Examples:
“What's on my calendar?” → calendar read tools. Do NOT open a calendar app.
“What is my latest email?” → email read tools. Do NOT open Gmail.
“Open Gmail.” → email open tool.
“Draft a reply.” → create a draft. Do NOT send.

Use the provided connection snapshot. Do not guess connection state.
If disconnected, say the service is not connected — do not open the website instead.
Never claim data was retrieved or an action succeeded without a verified tool result.`;
