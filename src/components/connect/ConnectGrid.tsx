import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  Link2,
  Plus,
  Search,
  Settings2,
  Unplug,
} from "lucide-react";
import {
  INTEGRATIONS,
  type IntegrationInfo,
} from "../../data/demoData";
import {
  credentialSpecFor,
  integrationSecureKey,
} from "../../config/integrationCatalog";
import {
  FRAMED_INTEGRATION_IDS,
  integrationIcons,
  type IntegrationId,
} from "../../config/iconRegistry";
import {
  connectorImplementation,
  connectorProfile,
  connectorState,
  describeState,
} from "../../features/capabilities/connectorRegistry";
import {
  GOOGLE_INTEGRATION_IDS,
  isGoogleIntegration,
  type GoogleOAuthStatus,
} from "../../config/googleOAuth";
import { EmptyState } from "../EmptyState";
import {
  IntegrationCredentialModal,
  type ConnectionState,
} from "./IntegrationCredentialModal";

const ALL = "All";
type DirectoryView = "discover" | "all" | "connected" | "available";

const DIRECTORY_VIEWS: ReadonlyArray<{
  value: DirectoryView;
  label: string;
  hint: string;
}> = [
  { value: "discover", label: "Discover", hint: "Featured & recommended" },
  { value: "all", label: "All", hint: "Every connector" },
  { value: "connected", label: "Connected", hint: "Linked services" },
  { value: "available", label: "Available", hint: "Not linked yet" },
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
      "twilio",
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

function connectionLabel(state: ConnectionState | undefined): string {
  if (state === "connected") return "Connected";
  if (state === "configured") return "Configured";
  return "Not connected";
}

export function ConnectGrid() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [directoryView, setDirectoryView] =
    useState<DirectoryView>("discover");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<IntegrationId | null>(null);
  const [selectedIntegration, setSelectedIntegration] =
    useState<IntegrationInfo | null>(null);
  /** Arrow cue: more category rows below the fold (not an expand button). */
  const [categoriesCanScrollMore, setCategoriesCanScrollMore] = useState(false);
  const categoriesListRef = useRef<HTMLDivElement | null>(null);
  const [connectionStates, setConnectionStates] = useState<
    Map<IntegrationId, ConnectionState>
  >(() => new Map());

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

  const updateCategoriesScrollCue = useCallback(() => {
    const el = categoriesListRef.current;
    if (!el) {
      setCategoriesCanScrollMore(false);
      return;
    }
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    setCategoriesCanScrollMore(remaining > 4);
  }, []);

  useEffect(() => {
    updateCategoriesScrollCue();
    const el = categoriesListRef.current;
    if (!el) return;

    const onScroll = () => updateCategoriesScrollCue();
    el.addEventListener("scroll", onScroll, { passive: true });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateCategoriesScrollCue())
        : null;
    ro?.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [categories, updateCategoriesScrollCue]);

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

    // Flat list for status/search filters; Discover keeps category sections.
    // Center grid is always three cards per row either way.
    if (
      directoryView === "connected" ||
      directoryView === "available" ||
      directoryView === "all" ||
      query.trim() ||
      category !== ALL
    ) {
      return [
        {
          id: "results" as const,
          title:
            directoryView === "connected"
              ? "Connected"
              : directoryView === "available"
                ? "Available"
                : directoryView === "all"
                  ? "All connectors"
                  : "Results",
          glyph: "·",
          integrations: filtered,
        },
      ].filter((section) => section.integrations.length > 0);
    }

    return CONNECT_SECTIONS.map((section) => ({
      ...section,
      integrations: section.integrationIds
        .map((id) => visibleById.get(id))
        .filter(
          (integration): integration is IntegrationInfo =>
            integration !== undefined,
        ),
    })).filter((section) => section.integrations.length > 0);
  }, [category, directoryView, filtered, query]);

  const selected =
    INTEGRATIONS.find((i) => i.id === selectedId) ?? null;
  const selectedState = selected
    ? connectionStates.get(selected.id)
    : undefined;

  const connectedList = useMemo(
    () => INTEGRATIONS.filter((i) => connectedIds.has(i.id)),
    [connectedIds],
  );

  const counts = useMemo(
    () => ({
      total: INTEGRATIONS.length,
      connected: connectedIds.size,
      available: INTEGRATIONS.length - connectedIds.size,
      visible: filtered.length,
    }),
    [connectedIds, filtered.length],
  );

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

  const openConnect = (integration: IntegrationInfo) => {
    setNotice(null);
    setSelectedId(integration.id);
    setSelectedIntegration(integration);
  };

  const viewLabel =
    DIRECTORY_VIEWS.find((v) => v.value === directoryView)?.label ?? "Connect";

  return (
    <div className="dashboard connect-workspace-root">
      {/* ---------------- Left rail ---------------- */}
      <div className="dashboard-col side-column dashboard-left">
        <section className="card sonare-card connect-rail-card connect-rail-views">
          <div className="connect-rail-block">
            <span className="connect-rail-heading">Views</span>
            <div
              className="connect-rail-filters"
              role="radiogroup"
              aria-label="Connector directory view"
            >
              {DIRECTORY_VIEWS.map((view) => (
                <button
                  key={view.value}
                  type="button"
                  role="radio"
                  aria-checked={directoryView === view.value}
                  className={`connect-rail-filter${
                    directoryView === view.value ? " active" : ""
                  }`}
                  onClick={() => {
                    setDirectoryView(view.value);
                    setCategory(ALL);
                  }}
                >
                  <span className="connect-rail-filter-dot" aria-hidden="true" />
                  <span className="connect-rail-filter-text">
                    <strong>{view.label}</strong>
                    <small>{view.hint}</small>
                  </span>
                  <span className="connect-rail-filter-count">
                    {view.value === "connected"
                      ? counts.connected
                      : view.value === "available"
                        ? counts.available
                        : counts.total}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="card sonare-card connect-rail-card connect-rail-categories-card">
          <div className="connect-rail-block">
            <span className="connect-rail-heading">Categories</span>
            <div
              ref={categoriesListRef}
              className="connect-rail-categories"
              role="list"
            >
              {categories.map((value) => {
                const count =
                  value === ALL
                    ? INTEGRATIONS.length
                    : INTEGRATIONS.filter((i) => i.category === value).length;
                return (
                  <button
                    key={value}
                    type="button"
                    role="listitem"
                    aria-pressed={category === value}
                    className={`connect-rail-category${
                      category === value ? " active" : ""
                    }`}
                    onClick={() => setCategory(value)}
                  >
                    <span>{value === ALL ? "All categories" : value}</span>
                    <span className="connect-rail-category-count">{count}</span>
                  </button>
                );
              })}
            </div>
            {categoriesCanScrollMore ? (
              <div
                className="connect-rail-scroll-cue"
                aria-hidden="true"
                title="More categories below — scroll the list"
              >
                <span className="connect-rail-expand-circle">
                  <ChevronDown size={14} strokeWidth={2.4} />
                </span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="card sonare-card connect-rail-card connect-rail-pulse">
          <div className="connect-rail-block">
            <span className="connect-rail-heading">Network pulse</span>
            <div className="connect-pulse">
              <div className="connect-pulse-head">
                <span>Linked</span>
                <span>
                  {counts.connected}/{counts.total}
                </span>
              </div>
              <div className="connect-pulse-track">
                <span
                  style={{
                    width: `${
                      counts.total
                        ? (counts.connected / counts.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="connect-pulse-grid">
                <span>
                  <b>{counts.connected}</b> Connected
                </span>
                <span>
                  <b>{counts.available}</b> Available
                </span>
                <span>
                  <b>{counts.visible}</b> Showing
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- Center ---------------- */}
      <div className="dashboard-center connect-center">
        <section className="connect-directory">
          <header className="agent-directory-head connect-directory-head">
            <div className="connect-directory-title">
              <span className="agent-rail-label">Connect workspace</span>
              <h1>{viewLabel}</h1>
              <p>Select a service to connect and use it in ArcSonare.</p>
            </div>
            <label className="connect-directory-search">
              <Search size={17} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search connectors"
                aria-label="Search all connectors"
              />
            </label>
          </header>

          {notice ? (
            <div className="connect-directory-notice" role="status">
              <Check size={14} />
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
                    <span className="connect-section-count">
                      {section.integrations.length}
                    </span>
                  </header>

                  <div className="connect-grid">
                    {section.integrations.map((integration) => {
                      const connectionState = connectionStates.get(
                        integration.id,
                      );
                      const isSelected = selectedId === integration.id;
                      return (
                        <article
                          key={integration.id}
                          className={`connect-card${
                            isSelected ? " is-selected" : ""
                          }${connectionState ? " is-linked" : ""}`}
                          onClick={() => setSelectedId(integration.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedId(integration.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                        >
                          <span
                            className={`connect-icon-slot integration-icon-${integration.id}${
                              FRAMED_INTEGRATION_IDS.has(integration.id)
                                ? " is-framed"
                                : ""
                            }`}
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
                              {connectionState ? (
                                <BadgeCheck
                                  className="connect-card-connected-badge"
                                  size={14}
                                  aria-label="Connected"
                                />
                              ) : null}
                              <span className="connect-name">
                                {integration.name}
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
                            {/* One truthful line per card, from the canonical
                                registry — not from the catalogue copy above. */}
                            {(() => {
                              const profile = connectorProfile(integration.id);
                              if (profile.implementation === "UI_ONLY") return null;
                              if (profile.implementation === "AUTH_ONLY") {
                                return (
                                  <p className="connect-card-status is-pending">
                                    Authentication only · tools not implemented yet
                                  </p>
                                );
                              }
                              return (
                                <p className="connect-card-status is-real">
                                  {connectionState ? "Connected · " : ""}
                                  {profile.accessLevel}
                                </p>
                              );
                            })()}
                          </div>
                          {/* The action must not imply a working integration
                              when none exists. A UI-only card has no credential
                              form to open, and an auth-only one stores a real
                              secret behind nothing — both said "Connect". */}
                          {(() => {
                            const impl = connectorImplementation(integration.id);
                            if (impl === "UI_ONLY") {
                              return (
                                <span
                                  className="connect-card-soon"
                                  title={`${integration.name} is not available yet`}
                                >
                                  Coming soon
                                </span>
                              );
                            }
                            const label = connectionState
                              ? "Manage"
                              : impl === "AUTH_ONLY"
                                ? "Set up credential"
                                : "Connect";
                            return (
                              <button
                                type="button"
                                className={`connect-card-add${
                                  connectionState ? " is-connected" : ""
                                }${impl === "AUTH_ONLY" ? " is-preview" : ""}`}
                                aria-label={`${label} ${integration.name}`}
                                title={
                                  impl === "AUTH_ONLY"
                                    ? `${integration.name}: credential can be saved, but ArcSonare tools are not implemented yet`
                                    : `${label} ${integration.name}`
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openConnect(integration);
                                }}
                              >
                                {connectionState ? (
                                  <Settings2 size={17} />
                                ) : (
                                  <Plus size={19} />
                                )}
                              </button>
                            );
                          })()}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ---------------- Right rail ---------------- */}
      <div className="dashboard-col side-column dashboard-right">
        <section className="card sonare-card connect-inspector-hero">
          {selected ? (
            <>
              <div className="connect-inspector-top">
                <span
                  className={`connect-icon-slot integration-icon-${selected.id}${
                    FRAMED_INTEGRATION_IDS.has(selected.id) ? " is-framed" : ""
                  }`}
                >
                  <img
                    className="connect-icon"
                    src={integrationIcons[selected.id]}
                    alt=""
                    width={40}
                    height={40}
                    draggable={false}
                  />
                </span>
                <span className="connect-rail-heading">Selected connector</span>
                <h2>{selected.name}</h2>
                <p>{selected.category}</p>
                <span
                  className={`connect-inspector-status${
                    selectedState ? " active" : ""
                  }`}
                >
                  {connectionLabel(selectedState)}
                </span>
              </div>
              <p className="connect-inspector-desc">
                {connectorDescription(selected)}
              </p>
              <div className="connect-inspector-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openConnect(selected)}
                >
                  {selectedState ? (
                    <>
                      <Settings2 size={13} /> Manage
                    </>
                  ) : (
                    <>
                      <Link2 size={13} /> Connect
                    </>
                  )}
                </button>
              </div>
              {/* What this connector can actually do, from the canonical
                  registry. Capability *names*, never their internal ids. */}
              {(() => {
                const profile = connectorProfile(selected.id);
                const state = connectorState(selected.id, {
                  credentialPresent: Boolean(selectedState),
                  validated: selectedState === "connected",
                  errored: false,
                });
                return (
                  <div className="connect-detail">
                    <dl className="connect-detail-facts">
                      <div>
                        <dt>Status</dt>
                        <dd>{describeState(state)}</dd>
                      </div>
                      <div>
                        <dt>Access</dt>
                        <dd>{profile.accessLevel}</dd>
                      </div>
                      <div>
                        <dt>Authentication</dt>
                        <dd>
                          {isGoogleIntegration(selected.id)
                            ? "Google sign-in"
                            : credentialSpecFor(selected.id)
                              ? "API credential"
                              : "None"}
                        </dd>
                      </div>
                      <div>
                        <dt>In chat</dt>
                        <dd>
                          {profile.chatCapabilityIds.length > 0
                            ? `${profile.chatCapabilityIds.length} tool${profile.chatCapabilityIds.length === 1 ? "" : "s"}`
                            : "No"}
                        </dd>
                      </div>
                      <div>
                        <dt>By voice</dt>
                        <dd>
                          {profile.voiceCapabilityIds.length > 0
                            ? `${profile.voiceCapabilityIds.length} tool${profile.voiceCapabilityIds.length === 1 ? "" : "s"}`
                            : "No"}
                        </dd>
                      </div>
                    </dl>
                    <div className="connect-detail-lists">
                      <div>
                        <span className="connect-detail-label">Available</span>
                        {profile.available.length > 0 ? (
                          <ul>
                            {profile.available.map((name) => (
                              <li key={name}>{name}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="connect-detail-none">
                            None — no ArcSonare tools are implemented yet.
                          </p>
                        )}
                      </div>
                      {profile.unavailable.length > 0 ? (
                        <div>
                          <span className="connect-detail-label">Unavailable</span>
                          <ul className="is-unavailable">
                            {profile.unavailable.map((name) => (
                              <li key={name}>{name}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })()}
            </>
          ) : (
            <EmptyState
              icon={<Unplug size={24} />}
              title="Select a connector"
              description="Choose a service from the center grid to inspect status and connect."
              compact
            />
          )}
        </section>

        <section className="card sonare-card connect-inspector-panel">
          <span className="connect-rail-heading">Linked now</span>
          {connectedList.length === 0 ? (
            <p className="connect-inspector-empty">
              Nothing linked yet. Connect a service from Discover or Available.
            </p>
          ) : (
            <div className="connect-linked-list">
              {connectedList.map((integration) => (
                <button
                  key={integration.id}
                  type="button"
                  className={`connect-linked-row${
                    selectedId === integration.id ? " active" : ""
                  }`}
                  onClick={() => setSelectedId(integration.id)}
                >
                  <span
                    className={`connect-icon-slot integration-icon-${integration.id}${
                      FRAMED_INTEGRATION_IDS.has(integration.id)
                        ? " is-framed"
                        : ""
                    }`}
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
                  <span>
                    <strong>{integration.name}</strong>
                    <small>
                      {connectionLabel(connectionStates.get(integration.id))}
                    </small>
                  </span>
                  <i className="online" />
                </button>
              ))}
            </div>
          )}
          <div className="connect-inspector-foot">
            <span>
              <i /> Network ready
            </span>
            <small>{counts.connected} linked</small>
          </div>
        </section>
      </div>

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
