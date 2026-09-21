/**
 * Remembers the last control clicked by vision, so follow-ups like
 * "press it" / "click that again" refer back instead of being sent to the
 * vision model as the literal word "it".
 *
 * After opening a media app (Spotify, YouTube, …), “press it” defaults to the
 * play button for that app.
 *
 * Dependency-free on purpose: the router imports this, and the router must
 * stay importable outside the app (the routing suites run under plain Node,
 * where the app-catalog asset imports cannot load).
 */

const TTL_MS = 45 * 60 * 1000;

/** Phrases that mean "the thing we were just talking about". */
const CLICK_PRONOUNS =
  /^(?:it|that|this|that one|this one|the button|that button|this button|the same|again|it again|that again|play|the play|play button)$/i;

let lastTarget: string | null = null;
let lastAt = 0;
/** Default control after opening an app (e.g. Spotify → play button). */
let appDefaultTarget: string | null = null;
let appDefaultAt = 0;

export function rememberClickTarget(target: string | undefined | null): void {
  const t = target?.trim();
  // Storing a pronoun would make it resolve to itself forever.
  if (!t || CLICK_PRONOUNS.test(t)) return;
  lastTarget = t;
  lastAt = Date.now();
}

/**
 * When an app is opened, set a sensible default for “press it” / “click play”.
 */
export function rememberAppDefaultClick(
  appName: string | undefined | null,
): void {
  const n = (appName ?? "").trim().toLowerCase();
  if (!n) return;
  if (
    /\b(spotify|youtube|netflix|music|media|vlc|movies?|twitch|disney|hulu|prime video)\b/.test(
      n,
    )
  ) {
    appDefaultTarget = "play button";
    appDefaultAt = Date.now();
    // Also seed last click target so “press it” works without a prior click.
    lastTarget = "play button";
    lastAt = Date.now();
    return;
  }
  // Generic desktop apps — “press it” means the primary action if any.
  appDefaultTarget = null;
}

export function getLastClickTarget(): string | null {
  if (!lastTarget) return null;
  if (Date.now() - lastAt > TTL_MS) {
    lastTarget = null;
    return null;
  }
  return lastTarget;
}

function getAppDefaultClick(): string | null {
  if (!appDefaultTarget) return null;
  if (Date.now() - appDefaultAt > TTL_MS) {
    appDefaultTarget = null;
    return null;
  }
  return appDefaultTarget;
}

/**
 * Resolve a spoken click target. A pronoun becomes the previously-clicked
 * control (or the media play button after opening Spotify/YouTube).
 * With nothing to refer back to it returns null so the caller can ask
 * instead of searching the screen for "it".
 */
export function resolveClickTarget(target: string): string | null {
  const t = target.trim();
  if (!t) return null;
  if (!CLICK_PRONOUNS.test(t)) return t;
  return getLastClickTarget() ?? getAppDefaultClick();
}

export function clearClickTarget(): void {
  lastTarget = null;
  lastAt = 0;
  appDefaultTarget = null;
  appDefaultAt = 0;
}
