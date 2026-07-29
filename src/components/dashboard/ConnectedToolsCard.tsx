import { useMemo, useSyncExternalStore } from "react";
import { INTEGRATIONS } from "../../data/demoData";
import { integrationIcons, type IntegrationId } from "../../config/iconRegistry";
import { navigate } from "../../stores/appStore";
import { ArrowRightIcon } from "../Icons";
import { getConnectionSnapshot } from "../../features/orchestration/ConnectionBroker";
import type { ConnectedAccount } from "../../features/orchestration/IntentContract";

const EMPTY_ACCOUNTS: ConnectedAccount[] = [];

/** Preferred strip order when nothing (or few things) are linked yet. */
const SUGGESTED_IDS: IntegrationId[] = [
  "gmail",
  "googleDrive",
  "discord",
  "youtube",
  "spotify",
  "telegram",
];

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

function integrationIdFromAccount(account: ConnectedAccount): IntegrationId | null {
  if (account.id.startsWith("local:")) {
    const raw = account.id.slice("local:".length);
    if (raw in integrationIcons) return raw as IntegrationId;
  }
  const byName = INTEGRATIONS.find(
    (i) => i.name.toLowerCase() === (account.accountLabel ?? "").toLowerCase(),
  );
  return byName?.id ?? null;
}

type ToolStripItem = {
  id: IntegrationId;
  name: string;
  linked: boolean;
};

/**
 * Compact strip: linked tools with correct icons, or suggested tools marked
 * Not connected. Every tile opens Connect.
 */
export function ConnectedToolsCard() {
  const accounts = useSyncExternalStore(
    subscribe,
    getConnectionSnapshot,
    () => EMPTY_ACCOUNTS,
  );

  const visible = useMemo((): ToolStripItem[] => {
    const linked: ToolStripItem[] = [];
    const seen = new Set<IntegrationId>();

    for (const account of accounts) {
      if (account.status !== "connected" && account.status !== "connected-limited") {
        continue;
      }
      const id = integrationIdFromAccount(account);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const catalog = INTEGRATIONS.find((i) => i.id === id);
      linked.push({
        id,
        name: catalog?.name ?? account.accountLabel ?? "",
        linked: true,
      });
      if (linked.length >= 4) break;
    }

    if (linked.length >= 4) return linked;

    const fillers: ToolStripItem[] = [...linked];
    for (const id of SUGGESTED_IDS) {
      if (seen.has(id)) continue;
      const catalog = INTEGRATIONS.find((i) => i.id === id);
      if (!catalog) continue;
      fillers.push({ id, name: catalog.name, linked: false });
      seen.add(id);
      if (fillers.length >= 4) break;
    }
    return fillers;
  }, [accounts]);

  return (
    <section className="card sonare-card tools-card">
      <div className="card-head">
        <span className="card-label">Connected Tools</span>
      </div>
      <div className="tools-row">
        {visible.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tool-item"
            onClick={() => navigate("connect")}
            aria-label={`${tool.name} — ${tool.linked ? "Linked" : "Not connected"}. Open Connect`}
            title={tool.linked ? `${tool.name} · Linked` : `${tool.name} · Not connected`}
          >
            <span className="tool-tile">
              <img
                src={integrationIcons[tool.id]}
                alt=""
                width={30}
                height={30}
                draggable={false}
              />
            </span>
            <span className="tool-name">{tool.name}</span>
            <span className={`tool-meta${tool.linked ? " is-linked" : ""}`}>
              {tool.linked ? "Linked" : "Not connected"}
            </span>
          </button>
        ))}
        <button
          type="button"
          className="tool-item tools-view-all"
          onClick={() => navigate("connect")}
          aria-label="View all connections"
        >
          <span className="tools-view-all-btn">
            <ArrowRightIcon size={15} />
          </span>
          <span className="tool-name">All</span>
          <span className="tool-meta">View</span>
        </button>
      </div>
    </section>
  );
}
