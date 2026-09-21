/**
 * Session focus for deictic follow-ups: “that app”, “screenshot it”,
 * “close that”. Prefer: last opened/focused app → first watched app.
 */

import { liveWatchedApplications } from "../watch/watchStore";
import { CONTEXT_APP_CATALOG } from "../dashboard/contextAppCatalog";

let lastAppName: string | null = null;
let lastAppAt = 0;
const TTL_MS = 45 * 60 * 1000;

export function rememberFocusedApp(name: string | undefined | null): void {
  const n = name?.trim();
  if (!n) return;
  lastAppName = n;
  lastAppAt = Date.now();
}

export function getLastFocusedApp(): string | null {
  if (!lastAppName) return null;
  if (Date.now() - lastAppAt > TTL_MS) {
    lastAppName = null;
    return null;
  }
  return lastAppName;
}

/** Resolve “that / this / it” to a concrete app or site name. */
export function resolveDeicticApp(
  phrase: string | undefined | null,
): string | null {
  const raw = (phrase ?? "").trim().toLowerCase();
  const deictic =
    !raw ||
    /^(that|this|it|the app|that app|this app|the application|that application|this application|the window|that window|this window|the browser|that browser)$/i.test(
      raw,
    );
  if (!deictic) {
    // Still strip "the" for normal names
    return phrase?.trim() || null;
  }

  const last = getLastFocusedApp();
  if (last) return last;

  // Fall back to a watched application (user chose Edge, Spotify, …).
  //
  // Read from the Rust-owned snapshot rather than the retired localStorage set:
  // this runs in whichever window is handling the request, and only the shared
  // store is the same in both.
  const watched = liveWatchedApplications();
  if (watched.length > 0) {
    const first = watched[0];
    const def = CONTEXT_APP_CATALOG.find((d) => d.id === first.appCatalogId);
    return def?.displayName ?? first.displayName;
  }

  return null;
}

export function clearFocusContext(): void {
  lastAppName = null;
  lastAppAt = 0;
}
