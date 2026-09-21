/**
 * The bundled application icon library (`src/assets/app-icons`).
 *
 * ~870 application marks, so that when the user says "open After Effects" or
 * "screenshot Blender", the reply can show that app's own icon instead of a
 * generic monitor glyph. Connect integrations still win — those are the logos
 * the user manages themselves — and this is the long tail behind them.
 *
 * Everything is bundled and resolved locally. Nothing is fetched at render
 * time, so a footer icon is never a network request.
 *
 * The matching lives in `appIconMatch` so it can be tested against the real
 * filenames without a bundler.
 */

import { buildAppIconIndex } from "./appIconMatch";

const iconModules = import.meta.glob("../assets/app-icons/*.ico", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const index = buildAppIconIndex(iconModules);

/** Find the bundled icon for an application name, or null when unsure. */
export function appIconUrl(query: string): string | null {
  return index.lookup(query);
}

/** How many marks the library holds — used by the icon-coverage check. */
export function appIconCount(): number {
  return index.size;
}
