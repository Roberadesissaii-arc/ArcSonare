/**
 * The hard privacy rule for unwatched applications.
 *
 * A detected-but-unwatched application may contribute exactly two things:
 * its identity in the Running Apps inventory, and whether it is running.
 * Nothing else — not the window title, not a path, not a page title, not a URL,
 * not visible text, not an accessibility tree, not a screenshot.
 *
 * The leak vector is not the watch block, which already carries only watched
 * applications. It is the *global* capabilities that read ambient machine
 * state: `system.get_active_window` returns whatever window is focused,
 * `windows.list` returns every title on the machine, and `screen.capture`
 * returns all of it as pixels. A Discord-scoped conversation offered those
 * tools can reach Chrome's title in one call, and the model will, because the
 * user asked a question and those were the tools it had.
 *
 * So in Watch mode they are withheld, and the model is told why.
 */
import type { CapabilityDefinition } from "../capabilities/capabilityTypes";

/**
 * Capabilities that can return content belonging to an application the user
 * has not watched.
 *
 * Hand-maintained, and deliberately so: this is a judgement about what a tool
 * can *reach*, which cannot be derived from its category or its risk level.
 * `check-watch-privacy` asserts that every capability able to name a window is
 * either listed here or explicitly justified.
 */
export const AMBIENT_READ_CAPABILITIES: ReadonlySet<string> = new Set([
  // Returns the focused window — which is frequently not the watched one.
  "system.get_active_window",
  // Returns every window title on the machine.
  "windows.list",
  "windows.get_active",
  // Returns every process with a window, and their titles.
  "system.get_running_processes",
  // Pixels. Everything visible, watched or not.
  "screen.capture",
  "screen.record",
  "screen.list_capture_targets",
  // Acts on any window by id, including one belonging to an unwatched app.
  "windows.focus",
  "windows.minimize",
  "windows.maximize",
  "windows.restore",
  "windows.move_resize",
  "windows.close",
  // Resolves and acts on any installed application by name, bypassing scope.
  "applications.focus",
  "applications.close",
]);

/**
 * Phrases that mean "tell me about everything running", which is the one case
 * where the inventory is the answer the user asked for.
 *
 * Narrow on purpose. "What's open?" is an inventory question; "what can you
 * do?" is not, and treating the second as the first is how the global feature
 * list came back.
 */
const INVENTORY_PATTERN =
  /\b(?:what(?:'s| is| are)?\s+(?:all\s+)?(?:apps?|applications?|programs?|windows?|processes?)\s+(?:are\s+)?(?:open|running)|what\s+(?:do\s+)?i\s+have\s+open|list\s+(?:my\s+)?(?:open\s+)?(?:apps?|applications?|windows?)|which\s+apps?\s+(?:are\s+)?(?:open|running)|everything\s+(?:that'?s\s+)?running)\b/i;

export function isInventoryRequest(text: string): boolean {
  return INVENTORY_PATTERN.test(text.trim());
}

/**
 * An explicit reference to an application by name.
 *
 * An unwatched application the user *names* may be discussed — they asked. This
 * matches only whole words so "chrome" in "chromebook" does not count.
 */
export function namesApplication(text: string, appCatalogId: string): boolean {
  const words = appCatalogId.replace(/-/g, " ").trim();
  if (!words) return false;
  return new RegExp(`\\b${words.replace(/\s+/g, "\\s+")}\\b`, "i").test(text);
}

export interface PrivacyDecision {
  /** Capabilities withheld for this turn, and why. */
  withheld: string[];
  reason: string | null;
}

/**
 * Decide which capabilities to withhold for one Watch-scoped turn.
 *
 * Returns nothing to withhold when the conversation is not watch-scoped —
 * global behaviour is correct there — or when the user explicitly asked for the
 * inventory.
 */
export function decideWithheld(input: {
  watchScoped: boolean;
  requestText: string;
  offered: CapabilityDefinition[];
}): PrivacyDecision {
  if (!input.watchScoped) return { withheld: [], reason: null };
  if (isInventoryRequest(input.requestText)) {
    return { withheld: [], reason: null };
  }
  const withheld = input.offered
    .map((c) => c.id)
    .filter((id) => AMBIENT_READ_CAPABILITIES.has(id));
  return {
    withheld,
    reason: withheld.length
      ? "This conversation is scoped to watched applications, so tools that read " +
        "arbitrary windows or the whole screen are not available for it."
      : null,
  };
}

/**
 * What an unwatched application is allowed to contribute, ever.
 *
 * Returned as a whitelist rather than applied as a filter so a caller cannot
 * accidentally pass through a field that was simply not thought about.
 */
export interface InventoryEntry {
  appCatalogId: string;
  displayName: string;
  running: boolean;
}

/**
 * Reduce a running instance to the two facts an unwatched application may
 * contribute. Everything else is dropped here, at the boundary.
 */
export function inventoryEntry(input: {
  appCatalogId: string;
  displayName: string;
  running: boolean;
}): InventoryEntry {
  return {
    appCatalogId: input.appCatalogId,
    displayName: input.displayName,
    running: input.running,
  };
}

/** Fields an unwatched application must never contribute. Asserted by tests. */
export const FORBIDDEN_UNWATCHED_FIELDS = [
  "windowTitle",
  "executablePath",
  "pageIdentity",
  "url",
  "visibleText",
  "uiAutomation",
  "screenshot",
  "documentContent",
  "terminalOutput",
  "sourceCode",
  "workspaceIdentity",
] as const;
