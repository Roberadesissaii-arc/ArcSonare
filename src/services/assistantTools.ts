/**
 * Deterministic local capabilities ArcSonare can answer without a model.
 * These run before LLM routing so “what time is it?” always works.
 */
export interface LocalToolResult {
  handled: true;
  reply: string;
  toolId: string;
}

export interface LocalToolMiss {
  handled: false;
}

export type LocalToolOutcome = LocalToolResult | LocalToolMiss;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[?.!]+$/g, "").trim();
}

function formatNow(): { time: string; date: string; full: string; zone: string } {
  const now = new Date();
  const zone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local time zone";
  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  const date = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const full = now.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  return { time, date, full, zone };
}

/** Context injected into every LLM system prompt. */
export function assistantSystemContext(): string {
  const { full, zone } = formatNow();
  return [
    "You are ArcSonare, a helpful Windows desktop assistant.",
    `Current local datetime: ${full} (${zone}).`,
    "Use this datetime for any time or date questions — do not invent a different clock.",
    "Keep replies concise (1–4 sentences) unless the user asks for more.",
    "You can help with: current time/date, drafting text, summarizing, planning tasks,",
    "and explaining how to use ArcSonare settings. You cannot control the OS unless a tool is connected.",
  ].join(" ");
}

/**
 * Try to answer with a local tool. Returns handled=true when no model call is needed.
 */
export function tryLocalAssistantTools(userText: string): LocalToolOutcome {
  const q = normalize(userText);
  if (!q) return { handled: false };

  const { time, date, full, zone } = formatNow();

  const timeAsk =
    /^(what('?s| is) the time|what time is it|current time|tell me the time|time now)$/.test(
      q,
    ) ||
    /\b(what time is it|what'?s the time|current time)\b/.test(q);

  if (timeAsk) {
    return {
      handled: true,
      toolId: "get_current_time",
      reply: `It’s ${time} (${zone}).`,
    };
  }

  const dateAsk =
    /^(what('?s| is) (the )?(date|day)|what day is it|current date|today'?s date)$/.test(
      q,
    ) || /\b(what day is it|what'?s the date|current date)\b/.test(q);

  if (dateAsk) {
    return {
      handled: true,
      toolId: "get_current_date",
      reply: `Today is ${date}.`,
    };
  }

  const datetimeAsk =
    /^(what('?s| is) (the )?(date and time|time and date)|date and time)$/.test(q);

  if (datetimeAsk) {
    return {
      handled: true,
      toolId: "get_current_datetime",
      reply: `It’s ${full}.`,
    };
  }

  return { handled: false };
}
