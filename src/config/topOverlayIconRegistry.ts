/**
 * Top-overlay icon registry. Icons live in src/assets/top-overlay/ (copied
 * from the dedicated top_overlay library). Runtime paths are Vite-bundled
 * relative URLs — never absolute filesystem paths.
 */

export type TopOverlayIconType =
  | "desktop-app"
  | "web-app"
  | "integration"
  | "system-action"
  | "file-type"
  | "service";

export type TopOverlayIconDefinition = {
  id: string;
  displayName: string;
  aliases: string[];
  /** Vite-resolved asset URL (relative import). */
  iconPath: string;
  type: TopOverlayIconType;
  desktopExecutable?: string;
  webUrl?: string;
  integrationId?: string;
  canOpenDesktop: boolean;
  canOpenWeb: boolean;
  supportsApiAction: boolean;
};

const iconModules = import.meta.glob("../assets/top-overlay/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function iconUrl(filename: string): string {
  const key = `../assets/top-overlay/${filename}`;
  const url = iconModules[key];
  if (!url) {
    console.warn(`[ArcSonare] missing top-overlay icon: ${filename}`);
    return "";
  }
  return url;
}

function def(
  partial: Omit<TopOverlayIconDefinition, "iconPath"> & { iconFile: string },
): TopOverlayIconDefinition {
  const { iconFile, ...rest } = partial;
  return { ...rest, iconPath: iconUrl(iconFile) };
}

/** Curated registry of applications / actions used by the overlay. */
export const TOP_OVERLAY_ICONS: TopOverlayIconDefinition[] = [
  def({
    id: "gmail",
    displayName: "Gmail",
    // Keep “email”/“mail” out of open-aliases — those mean draft-email intents.
    aliases: ["gmail", "google mail", "googlemail", "my email", "my gmail"],
    iconFile: "gmail.svg",
    type: "web-app",
    webUrl: "https://mail.google.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: true,
    integrationId: "gmail",
  }),
  def({
    id: "spotify",
    displayName: "Spotify",
    aliases: ["spotify", "spotify app", "music", "play music"],
    iconFile: "spotify.svg",
    type: "desktop-app",
    desktopExecutable: "Spotify.exe",
    webUrl: "https://open.spotify.com",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "youtube",
    displayName: "YouTube",
    aliases: ["youtube", "youtube website", "yt", "video site", "open a video site"],
    iconFile: "youtube.svg",
    type: "web-app",
    webUrl: "https://www.youtube.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "slack",
    displayName: "Slack",
    aliases: ["slack", "slack app"],
    iconFile: "slack.svg",
    type: "desktop-app",
    webUrl: "https://app.slack.com",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: true,
    integrationId: "slack",
  }),
  def({
    id: "notion",
    displayName: "Notion",
    aliases: ["notion", "notion app"],
    iconFile: "notion-light.svg",
    type: "desktop-app",
    webUrl: "https://www.notion.so",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "vscode",
    displayName: "VS Code",
    aliases: ["vscode", "vs code", "visual studio code", "code"],
    iconFile: "vscode.svg",
    type: "desktop-app",
    webUrl: "https://vscode.dev",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "cursor",
    displayName: "Cursor",
    aliases: ["cursor", "cursor ide", "cursor editor"],
    iconFile: "cursor.svg",
    type: "desktop-app",
    canOpenDesktop: true,
    canOpenWeb: false,
    supportsApiAction: false,
  }),
  def({
    id: "adobe-creative-cloud",
    displayName: "Adobe Creative Cloud",
    aliases: [
      "adobe creative cloud",
      "adobe cloud",
      "creative cloud",
      "adobe",
      "adobe cc",
    ],
    iconFile: "adobe.svg",
    type: "desktop-app",
    webUrl: "https://www.adobe.com/creativecloud.html",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "google-calendar",
    displayName: "Google Calendar",
    aliases: ["google calendar", "calendar", "my schedule", "schedule", "gcal"],
    iconFile: "google-calendar.svg",
    type: "web-app",
    webUrl: "https://calendar.google.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: true,
    integrationId: "google-calendar",
  }),
  def({
    id: "google-meet",
    displayName: "Google Meet",
    aliases: ["google meet", "meet", "video call"],
    iconFile: "google-meet.svg",
    type: "web-app",
    webUrl: "https://meet.google.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "chrome",
    displayName: "Google Chrome",
    aliases: ["chrome", "google chrome", "browser"],
    iconFile: "chrome.svg",
    type: "desktop-app",
    webUrl: "https://www.google.com",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "discord",
    displayName: "Discord",
    aliases: ["discord"],
    iconFile: "discord.svg",
    type: "desktop-app",
    webUrl: "https://discord.com/app",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "github",
    displayName: "GitHub",
    aliases: ["github", "git hub"],
    iconFile: "github.svg",
    type: "web-app",
    webUrl: "https://github.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "zoom",
    displayName: "Zoom",
    aliases: ["zoom", "zoom meeting"],
    iconFile: "zoom.svg",
    type: "desktop-app",
    webUrl: "https://zoom.us/start",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "figma",
    displayName: "Figma",
    aliases: ["figma"],
    iconFile: "figma.svg",
    type: "desktop-app",
    webUrl: "https://www.figma.com",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "edge",
    displayName: "Microsoft Edge",
    aliases: ["edge", "microsoft edge"],
    iconFile: "edge.svg",
    type: "desktop-app",
    canOpenDesktop: true,
    canOpenWeb: false,
    supportsApiAction: false,
  }),
  def({
    id: "outlook",
    displayName: "Outlook",
    aliases: ["outlook", "microsoft outlook", "outlook mail"],
    iconFile: "microsoft-outlook.svg",
    type: "desktop-app",
    webUrl: "https://outlook.live.com/mail",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: true,
    integrationId: "outlook",
  }),
  def({
    id: "microsoft-bing",
    displayName: "Bing",
    aliases: ["bing", "microsoft bing", "search the web", "web search", "search"],
    iconFile: "microsoft-bing.svg",
    type: "web-app",
    webUrl: "https://www.bing.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "windows-explorer",
    displayName: "File Explorer",
    aliases: ["file explorer", "explorer", "files", "folder"],
    iconFile: "windows-explorer.svg",
    type: "system-action",
    canOpenDesktop: true,
    canOpenWeb: false,
    supportsApiAction: false,
  }),
  def({
    id: "claude-ai",
    displayName: "Claude",
    aliases: ["claude", "claude ai", "anthropic"],
    iconFile: "claude-ai.svg",
    type: "web-app",
    webUrl: "https://claude.ai",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "google-gemini",
    displayName: "Gemini",
    aliases: ["gemini", "google gemini"],
    iconFile: "google-gemini.svg",
    type: "web-app",
    webUrl: "https://gemini.google.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "openai",
    displayName: "ChatGPT",
    aliases: ["chatgpt", "openai", "gpt"],
    iconFile: "openai.svg",
    type: "web-app",
    webUrl: "https://chatgpt.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "docker-engine",
    displayName: "Docker",
    aliases: ["docker", "docker desktop"],
    iconFile: "docker-engine.svg",
    type: "desktop-app",
    canOpenDesktop: true,
    canOpenWeb: false,
    supportsApiAction: false,
  }),
  def({
    id: "postman",
    displayName: "Postman",
    aliases: ["postman"],
    iconFile: "postman.svg",
    type: "desktop-app",
    canOpenDesktop: true,
    canOpenWeb: true,
    webUrl: "https://www.postman.com",
    supportsApiAction: false,
  }),
  def({
    id: "telegram",
    displayName: "Telegram",
    aliases: ["telegram"],
    iconFile: "telegram.svg",
    type: "desktop-app",
    webUrl: "https://web.telegram.org",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "whatsapp",
    displayName: "WhatsApp",
    aliases: ["whatsapp", "whats app"],
    iconFile: "whatsapp.svg",
    type: "web-app",
    webUrl: "https://web.whatsapp.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "twitch",
    displayName: "Twitch",
    aliases: ["twitch"],
    iconFile: "twitch.svg",
    type: "web-app",
    webUrl: "https://www.twitch.tv",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "netflix",
    displayName: "Netflix",
    aliases: ["netflix"],
    iconFile: "netflix.svg",
    type: "web-app",
    webUrl: "https://www.netflix.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "dropbox",
    displayName: "Dropbox",
    aliases: ["dropbox"],
    iconFile: "dropbox.svg",
    type: "desktop-app",
    webUrl: "https://www.dropbox.com",
    canOpenDesktop: true,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
  def({
    id: "google-drive",
    displayName: "Google Drive",
    aliases: ["google drive", "drive", "gdrive"],
    iconFile: "google-drive.svg",
    type: "web-app",
    webUrl: "https://drive.google.com",
    canOpenDesktop: false,
    canOpenWeb: true,
    supportsApiAction: false,
  }),
];

/** System-action icons that are not third-party apps. */
export const SYSTEM_OVERLAY_ICONS = {
  task: null as string | null,
  screenContext: null as string | null,
  search: iconUrl("microsoft-bing.svg") || iconUrl("chrome.svg"),
  check: null as string | null,
  error: null as string | null,
};

export function getIconById(id: string): TopOverlayIconDefinition | undefined {
  return TOP_OVERLAY_ICONS.find((i) => i.id === id);
}

export function getAllIconUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(iconModules)) {
    const name = path.split("/").pop()?.replace(/\.svg$/, "") ?? path;
    out[name] = url;
  }
  return out;
}
