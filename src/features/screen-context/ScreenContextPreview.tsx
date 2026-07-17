import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CloseIcon } from "../../components/Icons";
import type { CaptureMeta } from "./types";

interface ScreenContextPreviewProps {
  meta: CaptureMeta;
  onClose: () => void;
  onDelete: () => void;
}

/** Modal preview of a stored capture (annotated variant when it exists). */
export function ScreenContextPreview({ meta, onClose, onDelete }: ScreenContextPreviewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("get_capture_data_url", {
      id: meta.id,
      annotated: meta.annotated,
    })
      .then(setDataUrl)
      .catch((err) =>
        setError(typeof err === "string" ? err : "The capture could not be loaded."),
      );
  }, [meta]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal capture-preview"
        role="dialog"
        aria-label="Screen capture preview"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">
            {meta.source === "active-window"
              ? (meta.activeWindowTitle ?? "Active window")
              : "Screen capture"}
          </span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close preview">
            <CloseIcon size={15} />
          </button>
        </div>
        {error ? (
          <p className="field-error">{error}</p>
        ) : dataUrl ? (
          <img className="capture-preview-img" src={dataUrl} alt="Screen capture" />
        ) : (
          <p className="field-help">Loading capture…</p>
        )}
        <p className="field-help">
          Screen context is stored locally. Model analysis is not configured
          yet — nothing was sent anywhere.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete capture
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
