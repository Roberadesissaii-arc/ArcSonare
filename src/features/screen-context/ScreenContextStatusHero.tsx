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
  onStart: () => void;
  onStop: () => void;
  onCaptureAnnotate: () => void;
}

export function ScreenContextStatusHero({
  active,
  busy,
  enabled,
  capturing = false,
  error,
  onStart,
  onStop,
  onCaptureAnnotate,
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
                Screen Context is <span className="is-enabled">enabled</span>
              </>
            ) : (
              "Screen Context is off"
            )}
          </h2>
          <p className="screen-context-hero-desc">
            {active
              ? "ArcSonare is watching the selected screen. The edge indicator and capture tools are active and ready when you need them."
              : "Enable Screen Context to show the screen-edge indicator and prepare capture tools."}
          </p>
          {error ? (
            <p className="screen-context-hero-error" role="alert">
              {error}
            </p>
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
          disabled={busy}
          onClick={onCaptureAnnotate}
        >
          <TargetArrowIcon size={14} />
          Capture &amp; annotate
        </button>
        {active ? (
          <p className="screen-context-hero-hint">
            Capture &amp; annotate opens the drawing overlay on a live screenshot. Start alone only shows the edge indicator.
          </p>
        ) : !enabled ? (
          <p className="screen-context-hero-hint">
            Start enables Screen Context. Then use Capture &amp; annotate to draw.
          </p>
        ) : null}
      </div>
    </section>
  );
}
