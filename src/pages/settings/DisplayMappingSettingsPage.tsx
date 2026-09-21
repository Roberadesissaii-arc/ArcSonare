/**
 * Settings → Desktop Interaction → Display Mapping.
 *
 * Shows what ArcSonare knows about each monitor and lets the user re-check,
 * ignore or forget one.
 *
 * The page is careful about one thing in particular: a verified mapping means
 * coordinates land where intended, and nothing more. It is deliberately never
 * phrased as ArcSonare being "calibrated" or "accurate", because that reads as a
 * promise about recognising what is on screen — a different question with a
 * different answer.
 */
import { useCallback, useEffect, useState } from "react";
import { DisplayMappingWizard } from "../../features/display-mapping/DisplayMappingWizard";
import {
  arrangementLayout,
  enableDisplay,
  formatTimestamp,
  getDisplays,
  ignoreDisplay,
  removeDisplayProfile,
  statusExplanation,
  statusLabel,
  testDisplayCursor,
  testDisplayOverlay,
  type CursorTestResult,
  type DisplayConfigurationSummary,
} from "../../features/display-mapping/displayMappingService";

const DIAGRAM_WIDTH = 420;
const DIAGRAM_HEIGHT = 190;

export function DisplayMappingSettingsPage() {
  const [displays, setDisplays] = useState<DisplayConfigurationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardQueue, setWizardQueue] = useState<string[] | null>(null);
  const [cursorTest, setCursorTest] = useState<Record<string, CursorTestResult>>({});
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDisplays(await getDisplays());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      try {
        await work();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  const layout = arrangementLayout(displays, DIAGRAM_WIDTH, DIAGRAM_HEIGHT);
  const attached = displays.filter((d) => d.connected);
  const pending = attached.filter((d) => d.needsConfiguration);

  return (
    <section className="settings-panel dm-page">
      <header className="dm-header">
        <div>
          <h2 className="settings-panel-title">Display Mapping</h2>
          <p className="settings-panel-subtitle">
            Confirms that the coordinates ArcSonare calculates land where it means them to.
            Visual actions — highlights, cursor movement, clicks — are held back on any display
            that has not been checked. Opening folders, launching apps and editing files are
            unaffected.
          </p>
        </div>
        {pending.length > 0 && (
          <button
            className="dm-btn dm-btn-primary"
            onClick={() => setWizardQueue(pending.map((d) => d.displayId))}
          >
            Check {pending.length} display{pending.length === 1 ? "" : "s"}
          </button>
        )}
      </header>

      {error && <p className="dm-error">{error}</p>}
      {loading && displays.length === 0 && <p className="dm-muted">Reading displays…</p>}

      {attached.length > 0 && (
        <div className="dm-card dm-arrangement-card">
          <h3 className="dm-card-title">Arrangement</h3>
          <p className="dm-muted dm-arrangement-note">
            As Windows reports it. Read-only — change the layout in Windows Display Settings.
          </p>
          <div
            className="dm-arrangement"
            style={{ width: DIAGRAM_WIDTH, height: DIAGRAM_HEIGHT }}
          >
            {layout.map((box) => {
              const d = displays.find((x) => x.displayId === box.displayId);
              if (!d) return null;
              return (
                <div
                  key={box.displayId}
                  className={`dm-monitor dm-monitor-${d.status}`}
                  style={{
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                  }}
                  title={`${d.label} — ${d.friendlyName}`}
                >
                  <span className="dm-monitor-label">{d.label.replace("Display ", "")}</span>
                  <span className="dm-monitor-res">
                    {d.width}×{d.height}
                  </span>
                  {d.primary && <span className="dm-monitor-primary">Primary</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {displays.map((display) => (
        <article key={display.displayId} className="dm-card">
          <div className="dm-card-head">
            <div>
              <h3 className="dm-card-title">
                {display.label} — {display.friendlyName}
              </h3>
              <p className="dm-muted">{statusExplanation(display.status)}</p>
            </div>
            <span className={`dm-status dm-status-${display.status}`}>
              {statusLabel(display.status)}
            </span>
          </div>

          <dl className="dm-facts">
            <div>
              <dt>Resolution</dt>
              <dd>
                {display.width} × {display.height}
              </dd>
            </div>
            <div>
              <dt>Scale</dt>
              <dd>{Math.round(display.scaleFactor * 100)}%</dd>
            </div>
            <div>
              <dt>Orientation</dt>
              <dd>{display.orientation}</dd>
            </div>
            <div>
              <dt>Position</dt>
              <dd>
                {display.x}, {display.y}
              </dd>
            </div>
            <div>
              <dt>Primary</dt>
              <dd>{display.primary ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Connected</dt>
              <dd>{display.connected ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Samples</dt>
              <dd>{display.sampleCount || "—"}</dd>
            </div>
            <div>
              <dt>Average error</dt>
              <dd>{display.sampleCount ? `${display.averageErrorPx.toFixed(1)} px` : "—"}</dd>
            </div>
            <div>
              <dt>Maximum error</dt>
              <dd>{display.sampleCount ? `${display.maximumErrorPx.toFixed(1)} px` : "—"}</dd>
            </div>
            <div>
              <dt>Configured</dt>
              <dd>{formatTimestamp(display.configuredAtMs)}</dd>
            </div>
            <div>
              <dt>Last checked</dt>
              <dd>{formatTimestamp(display.validatedAtMs)}</dd>
            </div>
          </dl>

          <p className="dm-identity" title={display.displayId}>
            <span className="dm-identity-label">Hardware identity</span>
            <code>{display.displayId}</code>
          </p>

          {cursorTest[display.displayId] && (
            <p className={cursorTest[display.displayId].onIntendedDisplay ? "dm-ok" : "dm-error"}>
              Cursor landed {cursorTest[display.displayId].errorPx.toFixed(1)} px from the
              centre of this display
              {cursorTest[display.displayId].onIntendedDisplay ? "." : " — on another screen."}
            </p>
          )}

          <div className="dm-actions">
            {display.connected && display.status !== "ignored" && (
              <button
                className="dm-btn dm-btn-primary"
                onClick={() => setWizardQueue([display.displayId])}
              >
                {display.status === "valid" ? "Re-check" : "Check now"}
              </button>
            )}
            {display.connected && (
              <>
                <button
                  className="dm-btn"
                  onClick={() => void act(() => testDisplayOverlay(display.displayId))}
                >
                  Test overlay
                </button>
                <button
                  className="dm-btn"
                  onClick={() =>
                    void (async () => {
                      try {
                        const result = await testDisplayCursor(display.displayId);
                        setCursorTest((prev) => ({ ...prev, [display.displayId]: result }));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    })()
                  }
                >
                  Test cursor
                </button>
              </>
            )}
            {display.status === "ignored" ? (
              <button
                className="dm-btn"
                onClick={() => void act(() => enableDisplay(display.displayId))}
              >
                Re-enable
              </button>
            ) : (
              display.connected && (
                <button
                  className="dm-btn"
                  onClick={() => void act(() => ignoreDisplay(display.displayId))}
                >
                  Ignore
                </button>
              )
            )}
            {!display.connected && (
              <button
                className="dm-btn dm-btn-danger"
                onClick={() => void act(() => removeDisplayProfile(display.displayId))}
              >
                Forget this display
              </button>
            )}
          </div>
        </article>
      ))}

      <div className="dm-card">
        <button className="dm-btn" onClick={() => setDiagnosticsOpen((v) => !v)}>
          {diagnosticsOpen ? "Hide diagnostics" : "Diagnostics"}
        </button>
        {diagnosticsOpen && <Diagnostics />}
      </div>

      {wizardQueue && (
        <DisplayMappingWizard
          displays={displays}
          queue={wizardQueue}
          onClose={() => {
            setWizardQueue(null);
            void refresh();
          }}
          onFinished={() => void refresh()}
        />
      )}
    </section>
  );
}

function Diagnostics() {
  const [data, setData] = useState<string>("Loading…");
  useEffect(() => {
    void (async () => {
      try {
        const { getDiagnostics } = await import(
          "../../features/display-mapping/displayMappingService"
        );
        setData(JSON.stringify(await getDiagnostics(), null, 2));
      } catch (e) {
        setData(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);
  return <pre className="dm-diagnostics">{data}</pre>;
}
