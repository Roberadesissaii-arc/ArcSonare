import { useState } from "react";
import { Dropdown } from "../../components/settings/Dropdown";
import {
  DEFAULT_PREFS,
  type DataRetention,
  type RetentionDataType,
  RETENTION_DATA_TYPES,
} from "../../config/prefs";
import {
  RETENTION_DESCRIPTIONS,
  RETENTION_LABELS,
  retentionOptionsFor,
} from "./dataCategoryRegistry";
import { RetentionCategoryIcon } from "./CategoryIcons";
import { DataPrivacyCard } from "./DataPrivacyCard";

interface RetentionControlsCardProps {
  retention: Record<RetentionDataType, DataRetention>;
  onChange: (id: RetentionDataType, value: DataRetention) => void;
  onReset: () => void;
}

export function RetentionControlsCard({
  retention,
  onChange,
  onReset,
}: RetentionControlsCardProps) {
  const [pending, setPending] = useState<{
    id: RetentionDataType;
    next: DataRetention;
  } | null>(null);

  const requestChange = (id: RetentionDataType, next: DataRetention) => {
    const current = retention[id];
    if (isShorter(current, next)) {
      setPending({ id, next });
      return;
    }
    onChange(id, next);
  };

  return (
    <DataPrivacyCard
      title="Retention controls"
      description="Choose how long different types of data are kept on this device."
    >
      <ul className="data-retention-list">
        {RETENTION_DATA_TYPES.map((id) => (
          <li key={id} className="data-retention-row">
            <RetentionCategoryIcon id={id} />
            <div className="data-retention-meta">
              <span className="data-retention-name">{RETENTION_LABELS[id]}</span>
              <span className="data-retention-desc">
                {RETENTION_DESCRIPTIONS[id]}
              </span>
            </div>
            <Dropdown
              options={retentionOptionsFor(id)}
              value={retention[id]}
              onChange={(value) => requestChange(id, value)}
              ariaLabel={`Retention for ${RETENTION_LABELS[id]}`}
            />
          </li>
        ))}
      </ul>
      <footer className="data-retention-footer">
        <p>These settings apply only to local data on this device.</p>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            if (
              window.confirm(
                "Reset retention to recommended values? Existing data is not deleted immediately.",
              )
            ) {
              onReset();
            }
          }}
        >
          Reset to recommended
        </button>
      </footer>

      {pending ? (
        <div className="data-confirm-banner" role="alertdialog">
          <p>
            Change {RETENTION_LABELS[pending.id]} retention to “
            {retentionOptionsFor(pending.id).find((o) => o.value === pending.next)
              ?.label}
            ”? Existing items older than the new window will be removed during
            the next cleanup — not instantly.
          </p>
          <div className="data-confirm-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => {
                onChange(pending.id, pending.next);
                setPending(null);
              }}
            >
              Change retention
            </button>
          </div>
        </div>
      ) : null}
    </DataPrivacyCard>
  );
}

const ORDER: DataRetention[] = [
  "never",
  "after-processing",
  "1h",
  "1d",
  "7d",
  "30d",
  "manual",
];

function isShorter(current: DataRetention, next: DataRetention): boolean {
  return ORDER.indexOf(next) < ORDER.indexOf(current);
}

export function recommendedRetention(): Record<
  RetentionDataType,
  DataRetention
> {
  return { ...DEFAULT_PREFS.dataPrivacy.retention };
}
