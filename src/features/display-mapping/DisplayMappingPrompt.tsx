/**
 * The first-run nudge about unchecked displays.
 *
 * Deliberately not a gate. ArcSonare opens, the tray works, shortcuts work, and
 * every native action — opening a folder, launching an app, editing a file —
 * runs without a display profile, because none of them depend on knowing where a
 * pixel is. Only visual actions are held back, and only on the display that has
 * not been checked.
 *
 * Dismissing it is remembered for the session and recorded, so showing the main
 * window again does not re-ask. A prompt that reappears on every show is one the
 * user learns to dismiss without reading, which is how a real warning gets
 * missed later.
 */
import { useEffect, useState } from "react";
import {
  getDisplays,
  getPendingConfiguration,
  ignoreDisplay,
  type DisplayConfigurationSummary,
} from "./displayMappingService";
import { DisplayMappingWizard } from "./DisplayMappingWizard";

const DISMISSED_KEY = "arcsonare.displayMapping.promptDismissedAt";
/** How long "Later" lasts before ArcSonare mentions it again. */
const SNOOZE_MS = 1000 * 60 * 60 * 24 * 7;

function snoozed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // A prompt that cannot be snoozed is a nuisance, not a failure.
  }
}

export function DisplayMappingPrompt() {
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [displays, setDisplays] = useState<DisplayConfigurationSummary[]>([]);
  const [visible, setVisible] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wizardQueue, setWizardQueue] = useState<string[] | null>(null);

  useEffect(() => {
    void (async () => {
      if (snoozed()) return;
      try {
        const pending = await getPendingConfiguration();
        if (pending.pendingCount === 0) return;
        setPendingIds(pending.pendingDisplayIds);
        setDisplays(await getDisplays());
        setSelected(new Set(pending.pendingDisplayIds));
        setVisible(true);
      } catch {
        // Never block startup on this. An unreadable display list is a reason
        // to stay quiet, not to show an error the user cannot act on.
      }
    })();
  }, []);

  if (!visible) {
    return wizardQueue ? (
      <DisplayMappingWizard
        displays={displays}
        queue={wizardQueue}
        onClose={() => setWizardQueue(null)}
        onFinished={() => undefined}
      />
    ) : null;
  }

  const pendingDisplays = displays.filter((d) => pendingIds.includes(d.displayId));

  return (
    <div className="dm-prompt-backdrop">
      <div className="dm-prompt">
        <h2 className="dm-prompt-title">Display verification required</h2>
        <p className="dm-prompt-body">
          ArcSonare detected {pendingDisplays.length}{" "}
          {pendingDisplays.length === 1 ? "display" : "displays"} it has not checked yet.
          Verify {pendingDisplays.length === 1 ? "it" : "them"} so highlights, cursor movement
          and visual clicks land accurately.
        </p>
        <p className="dm-prompt-note">
          Everything else works meanwhile — opening folders, launching apps, editing files and
          voice all run without this.
        </p>

        {choosing && (
          <ul className="dm-prompt-list">
            {pendingDisplays.map((d) => (
              <li key={d.displayId}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(d.displayId)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(d.displayId);
                      else next.delete(d.displayId);
                      setSelected(next);
                    }}
                  />
                  <span>
                    {d.label} — {d.friendlyName} ({d.width}×{d.height})
                  </span>
                </label>
                <button
                  className="dm-btn dm-btn-ghost"
                  onClick={() => {
                    void ignoreDisplay(d.displayId).catch(() => undefined);
                    setPendingIds((ids) => ids.filter((id) => id !== d.displayId));
                  }}
                >
                  Ignore
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="dm-prompt-actions">
          <button
            className="dm-btn dm-btn-ghost"
            onClick={() => {
              snooze();
              setVisible(false);
            }}
          >
            Later
          </button>
          <button className="dm-btn" onClick={() => setChoosing((v) => !v)}>
            {choosing ? "Hide list" : "Choose displays"}
          </button>
          <button
            className="dm-btn dm-btn-primary"
            disabled={choosing && selected.size === 0}
            onClick={() => {
              const queue = choosing
                ? pendingIds.filter((id) => selected.has(id))
                : pendingIds;
              setVisible(false);
              setWizardQueue(queue);
            }}
          >
            Configure now
          </button>
        </div>
      </div>
    </div>
  );
}
