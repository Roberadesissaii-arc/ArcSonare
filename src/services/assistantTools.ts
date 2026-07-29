/**
 * Shared clock helpers + session action memory for the assistant system prompt.
 * Conversational answers always come from the model — never a hardcoded reply.
 */

import { formatSessionActionContext } from "../features/capabilities/actionSessionMemory";
import { connectedIntegrationsSummary } from "./integrationStatusService";

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
export async function assistantSystemContext(): Promise<string> {
  const { full, zone } = formatNow();
  const memory = formatSessionActionContext();
  const integrations = await connectedIntegrationsSummary().catch(
    () => "Integration status is unavailable right now.",
  );
  return [
    "You are ArcSonare, a helpful Windows desktop assistant.",
    `Current local datetime: ${full} (${zone}).`,
    "Use this datetime for any time or date questions — do not invent a different clock.",
    "Answer in your own words. Do not mention internal tool names or function ids.",
    "Keep replies concise (1–4 sentences) unless the user asks for more.",
    "You can help with: current time/date, drafting text, summarizing, planning tasks,",
    "explaining ArcSonare settings, and answering follow-ups about actions you already took.",
    "When recent-actions context is provided below, treat it as ground truth for what you did.",
    "Do not invent files, folders, paths, or actions that are not listed there.",
    integrations,
    "This integration status is ground truth — never guess or contradict it.",
    memory,
  ]
    .filter(Boolean)
    .join(" ");
}
