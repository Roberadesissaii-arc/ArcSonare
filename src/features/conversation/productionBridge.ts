/**
 * Where the conversation ledger meets real capability execution.
 *
 * Two jobs, both at the same boundary in `capabilityEngine.executeCapability`:
 *
 *   before dispatch — if the model handed us a pronoun as a target ("it"),
 *                     swap it for the structured reference of the thing the
 *                     conversation is actually about, or refuse.
 *   after success   — deposit what the tool found or created, so the *next*
 *                     follow-up has something to resolve against.
 *
 * This is deliberately not wired into `routeDeterministic`. That router is dead
 * in production on purpose — `capabilityEngine` says so in as many words: "The
 * model chooses every tool. There is deliberately no pattern-matching stage in
 * front of it." Wiring here would have fixed the routing suites and changed
 * nothing in the running application.
 *
 * Unlike the ledger and resolver, this file may import application types; it is
 * called from the executor, never from the router.
 */

import type { ToolResult } from "../capabilities/capabilityTypes";
import {
  rememberEntity,
  rememberToolResult,
  referableEntities,
  setInteractionSurface,
  getInteractionSurface,
  setPendingClarification,
  getPendingClarification,
  type ConversationEntity,
  type EntityType,
} from "./conversationContext";
import {
  clarificationQuestion,
  isReferencePhrase,
  missingContextQuestion,
  resolveReference,
  typesForAction,
} from "./referenceResolver";

/** Argument names that carry "the thing to act on", per capability. */
const TARGET_ARGS = [
  "target",
  "name",
  "query",
  "title_query",
  "item",
  "path",
] as const;

/**
 * Capabilities whose target may legitimately be a back-reference.
 *
 * Every id here is a registered capability — an invented one would be dead
 * weight that reads like support for something that does not exist.
 */
const RESOLVABLE = new Set([
  "screen.click_target",
  "screen.highlight_target",
  "desktop.find_item",
  "filesystem.open_item",
  "filesystem.reveal_in_explorer",
  "filesystem.find",
  "applications.open",
  "applications.focus",
  "applications.open_with",
  "tasks.complete",
  "tasks.reopen",
  "tasks.update",
  "tasks.delete",
  "tasks.add_subtask",
  "tasks.assign_agent",
]);

/**
 * How a tool argument came to hold the value it holds.
 *
 * The distinction that matters is `model-substituted`. The model can see the
 * whole conversation, so when the user says "press it" it frequently resolves
 * the pronoun itself and calls `screen.click_target({ target: "books" })`. The
 * bridge then sees a perfectly ordinary name and waves it through — which is
 * exactly what happened in the running application: "Press it" answered
 * "clicked 'books'" and clicked a folder.
 *
 * Detecting a pronoun is therefore not enough. What has to be checked is
 * whether the user actually named this target in this turn.
 */
export type TargetProvenance =
  | "explicit"          // the user named it in this turn
  | "resolver"          // our own reference resolver produced it
  | "model-substituted" // the model supplied it from conversation history
  | "unknown";

/** Strip punctuation and collapse whitespace, for substring comparison. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/["""''`.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Did the user name this target in this turn?
 *
 * Substring containment on normalised text. A target the user did not say is
 * one the model produced from somewhere else, and that is the case that needs
 * checking against the ledger.
 */
export function classifyTargetProvenance(
  target: string,
  userRequest: string,
): TargetProvenance {
  const t = normalizeText(target);
  const u = normalizeText(userRequest);
  if (!t) return "unknown";
  if (!u) return "unknown";
  if (u.includes(t)) return "explicit";
  // A multi-word target counts as named if every word of it was said, so
  // "the books folder" still matches "click the books folder".
  const words = t.split(" ").filter((w) => w.length > 2);
  if (words.length > 0 && words.every((w) => u.includes(w))) return "explicit";
  return "model-substituted";
}

/**
 * Capabilities that read the Desktop or the filesystem.
 *
 * Listed so a surface-relative request ("show me here") cannot be answered by
 * one of them while the conversation is on a different surface.
 */
const DESKTOP_READERS = new Set([
  "desktop.find_item",
  "filesystem.list_known_folder",
  "filesystem.list_directory",
  "filesystem.find",
  "filesystem.get_directory_summary",
]);

/**
 * Screen actions that need a target the user can actually point at.
 *
 * "Show me here" after a YouTube search reached `screen.click_target` with no
 * real target — the model, having nothing better, aimed a click at a window it
 * had not looked at. A click that lands somewhere arbitrary is worse than a
 * question, so these are guarded the same way the Desktop readers are: when the
 * request names a surface rather than a thing, ask.
 */
const SCREEN_TARGET_ACTIONS = new Set([
  "screen.click_target",
  "screen.highlight_target",
  "input.click_at",
]);

export type PronounOutcome =
  | { kind: "unchanged"; args: Record<string, unknown> }
  | { kind: "resolved"; args: Record<string, unknown>; entity: ConversationEntity }
  | { kind: "clarify"; question: string };

/**
 * Replace a pronoun target with the structured reference it means.
 *
 * Returns `clarify` rather than guessing. That is the whole point: the previous
 * behaviour turned "press it" into a click on an invented "play button", and a
 * click lands somewhere whether or not it was the right somewhere.
 */
export function resolvePronounArguments(
  capabilityId: string,
  args: Record<string, unknown>,
  userRequest: string,
): PronounOutcome {
  // "Show me here" after a YouTube search must not read the Desktop. The word
  // "here" names a surface, and if the surface on record is not the Desktop
  // then a Desktop reader is answering a question nobody asked.
  const surface = surfaceForRequest(userRequest);
  if (surface && surface.kind !== "desktop") {
    // A Desktop reader can never be the answer to "here" when "here" is a web
    // surface. A screen action can be — but only if the user named the control;
    // otherwise there is no target and the model is guessing at one.
    const namedTarget = TARGET_ARGS.map((k) => args[k])
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .find((v) => classifyTargetProvenance(v, userRequest) === "explicit");
    const blind = SCREEN_TARGET_ACTIONS.has(capabilityId) && !namedTarget;

    if (DESKTOP_READERS.has(capabilityId) || blind) {
      const what = surface.query ? `the ${surface.query} results` : "that";
      const question = `Do you want me to show ${what} here in chat, or bring ${surface.label} to the front?`;
      setPendingClarification({
        requestedAction: userRequest,
        candidates: [],
        askedAt: Date.now(),
        question,
      });
      return { kind: "clarify", question };
    }
  }

  if (!RESOLVABLE.has(capabilityId)) return { kind: "unchanged", args };

  const key = TARGET_ARGS.find(
    (k) => typeof args[k] === "string" && (args[k] as string).trim().length > 0,
  );
  if (!key) return { kind: "unchanged", args };

  const raw = String(args[key]).trim();

  if (!isReferencePhrase(raw)) {
    // Not a pronoun — but that does not make it safe. If the user did not name
    // this target in this turn, the model supplied it from history, and the
    // ledger may already know it is the wrong *kind* of thing for this action.
    const provenance = classifyTargetProvenance(raw, userRequest);
    if (provenance !== "model-substituted") return { kind: "unchanged", args };

    const wanted = typesForAction(userRequest || capabilityId);
    if (wanted.length === 0) return { kind: "unchanged", args };

    const known = referableEntities().find(
      (e) =>
        e.label.toLowerCase() === raw.toLowerCase() ||
        e.ref.toLowerCase() === raw.toLowerCase(),
    );
    // Nothing on record: the model may well be naming a control it can see, and
    // refusing every unrecognised target would break ordinary vision clicks.
    if (!known) return { kind: "unchanged", args };

    if (wanted.includes(known.type)) return { kind: "unchanged", args };

    // On record, and the wrong kind of thing. This is the bypass: "press it"
    // must not become a click on a folder just because the model spelled the
    // folder's name for us.
    const question = incompatibleTargetQuestion(userRequest, known.label, known.type);
    setPendingClarification({
      requestedAction: userRequest || capabilityId,
      candidates: [],
      askedAt: Date.now(),
      question,
    });
    return { kind: "clarify", question };
  }

  // The action wording decides which entity types are eligible — "highlight it"
  // and "mark it urgent" do not mean the same thing by "it".
  const action = userRequest || `${capabilityId} ${raw}`;
  const outcome = resolveReference(raw, action);

  switch (outcome.kind) {
    case "not-a-reference":
      return { kind: "unchanged", args };

    case "resolved":
      setPendingClarification(null);
      return {
        kind: "resolved",
        // The structured ref, never the pronoun. For a task this is the id, so
        // a follow-up updates the original task instead of creating a second.
        args: { ...args, [key]: outcome.entity.ref },
        entity: outcome.entity,
      };

    case "ambiguous": {
      const question = clarificationQuestion(action, outcome.candidates);
      setPendingClarification({
        requestedAction: action,
        candidates: outcome.candidates,
        askedAt: Date.now(),
        question,
      });
      return { kind: "clarify", question };
    }

    case "none":
      setPendingClarification({
        requestedAction: action,
        candidates: [],
        askedAt: Date.now(),
        question: missingContextQuestion(action),
      });
      return { kind: "clarify", question: missingContextQuestion(action) };
  }
}

/**
 * What to say when the model named something real but of the wrong kind.
 *
 * Says what was found, so the user is not left wondering whether the folder was
 * located at all — the answer is yes, it just is not something you press.
 */
function incompatibleTargetQuestion(
  action: string,
  label: string,
  type: EntityType,
): string {
  const noun =
    type === "folder" || type === "desktop-item"
      ? `the ${label} folder`
      : type === "task"
        ? `the task "${label}"`
        : type === "application"
          ? `${label}`
          : `"${label}"`;
  if (/click|press|tap|push/i.test(action)) {
    return `I found ${noun}, but I'm not sure what you want me to press. Tell me the button or control.`;
  }
  if (/highlight|point/i.test(action)) {
    return `I found ${noun}, but I'm not sure what you want me to highlight. Tell me the item.`;
  }
  if (/open|launch/i.test(action)) {
    return `I found ${noun}, but I'm not sure what you want me to open.`;
  }
  return `I found ${noun}, but that isn't something I can do that to. Tell me what you meant.`;
}

/**
 * Answer an outstanding "which one did you mean?".
 *
 * Matches the user's reply against the candidate labels that were offered. A
 * reply that matches nothing leaves the clarification standing rather than
 * picking one, because a wrong pick here is exactly the side effect the
 * clarification existed to prevent.
 */
export function resolveClarificationReply(
  reply: string,
): { entity: ConversationEntity; requestedAction: string } | null {
  const pending = getPendingClarification();
  if (!pending || pending.candidates.length === 0) return null;
  const r = reply.trim().toLowerCase();
  if (!r) return null;

  const hit =
    pending.candidates.find((c) => r === c.label.toLowerCase()) ??
    pending.candidates.find((c) => r.includes(c.label.toLowerCase()));
  if (!hit) return null;

  setPendingClarification(null);
  return { entity: hit, requestedAction: pending.requestedAction };
}

/**
 * Which surface a successful capability left the conversation on.
 *
 * Only set for capabilities that genuinely move the user somewhere. A task
 * update does not change "here", so it does not clear a browsing surface.
 */
function recordSurface(capabilityId: string, data: Record<string, unknown> | undefined): void {
  const q = str(data, "query", "search", "q");
  if (capabilityId === "web.search" || capabilityId === "web.open_url") {
    const url = str(data, "url", "target") ?? "";
    // `site` is what the search was actually scoped to; the URL is only a
    // fallback for an open that never carried one.
    const named = str(data, "site");
    const site = named === "youtube" || /youtube/i.test(url) ? "youtube" : "browser";
    setInteractionSurface({
      kind: site,
      label: site === "youtube" ? "YouTube" : "the browser",
      query: q,
      application: str(data, "application", "browser"),
    });
    return;
  }
  if (capabilityId === "desktop.find_item" || capabilityId === "screen.highlight_target") {
    setInteractionSurface({ kind: "desktop", label: "your Desktop", query: undefined });
    return;
  }
  if (capabilityId === "applications.open" || capabilityId === "applications.focus") {
    const app = str(data, "application", "app", "name", "query");
    if (app) {
      setInteractionSurface({
        kind: /youtube/i.test(app) ? "youtube" : "application",
        label: app,
        application: app,
      });
    }
  }
}

/** Phrases that mean "on the surface we are currently on". */
const SURFACE_PHRASES =
  /\b(?:here|there|in this app|on this page|in this window|on screen)\b/i;

/**
 * Does this request point at the current surface rather than a thing?
 *
 * Used to stop a Desktop reader answering "show me here" after a YouTube
 * search. Returns the surface the conversation is actually on, when the phrase
 * is present and a surface is on record.
 */
export function surfaceForRequest(
  userRequest: string,
): { kind: string; label: string; query?: string } | null {
  if (!SURFACE_PHRASES.test(userRequest)) return null;
  const surface = getInteractionSurface();
  if (!surface) return null;
  return { kind: surface.kind, label: surface.label, query: surface.query };
}

/** Pull a string field out of a tool result's data bag. */
function str(data: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Deposit whatever a successful tool found or created.
 *
 * Only successes: a folder that was not found is not something "it" can mean.
 *
 * Note what is deliberately *not* stored — the bounds rectangle from
 * `desktop.find_item`. A remembered rectangle is stale the moment the icon
 * moves or the display changes, and acting on it would put a border in the
 * wrong place. The name is kept, and the geometry is looked up again at action
 * time through the normal structured path.
 */
export function recordEntitiesFromResult(
  capabilityId: string,
  result: ToolResult,
): void {
  const success = result.status === "success";
  const data = (result.data ?? undefined) as Record<string, unknown> | undefined;

  rememberToolResult({
    capabilityId,
    success,
    summary: result.summary ?? "",
    entityIds: [],
  });
  if (!success) return;

  const remember = (
    type: ConversationEntity["type"],
    label: string,
    ref: string,
    meta?: ConversationEntity["meta"],
  ) => rememberEntity({ type, label, ref, sourceTool: capabilityId, confidence: 1, meta });

  // Record where the conversation now *is*, not just what it is about.
  // "Show me here" after a YouTube search used to fall through to the Desktop
  // reader and list files, because Desktop was the only context that existed.
  recordSurface(capabilityId, data);

  switch (capabilityId) {
    case "desktop.find_item":
    case "screen.highlight_target": {
      const name = str(data, "name", "target");
      if (name) {
        remember("desktop-item", name, name, {
          path: str(data, "path") ?? null,
          // Recorded so a later action knows the identity came from the shell,
          // not from vision. Not a coordinate.
          source: str(data, "source") ?? null,
        });
      }
      break;
    }

    case "tasks.create":
    case "tasks.update":
    case "tasks.complete":
    case "tasks.reopen":
    case "tasks.assign_agent":
    case "tasks.add_subtask": {
      const id = str(data, "taskId", "task_id");
      const task = data?.task as { title?: string } | undefined;
      const title = task?.title ?? str(data, "title") ?? id;
      if (id && title) remember("task", title, id);
      break;
    }

    case "filesystem.find":
    case "filesystem.open_item":
    case "filesystem.reveal_in_explorer": {
      const path = str(data, "path", "folder", "file");
      const label = str(data, "name", "label") ?? path?.split(/[\\/]/).pop();
      if (path && label) {
        remember(/\.[a-z0-9]{1,6}$/i.test(path) ? "file" : "folder", label, path);
      }
      break;
    }

    case "applications.open":
    case "applications.open_with":
    case "applications.focus": {
      const label = str(data, "application", "app", "name", "query");
      if (label) remember("application", label, label);
      break;
    }

    default:
      break;
  }
}
