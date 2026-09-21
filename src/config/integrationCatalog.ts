import type { IntegrationId } from "./iconRegistry";

export type IntegrationCredentialField = {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
  optional?: boolean;
  multiline?: boolean;
};

export type IntegrationCredentialSpec = {
  fields: IntegrationCredentialField[];
  docsUrl?: string;
  note?: string;
};

const password = (
  key: string,
  label: string,
  placeholder: string,
  optional = false,
): IntegrationCredentialField => ({
  key,
  label,
  placeholder,
  type: "password",
  optional,
});

export const CREDENTIAL_INTEGRATIONS: Partial<
  Record<IntegrationId, IntegrationCredentialSpec>
> = {
  gmail: {
    fields: [
      {
        key: "user",
        label: "Gmail address",
        placeholder: "you@gmail.com",
      },
      password(
        "password",
        "App Password",
        "16-character App Password (Google Account → Security)",
      ),
      {
        key: "clientId",
        label: "OAuth Client ID",
        placeholder: "Optional OAuth Client ID (from Google Cloud)",
        optional: true,
      },
    ],
    docsUrl: "https://myaccount.google.com/apppasswords",
    note: "Use a 16-character App Password generated from your Google Account Security settings.",
  },
  bitbucket: {
    fields: [
      {
        key: "username",
        label: "Atlassian account email",
        placeholder: "you@company.com",
      },
      password(
        "token",
        "API token",
        "Token from Bitbucket account settings",
      ),
      {
        key: "workspace",
        label: "Workspace",
        placeholder: "Optional workspace slug",
        optional: true,
      },
    ],
    docsUrl: "https://bitbucket.org/account/settings/app-passwords/",
    note: "Use a token with repository and pull-request access.",
  },
  discord: {
    fields: [
      password(
        "token",
        "Bot token",
        "Bot token from Discord Developer Portal",
      ),
    ],
    docsUrl: "https://discord.com/developers/applications",
  },
  github: {
    fields: [
      password(
        "token",
        "Personal access token",
        "ghp_... or github_pat_...",
      ),
    ],
    docsUrl: "https://github.com/settings/tokens",
    note: "Grant only the repository permissions ArcSonare should use.",
  },
  homeAssistant: {
    fields: [
      {
        key: "baseUrl",
        label: "Home Assistant URL",
        placeholder: "http://homeassistant.local:8123",
      },
      password(
        "token",
        "Long-lived access token",
        "Profile → Security → Long-lived access tokens",
      ),
    ],
    docsUrl: "https://www.home-assistant.io/docs/authentication/",
  },
  x: {
    fields: [
      password("token", "Bearer token", "Bearer token from X Developer Portal"),
      {
        key: "apiKey",
        label: "API key",
        placeholder: "Optional consumer API key",
        optional: true,
      },
      password(
        "apiSecret",
        "API secret",
        "Optional consumer API secret",
        true,
      ),
      {
        key: "label",
        label: "Account label",
        placeholder: "Optional, for example Brand",
        optional: true,
      },
    ],
    docsUrl: "https://developer.x.com/en/portal/dashboard",
  },
  mysql: {
    fields: [
      { key: "host", label: "Host", placeholder: "localhost or db.example.com" },
      {
        key: "port",
        label: "Port",
        placeholder: "3306",
        optional: true,
      },
      { key: "database", label: "Database", placeholder: "mydb" },
      { key: "username", label: "Username", placeholder: "root" },
      password("password", "Password", "Database password", true),
    ],
  },
  notion: {
    fields: [
      password("token", "Integration token", "secret_..."),
    ],
    docsUrl: "https://www.notion.so/my-integrations",
  },
  postgresql: {
    fields: [
      { key: "host", label: "Host", placeholder: "localhost or db.example.com" },
      {
        key: "port",
        label: "Port",
        placeholder: "5432",
        optional: true,
      },
      { key: "database", label: "Database", placeholder: "mydb" },
      { key: "username", label: "Username", placeholder: "postgres" },
      password("password", "Password", "Database password", true),
    ],
  },
  redis: {
    fields: [
      {
        key: "host",
        label: "Host",
        placeholder: "localhost or redis.example.com",
      },
      {
        key: "port",
        label: "Port",
        placeholder: "6379",
        optional: true,
      },
      {
        key: "username",
        label: "Username",
        placeholder: "Optional ACL username",
        optional: true,
      },
      password("password", "Password", "Redis password", true),
    ],
  },
  slack: {
    fields: [
      password("token", "Bot token", "xoxb-..."),
      password(
        "signingSecret",
        "Signing secret",
        "Signing secret from Slack App settings",
      ),
    ],
    docsUrl: "https://api.slack.com/apps",
  },
  telegram: {
    fields: [
      password("token", "Bot token", "Token from @BotFather"),
    ],
    docsUrl: "https://core.telegram.org/bots/tutorial",
  },
  whatsapp: {
    fields: [
      password(
        "accessToken",
        "Permanent access token",
        "Token from Meta Developer App",
      ),
      {
        key: "phoneNumberId",
        label: "Phone number ID",
        placeholder: "WhatsApp → API setup",
      },
    ],
    docsUrl:
      "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
  },
  smtp: {
    fields: [
      { key: "host", label: "SMTP host", placeholder: "smtp.yourdomain.com" },
      { key: "port", label: "Port", placeholder: "587" },
      { key: "user", label: "Username", placeholder: "you@yourdomain.com" },
      password("password", "Password", "App password or SMTP password"),
      {
        key: "from",
        label: "From address",
        placeholder: "Your Name <you@yourdomain.com>",
      },
    ],
  },
  spotify: {
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        placeholder: "Spotify Developer Dashboard client ID",
      },
      password(
        "clientSecret",
        "Client secret",
        "Spotify Developer Dashboard client secret",
      ),
    ],
    docsUrl: "https://developer.spotify.com/dashboard",
  },
  tmdb: {
    fields: [
      password(
        "apiKey",
        "API read access token",
        "Bearer token from TMDB Developer Dashboard",
      ),
    ],
    docsUrl:
      "https://developer.themoviedb.org/reference/getting-started",
  },
  openweather: {
    fields: [
      password("apiKey", "API key", "OpenWeather API key"),
    ],
    docsUrl: "https://openweathermap.org/api",
  },
  zillow: {
    fields: [
      password("apiKey", "RapidAPI key", "Zillow Scraper RapidAPI key"),
    ],
    docsUrl:
      "https://rapidapi.com/pullapi-pullapi-default/api/zillow-scraper-api",
  },
  ssh: {
    fields: [
      {
        key: "name",
        label: "Connection name",
        placeholder: "Production server",
      },
      {
        key: "host",
        label: "Host",
        placeholder: "server.example.com",
      },
      {
        key: "port",
        label: "Port",
        placeholder: "22",
        optional: true,
      },
      { key: "username", label: "Username", placeholder: "root" },
      password("password", "Password", "Optional when using a key", true),
      {
        key: "privateKey",
        label: "Private key",
        placeholder: "-----BEGIN ... PRIVATE KEY-----",
        type: "password",
        optional: true,
        multiline: true,
      },
    ],
    note: "Provide a password or private key. Credentials remain on this device.",
  },
  twilio: {
    fields: [
      password("accountSid", "Account SID", "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
      password("authToken", "Auth token", "Twilio Auth Token"),
      {
        key: "phoneNumber",
        label: "Twilio phone number",
        placeholder: "+12125551234",
      },
    ],
    docsUrl: "https://console.twilio.com",
  },
  unsplash: {
    fields: [
      {
        key: "accessKey",
        label: "Access key",
        placeholder: "Unsplash application access key",
      },
      password(
        "secretKey",
        "Secret key",
        "Optional Unsplash secret key",
        true,
      ),
    ],
    docsUrl: "https://unsplash.com/oauth/applications",
  },
  youtube: {
    fields: [
      password("apiKey", "YouTube Data API key", "AIzaSy..."),
    ],
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
  elevenlabs: {
    fields: [
      password("apiKey", "API key", "ElevenLabs xi-api-key"),
    ],
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
};

export const MCP_INTEGRATIONS = new Set<IntegrationId>(["higgsfield"]);

export const INTEGRATION_CAPABILITIES: Partial<Record<IntegrationId, string[]>> = {
  gmail: ["Read and search emails", "Send emails with attachments", "Manage labels and folders"],
  googleCalendar: ["List upcoming events", "Create and update events", "Manage multiple calendars"],
  googleDrive: ["List and download files", "Upload files to Drive", "Share files and folders"],
  bitbucket: ["List and manage repositories", "Create and review pull requests", "Trigger pipelines"],
  discord: ["Send messages to any channel", "List servers and channels", "Automate server actions"],
  github: ["List repositories you can access", "List and create issues", "Read pull requests"],
  homeAssistant: ["Read entity states and attributes", "Call services (lights, climate, switches)", "Trigger automations and scripts"],
  x: ["Search recent posts", "Read public timelines", "Post with user tokens when configured"],
  mysql: ["Run SQL queries", "Read and write rows", "List tables and schemas"],
  notion: ["Read and create pages", "Query Notion databases", "Search across workspace"],
  postgresql: ["Run SQL queries", "Read and insert rows", "List tables and schemas"],
  redis: ["Get and set keys", "List and scan keys", "Manage TTL and expiry"],
  slack: ["Post, edit, and delete bot messages", "List channels and read threads", "Search messages and mentions"],
  telegram: ["Send text messages via Bot API", "Deliver alerts and transactional updates"],
  whatsapp: ["Send template and session messages", "Customer care within the 24-hour window"],
  smtp: ["Send emails from your own domain", "Attach files to outgoing emails", "CC and BCC support"],
  spotify: ["Search and play any track or playlist", "Pause, skip, volume, shuffle", "Your playlists and liked songs"],
  tmdb: ["Search movies and TV shows", "Discover popular and top-rated titles", "Find where to stream"],
  openweather: ["Current conditions by city or coordinates", "5-day / 3-hour forecast"],
  zillow: ["Search homes for sale or rent", "Property details and Zestimate values"],
  ssh: ["Run commands on remote servers", "Read and write remote files", "Manage services and processes"],
  twilio: ["Send SMS to any phone number", "Send WhatsApp messages", "Make phone calls with text-to-speech"],
  unsplash: ["Search photos by keyword", "Fetch random curated photos"],
  youtube: ["Search and play videos", "List playlists and subscriptions", "Get video details and statistics"],
  higgsfield: ["Generate videos from text prompts", "Animate still images into video", "Generate images"],
  elevenlabs: ["Generate speech from text", "Choose from your ElevenLabs voice library"],
};

export function capabilitiesFor(id: IntegrationId): string[] {
  return INTEGRATION_CAPABILITIES[id] ?? [];
}

export function credentialSpecFor(
  id: IntegrationId,
): IntegrationCredentialSpec | undefined {
  return CREDENTIAL_INTEGRATIONS[id];
}

export function integrationSecureKey(id: IntegrationId): string {
  return `integration.${id}`;
}
