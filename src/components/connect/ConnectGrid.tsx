import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  INTEGRATIONS,
  type IntegrationInfo,
} from "../../data/demoData";
import {
  credentialSpecFor,
  integrationSecureKey,
} from "../../config/integrationCatalog";
import {
  integrationIcons,
  type IntegrationId,
} from "../../config/iconRegistry";
import {
  GOOGLE_INTEGRATION_IDS,
  isGoogleIntegration,
  type GoogleOAuthStatus,
} from "../../config/googleOAuth";
import {
  CheckIcon,
  PlusIcon,
  SearchIcon,
} from "../Icons";
import { Dropdown } from "../settings/Dropdown";
import {
  IntegrationCredentialModal,
  type ConnectionState,
} from "./IntegrationCredentialModal";

const ALL = "All";
type DirectoryView = "discover" | "all" | "connected" | "available";

const DIRECTORY_VIEWS: ReadonlyArray<{
  value: DirectoryView;
  label: string;
}> = [
  { value: "discover", label: "Discover" },
  { value: "all", label: "All" },
  { value: "connected", label: "Connected" },
  { value: "available", label: "Available" },
];

type ConnectSectionId =
  | "popular"
  | "developer"
  | "data"
  | "productivity"
  | "communication"
  | "creative";

const CONNECT_SECTIONS: ReadonlyArray<{
  id: ConnectSectionId;
  title: string;
  glyph: string;
  integrationIds: readonly IntegrationId[];
}> = [
  {
    id: "popular",
    title: "Popular",
    glyph: "↗",
    integrationIds: [
      "googleDrive",
      "gmail",
      "onedrive",
      "notion",
      "dropbox",
      "slack",
    ],
  },
  {
    id: "developer",
    title: "Developer",
    glyph: "</>",
    integrationIds: [
      "github",
      "bitbucket",
      "linear",
      "ssh",
      "mysql",
      "postgresql",
    ],
  },
  {
    id: "data",
    title: "Data & Analytics",
    glyph: "▥",
    integrationIds: [
      "redis",
      "googleSheets",
      "openweather",
      "tmdb",
      "zillow",
      "clickup",
    ],
  },
  {
    id: "productivity",
    title: "Productivity",
    glyph: "☷",
    integrationIds: [
      "googleCalendar",
      "googleDocs",
      "trello",
      "todoist",
      "evernote",
      "onenote",
    ],
  },
  {
    id: "communication",
    title: "Communication",
    glyph: "◌",
    integrationIds: [
      "teams",
      "discord",
      "zoom",
      "telegram",
      "whatsapp",
      "googleMeet",
    ],
  },
  {
    id: "creative",
    title: "Creative & Media",
    glyph: "✦",
    integrationIds: [
      "figma",
      "youtube",
      "loom",
      "spotify",
      "unsplash",
      "elevenlabs",
      "higgsfield",
      "homeAssistant",
      "x",
      "smtp",
    ],
  },
];

const INTEGRATION_DESCRIPTIONS: Partial<Record<IntegrationId, string>> = {
  gmail: "Search, organize, and manage your emails and calendar",
  outlook: "Bring Microsoft email and calendar activity into your workspace",
  googleCalendar: "Review schedules and create or update calendar events",
  teams: "Search meetings, messages, and team conversations",
  slack: "Search channels, follow discussions, and support team handoffs",
  notion: "Use workspace pages and databases as operational context",
  googleDrive: "Get in-depth answers from your Google Drive content",
  onedrive: "Get in-depth answers from your OneDrive content",
  dropbox: "Get in-depth answers from your Dropbox content",
  linear: "Track issues, projects, and engineering progress in Linear",
  github: "Search and manage your GitHub repositories",
  discord: "Access community conversations and server activity",
  zoom: "Review meeting activity and recorded conversations",
  trello: "Coordinate boards, cards, and project workflows",
  figma: "Reference designs, files, and product collaboration",
  clickup: "Connect projects, tasks, docs, and team workflows",
  todoist: "Organize personal and team tasks across projects",
  telegram: "Access messaging workflows and channel activity",
  whatsapp: "Connect customer and team messaging workflows",
  googleMeet: "Bring meeting context into ArcSonare",
  googleDocs: "Find and reference documents stored in Google Docs",
  googleSheets: "Analyze spreadsheet data and operational reports",
  evernote: "Use notes and notebooks as working context",
  onenote: "Connect notebooks, notes, and research",
  loom: "Reference team videos and async walkthroughs",
  spotify: "Control audio and access listening context",
  youtube: "Find and work with video content and channels",
  bitbucket: "Work with repositories and pull requests in Bitbucket",
  homeAssistant: "Connect approved smart-home workflows",
  x: "Search social updates and public conversations",
  mysql: "Query approved MySQL databases and structured data",
  postgresql: "Connect PostgreSQL data to approved workflows",
  redis: "Use cached data and managed Redis workflows",
  smtp: "Send approved email through your SMTP provider",
  tmdb: "Search movie and television metadata",
  openweather: "Access current conditions and forecast data",
  zillow: "Reference property and real-estate information",
  ssh: "Run approved remote-system workflows securely",
  twilio: "Connect messaging and communication workflows",
  unsplash: "Find image assets for creative work",
  higgsfield: "Create and organize AI-powered media",
  elevenlabs: "Create voice audio for approved workflows",
};

const FEATURED_IDS = new Set<IntegrationId>([
  "googleDrive",
  "gmail",
  "onedrive",
  "github",
  "slack",
  "notion",
]);

function connectorDescription(integration: IntegrationInfo) {
  return (
    INTEGRATION_DESCRIPTIONS[integration.id] ??
    `Connect ${integration.name} to ArcSonare workflows`
  );
}

export function ConnectGrid() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [directoryView, setDirectoryView] =
    useState<DirectoryView>("discover");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedIntegration, setSelectedIntegration] =
    useState<IntegrationInfo | null>(null);
  const [connectionStates, setConnectionStates] = useState<
    Map<IntegrationId, ConnectionState>
  >(
    () => new Map(),
  );

  useEffect(() => {
    let cancelled = false;

    const readConnectionStates = async () => {
      const next = new Map<IntegrationId, ConnectionState>();
      try {
        const googleStatus =
          await invoke<GoogleOAuthStatus>("google_oauth_status");
        if (googleStatus.connected) {
          GOOGLE_INTEGRATION_IDS.forEach((id) => next.set(id, "connected"));
        }
      } catch (error) {
        console.error("[connect] failed to read Google OAuth status", error);
      }

      await Promise.all(
        INTEGRATIONS.filter(
          (integration) =>
            !isGoogleIntegration(integration.id) &&
            credentialSpecFor(integration.id),
        ).map(async (integration) => {
          const key = integrationSecureKey(integration.id);
          try {
            const stored = await invoke<boolean>("secure_storage_has", { key });
            if (stored) next.set(integration.id, "configured");
          } catch (error) {
            console.error(
              `[connect] failed to read ${integration.id} credential state`,
              error,
            );
          }
        }),
      );

      if (!cancelled) setConnectionStates(next);
    };

    void readConnectionStates();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectedIds = useMemo(
    () => new Set(connectionStates.keys()),
    [connectionStates],
  );

  const categories = useMemo(() => {
    const values = Array.from(
      new Set(INTEGRATIONS.map((integration) => integration.category)),
    ).sort((a, b) => a.localeCompare(b));
    return [ALL, ...values];
  }, []);

  const categoryOptions = useMemo(
    () =>
      categories.map((value) => ({
        value,
        label: value === ALL ? "All categories" : value,
      })),
    [categories],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return INTEGRATIONS.filter((integration) => {
      if (category !== ALL && integration.category !== category) return false;
      if (
        directoryView === "connected" &&
        !connectedIds.has(integration.id)
      ) {
        return false;
      }
      if (
        directoryView === "available" &&
        connectedIds.has(integration.id)
      ) {
        return false;
      }
      if (!normalizedQuery) return true;
      return (
        integration.name.toLowerCase().includes(normalizedQuery) ||
        integration.category.toLowerCase().includes(normalizedQuery) ||
        connectorDescription(integration)
          .toLowerCase()
          .includes(normalizedQuery)
      );
    });
  }, [category, connectedIds, directoryView, query]);

  const groupedIntegrations = useMemo(() => {
    const visibleById = new Map(
      filtered.map((integration) => [integration.id, integration]),
    );

    return CONNECT_SECTIONS.map((section) => ({
      ...section,
      integrations: section.integrationIds
        .map((id) => visibleById.get(id))
        .filter(
          (integration): integration is IntegrationInfo =>
            integration !== undefined,
        ),
    })).filter((section) => section.integrations.length > 0);
  }, [filtered]);

  const updateConnectionState = (
    ids: readonly IntegrationId[],
    state: ConnectionState | "disconnected",
    message: string,
  ) => {
    setConnectionStates((current) => {
      const next = new Map(current);
      for (const id of ids) {
        if (state === "disconnected") next.delete(id);
        else next.set(id, state);
      }
      return next;
    });
    setNotice(message);
  };

  return (
    <div className="connect-workspace">
      <header className="connect-directory-head">
        <div className="connect-directory-title">
          <h1>Connectors</h1>
          <p>Connect services so ArcSonare can access and act on your data</p>
        </div>
        <div className="connect-directory-tools">
          <label className="connect-directory-search">
            <SearchIcon size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search all connectors"
              aria-label="Search all connectors"
            />
          </label>
          <Dropdown
            options={categoryOptions}
            value={category}
            onChange={setCategory}
            ariaLabel="Filter connectors by category"
            className="connect-category-dropdown"
          />
        </div>
      </header>

      <div className="connect-directory-controls">
        <div
          className="connect-directory-tabs"
          role="tablist"
          aria-label="Connector directory view"
        >
          {DIRECTORY_VIEWS.map((view) => (
            <button
              key={view.value}
              type="button"
              role="tab"
              aria-selected={directoryView === view.value}
              className={directoryView === view.value ? "active" : ""}
              onClick={() => setDirectoryView(view.value)}
            >
              {view.label}
            </button>
          ))}
        </div>

      </div>

      {notice ? (
        <div className="connect-directory-notice" role="status">
          <CheckIcon size={13} />
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      {groupedIntegrations.length === 0 ? (
        <div className="connect-directory-empty">
          No connectors match “{query.trim() || category}”.
        </div>
      ) : (
        <div className="connect-sections">
          {groupedIntegrations.map((section) => (
            <section className="connect-section" key={section.id}>
              <header className="connect-section-header">
                <span className="connect-section-glyph" aria-hidden="true">
                  {section.glyph}
                </span>
                <h2>{section.title}</h2>
              </header>

              <div className="connect-grid">
                {section.integrations.map((integration) => {
                  const connectionState = connectionStates.get(integration.id);
                  return (
                    <article key={integration.id} className="connect-card">
                      <span
                        className={`connect-icon-slot integration-icon-${integration.id}`}
                      >
                        <img
                          className="connect-icon"
                          src={integrationIcons[integration.id]}
                          alt=""
                          width={40}
                          height={40}
                          draggable={false}
                        />
                      </span>
                      <div className="connect-meta">
                        <div className="connect-card-name-row">
                          <span className="connect-name">
                            {integration.name}
                          </span>
                          <span
                            className="connect-card-verified"
                            title="Verified connector"
                            aria-label="Verified connector"
                          >
                            <CheckIcon size={8} />
                          </span>
                          {FEATURED_IDS.has(integration.id) &&
                          section.id === "developer" ? (
                            <span className="connect-card-popular">
                              Popular ↗
                            </span>
                          ) : null}
                        </div>
                        <p className="connect-description">
                          {connectorDescription(integration)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`connect-card-add${
                          connectionState ? " is-connected" : ""
                        }`}
                        aria-label={`${connectionState ? "Manage" : "Connect"} ${
                          integration.name
                        }`}
                        title={`${connectionState ? "Manage" : "Connect"} ${
                          integration.name
                        }`}
                        onClick={() => {
                          setNotice(null);
                          setSelectedIntegration(integration);
                        }}
                      >
                        {connectionState ? (
                          <CheckIcon size={16} />
                        ) : (
                          <PlusIcon size={17} />
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <IntegrationCredentialModal
        integration={selectedIntegration}
        state={
          selectedIntegration
            ? connectionStates.get(selectedIntegration.id)
            : undefined
        }
        onClose={() => setSelectedIntegration(null)}
        onConnectionChange={updateConnectionState}
      />
    </div>
  );
}
