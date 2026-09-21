/**
 * Shared clock helpers + session action memory for the assistant system prompt.
 * Conversational answers always come from the model — never a hardcoded reply.
 */

import { formatSessionActionContext } from "../features/capabilities/actionSessionMemory";
import { loadAccountProfile } from "../features/account/accountProfile";
import { connectedIntegrationsSummary } from "./integrationStatusService";
import { buildAssistantPrompt } from "./assistantPrompt";
import { watchContextForPrompt } from "../features/watch/watchPromptContext";

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

/**
 * Context injected into every LLM system prompt.
 *
 * `requestText` narrows the watched-application block to what could plausibly
 * answer this turn. Without it every watched application's state travels with
 * every request, which is both noisier and a wider disclosure than the user
 * asked for.
 */
export async function assistantSystemContext(
  requestText = "",
  conversationId?: string,
): Promise<string> {
  const { full, zone } = formatNow();
  const memory = formatSessionActionContext();
  const [integrations, desktop] = await Promise.all([
    connectedIntegrationsSummary().catch(
      () => "Integration status is unavailable right now.",
    ),
    watchContextForPrompt(requestText, conversationId).catch(
      () => "Desktop app status is unavailable right now.",
    ),
  ]);
  const profile = loadAccountProfile();
  const userName =
    profile.displayName.trim() || profile.fullName.trim() || "";
  return buildAssistantPrompt({
    datetime: full,
    zone,
    integrations,
    memory,
    desktop,
    userName,
  });
}
