/**
 * One place that decides the shape of an assistant reply.
 *
 * Tone used to be governed entirely by prompt text — "vary your openings",
 * "don't say Done —". A prompt is a request, not a guarantee, and the observed
 * failures were exactly the ones a prompt cannot prevent: the user's name on two
 * consecutive replies, a follow-up re-announcing a discovery from the turn
 * before, and internal capability ids in the footer.
 *
 * So the structural decisions are made here, from the real tool result and the
 * conversation ledger, and handed to the presenter as facts:
 *
 *   - may this reply use the user's name?
 *   - was this entity already announced?
 *   - what does the user see as the source of this answer?
 *   - which one or two follow-up actions are actually executable now?
 *
 * The model still writes the sentence. It no longer decides these.
 */

import type { ToolResult } from "../capabilities/capabilityTypes";
import {
  recommendationOfferCount,
  shouldUseUserName,
  wasEntityAlreadyDiscussed,
} from "./conversationContext";

/** Keep a chip label short enough to read at a glance. */
function truncate(text: string, max = 34): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** A source badge: a local icon plus a friendly, non-technical label. */
export interface ResponseSource {
  /**
   * Key the chat UI resolves to a bundled icon — an app/integration id
   * ("youtube", "discord"), or a generic glyph name ("folder", "task",
   * "connection", "browser", "system").
   */
  iconKey: string;
  /** "YouTube results opened", "Folder highlighted". Never a capability id. */
  label: string;
}

/** A follow-up the user can run with one click. Structured, never free text. */
export interface ResponseAction {
  id: string;
  label: string;
  capabilityId: string;
  args: Record<string, unknown>;
}

export interface ResponsePlan {
  outcome: "success" | "failure" | "clarification";
  /** Verified facts the presenter may rephrase but not contradict. */
  facts: string;
  entityLabel?: string;
  /** Structured identity of the thing this reply is about. */
  entityRef?: string;
  /** False when the user was already told about this entity in an earlier turn. */
  newlyDiscovered: boolean;
  mayUseName: boolean;
  source: ResponseSource;
  actions: ResponseAction[];
  /** Always false for normal chat; developer diagnostics read the trace instead. */
  showTechnicalDetails: boolean;
}

function data(result: ToolResult): Record<string, unknown> {
  return (result.data ?? {}) as Record<string, unknown>;
}

function str(result: ToolResult, ...keys: string[]): string | undefined {
  const d = data(result);
  for (const k of keys) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Tomorrow at 9am local, as an ISO string — a real value, not a placeholder. */
function tomorrowMorningIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

/**
 * What the user should see as the source of this answer.
 *
 * Deliberately keyed on what the action touched, not on which capability ran:
 * "YouTube" is meaningful, "web.search" is not.
 */
function sourceFor(capabilityId: string, result: ToolResult): ResponseSource {
  const ok = result.status === "success";

  switch (capabilityId) {
    case "connections.list":
      return { iconKey: "connection", label: "Connected apps checked" };
    case "connections.list":
      return { iconKey: "connection", label: "Connected apps checked" };
    case "connections.get_status": {
      const service = str(result, "service");
      const name = str(result, "display_name") ?? "Service";
      return {
        iconKey: service ?? "connection",
        label: `${name} connection checked`,
      };
    }
    case "web.search": {
      const site = str(result, "site");
      if (site === "youtube") {
        return { iconKey: "youtube", label: "YouTube results opened" };
      }
      return { iconKey: "browser", label: "Web search opened" };
    }
    case "web.activate_listed_item":
      return { iconKey: "youtube", label: "YouTube video opened" };
    case "youtube.search":
      return { iconKey: "youtube", label: "YouTube results" };
    case "youtube.list_channel_videos":
      return { iconKey: "youtube", label: "Newest uploads" };
    case "youtube.open_result":
      return { iconKey: "youtube", label: "YouTube video opened" };
    case "web.open_url": {
      const url = str(result, "url") ?? "";
      return /youtube/i.test(url)
        ? { iconKey: "youtube", label: "YouTube opened" }
        : { iconKey: "browser", label: "Page opened" };
    }
    case "web.fetch_page":
      return { iconKey: "browser", label: "Web page read" };
    case "web.answer_question":
      return { iconKey: "browser", label: "Looked it up" };

    case "applications.open":
    case "applications.focus":
    case "applications.open_with":
    case "applications.close": {
      const app = str(result, "application", "app", "name") ?? "App";
      const verb =
        capabilityId === "applications.close"
          ? "closed"
          : capabilityId === "applications.focus"
            ? "brought forward"
            : "opened";
      return { iconKey: app.toLowerCase(), label: `${app} ${verb}` };
    }

    case "screen.highlight_target":
      return { iconKey: "folder", label: "Highlighted on screen" };
    case "desktop.find_item":
      return { iconKey: "folder", label: "Found on your Desktop" };
    case "filesystem.list_known_folder":
    case "filesystem.list_directory":
    case "filesystem.get_directory_summary":
      return { iconKey: "folder", label: "Folder read" };
    case "filesystem.find":
      return { iconKey: "folder", label: "Files searched" };
    case "filesystem.create_directory":
      return { iconKey: "folder", label: "Folder created" };
    case "filesystem.create_file":
    case "filesystem.write_text_file":
      return { iconKey: "folder", label: "File saved" };
    case "filesystem.open_item":
    case "filesystem.reveal_in_explorer":
      return { iconKey: "folder", label: "Folder opened" };

    case "tasks.create":
      return { iconKey: "task", label: "Task created" };
    case "tasks.complete":
      return { iconKey: "task", label: "Task completed" };
    case "tasks.reopen":
      return { iconKey: "task", label: "Task reopened" };
    case "tasks.update":
    case "tasks.add_subtask":
    case "tasks.assign_agent":
      return { iconKey: "task", label: "Task updated" };
    case "tasks.list":
      return { iconKey: "task", label: "Tasks read" };
    case "tasks.delete":
      return { iconKey: "task", label: "Task deleted" };

    case "email.list_messages":
    case "email.read_message":
      return { iconKey: "gmail", label: "Gmail read" };
    case "email.get_connection_status":
      return { iconKey: "gmail", label: "Gmail connection checked" };
    case "calendar.list_events":
      return { iconKey: "googleCalendar", label: "Calendar read" };
    case "calendar.create_event":
      return { iconKey: "googleCalendar", label: "Event added" };
    case "calendar.get_connection_status":
      return { iconKey: "googleCalendar", label: "Calendar connection checked" };
    case "drive.list_files":
      return { iconKey: "googleDrive", label: "Drive read" };
    case "drive.get_connection_status":
      return { iconKey: "googleDrive", label: "Drive connection checked" };

    case "screen.capture":
      return { iconKey: "system", label: "Screenshot taken" };
    case "screen.click_target":
    case "input.click_at":
      return { iconKey: "system", label: "Clicked on screen" };
    case "arcsonare.navigate":
      return { iconKey: "system", label: "Moved to a page" };

    default:
      return {
        iconKey: "system",
        label: ok ? "Action completed" : "Action did not complete",
      };
  }
}

/**
 * The brief handed to the model for the final sentence.
 *
 * Deliberately narrow. The model gets the verified outcome and the rules it
 * must respect, and nothing else — no internal logs, no capability ids, no
 * provider chatter. It owns the phrasing; it owns nothing else.
 *
 * This is what makes a reply feel written rather than assembled, without giving
 * the model any say over what actually happened.
 */
export function buildFinalResponseContract(input: {
  originalRequest: string;
  plan: ResponsePlan;
  /** One-line human description of what ran, e.g. "opened a YouTube search". */
  action: string;
  /** Verified, already-composed facts. Ground truth. */
  verifiedFacts: string;
  userFirstName?: string;
}): string {
  const { plan } = input;
  const lines = [
    "Write the user's reply. The facts below already happened and were verified.",
    "",
    `User asked: "${input.originalRequest}"`,
    `Outcome: ${plan.outcome}`,
    `What ran: ${input.action}`,
    plan.entityLabel ? `Subject: ${plan.entityLabel}` : "",
    "",
    "Verified facts (ground truth — never contradict, never embellish):",
    input.verifiedFacts,
    "",
    "Rules:",
    "- One or two sentences. Natural, warm, specific. Vary your phrasing between replies.",
    // These are the exact openers that made the old templated replies feel
    // machine-written; a model left to its own devices reaches for them too.
    '- Never open with "Done", "Done —", "Got it", "Sure thing", "All set" or "I have successfully". Start with the substance.',
    "- Never invent an action, a result, a URL, a file, or a number that is not above.",
    "- Never claim success if the outcome is not success.",
    "- Never mention tools, capabilities, models, providers, or how you did it.",
    plan.mayUseName && input.userFirstName
      ? `- You may use the user's first name (${input.userFirstName}) once, if it feels natural.`
      : "- Do NOT use the user's name in this reply.",
    plan.newlyDiscovered
      ? ""
      : "- The user already knows about this from an earlier turn. Do NOT say you found, located or discovered it. Report only what changed now.",
    plan.actions.length > 0
      ? `- You may offer exactly one follow-up, phrased naturally, and only this one: "${plan.actions[0].label}". Do not invent others.`
      : "- Do not offer a follow-up action.",
    "",
    "Reply with the message only.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Source badge for a capability with no ToolResult in hand — orchestrated
 * connected-service reads and locally-answered questions.
 */
export function sourceForCapabilityId(capabilityId: string): ResponseSource {
  return sourceFor(capabilityId, {
    callId: "",
    capabilityId,
    status: "success",
    summary: "",
    evidence: { verified: true, method: "state-readback" },
    startedAt: "",
    completedAt: "",
    durationMs: 0,
  });
}

/**
 * Follow-ups worth offering — at most two, and only when they can actually run.
 *
 * A chip carries the capability and its arguments, so clicking it re-enters the
 * executor directly. Nothing here goes back through the model as text: "Open
 * folder" as a sentence is another chance to reinterpret it as something else.
 */
function actionsFor(capabilityId: string, result: ToolResult): ResponseAction[] {
  if (result.status !== "success") return [];

  switch (capabilityId) {
    case "connections.get_status": {
      const state = str(result, "state");
      if (state === "not-connected") {
        return [
          {
            id: "open-connect",
            label: "Open Connect",
            capabilityId: "arcsonare.navigate",
            args: { page: "connect" },
          },
        ];
      }
      if (state === "error" || state === "needs-reauth") {
        return [
          {
            id: "review-connection",
            label: "Review connection",
            capabilityId: "arcsonare.navigate",
            args: { page: "connect" },
          },
        ];
      }
      if (state === "connected" && str(result, "service") === "youtube") {
        return [
          {
            id: "open-youtube",
            label: "Open YouTube",
            capabilityId: "web.open_url",
            args: { url: "https://www.youtube.com" },
          },
        ];
      }
      return [];
    }

    case "desktop.find_item": {
      const name = str(result, "name", "target");
      const path = str(result, "path");
      if (!name) return [];
      const actions: ResponseAction[] = [
        {
          id: "highlight-item",
          label: "Highlight",
          capabilityId: "screen.highlight_target",
          args: { target: name },
        },
      ];
      if (path) {
        actions.unshift({
          id: "open-item",
          label: "Open folder",
          capabilityId: "filesystem.open_item",
          args: { path },
        });
      }
      return actions.slice(0, 2);
    }

    case "screen.highlight_target": {
      const path = str(result, "path");
      if (!path) return [];
      return [
        {
          id: "open-item",
          label: "Open folder",
          capabilityId: "filesystem.open_item",
          args: { path },
        },
      ];
    }

    case "tasks.create": {
      const id = str(result, "taskId", "task_id");
      if (!id) return [];
      return [
        {
          id: "due-tomorrow",
          label: "Due tomorrow",
          capabilityId: "tasks.update",
          args: { task_id: id, due_at: tomorrowMorningIso() },
        },
        {
          id: "mark-high",
          label: "Mark high priority",
          capabilityId: "tasks.update",
          args: { task_id: id, priority: "high" },
        },
      ];
    }

    case "tasks.update": {
      const id = str(result, "taskId", "task_id");
      if (!id) return [];
      const task = data(result).task as
        | { priority?: string; dueAt?: string; due_at?: string }
        | undefined;
      const hasDue = Boolean(task?.dueAt ?? task?.due_at);
      // Offer the half they have not set. Repeating the change they just made
      // is the chip equivalent of re-announcing a discovery.
      if (!hasDue) {
        return [
          {
            id: "due-tomorrow",
            label: "Due tomorrow",
            capabilityId: "tasks.update",
            args: { task_id: id, due_at: tomorrowMorningIso() },
          },
        ];
      }
      if (task?.priority !== "high") {
        return [
          {
            id: "mark-high",
            label: "Mark high priority",
            capabilityId: "tasks.update",
            args: { task_id: id, priority: "high" },
          },
        ];
      }
      return [];
    }

    case "web.search": {
      if (str(result, "site") !== "youtube") return [];
      return [
        {
          id: "open-first-video",
          label: "Open the first video",
          capabilityId: "web.activate_listed_item",
          args: { index: 1, site: "youtube" },
        },
      ];
    }

    case "youtube.search":
    case "youtube.list_channel_videos": {
      const d = data(result);
      const items = Array.isArray(d.items)
        ? (d.items as Array<{
            id?: string;
            ordinal?: number;
            title?: string;
            type?: string;
            sourceId?: string;
          }>)
        : [];
      const first = items[0];
      if (!first?.id) return [];

      // A channel result is not something to "open" — the useful next step is
      // what the user actually wanted, which is what the channel has posted.
      if (first.type === "channel" && first.sourceId) {
        return [
          {
            id: `channel-videos-${first.sourceId}`,
            label: "See the newest uploads",
            capabilityId: "youtube.list_channel_videos",
            args: { channel_id: first.sourceId, limit: 5 },
          },
        ];
      }

      // Vary what is offered, and stop offering it once it has been ignored.
      // "Want me to open the first one?" after every single search is the
      // clearest tell that a recommendation is scripted rather than considered.
      const offeredAlready = recommendationOfferCount("open-first-result");
      if (offeredAlready >= 2) return [];
      const target = offeredAlready === 0 ? first : (items[1] ?? first);
      return [
        {
          id: "open-first-result",
          label:
            offeredAlready === 0
              ? `Open “${truncate(target.title ?? "the first one")}”`
              : "Open one of these",
          capabilityId: "youtube.open_result",
          args: {
            result_item_id: target.id,
            result_set_id: typeof d.result_set_id === "string" ? d.result_set_id : undefined,
          },
        },
      ];
    }

    default:
      return [];
  }
}

/** The entity this reply is about, when the result identifies one. */
function entityFor(
  capabilityId: string,
  result: ToolResult,
): { label?: string; ref?: string } {
  switch (capabilityId) {
    case "desktop.find_item":
    case "screen.highlight_target": {
      const name = str(result, "name", "target");
      return { label: name, ref: name };
    }
    case "tasks.create":
    case "tasks.update":
    case "tasks.complete":
    case "tasks.reopen":
    case "tasks.assign_agent":
    case "tasks.add_subtask": {
      const id = str(result, "taskId", "task_id");
      const task = data(result).task as { title?: string } | undefined;
      return { label: task?.title ?? str(result, "title"), ref: id };
    }
    case "filesystem.open_item":
    case "filesystem.reveal_in_explorer":
    case "filesystem.find": {
      const path = str(result, "path", "folder", "file");
      const label = str(result, "name", "label") ?? path?.split(/[\\/]/).pop();
      return { label, ref: path };
    }
    case "applications.open":
    case "applications.focus": {
      const app = str(result, "application", "app", "name");
      return { label: app, ref: app };
    }
    default:
      return {};
  }
}

/**
 * Build the plan for one tool result.
 *
 * `mayUseName` is only *decided* here — recording that the name was used stays
 * with the presenter, because a plan that is built and discarded must not burn
 * the cooldown.
 */
export function buildResponsePlan(input: {
  capabilityId: string;
  result: ToolResult;
  facts: string;
}): ResponsePlan {
  const { capabilityId, result } = input;
  const clarification =
    result.status === "needs-confirmation" ||
    Boolean((data(result) as { clarification?: boolean }).clarification);
  const outcome: ResponsePlan["outcome"] = clarification
    ? "clarification"
    : result.status === "success" || result.status === "partial"
      ? "success"
      : "failure";

  const entity = entityFor(capabilityId, result);
  const alreadyKnown = entity.ref ? wasEntityAlreadyDiscussed(entity.ref) : false;

  // A badge describes what happened, so it may only describe a thing that did.
  // Observed: "Show me here" was answered with a clarifying question and the
  // footer still read "Highlighted on screen" — the label of the action the
  // model asked for, not of the one that ran. Nothing was highlighted.
  const source =
    outcome === "success"
      ? sourceFor(capabilityId, result)
      : outcome === "clarification"
        ? { iconKey: "system", label: "Waiting on your answer" }
        : { ...sourceFor(capabilityId, result), label: "Didn't go through" };

  return {
    outcome,
    facts: input.facts,
    entityLabel: entity.label,
    entityRef: entity.ref,
    newlyDiscovered: !alreadyKnown,
    // A confirmation of an action the user just asked for does not need to
    // address them by name at all; the ledger's cooldown handles the rest.
    mayUseName: outcome === "success" && shouldUseUserName(),
    source,
    actions: outcome === "success" ? actionsFor(capabilityId, result) : [],
    showTechnicalDetails: false,
  };
}
