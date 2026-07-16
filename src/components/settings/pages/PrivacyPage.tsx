import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingRow } from "../SettingRow";
import { Toggle } from "../Toggle";

/**
 * Privacy overview. Voice, screen context and history do not exist yet in
 * this phase, so their switches are shown off and locked rather than
 * pretending to be functional.
 */
export function PrivacyPage() {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current !== null) {
        window.clearTimeout(confirmTimer.current);
      }
    };
  }, []);

  const clearData = () => {
    if (!confirming) {
      setConfirming(true);
      setStatus(null);
      confirmTimer.current = window.setTimeout(
        () => setConfirming(false),
        4000,
      );
      return;
    }
    if (confirmTimer.current !== null) {
      window.clearTimeout(confirmTimer.current);
    }
    setConfirming(false);
    invoke("clear_local_data")
      .then(() =>
        setStatus("Local data cleared. All preferences are back to defaults."),
      )
      .catch((err) =>
        setStatus(
          typeof err === "string" ? err : "Local data could not be cleared.",
        ),
      );
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Privacy</h1>
        <p className="page-subtitle">
          ArcSonare runs entirely on this computer. Voice, screen context and
          history are not active in this phase — these controls unlock when
          those capabilities ship.
        </p>
      </header>

      <SettingRow
        label="Microphone access"
        description="Voice capture is not part of this phase."
        disabled
      >
        <Toggle checked={false} onChange={() => {}} label="Microphone access" disabled />
      </SettingRow>

      <SettingRow
        label="Screen context"
        description="Reading the active screen is not part of this phase."
        disabled
      >
        <Toggle checked={false} onChange={() => {}} label="Screen context" disabled />
      </SettingRow>

      <SettingRow
        label="Local history"
        description="No activity history is recorded in this phase."
        disabled
      >
        <Toggle checked={false} onChange={() => {}} label="Local history" disabled />
      </SettingRow>

      <SettingRow
        label="Clear local data"
        description="Deletes the local settings file and restores defaults."
      >
        <button
          type="button"
          className={`btn${confirming ? " btn-danger" : ""}`}
          onClick={clearData}
        >
          {confirming ? "Click again to confirm" : "Clear data"}
        </button>
      </SettingRow>

      {status ? (
        <p className="field-help" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
