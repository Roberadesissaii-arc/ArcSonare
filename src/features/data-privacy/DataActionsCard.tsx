import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DataPrivacyCard } from "./DataPrivacyCard";
import { localStorageKeys } from "./dataPrivacyActions";

interface DataActionsCardProps {
  onExport: () => void;
  onDeleteAll: () => void;
  onCleared: () => void;
}

export function DataActionsCard({
  onExport,
  onDeleteAll,
  onCleared,
}: DataActionsCardProps) {
  return (
    <DataPrivacyCard
      title="Data actions"
      description="Export or remove local ArcSonare data. Credentials in Windows Credential Manager are separate."
    >
      <ul className="data-actions-list">
        <ActionRow
          title="Export ArcSonare data"
          description="Save selected local data as a JSON package. Credentials are excluded."
          button="Export"
          onClick={onExport}
        />
        <ClearRow
          title="Clear screen history"
          description="Delete stored Screen Context captures, thumbnails, and annotations."
          button="Clear screen history"
          confirm="Deletes all capture files under the ArcSonare data folder."
          onClear={async () => {
            await invoke("clear_capture_history");
            onCleared();
            return "Screen capture history cleared.";
          }}
        />
        <ClearRow
          title="Clear voice history"
          description="Remove saved transcripts and the local voice data folder when present."
          button="Clear voice history"
          confirm="Clears the voice data folder. Existing transcript preferences stay."
          onClear={async () => {
            await invoke("clear_category_files", { category: "voice-transcripts" });
            onCleared();
            return "Voice data cleared.";
          }}
        />
        <ClearRow
          title="Clear command and search history"
          description="Deletes the local activity log only — not tasks or agents."
          button="Clear history"
          confirm="This deletes the local activity log only."
          onClear={async () => {
            window.localStorage.removeItem("arcsonare.activity.v1");
            onCleared();
            return "Command and activity history cleared.";
          }}
        />
        <ClearRow
          title="Clear agent activity"
          description="Clears per-agent activity timelines. Agent configurations remain."
          button="Clear agent activity"
          confirm="Agent configs stay; only activity timelines are cleared."
          onClear={async () => {
            const keys = localStorageKeys(["arcsonare.agents"]);
            for (const key of keys) {
              try {
                const raw = window.localStorage.getItem(key);
                if (!raw) continue;
                const parsed = JSON.parse(raw) as unknown;
                if (Array.isArray(parsed)) {
                  const next = parsed.map((a) =>
                    a && typeof a === "object"
                      ? { ...(a as object), activity: [] }
                      : a,
                  );
                  window.localStorage.setItem(key, JSON.stringify(next));
                } else if (parsed && typeof parsed === "object" && "agents" in (parsed as object)) {
                  const obj = parsed as { agents?: unknown[] };
                  if (Array.isArray(obj.agents)) {
                    obj.agents = obj.agents.map((a) =>
                      a && typeof a === "object"
                        ? { ...(a as object), activity: [] }
                        : a,
                    );
                    window.localStorage.setItem(key, JSON.stringify(obj));
                  }
                }
              } catch {
                // skip malformed
              }
            }
            onCleared();
            return "Agent activity cleared. Reload the Agents page to refresh.";
          }}
        />
        <ClearRow
          title="Clear model cache"
          description="Remove temporary cache files. Downloaded local models are not deleted."
          button="Clear model cache"
          confirm="Only the cache folder is removed."
          onClear={async () => {
            await invoke("clear_category_files", { category: "model-cache" });
            onCleared();
            return "Model cache cleared.";
          }}
        />
        <ActionRow
          title="Delete all local data"
          description="Remove tasks, agents, history, captures, cache, and preferences from this device."
          button="Delete all local data"
          danger
          onClick={onDeleteAll}
        />
      </ul>
    </DataPrivacyCard>
  );
}

function ActionRow({
  title,
  description,
  button,
  onClick,
  danger,
}: {
  title: string;
  description: string;
  button: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <li className="data-action-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className={`btn btn-small${danger ? " btn-danger-outline" : ""}`}
        onClick={onClick}
      >
        {button}
      </button>
    </li>
  );
}

function ClearRow({
  title,
  description,
  button,
  confirm,
  onClear,
}: {
  title: string;
  description: string;
  button: string;
  confirm: string;
  onClear: () => Promise<string>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  return (
    <li className="data-action-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {status ? (
          <p className="field-help" role="status">
            {status}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={`btn btn-small${confirming ? " btn-danger" : ""}`}
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            setStatus(confirm);
            window.setTimeout(() => setConfirming(false), 5000);
            return;
          }
          setConfirming(false);
          onClear()
            .then(setStatus)
            .catch((err) =>
              setStatus(typeof err === "string" ? err : "The action failed."),
            );
        }}
      >
        {confirming ? "Click again to confirm" : button}
      </button>
    </li>
  );
}
