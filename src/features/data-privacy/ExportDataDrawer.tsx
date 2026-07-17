import { useMemo, useState } from "react";
import { CloseIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import { USAGE_CATEGORIES } from "./dataCategoryRegistry";
import { localStorageKeys } from "./dataPrivacyActions";

interface ExportDataDrawerProps {
  onClose: () => void;
}

const EXPORTABLE = USAGE_CATEGORIES.filter((c) => c.exportable);

export function ExportDataDrawer({ onClose }: ExportDataDrawerProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of EXPORTABLE) {
      init[c.id] = !c.sensitive;
    }
    init["preferences"] = true;
    init["tasks"] = true;
    init["agents"] = true;
    return init;
  });
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const estimate = useMemo(() => {
    let keys = 0;
    try {
      keys = localStorageKeys(["arcsonare."]).length;
    } catch {
      keys = 0;
    }
    return keys;
  }, []);

  const runExport = () => {
    setBusy(true);
    setStatus(null);
    try {
      const data: Record<string, unknown> = {
        manifest: {
          exportVersion: 1,
          exportedAt: new Date().toISOString(),
          included: Object.entries(selected)
            .filter(([, v]) => v)
            .map(([k]) => k),
          excluded: ["credentials", "api-keys"],
          note: "Credentials in Windows Credential Manager are never included.",
        },
      };

      const take = (prefix: string, outKey: string) => {
        for (const key of localStorageKeys([prefix])) {
          data[outKey + ":" + key] = window.localStorage.getItem(key);
        }
      };

      if (selected.tasks) take("arcsonare.tasks", "tasks");
      if (selected.agents) take("arcsonare.agents", "agents");
      if (selected["activity-logs"]) take("arcsonare.activity", "activity");
      if (selected.preferences) take("arcsonare.", "prefs-related");

      // Sensitive capture metadata is only included when explicitly allowed.
      if (includeSensitive && selected["screen-captures"]) {
        data.screenCapturesNote =
          "Capture binary files live on disk; export JSON does not embed PNGs.";
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
      setStatus(
        `Export saved. Credentials excluded. ~${estimate} localStorage keys considered.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside
        className="data-drawer"
        role="dialog"
        aria-label="Export ArcSonare data"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="data-drawer-head">
          <div>
            <h2>Export ArcSonare data</h2>
            <p>JSON package. Credentials are excluded by default.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </header>

        <ul className="data-export-list">
          {[
            { id: "tasks", label: "Tasks" },
            { id: "agents", label: "Agents" },
            { id: "activity-logs", label: "Activity & agent logs" },
            { id: "preferences", label: "Preferences / related keys" },
            { id: "screen-captures", label: "Screen Context metadata note" },
            { id: "voice-transcripts", label: "Voice category note" },
          ].map((item) => (
            <li key={item.id}>
              <Toggle
                checked={!!selected[item.id]}
                onChange={(v) => setSelected((s) => ({ ...s, [item.id]: v }))}
                label={item.label}
              />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>

        <div className="data-control-row">
          <div>
            <span className="data-control-label">Include sensitive selections</span>
            <span className="data-control-desc">
              Still excludes API keys and Credential Manager secrets.
            </span>
          </div>
          <Toggle
            checked={includeSensitive}
            onChange={setIncludeSensitive}
            label="Include sensitive selections"
          />
        </div>

        {status ? (
          <p className="field-help" role="status">
            {status}
          </p>
        ) : null}

        <div className="data-drawer-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={runExport}
          >
            {busy ? "Exporting…" : "Export JSON"}
          </button>
        </div>
      </aside>
    </div>
  );
}
