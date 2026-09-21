import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CloseIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import { formatBytes, type StorageScanResult } from "./dataPrivacyTypes";
import { localStorageKeys } from "./dataPrivacyActions";

const PHRASE = "DELETE MY LOCAL DATA";

interface DeleteAllDataDialogProps {
  scan: StorageScanResult | null;
  onClose: () => void;
  onDone: () => void;
}

export function DeleteAllDataDialog({
  scan,
  onClose,
  onDone,
}: DeleteAllDataDialogProps) {
  const [step, setStep] = useState(1);
  const [typed, setTyped] = useState("");
  const [removeCredentials, setRemoveCredentials] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("clear_capture_history").catch(() => undefined);
      await invoke("clear_category_files", { category: "voice-transcripts" }).catch(
        () => undefined,
      );
      await invoke("clear_category_files", { category: "model-cache" }).catch(
        () => undefined,
      );
      await invoke("clear_local_data");

      const keys = localStorageKeys(["arcsonare."]);
      keys.forEach((k) => window.localStorage.removeItem(k));

      if (removeCredentials) {
        for (const provider of [
          "anthropic",
          "openai",
          "google",
          "xai",
          "deepseek",
        ]) {
          await invoke("delete_provider_key", { provider }).catch(() => undefined);
        }
      }

      onDone();
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : "Deletion failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal data-delete-dialog"
        role="alertdialog"
        aria-label="Delete all local data"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 className="modal-title">Delete all local data</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </header>

        {step === 1 ? (
          <>
            <p className="page-lede">
              This will remove approximately{" "}
              <strong>{formatBytes(scan?.totalBytes ?? 0)}</strong> across{" "}
              {(scan?.totalFiles ?? 0).toLocaleString()} tracked files/keys,
              including tasks, agents, activity, captures, cache, and preferences.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="page-lede">The following are not deleted unless selected:</p>
            <ul className="data-delete-remain">
              <li>Credentials in Windows Credential Manager (optional below)</li>
              <li>Installer files</li>
              <li>Cloud-provider data stored outside ArcSonare</li>
              <li>Files in connected services</li>
            </ul>
            <p className="field-help">
              Files will be deleted using the standard Windows filesystem.
            </p>
            <div className="data-control-row">
              <div>
                <span className="data-control-label">
                  Also remove provider credentials
                </span>
                <span className="data-control-desc">
                  Unchecked by default. Removes API keys from Credential Manager.
                </span>
              </div>
              <Toggle
                checked={removeCredentials}
                onChange={setRemoveCredentials}
                label="Also remove provider credentials"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setStep(3)}>
                Continue
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <p className="page-lede">
              Type <strong>{PHRASE}</strong> to confirm.
            </p>
            <input
              className="modal-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Confirmation phrase"
              autoComplete="off"
            />
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || typed.trim() !== PHRASE}
                onClick={() => void run()}
              >
                {busy ? "Deleting…" : "Delete all local data"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
