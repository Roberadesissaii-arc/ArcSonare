import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";

/**
 * Settings → Updates.
 *
 * Replaces the old Integrations section, which duplicated the Connect page —
 * the same accounts, the same connect buttons, two places to keep in sync.
 * Connect owns integrations; this owns the app version.
 */
export function UpdatesSettingsPage() {
  const [version, setVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  const check = async () => {
    setChecking(true);
    setStatus("");
    try {
      // No update server is configured yet, so say that plainly rather than
      // showing a spinner that resolves to a reassuring lie.
      setStatus(
        "Automatic updates aren't set up yet. New builds are installed from the ArcSonare setup file.",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="settings-section">
      <SettingsPageHeader
        title="Updates"
        description="Your installed version and how to get new ones."
      />

      <div className="settings-row">
        <div className="settings-row-text">
          <p className="settings-row-label">Installed version</p>
          <p className="settings-row-hint">
            ArcSonare {version || "…"}
          </p>
        </div>
        <div className="settings-row-control">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void check()}
            disabled={checking}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
        </div>
      </div>

      {status ? (
        <p className="settings-row-hint" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
