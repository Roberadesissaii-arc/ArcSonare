/**
 * Curated “context apps” ArcSonare cares about on the dashboard.
 * Detection uses real process names + open window titles (e.g. YouTube in Chrome).
 * Icons: Connect pack first, then desktop ICO imports, then overlay fallback.
 */
import { getIconById } from "../../config/topOverlayIconRegistry";
import {
  desktopAppIcons,
  integrationIcons,
  type DesktopAppIconId,
  type IntegrationId,
} from "../../config/iconRegistry";

export type ContextKind =
  | "meeting"
  | "lecture"
  | "browser"
  | "media"
  | "communication"
  | "productivity"
  | "development"
  | "other";

export interface ContextAppDef {
  id: string;
  displayName: string;
  /** Executable basenames (case-insensitive, with or without .exe). */
  processNames: string[];
  /** Substrings matched against open window titles (case-insensitive). */
  titleHints?: string[];
  /** Only count as open when a title hint also matches (web destinations). */
  requireTitleHint?: boolean;
  kind: ContextKind;
  /** Short label for future AI context (“in a meeting”, “watching lecture”). */
  contextHint: string;
  /** Prefer Connect integration icon (same pack as Connected Tools). */
  integrationIconId?: IntegrationId;
  /** Desktop/browser icons from the ICO pack (chrome, vscode, …). */
  desktopIconId?: DesktopAppIconId;
  /** Overlay fallback when there is no Connect / desktop icon. */
  overlayIconId?: string;
  /** Sort priority (lower = higher in list). */
  priority: number;
}

/**
 * Useful apps for students / knowledge work — meetings, lectures, browsers,
 * code, notes. Not every installed process.
 */
export const CONTEXT_APP_CATALOG: ContextAppDef[] = [
  {
    id: "zoom",
    displayName: "Zoom",
    processNames: ["zoom", "zoom.exe", "cpthost", "cpthost.exe", "zoomus"],
    titleHints: ["zoom meeting", "zoom webinar"],
    kind: "meeting",
    contextHint: "Meeting audio can be summarized when watching is on",
    integrationIconId: "zoom",
    priority: 10,
  },
  {
    id: "teams",
    displayName: "Microsoft Teams",
    processNames: [
      "ms-teams",
      "ms-teams.exe",
      "teams",
      "teams.exe",
      "msteams",
      "msteams.exe",
    ],
    titleHints: ["microsoft teams", "| microsoft teams"],
    kind: "meeting",
    contextHint: "Calls and chats — watch to capture context",
    integrationIconId: "teams",
    priority: 11,
  },
  {
    id: "google-meet",
    displayName: "Google Meet",
    processNames: ["chrome", "msedge", "firefox", "brave", "opera"],
    titleHints: ["meet -", "google meet", "meet.google.com"],
    requireTitleHint: true,
    kind: "meeting",
    contextHint: "Browser meeting tab open",
    integrationIconId: "googleMeet",
    priority: 12,
  },
  {
    id: "discord",
    displayName: "Discord",
    processNames: ["discord", "discord.exe"],
    titleHints: ["discord"],
    kind: "communication",
    contextHint: "Voice or chat session open",
    integrationIconId: "discord",
    priority: 20,
  },
  {
    id: "slack",
    displayName: "Slack",
    processNames: ["slack", "slack.exe"],
    titleHints: ["slack"],
    kind: "communication",
    contextHint: "Team channels and threads open",
    integrationIconId: "slack",
    priority: 21,
  },
  {
    id: "youtube",
    displayName: "YouTube",
    processNames: ["chrome", "msedge", "firefox", "brave", "opera", "youtube"],
    titleHints: ["youtube", " - youtube"],
    requireTitleHint: true,
    kind: "media",
    contextHint: "Video open in the browser",
    integrationIconId: "youtube",
    priority: 30,
  },
  {
    id: "amazon",
    displayName: "Amazon",
    processNames: ["chrome", "msedge", "firefox", "brave", "opera"],
    titleHints: ["amazon.com", "amazon.co", " - amazon", "| amazon"],
    requireTitleHint: true,
    kind: "other",
    contextHint: "Shopping page open in the browser",
    priority: 32,
  },
  {
    id: "netflix",
    displayName: "Netflix",
    processNames: ["chrome", "msedge", "firefox", "brave", "opera"],
    titleHints: ["netflix"],
    requireTitleHint: true,
    kind: "media",
    contextHint: "Streaming in the browser",
    overlayIconId: "netflix",
    priority: 31,
  },
  {
    id: "spotify",
    displayName: "Spotify",
    processNames: ["spotify", "spotify.exe"],
    titleHints: ["spotify"],
    kind: "media",
    contextHint: "Music is playing",
    integrationIconId: "spotify",
    priority: 40,
  },
  {
    id: "chrome",
    displayName: "Chrome",
    processNames: ["chrome", "chrome.exe"],
    kind: "browser",
    contextHint: "Browser is running",
    desktopIconId: "chrome",
    priority: 50,
  },
  {
    id: "edge",
    displayName: "Edge",
    processNames: ["msedge", "msedge.exe", "msedgewebview2"],
    kind: "browser",
    contextHint: "Browser is running",
    desktopIconId: "edge",
    priority: 51,
  },
  {
    id: "firefox",
    displayName: "Firefox",
    processNames: ["firefox", "firefox.exe"],
    kind: "browser",
    contextHint: "Browser is running",
    desktopIconId: "firefox",
    priority: 52,
  },
  {
    id: "brave",
    displayName: "Brave",
    processNames: ["brave", "brave.exe"],
    kind: "browser",
    contextHint: "Browser is running",
    desktopIconId: "brave",
    priority: 53,
  },
  {
    id: "vscode",
    displayName: "VS Code",
    processNames: ["code", "code.exe"],
    titleHints: ["visual studio code", " - visual studio code"],
    kind: "development",
    contextHint: "Editor open — watch to understand your project",
    desktopIconId: "vscode",
    priority: 25,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    processNames: ["cursor", "cursor.exe"],
    titleHints: ["cursor"],
    kind: "development",
    contextHint: "Editor open — watch to understand your project",
    desktopIconId: "vscode",
    priority: 24,
  },
  {
    id: "google-classroom",
    displayName: "Classroom",
    processNames: ["chrome", "msedge", "firefox", "brave", "opera"],
    titleHints: ["google classroom", "classroom.google"],
    requireTitleHint: true,
    kind: "lecture",
    contextHint: "Class work open in the browser",
    desktopIconId: "googleClassroom",
    priority: 14,
  },
  {
    id: "notion",
    displayName: "Notion",
    processNames: ["notion", "notion.exe"],
    titleHints: ["notion"],
    kind: "productivity",
    contextHint: "Notes workspace open",
    integrationIconId: "notion",
    priority: 28,
  },
  {
    id: "outlook",
    displayName: "Outlook",
    processNames: ["outlook", "outlook.exe", "olk", "olk.exe"],
    titleHints: ["outlook", "inbox"],
    kind: "communication",
    contextHint: "Mail and calendar open",
    integrationIconId: "outlook",
    priority: 22,
  },
  {
    id: "figma",
    displayName: "Figma",
    processNames: ["figma", "figma.exe"],
    titleHints: ["figma"],
    kind: "productivity",
    contextHint: "Design file open",
    integrationIconId: "figma",
    priority: 35,
  },
  {
    id: "onenote",
    displayName: "OneNote",
    processNames: ["onenote", "onenote.exe", "onenotem"],
    titleHints: ["onenote"],
    kind: "lecture",
    contextHint: "Lecture notes open",
    integrationIconId: "onenote",
    priority: 27,
  },
  {
    id: "udemy",
    displayName: "Udemy",
    processNames: ["chrome", "msedge", "firefox", "brave", "opera"],
    titleHints: ["udemy", " | udemy"],
    requireTitleHint: true,
    kind: "lecture",
    contextHint: "Course video open in the browser",
    overlayIconId: "udemy-light",
    priority: 16,
  },
];

/** Connect icons → desktop ICO pack → overlay fallback. */
export function resolveContextAppIcon(def: ContextAppDef): string | undefined {
  if (def.integrationIconId && integrationIcons[def.integrationIconId]) {
    return integrationIcons[def.integrationIconId];
  }
  if (def.desktopIconId && desktopAppIcons[def.desktopIconId]) {
    return desktopAppIcons[def.desktopIconId];
  }
  if (def.overlayIconId) {
    const fromOverlay = getIconById(def.overlayIconId)?.iconPath;
    if (fromOverlay) return fromOverlay;
  }
  return undefined;
}

export function kindLabel(kind: ContextKind): string {
  switch (kind) {
    case "meeting":
      return "Meeting";
    case "lecture":
      return "Learning";
    case "browser":
      return "Browser";
    case "media":
      return "Media";
    case "communication":
      return "Chat";
    case "productivity":
      return "Work";
    case "development":
      return "Code";
    default:
      return "Open";
  }
}
