/**
 * Application registry — launch preferences and fallback order.
 * Desktop resolution is enforced in Rust; this drives UI + intent routing.
 */

export type LaunchFallback = "desktop-then-web" | "web-only" | "desktop-only" | "api-then-web";

export type ApplicationDefinition = {
  id: string;
  displayName: string;
  fallback: LaunchFallback;
  /** Preferred open status text, e.g. "Opening Spotify". */
  openingStatus: string;
  successStatus: string;
};

export const APPLICATION_REGISTRY: ApplicationDefinition[] = [
  {
    id: "spotify",
    displayName: "Spotify",
    fallback: "desktop-then-web",
    openingStatus: "Opening Spotify",
    successStatus: "Spotify opened",
  },
  {
    id: "gmail",
    displayName: "Gmail",
    fallback: "web-only",
    openingStatus: "Opening Gmail",
    successStatus: "Gmail opened",
  },
  {
    id: "youtube",
    displayName: "YouTube",
    fallback: "web-only",
    openingStatus: "Opening YouTube",
    successStatus: "YouTube opened",
  },
  {
    id: "slack",
    displayName: "Slack",
    fallback: "desktop-then-web",
    openingStatus: "Opening Slack",
    successStatus: "Slack opened",
  },
  {
    id: "notion",
    displayName: "Notion",
    fallback: "desktop-then-web",
    openingStatus: "Opening Notion",
    successStatus: "Notion opened",
  },
  {
    id: "vscode",
    displayName: "VS Code",
    fallback: "desktop-then-web",
    openingStatus: "Opening VS Code",
    successStatus: "VS Code opened",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    fallback: "desktop-only",
    openingStatus: "Opening Cursor",
    successStatus: "Cursor opened",
  },
  {
    id: "adobe-creative-cloud",
    displayName: "Adobe Creative Cloud",
    fallback: "desktop-then-web",
    openingStatus: "Opening Adobe Creative Cloud",
    successStatus: "Adobe Creative Cloud opened",
  },
  {
    id: "chrome",
    displayName: "Google Chrome",
    fallback: "desktop-only",
    openingStatus: "Opening Chrome",
    successStatus: "Chrome opened",
  },
  {
    id: "discord",
    displayName: "Discord",
    fallback: "desktop-then-web",
    openingStatus: "Opening Discord",
    successStatus: "Discord opened",
  },
  {
    id: "github",
    displayName: "GitHub",
    fallback: "web-only",
    openingStatus: "Opening GitHub",
    successStatus: "GitHub opened",
  },
  {
    id: "google-calendar",
    displayName: "Google Calendar",
    fallback: "web-only",
    openingStatus: "Opening Google Calendar",
    successStatus: "Google Calendar opened",
  },
  {
    id: "zoom",
    displayName: "Zoom",
    fallback: "desktop-then-web",
    openingStatus: "Opening Zoom",
    successStatus: "Zoom opened",
  },
  {
    id: "figma",
    displayName: "Figma",
    fallback: "desktop-then-web",
    openingStatus: "Opening Figma",
    successStatus: "Figma opened",
  },
  {
    id: "outlook",
    displayName: "Outlook",
    fallback: "desktop-then-web",
    openingStatus: "Opening Outlook",
    successStatus: "Outlook opened",
  },
];

export function getApplication(id: string): ApplicationDefinition | undefined {
  return APPLICATION_REGISTRY.find((a) => a.id === id);
}
