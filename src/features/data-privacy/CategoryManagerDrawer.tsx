import { useState } from "react";
import { CloseIcon } from "../../components/Icons";
import { invoke } from "@tauri-apps/api/core";
import { USAGE_CATEGORIES } from "./dataCategoryRegistry";
import { formatBytes, type StorageScanResult } from "./dataPrivacyTypes";

interface CategoryManagerDrawerProps {
  categoryId: string;
  scan: StorageScanResult | null;
  onClose: () => void;
  onCleared: () => void;
}

export function CategoryManagerDrawer({
  categoryId,
  scan,
  onClose,
  onCleared,
}: CategoryManagerDrawerProps) {
  const [error, setError] = useState<string | null>(null);
  const def = USAGE_CATEGORIES.find((c) => c.id === categoryId);
  const row = scan?.categories.find((c) => c.id === categoryId);
  if (!def) return null;

  const openFolder = () => {
    const folder =
      categoryId === "screen-captures"
        ? "captures"
        : categoryId === "voice-transcripts"
          ? "voice"
          : categoryId === "model-cache"
            ? "cache"
            : "data";
    invoke("open_data_subfolder", { folder }).catch((err) =>
      console.error("[ArcSonare] open subfolder failed:", err),
    );
  };

  const clear = async () => {
    if (!def.clearable) return;
    setError(null);
    if (!window.confirm(`Clear ${def.displayName}? This cannot be undone.`)) {
      return;
    }
    try {
      if (categoryId === "activity-logs") {
        window.localStorage.removeItem("arcsonare.activity.v1");
      } else {
        await invoke("clear_category_files", { category: categoryId });
      }
      onCleared();
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : "Clear failed.");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside
        className="data-drawer"
        role="dialog"
        aria-label={`Manage ${def.displayName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="data-drawer-head">
          <div>
            <h2>{def.displayName}</h2>
            <p>{def.description}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </header>
        <dl className="data-drawer-stats">
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(row?.bytes ?? 0)}</dd>
          </div>
          <div>
            <dt>Files / keys</dt>
            <dd>{(row?.itemCount ?? row?.fileCount ?? 0).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>
              {categoryId === "activity-logs"
                ? "Browser localStorage"
                : scan?.dataDir
                  ? `${scan.dataDir}\\…`
                  : "—"}
            </dd>
          </div>
        </dl>
        <p className="data-drawer-note">
          {def.sensitive
            ? "Sensitive content is not previewed here. Open the folder to inspect files."
            : "Use Clear only when you intend to remove this category’s stored data."}
        </p>
        {error ? (
          <p className="data-privacy-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="data-drawer-actions">
          <button type="button" className="btn" onClick={openFolder}>
            Open folder
          </button>
          {def.clearable ? (
            <button type="button" className="btn btn-danger" onClick={() => void clear()}>
              Clear category
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
