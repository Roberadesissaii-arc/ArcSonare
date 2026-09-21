/**
 * Which watched-application capabilities a model may be offered.
 *
 * The rule the whole feature rests on: a capability that acts on an application
 * is offered only when that application is *watched* and *running*. Offering
 * `spotify.play` with Spotify closed produces the worst failure mode this
 * codebase already knows — the model calls a tool it was just shown, the tool
 * fails, and the assistant has to explain away something it advertised a moment
 * earlier. `connectorRegistry` learned that with Gmail; this is the same gate
 * for desktop applications.
 */
import { CAPABILITY_REGISTRY } from "../capabilities/capabilityRegistry";
import type { CapabilityDefinition } from "../capabilities/capabilityTypes";
import {
  parseMediaIntent,
  VISION_AND_CURSOR_CAPABILITIES,
} from "./mediaIntent";
import { decideWithheld } from "./watchPrivacyGate";
import type { WatchedApplication } from "./watchTypes";

/**
 * Catalog ids that a capability's `watchedApplicationId` may stand in for.
 *
 * Cursor is a VS Code fork and serves the same bridge, and every browser
 * answers the same navigation capabilities. Written out rather than inferred
 * so adding a browser cannot silently grant it editor capabilities.
 */
const EQUIVALENT: Record<string, readonly string[]> = {
  vscode: ["vscode", "cursor"],
  spotify: ["spotify"],
  discord: ["discord"],
};

const BROWSER_IDS = ["chrome", "edge", "firefox", "brave"] as const;

/** Capabilities that serve any watched browser rather than one named app. */
const BROWSER_CAPABILITIES = new Set([
  "browser.get_page_context",
  "browser.navigate",
]);

/** Capabilities that serve any watched instance at all. */
const ANY_WATCHED_CAPABILITIES = new Set([
  "applications.focus_watched",
  "applications.get_window_context",
]);

/** Is this application live enough to act on? */
function isLive(application: WatchedApplication): boolean {
  return (
    (application.state === "watching" || application.state === "stale") &&
    application.instances.length > 0
  );
}

/**
 * Whether the privacy policy permits this capability at all.
 *
 * A capability whose permission the user has withheld must not appear in the
 * tool list. Refusing it at call time would be safe, but it would also mean the
 * model routinely proposes actions the user has already declined.
 */
function permissionSatisfied(
  capability: CapabilityDefinition,
  application: WatchedApplication,
): boolean {
  if (!capability.requiredPermissions.includes("watch.messageContent")) return true;
  return application.privacyPolicy.messageContent;
}

/**
 * The watched-application capabilities on offer right now.
 *
 * Returns only the `watched-app` category. Callers concatenate this with the
 * ordinary capability list; nothing here removes a general capability, because
 * "what apps are running?" must still be answerable with nothing watched.
 */
export function capabilitiesForWatchContext(
  watched: WatchedApplication[],
): CapabilityDefinition[] {
  const live = watched.filter(isLive);
  if (live.length === 0) return [];

  const liveIds = new Set(live.map((w) => w.appCatalogId));
  const byId = new Map(live.map((w) => [w.appCatalogId, w]));
  const anyBrowserWatched = BROWSER_IDS.some((id) => liveIds.has(id));

  return CAPABILITY_REGISTRY.filter((capability) => {
    if (capability.category !== "watched-app") return false;
    if (capability.availability !== "available") return false;

    if (ANY_WATCHED_CAPABILITIES.has(capability.id)) return true;

    if (BROWSER_CAPABILITIES.has(capability.id)) {
      // A tab destination (YouTube) is shown *by* a browser window, so watching
      // it is watching a browser for navigation purposes.
      return (
        anyBrowserWatched ||
        live.some((w) => w.instances.some((i) => BROWSER_IDS.some((b) => i.executableName.toLowerCase().includes(b))))
      );
    }

    const required = capability.watchedApplicationId;
    if (!required) return false;

    const accepted = EQUIVALENT[required] ?? [required];
    const match = accepted.map((id) => byId.get(id)).find(Boolean);
    if (!match) return false;
    return permissionSatisfied(capability, match);
  });
}

/**
 * Why a watched-application capability is not on offer.
 *
 * "There is no such tool" is the wrong answer when the tool exists and the
 * application is simply closed — that is exactly the case where the user wants
 * to be offered "want me to open it?".
 */
export function explainWatchUnavailable(
  capabilityId: string,
  watched: WatchedApplication[],
): string | null {
  const capability = CAPABILITY_REGISTRY.find((c) => c.id === capabilityId);
  if (!capability || capability.category !== "watched-app") return null;

  const required = capability.watchedApplicationId;
  if (!required) return null;

  const accepted = EQUIVALENT[required] ?? [required];
  const entry = watched.find((w) => accepted.includes(w.appCatalogId));
  if (!entry) {
    return `${required} isn't being watched, so I don't have controls for it. Add it under Running apps and I will.`;
  }
  if (entry.state === "app-closed" || entry.instances.length === 0) {
    return `${entry.displayName} is watched but isn't running right now. Want me to open it?`;
  }
  if (entry.state === "paused") {
    return `Watching is paused for ${entry.displayName}.`;
  }
  if (!permissionSatisfied(capability, entry)) {
    return `Reading ${entry.displayName} message content is turned off in its privacy settings.`;
  }
  return null;
}

/**
 * Narrow an offered capability list for one Watch-scoped turn.
 *
 * Two different jobs, and it is worth being explicit about which is which,
 * because conflating them would either leak or over-restrict:
 *
 *  - **Privacy (hard).** Capabilities that read ambient machine state —
 *    `system.get_active_window`, `windows.list`, `screen.capture` — are removed.
 *    They are the actual route by which an unwatched Chrome window reaches the
 *    model: the watch block never carried Chrome, but a tool that returns every
 *    window title does. This is not negotiable and is not about relevance.
 *
 *  - **Scope (soft).** The rest of ArcSonare stays available. "Watch VS Code,
 *    then make me a task about this bug" is a legitimate request, and removing
 *    `tasks.create` would break it to fix a problem that is really about the
 *    *answer*. Keeping the assistant from reciting its global feature list is
 *    the prompt's job and the response guard's job, not the tool list's.
 */
export function narrowForWatchScope(
  offered: CapabilityDefinition[],
  input: { watchScoped: boolean; requestText: string; scopeCapabilityIds: string[] },
): { capabilities: CapabilityDefinition[]; withheld: string[]; reason: string | null } {
  const decision = decideWithheld({
    watchScoped: input.watchScoped,
    requestText: input.requestText,
    offered,
  });

  const removed = new Set(decision.withheld);
  let reason = decision.reason;

  // A media transport command needs no pixels. Removing the vision and cursor
  // tools for the turn is the only reliable way to keep them out of it — the
  // model was *told* to use the media capability and reached for
  // `screen.click_target` anyway, because it was there. An instruction not to
  // use a visible tool is a suggestion; not offering it is a guarantee.
  if (input.watchScoped && parseMediaIntent(input.requestText) !== null) {
    for (const capability of offered) {
      if (VISION_AND_CURSOR_CAPABILITIES.has(capability.id)) {
        removed.add(capability.id);
      }
    }
    reason =
      "This is a media transport command. It is performed through the media " +
      "session, so screen capture, visual targeting and cursor control are not " +
      "available for it.";
  }

  if (removed.size === 0) {
    return { capabilities: offered, withheld: [], reason };
  }
  return {
    capabilities: offered.filter((c) => !removed.has(c.id)),
    withheld: [...removed],
    reason,
  };
}

/**
 * The instance a capability call should carry, for one application.
 *
 * Returns null when the choice is ambiguous — the caller must ask rather than
 * fill in an instance key and hope.
 */
export function instanceKeyFor(
  application: WatchedApplication,
): string | null {
  if (application.preferredInstanceKey) {
    const pinned = application.instances.find(
      (i) => i.instanceKey === application.preferredInstanceKey,
    );
    if (pinned) return pinned.instanceKey;
  }
  if (application.instances.length === 1) return application.instances[0].instanceKey;
  return null;
}
