import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckIcon,
  DotsIcon,
  FolderIcon,
  ShieldIcon,
} from "../../components/Icons";
import { DataPrivacyCard } from "./DataPrivacyCard";
import {
  backupLabel,
  encryptionLabel,
  folderStatusLabel,
} from "./dataPrivacyActions";
import { formatBytes, type StorageScanResult } from "./dataPrivacyTypes";

interface DataLocationCardProps {
  scan: StorageScanResult | null;
  scanning: boolean;
  onRefresh: () => void;
}

export function DataLocationCard({
  scan,
  scanning,
  onRefresh,
}: DataLocationCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const path = scan?.dataDir ?? "Loading…";
  const status = scan?.folderStatus ?? "loading";
  const ready = status === "ready";

  useEffect(() => {
    if (!menuOpen) return;
    const onPtr = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPtr);
    return () => window.removeEventListener("pointerdown", onPtr);
  }, [menuOpen]);

  const copyPath = async () => {
    if (!scan?.dataDir) return;
    try {
      await navigator.clipboard.writeText(scan.dataDir);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be denied.
    }
    setMenuOpen(false);
  };

  const openFolder = () => {
    invoke("open_data_folder").catch((err) =>
      console.error("[ArcSonare] open data folder failed:", err),
    );
  };

  return (
    <DataPrivacyCard title="Data location">
      <div className="data-location-main">
        <span className="data-location-tile" aria-hidden="true">
          <FolderIcon size={22} />
        </span>
        <div className="data-location-meta">
          <span className="data-location-label">Local data folder</span>
          <code className="data-location-path" title={path}>
            {path}
          </code>
          <span
            className={`data-location-badge${ready ? " is-ready" : " is-warn"}`}
          >
            {ready ? <CheckIcon size={11} /> : null}
            {folderStatusLabel(status)}
          </span>
        </div>
        <div className="data-location-actions">
          <button
            type="button"
            className="btn btn-small"
            onClick={openFolder}
            disabled={!scan || status === "unavailable"}
          >
            <FolderIcon size={13} />
            Open folder
          </button>
          <div className="data-more-wrap" ref={menuRef}>
            <button
              type="button"
              className="data-more-btn"
              aria-label="Data location options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <DotsIcon size={14} />
            </button>
            {menuOpen ? (
              <ul className="data-more-menu" role="menu">
                <li>
                  <button type="button" role="menuitem" onClick={copyPath}>
                    {copied ? "Copied" : "Copy folder path"}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onRefresh();
                      setMenuOpen(false);
                    }}
                  >
                    Recalculate storage
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      <div className="data-location-metrics" aria-label="Storage summary">
        <div className="data-metric">
          <span className="data-metric-label">Storage used</span>
          <span className="data-metric-value">
            {scanning && !scan ? "…" : formatBytes(scan?.totalBytes ?? 0)}
          </span>
        </div>
        <div className="data-metric">
          <span className="data-metric-label">Files</span>
          <span className="data-metric-value">
            {(scan?.totalFiles ?? 0).toLocaleString()}
          </span>
        </div>
        <div className="data-metric">
          <span className="data-metric-label">Last backup</span>
          <span className="data-metric-value">
            {backupLabel(scan?.backupStatus ?? "not-configured")}
          </span>
        </div>
        <div className="data-metric">
          <span className="data-metric-label">Encryption</span>
          <span className="data-metric-value" title="API keys use Windows Credential Manager; other local files are not AES-encrypted by ArcSonare.">
            <ShieldIcon size={12} />
            {encryptionLabel(scan?.encryptionStatus ?? "secrets-protected-separately")}
          </span>
        </div>
      </div>
    </DataPrivacyCard>
  );
}
