/**
 * The small round source mark in a reply's footer.
 *
 * Two rules, both learned from getting them wrong:
 *
 *   1. **An app or service uses the icon the Connect page uses.** Those are the
 *      logos the user already recognises from their own integrations list, and
 *      having chat show a different mark for the same service is the kind of
 *      inconsistency that reads as a bug even when nothing is broken.
 *   2. **A generic concept never looks up an app icon.** "folder" used to match
 *      the overlay pack's File Explorer entry (its aliases include "folder"),
 *      so "Folder read" rendered a Windows Explorer logo squeezed into a circle
 *      it did not fit. Concepts are drawn glyphs, and they never touch the
 *      image path at all.
 *
 * Everything is bundled — nothing is fetched at render time. A chat footer that
 * reaches the network to draw a logo is a tracking surface, and it fails
 * silently offline, which is when a desktop app most needs to work.
 */

import { Folder, Globe, ListChecks, Link2, MonitorCog } from "lucide-react";
import {
  desktopAppIcons,
  integrationIcons,
  FRAMED_INTEGRATION_IDS,
  type DesktopAppIconId,
} from "../../config/iconRegistry";
import { resolveServiceId } from "../../features/capabilities/connectionStatus";
import { TOP_OVERLAY_ICONS } from "../../config/topOverlayIconRegistry";
import { appIconUrl } from "../../config/appIconLibrary";

/** Keys that describe a kind of thing, not a product. Always drawn. */
const GLYPH_KEYS = new Set(["folder", "task", "connection", "browser", "system"]);

/** Apps with an icon in the shared asset folder but no Connect integration. */
const DESKTOP_APP_ALIASES: Record<string, DesktopAppIconId> = {
  chrome: "chrome",
  "google chrome": "chrome",
  firefox: "firefox",
  "mozilla firefox": "firefox",
  edge: "edge",
  msedge: "edge",
  "microsoft edge": "edge",
  brave: "brave",
  "brave browser": "brave",
  vscode: "vscode",
  "vs code": "vscode",
  code: "vscode",
  "visual studio code": "vscode",
  "google classroom": "googleClassroom",
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResolvedSourceIcon {
  url: string;
  /**
   * True for bare brand marks that ship without their own filled container —
   * the Connect page draws one for these, and so do we, or they float oddly
   * beside logos that already have a background.
   */
  framed: boolean;
}

/**
 * Bundled image for an app/service key, or null when it should be a glyph.
 *
 * Order is deliberate: Connect integrations first, because those are the icons
 * the user sees everywhere else in the app.
 */
export function sourceIconFor(iconKey: string): ResolvedSourceIcon | null {
  const key = normalize(iconKey);
  if (!key || GLYPH_KEYS.has(key)) return null;

  const integration = resolveServiceId(key);
  if (integration && integrationIcons[integration]) {
    return {
      url: integrationIcons[integration],
      framed: FRAMED_INTEGRATION_IDS.has(integration),
    };
  }

  const desktop = DESKTOP_APP_ALIASES[key];
  if (desktop) return { url: desktopAppIcons[desktop], framed: false };

  const overlay = TOP_OVERLAY_ICONS.find(
    (entry) =>
      normalize(entry.id) === key ||
      normalize(entry.displayName) === key ||
      entry.aliases.some((a) => normalize(a) === key),
  );
  if (overlay?.iconPath) return { url: overlay.iconPath, framed: false };

  // The long tail: After Effects, Blender, Steam, DaVinci Resolve — anything
  // the user might open that nobody curated a mark for.
  const library = appIconUrl(key);
  return library ? { url: library, framed: false } : null;
}

function Glyph({ iconKey, size }: { iconKey: string; size: number }) {
  switch (iconKey) {
    case "folder":
      return <Folder size={size} strokeWidth={2} />;
    case "task":
      return <ListChecks size={size} strokeWidth={2} />;
    case "connection":
      return <Link2 size={size} strokeWidth={2} />;
    case "browser":
      return <Globe size={size} strokeWidth={2} />;
    default:
      return <MonitorCog size={size} strokeWidth={2} />;
  }
}

export function SourceIcon({ iconKey }: { iconKey: string }) {
  const icon = sourceIconFor(iconKey);
  if (!icon) {
    return (
      <span className="chat-source-icon is-glyph" aria-hidden="true">
        <Glyph iconKey={normalize(iconKey)} size={11} />
      </span>
    );
  }
  return (
    <span
      className={`chat-source-icon${icon.framed ? " is-framed" : ""}`}
      aria-hidden="true"
    >
      <img src={icon.url} alt="" draggable={false} />
    </span>
  );
}
