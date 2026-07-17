import { Dropdown } from "../../components/settings/Dropdown";
import { Toggle } from "../../components/settings/Toggle";
import type { Prefs, ScreenRetention } from "../../config/prefs";
import { CaptureHistoryEmptyState } from "./CaptureHistoryEmptyState";
import { CaptureHistoryList } from "./CaptureHistoryList";
import { ScreenContextCard } from "./ScreenContextCard";
import type { CaptureMeta } from "./types";

type PrivacyPrefs = Prefs["screenContext"]["privacy"];

const RETENTION_OPTIONS: { value: ScreenRetention; label: string }[] = [
  { value: "none", label: "Do not save" },
  { value: "after-processing", label: "Delete after processing" },
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "manual", label: "Keep until manually deleted" },
];

interface PrivacyHistoryCardProps {
  privacy: PrivacyPrefs;
  captures: CaptureMeta[];
  busy: boolean;
  onPrivacyChange: (patch: Partial<PrivacyPrefs>) => void;
  onClearHistory: () => void;
  onOpenCapture: (meta: CaptureMeta) => void;
  onDeleteCapture: (meta: CaptureMeta) => void;
}

export function PrivacyHistoryCard({
  privacy,
  captures,
  busy,
  onPrivacyChange,
  onClearHistory,
  onOpenCapture,
  onDeleteCapture,
}: PrivacyHistoryCardProps) {
  const clearHistory = () => {
    if (
      !window.confirm(
        "Delete every stored screen capture? This cannot be undone.",
      )
    ) {
      return;
    }
    onClearHistory();
  };

  return (
    <ScreenContextCard
      number={5}
      title="Privacy & history"
      description="Local retention and capture history on this device."
      className="screen-context-card-privacy"
    >
      <div className="screen-context-privacy-grid">
        <div className="screen-context-privacy-col">
          <div className="screen-context-toggle-row is-compact">
            <div className="screen-context-toggle-copy">
              <span className="screen-context-toggle-label">Save Screen Context history</span>
              <span className="screen-context-toggle-desc">
                Keep capture metadata and files under the ArcSonare data folder.
              </span>
            </div>
            <Toggle
              checked={privacy.saveHistory}
              onChange={(saveHistory) => onPrivacyChange({ saveHistory })}
              label="Save Screen Context history"
            />
          </div>
          <div className="screen-context-privacy-field">
            <span className="screen-context-field-label">Retention</span>
            <Dropdown<ScreenRetention>
              options={RETENTION_OPTIONS}
              value={privacy.retention}
              onChange={(retention) => onPrivacyChange({ retention })}
              ariaLabel="Screen capture retention"
            />
          </div>
          <div className="screen-context-toggle-row is-compact">
            <div className="screen-context-toggle-copy">
              <span className="screen-context-toggle-label">Store locally only</span>
              <span className="screen-context-toggle-desc">
                Captures never leave this computer in this build.
              </span>
            </div>
            <Toggle
              checked={privacy.localOnly}
              onChange={(localOnly) => onPrivacyChange({ localOnly })}
              label="Store locally only"
            />
          </div>
          <div className="screen-context-toggle-row is-compact">
            <div className="screen-context-toggle-copy">
              <span className="screen-context-toggle-label">Remove captures after processing</span>
            </div>
            <Toggle
              checked={privacy.removeAfterProcessing}
              onChange={(removeAfterProcessing) =>
                onPrivacyChange({ removeAfterProcessing })
              }
              label="Remove captures after processing"
            />
          </div>
          <div className="screen-context-toggle-row is-compact">
            <div
              className="screen-context-toggle-copy"
              title="Accessibility field detection is not built yet."
            >
              <span className="screen-context-toggle-label">
                Exclude password fields where detectable
              </span>
              <span className="screen-context-toggle-desc">
                Field detection requires the accessibility integration, which is not built yet.
              </span>
            </div>
            <Toggle
              checked={privacy.excludePasswordFields}
              onChange={(excludePasswordFields) =>
                onPrivacyChange({ excludePasswordFields })
              }
              label="Exclude password fields"
              disabled
            />
          </div>
          <button
            type="button"
            className="screen-context-btn is-danger"
            disabled={busy}
            onClick={clearHistory}
          >
            Clear screen-capture history
          </button>
        </div>

        <div className="screen-context-history-col">
          <h3 className="screen-context-history-heading">Capture history</h3>
          {captures.length === 0 ? (
            <CaptureHistoryEmptyState />
          ) : (
            <CaptureHistoryList
              captures={captures}
              onOpen={onOpenCapture}
              onDelete={onDeleteCapture}
            />
          )}
        </div>
      </div>
    </ScreenContextCard>
  );
}
