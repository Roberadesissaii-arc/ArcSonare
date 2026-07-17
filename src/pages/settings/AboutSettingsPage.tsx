import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ArcSonareLogo } from "../../components/brand/ArcSonareLogo";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";

const ACKNOWLEDGEMENTS = [
  "Tauri — application framework (MIT / Apache-2.0)",
  "React — user interface library (MIT)",
  "Vite — build tooling (MIT)",
  "global-hotkey — system-wide shortcuts (MIT / Apache-2.0)",
  "xcap — screen capture (Apache-2.0)",
  "keyring — secure credential storage (MIT / Apache-2.0)",
];

export function AboutSettingsPage() {
  const [version, setVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [showAcknowledgements, setShowAcknowledgements] = useState(false);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">About</h1>
        <p className="page-subtitle">Sonare Desktop</p>
      </header>

      <div className="about-hero">
        <span className="about-logo">
          <ArcSonareLogo size={44} />
        </span>
        <div>
          <div className="about-name">ArcSonare</div>
          <div className="about-version">Version {version || "…"}</div>
        </div>
      </div>

      <SettingsGroup title="Application">
        <SettingRow label="Updates" description="Check whether a newer build is available.">
          <button
            type="button"
            className="btn"
            onClick={() =>
              setUpdateStatus(
                `You're running ArcSonare ${version}. Automatic updates are not enabled in this phase — new builds are installed manually.`,
              )
            }
          >
            Check for updates
          </button>
        </SettingRow>
        {updateStatus ? (
          <p className="field-help" role="status">
            {updateStatus}
          </p>
        ) : null}
        <SettingRow
          label="Privacy"
          description="ArcSonare stores its preferences and captures locally. No account is required; no telemetry is sent in this build."
        />
        <SettingRow
          label="Acknowledgements"
          description="Open-source software used by ArcSonare."
        >
          <button
            type="button"
            className="btn"
            onClick={() => setShowAcknowledgements((v) => !v)}
          >
            {showAcknowledgements ? "Hide" : "View"}
          </button>
        </SettingRow>
        {showAcknowledgements ? (
          <ul className="ack-list">
            {ACKNOWLEDGEMENTS.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        ) : null}
      </SettingsGroup>
    </div>
  );
}
