/**
 * The one function that turns the active watch scope into prompt text.
 *
 * Shared by chat and voice deliberately. They previously built desktop context
 * independently — chat through a relevance-ranked block, voice through nothing
 * at all — which is why the two surfaces disagreed and why voice could not
 * answer a question the Dashboard had the data for.
 *
 * It is built from the **conversation's active scope**, not from relevance
 * ranking. Ranking was the cause of the reported failure: "what can you do?"
 * contains none of Discord's domain vocabulary, so every watched application
 * scored zero, the block said "no watched applications are relevant", and the
 * model answered from the global feature list instead.
 *
 * `check-watch-scope` asserts both surfaces call this.
 */
import type { ApplicationAbilities } from "./watchAbilityTypes";
import { afterReopening, availableNow, unsupported } from "./watchAbilityTypes";
import { buildWatchContext, formatWatchContextForModel } from "./watchContextBroker";
import { recordWatchInjection } from "./watchProvenance";
import {
  refreshWatchScope,
  type ActiveWatchEntry,
} from "./watchScopeStore";
import { watchRelevance } from "./watchRelevance";
import { getWatchSnapshot } from "./watchStore";
import { watchAppVisual } from "./watchAppIcon";

/** What was included in a prompt, for the developer trace. */
export interface WatchPromptTrace {
  conversationId: string;
  contextMode: "watch" | "global";
  /** Applications whose content entered the prompt. */
  includedApplicationIds: string[];
  /** Running applications deliberately excluded. Identity only, no content. */
  excludedApplicationIds: string[];
  /** Capability ids offered this turn. */
  capabilityIds: string[];
  /** Why the watched context was included, or null when it was withheld. */
  relevanceReason?: string | null;
  /**
   * Applications this turn named that are running but not active.
   *
   * Recorded so the reply can carry a real "Activate <app>" button. Telling the
   * user to activate something and giving them no way to do it is the same
   * dead end as saying nothing.
   */
  awaitingActivation?: Array<{ appCatalogId: string; displayName: string }>;
  /** Characters of watched context in the prompt. Never the content itself. */
  contextChars: number;
  at: string;
}

let lastTrace: WatchPromptTrace | null = null;

/**
 * Applications the previous turn actually used.
 *
 * What makes "pause it" work after "play the current song" and *not* after
 * "what's the weather?". Cleared whenever the active scope changes, so a
 * pronoun cannot reach back past a switch to the application the user left.
 */
let lastUsedApplicationIds: string[] = [];

/** Forget the previous turn's applications. Called on any scope change. */
export function clearWatchTurnMemory(): void {
  lastUsedApplicationIds = [];
  lastTrace = null;
}

/** The last prompt's inclusion decision. Never carries private content. */
export function lastWatchPromptTrace(): WatchPromptTrace | null {
  return lastTrace;
}

/**
 * Watched-application context for a model prompt.
 *
 * When the conversation is scoped, the block describes exactly those
 * applications and states plainly that the conversation is scoped — which is
 * what stops the model reaching for the global feature list.
 */
export async function watchContextForPrompt(
  requestText: string,
  conversationId?: string,
): Promise<string> {
  if (!conversationId) {
    // No conversation to scope to (session-level voice instructions). Fall back
    // to the broker's relevance view, which is correct there: the instructions
    // are built once and must cover whatever the user says next.
    return unscopedContext(requestText);
  }

  // Always re-read. The scope and the applications' live state are the two
  // things most likely to be stale: the user may have switched the active
  // application a moment ago, and a media session's track changes without
  // anyone telling us. A cached snapshot is fine for rendering a row; it is
  // never the authority for what a request is answered from.
  const result = await refreshWatchScope(conversationId);

  // A watched application that has closed is retired from the active scope —
  // it is no longer what the conversation is about. It must still be able to
  // answer for itself, though: after Spotify quits, "what's playing" has to
  // produce "Spotify is watched, but it is not running", not silence and not
  // the track it was on. So a closed application rejoins the turn when the user
  // names it, or when the previous turn was already about it.
  const inScope = new Set(result.scope.entries.map((e) => e.appCatalogId));
  const snapshot = getWatchSnapshot();
  const closed: ActiveWatchEntry[] = snapshot.watched
    .filter((w) => w.instances.length === 0 && !inScope.has(w.appCatalogId))
    .map((w) => ({
      appCatalogId: w.appCatalogId,
      displayName: w.displayName,
      running: false,
    }));

  // Running, but the user has not made it part of this conversation.
  //
  // "What page is Chrome showing?" with Chrome running and inactive must not be
  // answered — reading a window the user has not selected is the thing Watch
  // exists to gate — and must not be silently ignored either, because the
  // fallback for silence was the visual locator taking a screenshot of a
  // window nobody authorised. It joins the turn to say it needs activating.
  const inactive: ActiveWatchEntry[] = [
    ...new Map(
      snapshot.running
        .filter((i) => !inScope.has(i.appCatalogId))
        .map((i) => [i.appCatalogId, i]),
    ).values(),
  ].map((instance) => ({
    appCatalogId: instance.appCatalogId,
    displayName:
      snapshot.watched.find((w) => w.appCatalogId === instance.appCatalogId)
        ?.displayName ?? watchAppVisual(instance.appCatalogId, instance.executableName).displayName,
    running: true,
  }));
  const inactiveIds = new Set(inactive.map((e) => e.appCatalogId));

  // Not every turn is about the watched application. Activating Spotify makes
  // it *available*, not implied — without this gate "what's the weather?" and
  // "create a task" carried Spotify's state into the prompt.
  const verdict = watchRelevance({
    requestText,
    active: [...result.scope.entries, ...closed, ...inactive],
    // A running application the user never selected is reachable only by name.
    // A *closed* one is not on this list: it was retired automatically, not by
    // the user, so "what's playing" right after Spotify quits still has to
    // reach Spotify and be told it is not running — silence there is how the
    // old track got answered from memory instead.
    namedOnly: inactiveIds,
    previousTurnApplicationIds: lastUsedApplicationIds,
  });
  if (!verdict.relevant) {
    lastTrace = {
      conversationId,
      contextMode: "global",
      includedApplicationIds: [],
      excludedApplicationIds: result.scope.entries.map((e) => e.appCatalogId),
      capabilityIds: [],
      relevanceReason: null,
      contextChars: 0,
      at: new Date().toISOString(),
    };
    return "";
  }

  // Only the applications the turn is actually about.
  const relevant = new Set(verdict.applicationIds);
  const entries = [...result.scope.entries, ...closed, ...inactive].filter((e) =>
    relevant.has(e.appCatalogId),
  );
  const abilities = [
    ...result.abilities,
    // Neither a closed nor an inactive application has abilities from Rust —
    // both are out of scope — so their entries are written here, plainly, as
    // the honest answers they need to give.
    ...closed
      .filter((e) => relevant.has(e.appCatalogId))
      .map((e) => closedAbilities(e.displayName, e.appCatalogId)),
    ...inactive
      .filter((e) => relevant.has(e.appCatalogId))
      .map((e) => inactiveAbilities(e.displayName, e.appCatalogId)),
  ].filter((a) => relevant.has(a.appCatalogId));

  if (entries.length === 0) {
    lastTrace = {
      conversationId,
      contextMode: "global",
      includedApplicationIds: [],
      excludedApplicationIds: [],
      capabilityIds: [],
      contextChars: 0,
      at: new Date().toISOString(),
    };
    return "No application is being watched for this conversation. Answer normally.";
  }

  const block = formatScope(abilities, entries.length > 1, entries);

  // What was deliberately left out, by identity only. This is the developer
  // diagnostic Objective 9 asks for, and it carries catalog ids — never a
  // title, a path or a page — because a diagnostic that logged the content it
  // withheld would defeat the withholding.
  const activeIds = new Set(entries.map((e) => e.appCatalogId));
  const excluded = [
    ...new Set(
      getWatchSnapshot()
        .running.map((i) => i.appCatalogId)
        .filter((id) => !activeIds.has(id)),
    ),
  ];

  lastTrace = {
    conversationId,
    contextMode: "watch",
    includedApplicationIds: [...activeIds],
    excludedApplicationIds: excluded,
    capabilityIds: result.capabilityIds,
    relevanceReason: verdict.reason,
    contextChars: block.length,
    at: new Date().toISOString(),
  };

  lastUsedApplicationIds = [...activeIds];
  lastTrace.awaitingActivation = inactive
    .filter((e) => relevant.has(e.appCatalogId))
    .map((e) => ({ appCatalogId: e.appCatalogId, displayName: e.displayName }));
  // This turn's provenance. Recorded here rather than inferred later, because
  // "which applications reached the prompt" is only knowable at the moment the
  // prompt is built.
  recordWatchInjection([...activeIds]);
  return block;
}

/**
 * What a watched application that is closed can say for itself.
 *
 * Deliberately empty of anything callable: the point of this entry is that the
 * model tells the user the application is not running and offers to open it,
 * rather than answering from the last thing it knew.
 */
function closedAbilities(
  displayName: string,
  appCatalogId: string,
): ApplicationAbilities {
  return {
    appCatalogId,
    displayName,
    running: false,
    summary: `${displayName} is watched, but it is not running right now. Say so, and offer to open it. Do NOT answer from anything it was doing earlier in this conversation.`,
    abilities: [
      {
        label: `Open ${displayName}`,
        capabilityId: "applications.launch",
        availability: "now",
      },
    ],
  };
}

/**
 * What a running application the user has not activated can say for itself.
 *
 * Nothing readable, and nothing to guess from. The one thing offered is the
 * activation the user has to perform, because the alternative that shipped was
 * the visual locator screenshotting a window nobody had authorised.
 */
function inactiveAbilities(
  displayName: string,
  appCatalogId: string,
): ApplicationAbilities {
  return {
    appCatalogId,
    displayName,
    running: true,
    summary: `${displayName} is running, but focused Watch access is not active for it in this conversation. Say exactly that, and offer to turn it on. Do NOT read its window, take a screenshot, search the screen, or answer from anything earlier in this conversation.`,
    abilities: [
      {
        label: `Activate ${displayName} for this conversation`,
        capabilityId: "watch.activate_application",
        availability: "now",
      },
    ],
  };
}

/**
 * The scoped block.
 *
 * Structure matters here. The model is told, in order: that the conversation is
 * scoped, which applications, what each can do *now*, what needs the
 * application reopened, what is simply not possible, and finally that the
 * global feature list is not the answer to a question asked in this
 * conversation. Every one of those lines exists because omitting it produced a
 * wrong answer.
 */
function formatScope(
  abilities: ApplicationAbilities[],
  multiple: boolean,
  entries: ActiveWatchEntry[],
): string {
  const lines: string[] = [
    multiple
      ? `WATCH MODE — this conversation is scoped to ${abilities.length} applications.`
      : `WATCH MODE — this conversation is scoped to ${abilities[0]?.displayName ?? "one application"}.`,
  ];

  for (const app of abilities) {
    const entry = entries.find((e) => e.appCatalogId === app.appCatalogId);
    lines.push("");
    lines.push(`## ${app.displayName}${app.running ? "" : " — NOT RUNNING"}`);
    lines.push(app.summary);
    // Every watched-app capability requires an instance key, and the model has
    // no other way to obtain one. Omitting it here made the tools unusable —
    // the model would either guess a key or give up and describe the
    // application instead of acting on it.
    if (entry?.boundInstanceKey) {
      lines.push(`instance_key: ${entry.boundInstanceKey}`);
    } else if (app.running) {
      lines.push(
        "More than one window is open and none is pinned — ask which one before acting.",
      );
    }

    const now = availableNow(app);
    if (now.length > 0) {
      lines.push("What you can do right now:");
      for (const ability of now) {
        lines.push(`  - ${ability.label}${ability.note ? ` (${ability.note})` : ""}`);
      }
    }

    const later = afterReopening(app);
    if (later.length > 0) {
      lines.push(
        `Only after ${app.displayName} is reopened — do NOT attempt these now:`,
      );
      for (const ability of later) {
        lines.push(`  - ${ability.label}`);
      }
    }

    const never = unsupported(app);
    if (never.length > 0) {
      lines.push("Not possible — say so plainly if asked:");
      for (const ability of never) {
        lines.push(`  - ${ability.label}${ability.note ? ` — ${ability.note}` : ""}`);
      }
    }
  }

  lines.push("");
  lines.push(
    "Answer questions like \"what can you do?\", \"what's going on?\", \"what do you see?\" " +
      "and \"help me with this\" from the list above and nothing else.",
  );
  // The staleness rule. Application state changes without anyone telling us —
  // the track advances, the channel changes — so an answer composed from what
  // was true earlier in the conversation is a guess wearing a fact's clothes.
  lines.push(
    "For any question about what the application is doing RIGHT NOW — what is playing, " +
      "which channel, which file, what changed — call the read tool for it on this turn. " +
      "Never answer from an earlier turn in this conversation: the state has moved on.",
  );
  lines.push(
    "Do NOT describe ArcSonare's general abilities — opening applications, screenshots, " +
      "tasks, calendar, email, web search — in this conversation. They are not what was asked.",
  );
  if (multiple) {
    lines.push(
      "Group your answer by application. Do not merge them into one list. " +
        "If a request could apply to more than one of them, ask which.",
    );
  }
  lines.push(
    "Other applications may be running on this machine. They are NOT part of this " +
      "conversation: do not mention them, and do not read or report their windows.",
  );
  // The honesty rule the adapters depend on. A window title says which file is
  // focused and nothing about whether it compiles; treating one as the other is
  // how "what is happening in Discord?" got a confident, invented answer.
  lines.push(
    "Every watched-app tool needs the instance_key printed with its application. " +
      "Never guess one. Never infer an application's contents from its window title — " +
      "if something is listed as not possible, say you cannot see it rather than filling it in.",
  );

  return lines.join("\n");
}

/**
 * Session-level context, with no conversation to scope to.
 *
 * Used by the voice session's one-time instructions. Still watched-only — it
 * never describes an unwatched application — but it cannot narrow to a
 * conversation that does not exist yet.
 */
async function unscopedContext(requestText: string): Promise<string> {
  try {
    const result = await buildWatchContext({ requestText, metadataOnly: true });
    return formatWatchContextForModel(result);
  } catch (err) {
    console.error("[ArcSonare] watch prompt context failed:", err);
    // An honest blank. "No apps are watched" would be a claim, and the failure
    // here is that we could not look — not that there are none.
    return "Watched-application context could not be read right now.";
  }
}
