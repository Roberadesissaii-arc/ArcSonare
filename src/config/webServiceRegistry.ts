/**
 * Web-service registry for browser-only destinations and compose URLs.
 */

export type WebServiceDefinition = {
  id: string;
  displayName: string;
  url: string;
  composeUrl?: string;
};

export const WEB_SERVICE_REGISTRY: WebServiceDefinition[] = [
  {
    id: "gmail",
    displayName: "Gmail",
    url: "https://mail.google.com",
    composeUrl: "https://mail.google.com/mail/?view=cm&fs=1",
  },
  {
    id: "youtube",
    displayName: "YouTube",
    url: "https://www.youtube.com",
  },
  {
    id: "github",
    displayName: "GitHub",
    url: "https://github.com",
  },
  {
    id: "google-calendar",
    displayName: "Google Calendar",
    url: "https://calendar.google.com",
  },
  {
    id: "google-meet",
    displayName: "Google Meet",
    url: "https://meet.google.com",
  },
  {
    id: "spotify-web",
    displayName: "Spotify Web",
    url: "https://open.spotify.com",
  },
  {
    id: "notion-web",
    displayName: "Notion",
    url: "https://www.notion.so",
  },
  {
    id: "slack-web",
    displayName: "Slack",
    url: "https://app.slack.com",
  },
  {
    id: "web-search",
    displayName: "Web Search",
    url: "https://www.google.com/search?q=",
  },
];

export function getWebService(id: string): WebServiceDefinition | undefined {
  return WEB_SERVICE_REGISTRY.find((s) => s.id === id);
}
