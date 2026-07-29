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

export function credentialSpecFor(
  id: IntegrationId,
): IntegrationCredentialSpec | undefined {
  return CREDENTIAL_INTEGRATIONS[id];
}

export function integrationSecureKey(id: IntegrationId): string {
  return `integration.${id}`;
}
