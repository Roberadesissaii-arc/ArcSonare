import { USAGE_CATEGORIES } from "./dataCategoryRegistry";
import { UsageCategoryIcon } from "./CategoryIcons";
import { DataPrivacyCard } from "./DataPrivacyCard";
import {
  formatBytes,
  percentOf,
  type StorageScanResult,
} from "./dataPrivacyTypes";

interface UsageOverviewCardProps {
  scan: StorageScanResult | null;
  scanning: boolean;
  onRefresh: () => void;
  onManage: (categoryId: string) => void;
}

export function UsageOverviewCard({
  scan,
  scanning,
  onRefresh,
  onManage,
}: UsageOverviewCardProps) {
  const total = scan?.totalBytes ?? 0;
  const scannedLabel = scan
    ? `Last scanned ${relativeScan(scan.scannedAt, scan.scanDurationMs)}`
    : scanning
      ? "Calculating storage…"
      : "Not scanned yet";

  return (
    <DataPrivacyCard
      title="Usage overview"
      description="See which ArcSonare data categories use local storage."
      actions={
        <button
          type="button"
          className="btn btn-small"
          onClick={onRefresh}
          disabled={scanning}
        >
          {scanning ? "Scanning…" : "Refresh"}
        </button>
      }
    >
      <ul className="data-usage-list">
        {USAGE_CATEGORIES.map((cat) => {
          const row = scan?.categories.find((c) => c.id === cat.id);
          const bytes = row?.bytes ?? 0;
          const pct = percentOf(bytes, total);
          return (
            <li key={cat.id} className="data-usage-row">
              <UsageCategoryIcon id={cat.id} tone={cat.tone} />
              <div className="data-usage-meta">
                <span className="data-usage-name">{cat.displayName}</span>
                <span className="data-usage-desc">{cat.description}</span>
              </div>
              <span className="data-usage-size">{formatBytes(bytes)}</span>
              <span className="data-usage-pct">{pct}%</span>
              <span
                className="data-usage-bar"
                role="meter"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${cat.displayName}, ${formatBytes(bytes)}, ${pct} percent of local storage`}
              >
                <span
                  className={`data-usage-fill tone-${cat.tone}`}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onManage(cat.id)}
              >
                Manage
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="data-usage-footer">
        <div>
          <span className="data-usage-total-label">Total local storage used</span>
          <span className="data-usage-scanned">{scannedLabel}</span>
        </div>
        <strong className="data-usage-total-value">{formatBytes(total)}</strong>
      </footer>
      {scan?.errors?.length ? (
        <p className="data-privacy-error" role="status">
          {scan.errors[0]}
        </p>
      ) : null}
    </DataPrivacyCard>
  );
}

function relativeScan(scannedAt: string, durationMs: number): string {
  const secs = Number(scannedAt);
  if (!Number.isFinite(secs) || secs <= 0) return `${durationMs} ms`;
  const age = Math.max(0, Math.floor(Date.now() / 1000 - secs));
  if (age < 60) return `just now (${durationMs} ms)`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  return `${Math.floor(age / 3600)}h ago`;
}
