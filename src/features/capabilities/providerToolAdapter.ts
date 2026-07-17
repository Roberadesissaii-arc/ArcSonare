/**
 * Provider-independent tool calling. One registry — each adapter converts the
 * selected capabilities into its provider's function-tool format and parses
 * tool calls back. Providers without native tools fall back to one strict
 * JSON object that is validated locally; invalid output is never executed.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  CapabilityDefinition,
  ParsedToolCall,
  ToolResult,
} from "./capabilityTypes";

export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

export interface AdapterReply {
  text?: string;
  toolCalls: ParsedToolCall[];
  raw?: unknown;
}

export interface ProviderToolAdapter {
  id: string;
  supportsNativeTools(): boolean;
  supportsStrictSchema(): boolean;
  supportsParallelTools(): boolean;
  supportsVision(): boolean;
  supportsRealtimeTools(): boolean;
  formatTools(capabilities: CapabilityDefinition[]): unknown[];
  chat(turns: ChatTurn[], tools: CapabilityDefinition[], model: string): Promise<AdapterReply>;
  formatToolResults(results: ToolResult[]): ChatTurn[];
}

/** Tool names use "__" because most providers reject dots in function names. */
export function toToolName(capabilityId: string): string {
  return capabilityId.replace(/\./g, "__");
}

export function fromToolName(toolName: string): string {
  return toolName.replace(/__/g, ".");
}

function openAiTools(capabilities: CapabilityDefinition[]): unknown[] {
  return capabilities.map((cap) => ({
    type: "function",
    function: {
      name: toToolName(cap.id),
      description: cap.description,
      parameters: cap.inputSchema,
    },
  }));
}

function parseOpenAiMessage(message: unknown): AdapterReply {
  const m = message as {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  const toolCalls: ParsedToolCall[] = [];
  for (const call of m.tool_calls ?? []) {
    const name = call.function?.name;
    if (!name) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(call.function?.arguments || "{}") as Record<string, unknown>;
    } catch {
      // Invalid JSON arguments are surfaced as an empty object; the local
      // validator will reject and the engine retries once with feedback.
      parsed = { __parse_error: call.function?.arguments ?? "" };
    }
    toolCalls.push({
      id: call.id ?? `tc-${toolCalls.length}`,
      capabilityId: fromToolName(name),
      arguments: parsed,
    });
  }
  return { text: m.content ?? undefined, toolCalls, raw: message };
}

function openAiTurns(turns: ChatTurn[]): unknown[] {
  return turns.map((t) => {
    if (t.role === "tool") {
      return { role: "tool", tool_call_id: t.toolCallId, content: t.content };
    }
    if (t.role === "assistant" && t.toolCalls?.length) {
      return {
        role: "assistant",
        content: t.content || null,
        tool_calls: t.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      };
    }
    return { role: t.role, content: t.content };
  });
}

/** DeepSeek — OpenAI-compatible /chat/completions with native tools. */
export const deepSeekAdapter: ProviderToolAdapter = {
  id: "deepseek",
  supportsNativeTools: () => true,
  supportsStrictSchema: () => false,
  supportsParallelTools: () => true,
  supportsVision: () => false,
  supportsRealtimeTools: () => false,
  formatTools: openAiTools,
  async chat(turns, tools, model) {
    const message = await invoke<unknown>("deepseek_chat_tools", {
      model,
      messages: openAiTurns(turns),
      tools: openAiTools(tools),
    });
    return parseOpenAiMessage(message);
  },
  formatToolResults(results) {
    return results.map((r) => ({
      role: "tool" as const,
      toolCallId: r.callId,
      content: JSON.stringify(compactToolResult(r)),
    }));
  },
};

function ollamaTurns(turns: ChatTurn[]): unknown[] {
  return turns.map((t) => {
    if (t.role === "tool") {
      return { role: "tool", content: t.content };
    }
    if (t.role === "assistant" && t.toolCalls?.length) {
      return {
        role: "assistant",
        content: t.content ?? "",
        tool_calls: t.toolCalls.map((c) => ({
          function: { name: c.name, arguments: safeParse(c.arguments) },
        })),
      };
    }
    return { role: t.role, content: t.content };
  });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseOllamaMessage(message: unknown): AdapterReply {
  const m = message as {
    content?: string;
    tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
  };
  const toolCalls: ParsedToolCall[] = [];
  for (const call of m.tool_calls ?? []) {
    const name = call.function?.name;
    if (!name) continue;
    const rawArgs = call.function?.arguments;
    const args =
      typeof rawArgs === "string"
        ? (safeParse(rawArgs) as Record<string, unknown>)
        : ((rawArgs ?? {}) as Record<string, unknown>);
    toolCalls.push({
      id: `tc-${toolCalls.length}`,
      capabilityId: fromToolName(name),
      arguments: args,
    });
  }
  return { text: m.content || undefined, toolCalls, raw: message };
}

/** Local Ollama — /api/chat tools (model-dependent; falls back to JSON mode). */
export const ollamaAdapter: ProviderToolAdapter = {
  id: "ollama-local",
  supportsNativeTools: () => true,
  supportsStrictSchema: () => false,
  supportsParallelTools: () => false,
  supportsVision: () => false,
  supportsRealtimeTools: () => false,
  formatTools: openAiTools,
  async chat(turns, tools, model) {
    const message = await invoke<unknown>("ollama_chat_tools", {
      model,
      messages: ollamaTurns(turns),
      tools: openAiTools(tools),
    });
    return parseOllamaMessage(message);
  },
  formatToolResults(results) {
    return results.map((r) => ({
      role: "tool" as const,
      toolCallId: r.callId,
      content: JSON.stringify(compactToolResult(r)),
    }));
  },
};

/**
 * JSON fallback for providers without reliable native tool calling: request
 * one strict JSON object, validate locally, never execute invalid output.
 */
export function buildJsonFallbackPrompt(capabilities: CapabilityDefinition[]): string {
  const tools = capabilities.map((c) => ({
    name: toToolName(c.id),
    description: c.description,
    parameters: c.inputSchema,
  }));
  return [
    "You can trigger local Windows capabilities. To use one, reply with ONLY a JSON object:",
    '{"tool": "<name>", "arguments": { ... }}',
    "If no capability fits, reply with ONLY:",
    '{"tool": null, "reply": "<your answer>"}',
    "Available capabilities:",
    JSON.stringify(tools),
    "Never invent capability names or arguments. No prose outside the JSON.",
  ].join("\n");
}

export function parseJsonFallback(reply: string): AdapterReply {
  const trimmed = reply.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(trimmed) as {
      tool?: string | null;
      arguments?: Record<string, unknown>;
      reply?: string;
    };
    if (parsed.tool) {
      return {
        toolCalls: [
          {
            id: "tc-0",
            capabilityId: fromToolName(parsed.tool),
            arguments: parsed.arguments ?? {},
          },
        ],
      };
    }
    return { text: parsed.reply ?? trimmed, toolCalls: [] };
  } catch {
    // Not JSON — treat as a plain reply, never execute.
    return { text: reply, toolCalls: [] };
  }
}

/**
 * Compact tool results for the model: status, summary, key data — never the
 * full artifact payloads or huge listings.
 */
export function compactToolResult(result: ToolResult): Record<string, unknown> {
  let data = result.data as Record<string, unknown> | undefined;
  if (data) {
    const clone: Record<string, unknown> = { ...data };
    // Trim listings/search results to the first 20 entries for the model.
    for (const key of ["items", "results", "processes", "windows", "applications", "tasks"]) {
      const value = clone[key];
      if (Array.isArray(value) && value.length > 20) {
        clone[key] = value.slice(0, 20);
        clone[`${key}_truncated`] = value.length;
      }
    }
    // Never feed whole file bodies back unless small.
    if (typeof clone.content === "string" && clone.content.length > 4000) {
      clone.content = `${clone.content.slice(0, 4000)}…(truncated)`;
    }
    data = clone;
  }
  return {
    capability: result.capabilityId,
    status: result.status,
    summary: result.summary,
    verified: result.evidence.verified,
    verification: result.evidence.method,
    data,
    error: result.error ? { code: result.error.code, message: result.error.message } : undefined,
    warnings: result.warnings,
  };
}
