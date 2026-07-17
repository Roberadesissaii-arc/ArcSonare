import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { patchPrefs, updatePrefs, usePrefs } from "../../stores/settingsStore";
import {
  RETENTION_DATA_TYPES,
  type DataRetention,
  type RetentionDataType,
} from "../../config/prefs";

interface DataUsage {
  dataDir: string;
  settingsBytes: number;
  capturesBytes: number;
}

const TYPE_LABELS: Record<RetentionDataType, string> = {
  "voice-transcripts": "Voice transcripts",
  "raw-audio": "Raw microphone recordings",
  "screen-captures": "Screen captures",
  "screen-annotations": "Screen annotations",
  "agent-activity": "Agent activity",
  "search-history": "Search history",
  "command-history": "Command history",
};

const RETENTION_OPTIONS: { value: DataRetention; label: string }[] = [
  { value: "never", label: "Never save" },
  { value: "after-processing", label: "Delete after processing" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "manual", label: "Keep until deleted" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function localStorageBytes(prefix: string): number {
  let total = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) {
        total += (window.localStorage.getItem(key)?.length ?? 0) * 2;
      }
    }
  } catch {
    // localStorage unavailable.
  }
  return total;
}

/** Rows for confirmable destructive actions. */
function ClearAction({
  label,
  description,
  confirmText,
  onClear,
}: {
  label: string;
  description: string;
  confirmText: string;
  onClear: () => Promise<string>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = () => {
    if (!confirming) {
      setConfirming(true);
      setStatus(confirmText);
      window.setTimeout(() => setConfirming(false), 5000);
      return;
    }
    setConfirming(false);
    onClear()
      .then(setStatus)
      .catch((err) =>
        setStatus(typeof err === "string" ? err : "The action failed."),
      );
  };

  return (
    <>
      <SettingRow label={label} description={description}>
        <button
          type="button"
          className={`btn${confirming ? " btn-danger" : ""}`}
          onClick={run}
        >
          {confirming ? "Click again to confirm" : label}
        </button>
      </SettingRow>
      {status ? (
        <p className="field-help" role="status">
          {status}
        </p>
      ) : null}
    </>
  );
}

export function DataPrivacySettingsPage() {
  const prefs = usePrefs();
  const dp = prefs.dataPrivacy;
  const [usage, setUsage] = useState<DataUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  const refreshUsage = () => {
    invoke<DataUsage>("get_data_usage")
      .then(setUsage)
      .catch((err) =>
        setUsageError(typeof err === "string" ? err : "Storage usage unavailable."),
      );
  };
  useEffect(refreshUsage, []);

  const set = (patch: Partial<typeof dp>) => patchPrefs("dataPrivacy", patch);
  const setRetention = (id: RetentionDataType, value: DataRetention) =>
    updatePrefs((p) => ({
      ...p,
      dataPrivacy: {
        ...p.dataPrivacy,
        retention: { ...p.dataPrivacy.retention, [id]: value },
      },
    }));

  const tasksBytes = localStorageBytes("arcsonare.tasks");
  const activityBytes = localStorageBytes("arcsonare.activity");
  const agentBytes = localStorageBytes("arcsonare.agents");

  const exportData = async (): Promise<string> => {
    const data: Record<string, unknown> = {};
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith("arcsonare.")) {
          data[key] = window.localStorage.getItem(key);
        }
      }
    } catch {
      // localStorage unavailable.
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arcsonare-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return "Exported local ArcSonare data (settings live in the data folder).";
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Data &amp; Privacy</h1>
        <p className="page-subtitle">
          What ArcSonare stores on this computer, for how long, and how to
          remove it.
        </p>
      </header>

      <SettingsGroup title="Data location">
        <SettingRow
          label="Local data folder"
          description={usage?.dataDir ?? usageError ?? "Loading..."}
        >
          <button
            type="button"
            className="btn"
            onClick={() =>
              invoke("open_data_folder").catch((err) =>
                console.error("[ArcSonare] open data folder failed:", err),
              )
            }
          >
            Open folder
          </button>
        </SettingRow>
        <SettingRow
          label="Storage usage"
          description="Approximate sizes of locally stored ArcSonare data."
        >
          <button type="button" className="btn" onClick={refreshUsage}>
            Refresh
          </button>
        </SettingRow>
        <ul className="usage-list">
          <li>
            <span>Settings</span>
            <span>{usage ? formatBytes(usage.settingsBytes) : "…"}</span>
          </li>
          <li>
            <span>Screen captures &amp; annotations</span>
            <span>{usage ? formatBytes(usage.capturesBytes) : "…"}</span>
          </li>
          <li>
            <span>Tasks</span>
            <span>{formatBytes(tasksBytes)}</span>
          </li>
          <li>
            <span>Activity log</span>
            <span>{formatBytes(activityBytes)}</span>
          </li>
          <li>
            <span>Agents</span>
            <span>{formatBytes(agentBytes)}</span>
          </li>
          <li>
            <span>Voice transcripts / raw audio / model cache</span>
            <span>0 B (not collected in this phase)</span>
          </li>
        </ul>
      </SettingsGroup>

      <SettingsGroup
        title="Retention"
        description="How long each data type is kept. Voice data types apply once voice capture ships."
      >
        {RETENTION_DATA_TYPES.map((id) => (
          <SettingRow key={id} label={TYPE_LABELS[id]}>
            <Dropdown<DataRetention>
              options={RETENTION_OPTIONS}
              value={dp.retention[id]}
              onChange={(value) => setRetention(id, value)}
              ariaLabel={`Retention for ${TYPE_LABELS[id]}`}
            />
          </SettingRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Privacy controls">
        <SettingRow label="Store voice transcripts locally">
          <Toggle
            checked={dp.storeTranscripts}
            onChange={(storeTranscripts) => set({ storeTranscripts })}
            label="Store voice transcripts locally"
          />
        </SettingRow>
        <SettingRow label="Store raw audio">
          <Toggle
            checked={dp.storeRawAudio}
            onChange={(storeRawAudio) => set({ storeRawAudio })}
            label="Store raw audio"
          />
        </SettingRow>
        <SettingRow label="Store Screen Context captures">
          <Toggle
            checked={dp.storeCaptures}
            onChange={(storeCaptures) => set({ storeCaptures })}
            label="Store Screen Context captures"
          />
        </SettingRow>
        <SettingRow
          label="Allow cloud processing"
          description="No cloud processing happens in this build; this gate applies once a provider is connected."
        >
          <Toggle
            checked={dp.allowCloud}
            onChange={(allowCloud) => set({ allowCloud })}
            label="Allow cloud processing"
          />
        </SettingRow>
        <SettingRow label="Ask before cloud processing">
          <Toggle
            checked={dp.askBeforeCloud}
            onChange={(askBeforeCloud) => set({ askBeforeCloud })}
            label="Ask before cloud processing"
            disabled={!dp.allowCloud}
          />
        </SettingRow>
        <SettingRow
          label="Allow anonymous diagnostics"
          description="No telemetry exists in this build; nothing is sent regardless."
        >
          <Toggle
            checked={dp.diagnostics}
            onChange={(diagnostics) => set({ diagnostics })}
            label="Allow anonymous diagnostics"
          />
        </SettingRow>
        <SettingRow label="Allow crash reports">
          <Toggle
            checked={dp.crashReports}
            onChange={(crashReports) => set({ crashReports })}
            label="Allow crash reports"
          />
        </SettingRow>
        <SettingRow label="Allow performance metrics">
          <Toggle
            checked={dp.perfMetrics}
            onChange={(perfMetrics) => set({ perfMetrics })}
            label="Allow performance metrics"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Data actions">
        <SettingRow
          label="Export ArcSonare data"
          description="Saves tasks, activity, agents and local preferences as JSON."
        >
          <button
            type="button"
            className="btn"
            onClick={() => {
              void exportData();
            }}
          >
            Export
          </button>
        </SettingRow>
        <ClearAction
          label="Clear screen history"
          description="Deletes every stored screen capture and annotation."
          confirmText="This deletes all capture files under the ArcSonare data folder."
          onClear={async () => {
            await invoke("clear_capture_history");
            refreshUsage();
            return "Screen capture history cleared.";
          }}
        />
        <ClearAction
          label="Clear command history"
          description="Deletes the local activity log (commands, task and agent events)."
          confirmText="This deletes the local activity log only."
          onClear={async () => {
            window.localStorage.removeItem("arcsonare.activity.v1");
            return "Command and activity history cleared. Restart-free; new entries start fresh.";
          }}
        />
        <ClearAction
          label="Delete all local data"
          description="Restores every preference to defaults and deletes local tasks, agents, activity and captures. Provider keys in Windows Credential Manager are NOT touched — remove them under Models."
          confirmText="This resets settings, deletes tasks/agents/activity and clears captures. Provider keys are kept."
          onClear={async () => {
            await invoke("clear_capture_history").catch(() => undefined);
            await invoke("clear_local_data");
            const keys: string[] = [];
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key?.startsWith("arcsonare.")) keys.push(key);
            }
            keys.forEach((k) => window.localStorage.removeItem(k));
            refreshUsage();
            return "All local ArcSonare data was deleted and defaults restored.";
          }}
        />
      </SettingsGroup>
    </div>
  );
}
