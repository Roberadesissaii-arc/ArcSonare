/**
 * Which applications actually contributed to *this* turn.
 *
 * The shipped failure: a "Spotify context" badge sat under replies to "open the
 * nft folder", "tell me what is in that file" and "is this an Expo app?". None
 * of those touched Spotify. The badge was derived from standing state — the
 * active scope, the previous reply's sources, the composer — all of which
 * outlive the turn they described. Provenance has to be built during the turn
 * and read only from that turn, or it is a claim about the past presented as a
 * fact about the present.
 *
 * The ledger is deliberately narrow: it records identities (`spotify`,
 * `discord`), never a track name, a channel or a title. A provenance record that
 * carried content would defeat the privacy gate it sits behind.
 */
import { CAPABILITY_REGISTRY } from "../capabilities/capabilityRegistry";
import { currentScopeVersion, isScopeVersionStale } from "./watchScopeStore";

export interface TurnProvenance {
  turnId: string;
  /** Applications whose context reached the prompt. */
  injected: string[];
  /** Applications whose adapter or capability actually ran. */
  adaptersQueried: string[];
  /** Whether any watched context was used at all. */
  watchContextUsed: boolean;
  /**
   * The active-set generation this turn was opened under.
   *
   * A turn that started with Spotify active and finished after the user
   * switched to Discord describes a scope that no longer exists. Crediting it
   * would put a Spotify badge on an answer the user asked in a Discord
   * context — the same class of mistake as the badge that outlived its turn.
   */
  scopeVersion: number;
}

let current: TurnProvenance | null = null;
let counter = 0;
/**
 * How many turns are open.
 *
 * A turn is not always a single `askAssistant` call: the assistant re-enters
 * itself to style an answer, to summarise, to run a follow-up. Without this,
 * an inner call reset the ledger and the outer call read an empty one — the
 * Spotify reply that genuinely came from Spotify carried no badge at all.
 * Only the outermost turn opens and closes the ledger.
 */
let depth = 0;

/**
 * Open a turn. Everything from the previous one is discarded here, which is the
 * whole point: nothing can be inherited by accident.
 *
 * Re-entrant: a nested call joins the turn already in progress rather than
 * starting a new one.
 */
export function beginWatchTurn(): string {
  depth += 1;
  if (current) return current.turnId;
  counter += 1;
  const turnId = `turn-${counter}`;
  current = {
    turnId,
    injected: [],
    adaptersQueried: [],
    watchContextUsed: false,
    scopeVersion: currentScopeVersion(),
  };
  return turnId;
}

/** The applications the prompt builder decided this turn was about. */
export function recordWatchInjection(applicationIds: readonly string[]): void {
  if (!current) return;
  for (const id of applicationIds) {
    if (!current.injected.includes(id)) current.injected.push(id);
  }
  if (applicationIds.length > 0) current.watchContextUsed = true;
}

/**
 * A watched-application capability ran. Called from the execution path, so a
 * tool the model chose but never invoked contributes nothing.
 */
export function recordCapabilityCall(
  capabilityId: string,
  /**
   * The instance the call addressed, when it named one.
   *
   * Some watched-app capabilities serve a *class* rather than one application —
   * `browser.get_page_context` answers for whichever browser is watched — so
   * the registry cannot name the application and the instance key is the only
   * thing that can. Without this, a real Chrome read was credited to nothing.
   */
  instanceKey?: unknown,
): void {
  if (!current) return;
  const appCatalogId =
    applicationForCapability(capabilityId) ??
    applicationFromInstanceKey(capabilityId, instanceKey);
  if (!appCatalogId) return;
  if (!current.adaptersQueried.includes(appCatalogId)) {
    current.adaptersQueried.push(appCatalogId);
  }
  current.watchContextUsed = true;
}

/**
 * The application an instance key belongs to, for watched-app capabilities only.
 *
 * The category check matters: a filesystem capability that happened to carry a
 * colon-separated argument must not be read as an application read.
 */
function applicationFromInstanceKey(
  capabilityId: string,
  instanceKey: unknown,
): string | null {
  if (typeof instanceKey !== "string" || instanceKey.length === 0) return null;
  const definition = CAPABILITY_REGISTRY.find((c) => c.id === capabilityId);
  if (definition?.category !== "watched-app") return null;
  const appCatalogId = instanceKey.split(":")[0];
  return appCatalogId.length > 0 ? appCatalogId : null;
}

/**
 * The applications this turn may be credited to.
 *
 * A capability call is the strongest evidence — the application was read or
 * acted on. Injection counts too, but only for the applications the relevance
 * gate actually let through: "what can you do?" is answered from the injected
 * ability list with no adapter call, and that answer genuinely came from the
 * application. An unrelated request injects nothing, so it credits nothing.
 */
export function turnContributors(): string[] {
  if (!current) return [];
  // The user changed the active set while this turn was running. What it
  // gathered describes a scope that is no longer current, so it credits
  // nothing rather than crediting the application the user just left.
  if (isScopeVersionStale(current.scopeVersion)) return [];
  return [...new Set([...current.adaptersQueried, ...current.injected])];
}

export function currentTurnProvenance(): TurnProvenance | null {
  return current ? { ...current } : null;
}

/**
 * Close the turn. Nothing survives into the next one.
 *
 * A nested call only decrements: the ledger closes when the outermost turn
 * does, so an inner styling pass cannot end the turn its caller is still in.
 */
export function endWatchTurn(): TurnProvenance | null {
  depth = Math.max(0, depth - 1);
  if (depth > 0) return current;
  const finished = current;
  current = null;
  return finished;
}

/** Test seam: forget any open turn. */
export function resetWatchProvenance(): void {
  current = null;
  depth = 0;
}

/**
 * Which application a capability belongs to.
 *
 * Read from the registry's own `watchedApplicationId` rather than the id's
 * prefix, so a capability that is renamed cannot quietly stop being attributed.
 * Capabilities that serve *any* watched instance — focus, window context —
 * name no application and credit none: they are how ArcSonare acts on a window,
 * not evidence that a particular application informed the answer.
 */
export function applicationForCapability(capabilityId: string): string | null {
  const definition = CAPABILITY_REGISTRY.find((c) => c.id === capabilityId);
  if (!definition) return null;
  if (definition.category !== "watched-app") return null;
  return definition.watchedApplicationId ?? null;
}
