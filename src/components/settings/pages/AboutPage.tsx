import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { SonareLogo } from "../../overlay/SonareLogo";
import { SettingRow } from "../SettingRow";

const ACKNOWLEDGEMENTS = [
  "Tauri — application framework (MIT / Apache-2.0)",
  "React — user interface library (MIT)",
  "Vite — build tooling (MIT)",
  "global-hotkey — system-wide shortcuts (MIT / Apache-2.0)",
];

export function AboutPage() {
  const [version, setVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [showAcknowledgements, setShowAcknowledgements] = useState(false);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  const checkForUpdates = () => {
    setUpdateStatus(
      `You're running ArcSonare ${version}. Automatic updates are not enabled in this phase — new builds are installed manually.`,
    );
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">About</h1>
        <p className="page-subtitle">Sonare Desktop</p>
      </header>

      <div className="about-hero">
        <span className="about-logo">
          <SonareLogo size={44} />
        </span>
        <div>
          <div className="about-name">ArcSonare</div>
          <div className="about-version">Version {version || "…"}</div>
        </div>
      </div>

      <SettingRow
        label="Updates"
        description="Check whether a newer build is available."
      >
        <button type="button" className="btn" onClick={checkForUpdates}>
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
        description="ArcSonare stores its preferences locally on this computer. Nothing is sent anywhere; no audio is captured and no account is required in this phase."
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
    </div>
  );
}
