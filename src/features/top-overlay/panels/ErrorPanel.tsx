import { invoke } from "@tauri-apps/api/core";
import type { OverlayError } from "../overlayTypes";

interface ErrorPanelProps {
  error: OverlayError;
  onCancel: () => void;
  onRetry?: () => void;
}

export function ErrorPanel({ error, onCancel, onRetry }: ErrorPanelProps) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        [error.code, error.message].filter(Boolean).join(": "),
      );
    } catch {
      // clipboard may be unavailable
    }
  };

  return (
    <div className="overlay-panel error-panel">
      <p className="panel-heading">Something went wrong</p>
      <p className="panel-body">{error.message}</p>
      {error.code ? <p className="panel-note">Code: {error.code}</p> : null}
      <div className="panel-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-secondary" onClick={() => void copy()}>
          Copy error details
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void invoke("open_settings")}
        >
          Open Settings
        </button>
        {onRetry ? (
          <button type="button" className="btn-primary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
