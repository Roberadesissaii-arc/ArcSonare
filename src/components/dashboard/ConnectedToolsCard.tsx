import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { INTEGRATIONS } from "../../data/demoData";
import {
  FRAMED_INTEGRATION_IDS,
  integrationIcons,
  type IntegrationId,
} from "../../config/iconRegistry";
import { GOOGLE_INTEGRATION_IDS, GOOGLE_SHARED_ACCOUNT_ID } from "../../config/googleOAuth";
import { navigate } from "../../stores/appStore";
import { BadgeAlert, BadgeCheck } from "lucide-react";
import { getConnectionSnapshot } from "../../features/orchestration/ConnectionBroker";
import type { ConnectedAccount } from "../../features/orchestration/IntentContract";
import {
  getConnectedIntegrationIds,
  syncConnectionBrokerFromIntegrations,
} from "../../services/integrationStatusService";
import { PagedApplicationCard } from "./PagedApplicationCard";

const EMPTY_ACCOUNTS: ConnectedAccount[] = [];
const EMPTY_LINKED = new Set<IntegrationId>();

const SUGGESTED_IDS: IntegrationId[] = [
  "gmail",
  "googleDrive",
  "discord",
  "youtube",
  "spotify",
  "telegram",
];

const APP_BLURB: Partial<Record<IntegrationId, string>> = {
  gmail: "Mail and inbox actions",
  googleDrive: "Files and shared drives",
  googleCalendar: "Events and scheduling",
  discord: "Chat and communities",
  youtube: "Video and watch later",
  spotify: "Music and listening",
  telegram: "Messages and chats",
  slack: "Team channels",
  teams: "Calls and channels",
  zoom: "Meetings and webinars",
  notion: "Notes and docs",
  outlook: "Mail and calendar",
  github: "Code and pull requests",
  googleMeet: "Video calls",
  figma: "Design files",
  linear: "Issues and projects",
};

function subscribe(cb: () => void) {
  const onEvt = () => cb();
  window.addEventListener("arcsonare://connection-updated", onEvt);
  window.addEventListener("arcsonare://connection-disconnected", onEvt);
  window.addEventListener("arcsonare://connection-added", onEvt);
  return () => {
    window.removeEventListener("arcsonare://connection-updated", onEvt);
    window.removeEventListener("arcsonare://connection-disconnected", onEvt);
    window.removeEventListener("arcsonare://connection-added", onEvt);
  };
}

/** Expand ConnectionBroker accounts into integration ids (handles local:google). */
function integrationIdsFromAccount(account: ConnectedAccount): IntegrationId[] {
  if (account.status !== "connected" && account.status !== "connected-limited") {
    return [];
  }

  // Shared Google OAuth account → Gmail / Calendar / Drive by service.
  if (account.id === GOOGLE_SHARED_ACCOUNT_ID || account.id === "local:google") {
    const out: IntegrationId[] = [];
    if (account.services.includes("email")) out.push("gmail");
    if (account.services.includes("calendar")) out.push("googleCalendar");
    if (account.services.includes("drive")) out.push("googleDrive");
    // If scopes/services are empty but account is connected, show the Google suite.
    if (out.length === 0) return [...GOOGLE_INTEGRATION_IDS];
    return out;
  }

  if (account.id.startsWith("local:")) {
    const raw = account.id.slice("local:".length);
    if (raw in integrationIcons) return [raw as IntegrationId];
  }

  const byName = INTEGRATIONS.find(
    (i) => i.name.toLowerCase() === (account.accountLabel ?? "").toLowerCase(),
  );
  return byName ? [byName.id] : [];
}

type AppListItem = {
  id: IntegrationId;
  name: string;
  blurb: string;
  linked: boolean;
};

/**
 * Left-rail card: applications from the Connect catalog.
 * Linked state uses the same truth as Connect (OAuth + secure storage),
 * not only the ConnectionBroker cache — so Gmail shows connected when it is.
 */
export function ConnectedToolsCard() {
  const accounts = useSyncExternalStore(
    subscribe,
    getConnectionSnapshot,
    () => EMPTY_ACCOUNTS,
  );
  const [oauthLinked, setOauthLinked] = useState<Set<IntegrationId>>(EMPTY_LINKED);

  const refreshLinked = useCallback(async () => {
    try {
      await syncConnectionBrokerFromIntegrations();
      const ids = await getConnectedIntegrationIds();
      setOauthLinked(ids);
    } catch (err) {
      console.error("[ArcSonare] Applications status refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    void refreshLinked();
  }, [refreshLinked, accounts]);

  useEffect(() => {
    const onFocus = () => void refreshLinked();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshLinked]);

  const candidates = useMemo((): AppListItem[] => {
    // Merge OAuth truth + broker accounts (broker covers non-Google local: ids).
    const linkedSet = new Set<IntegrationId>(oauthLinked);
    for (const account of accounts) {
      for (const id of integrationIdsFromAccount(account)) {
        linkedSet.add(id);
      }
    }

    const linked: AppListItem[] = [];
    const seen = new Set<IntegrationId>();

    // Prefer Gmail first when connected so status matches Connect immediately.
    const preferredOrder: IntegrationId[] = [
      "gmail",
      "googleDrive",
      "googleCalendar",
      ...SUGGESTED_IDS,
    ];

    for (const id of preferredOrder) {
      if (!linkedSet.has(id) || seen.has(id)) continue;
      const catalog = INTEGRATIONS.find((i) => i.id === id);
      if (!catalog) continue;
      seen.add(id);
      linked.push({
        id,
        name: catalog.name,
        blurb: APP_BLURB[id] ?? "Ready in Connect",
        linked: true,
      });
    }

    // Any other connected integrations not in the preferred list.
    for (const id of linkedSet) {
      if (seen.has(id)) continue;
      const catalog = INTEGRATIONS.find((i) => i.id === id);
      if (!catalog) continue;
      seen.add(id);
      linked.push({
        id,
        name: catalog.name,
        blurb: APP_BLURB[id] ?? "Ready in Connect",
        linked: true,
      });
    }

    // Fill remaining slots with suggested (not connected) apps.
    const fillers: AppListItem[] = [...linked];
    for (const id of SUGGESTED_IDS) {
      if (seen.has(id)) continue;
      const catalog = INTEGRATIONS.find((i) => i.id === id);
      if (!catalog) continue;
      fillers.push({
        id,
        name: catalog.name,
        blurb: APP_BLURB[id] ?? "Open Connect to link this app",
        linked: false,
      });
      seen.add(id);
    }
    return fillers;
  }, [accounts, oauthLinked]);

  // Frame, header, subtitle, viewport and pager all come from
  // `PagedApplicationCard`, which the Running Apps card beside this one renders
  // through as well. This card's own markup — the rows — is unchanged.
  return (
    <PagedApplicationCard
      label="Applications"
      description="Apps you can link in Connect."
      variant="applications-card"
      listLabel="Applications"
      items={candidates}
      keyOf={(app) => app.id}
      onAll={() => navigate("connect")}
      renderRow={(app) => (
        <button
          type="button"
          className="tools-list-row"
          onClick={() => navigate("connect")}
          aria-label={
            app.linked
              ? `${app.name}, connected. Open Connect`
              : `${app.name}. Open Connect`
          }
        >
          <span
            className={`tools-list-icon integration-icon-${app.id}${
              FRAMED_INTEGRATION_IDS.has(app.id) ? " is-framed" : ""
            }`}
          >
            <img
              src={integrationIcons[app.id]}
              alt=""
              width={28}
              height={28}
              draggable={false}
            />
            <span
              className={`tools-list-status${
                app.linked ? " is-connected" : " is-disconnected"
              }`}
              aria-hidden="true"
              title={app.linked ? "Connected" : "Not connected"}
            >
              {app.linked ? (
                <BadgeCheck size={14} strokeWidth={2.25} />
              ) : (
                <BadgeAlert size={14} strokeWidth={2.25} />
              )}
            </span>
          </span>
          <span className="tools-list-copy">
            <strong className="tools-list-title">{app.name}</strong>
            <span className="tools-list-desc">{app.blurb}</span>
          </span>
        </button>
      )}
    />
  );
}
