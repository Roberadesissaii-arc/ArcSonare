import {
  MonitorIcon,
  PlayIcon,
  StopIcon,
  TargetArrowIcon,
} from "../../components/Icons";

interface ScreenContextStatusHeroProps {
  active: boolean;
  busy: boolean;
  enabled: boolean;
  capturing?: boolean;
  error: string | null;
  pendingCapture?: boolean;
  onStart: () => void;
  onStop: () => void;
  onCaptureAnnotate: () => void;
  onConfirmCapture?: () => void;
  onCancelCapture?: () => void;
}

export function ScreenContextStatusHero({
  active,
  busy,
  enabled,
  capturing = false,
  error,
  pendingCapture = false,
  onStart,
  onStop,
  onCaptureAnnotate,
  onConfirmCapture,
  onCancelCapture,
}: ScreenContextStatusHeroProps) {
  const showLive = active || capturing;

  return (
    <section
      className={`screen-context-hero${showLive ? " is-active" : ""}${capturing ? " is-capturing" : ""}`}
      aria-labelledby="screen-context-hero-title"
    >
      <div className="screen-context-hero-left">
        <div className="screen-context-hero-status-ring">
          <span className="screen-context-hero-status-icon" aria-hidden="true">
            <MonitorIcon size={28} />
          </span>
          {active ? (
            <span className="screen-context-hero-live-badge" aria-hidden="true" />
          ) : null}
        </div>
        <div className="screen-context-hero-copy">
          <h2 id="screen-context-hero-title" className="screen-context-hero-title">
            {active ? (
              <>
                Screen Context is <span className="is-enabled">on</span>
              </>
            ) : enabled ? (
              "Screen Context is ready — press Start"
            ) : (
              "Screen Context is off"
            )}
          </h2>
          <p className="screen-context-hero-desc">
            {active
              ? "ArcSonare is watching the selected screen. The edge indicator and capture tools are active."
              : enabled
                ? "Preferences are saved. Press Start to show the edge indicator, or Capture & annotate to begin immediately."
                : "Turn on Enable Screen Context below, or press Start — both activate capture tools."}
          </p>
          {error ? (
            <p className="screen-context-hero-error" role="alert">
              {error}
            </p>
          ) : null}
          {pendingCapture ? (
            <div className="screen-context-inline-confirm" role="status">
              <p>Capture the selected screen and open annotation?</p>
              <div className="screen-context-inline-confirm-actions">
                <button
                  type="button"
                  className="screen-context-btn is-primary"
                  disabled={busy}
                  onClick={onConfirmCapture}
                >
                  Capture
                </button>
                <button
                  type="button"
                  className="screen-context-btn is-secondary"
                  disabled={busy}
                  onClick={onCancelCapture}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div
        className="screen-context-hero-preview"
        role="img"
        aria-label="Decorative monitor preview"
      >
        <div className="screen-context-hero-monitor">
          <span className="screen-context-hero-monitor-edge" aria-hidden="true" />
          <span className="screen-context-hero-monitor-cursor" aria-hidden="true" />
          <span className="screen-context-hero-monitor-trail" aria-hidden="true" />
          <span className="screen-context-hero-monitor-window" aria-hidden="true" />
        </div>
      </div>

      <div className="screen-context-hero-actions">
        {active ? (
          <button
            type="button"
            className="screen-context-btn is-primary"
            disabled={busy}
            onClick={onStop}
          >
            <StopIcon size={14} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="screen-context-btn is-primary"
            disabled={busy}
            onClick={onStart}
          >
            <PlayIcon size={14} />
            Start
          </button>
        )}
        <button
          type="button"
          className="screen-context-btn is-secondary"
          disabled={busy || pendingCapture}
          onClick={onCaptureAnnotate}
        >
          <TargetArrowIcon size={14} />
          Capture &amp; annotate
        </button>
        {active ? (
          <p className="screen-context-hero-hint">
            Capture &amp; annotate opens the drawing overlay. Start alone only shows the edge indicator.
          </p>
        ) : (
          <p className="screen-context-hero-hint">
            Enable Screen Context (or Start) turns it on. Capture &amp; annotate starts and opens the draw overlay.
          </p>
        )}
      </div>
    </section>
  );
}
