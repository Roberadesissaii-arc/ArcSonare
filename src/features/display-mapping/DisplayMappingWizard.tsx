/**
 * The display mapping wizard.
 *
 * Walks one monitor at a time through identification, nine calibration points
 * and five fresh validation points, then reports what it measured.
 *
 * The targets are positioned from coordinates Rust supplies, and the sample is
 * taken by Rust reading the real cursor — this component never converts a click
 * into a physical point. It renders instructions and progress; the measurement
 * belongs to the side that owns the geometry.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  beginNinePoint,
  cancelMapping,
  completeMapping,
  identifyDisplay,
  recordMappingClick,
  retryMappingSample,
  ratingLabel,
  runRandomValidation,
  ACCURACY_THRESHOLDS,
  SAMPLE_EVENT,
  startSession,
  type DisplayConfigurationSummary,
  type DisplayMappingWizardStep,
  type WizardStatus,
} from "./displayMappingService";

interface Props {
  displays: DisplayConfigurationSummary[];
  /** Stable identities to walk through, in order. */
  queue: string[];
  onClose: () => void;
  onFinished: () => void;
}

export function DisplayMappingWizard({ displays, queue, onClose, onFinished }: Props) {
  const [step, setStep] = useState<DisplayMappingWizardStep>("intro");
  const [queueIndex, setQueueIndex] = useState(0);
  const [status, setStatus] = useState<WizardStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentId = queue[queueIndex];
  const display = displays.find((d) => d.displayId === currentId);
  const isLast = queueIndex >= queue.length - 1;

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  // A session holds a native overlay open. Leaving without cancelling would
  // strand a border on the user's screen with nothing to dismiss it.
  useEffect(() => {
    return () => {
      void cancelMapping().catch(() => undefined);
    };
  }, []);

  // Samples taken by the global Space shortcut have no caller to return to —
  // the key is pressed while some other window has focus, which is the whole
  // point of it being global. Rust pushes the new state here instead. Without
  // this the points record correctly and the interface simply stops moving.
  useEffect(() => {
    const unlisten = listen<WizardStatus>(SAMPLE_EVENT, (event) => {
      setStatus(event.payload);
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // Phase transitions belong to whoever observes the last sample land, and with
  // a global shortcut that is this listener rather than the call that started
  // it. Kept separate from the handler above so a re-render cannot fire it
  // twice.
  useEffect(() => {
    if (!status || busy) return;
    if (status.target || status.finished) return;
    void (async () => {
      if (status.phase === "nine-point") {
        const validating = await run(() => runRandomValidation(status.sessionId));
        if (!validating) return;
        setStatus(validating);
        setStep("random-validation");
      } else if (status.phase === "random-validation") {
        const finished = await run(() => completeMapping(status.sessionId));
        if (!finished) return;
        setStatus(finished);
        setStep("result");
      }
    })();
  }, [busy, run, status]);

  const beginDisplay = useCallback(
    async (displayId: string) => {
      const started = await run(() => startSession(displayId));
      if (!started) return;
      setStatus(started);
      setStep("identify-display");
      await run(() => identifyDisplay(started.sessionId));
    },
    [run],
  );

  const confirmIdentity = useCallback(async () => {
    if (!status) return;
    const next = await run(() => beginNinePoint(status.sessionId));
    if (!next) return;
    setStatus(next);
    setStep("nine-point");
  }, [run, status]);

  // The in-app fallback, for when the global shortcut could not be registered.
  // Advancing phases is left to the effect above so both input paths take the
  // same route out of a finished phase.
  const recordClick = useCallback(async () => {
    if (!status) return;
    const next = await run(() => recordMappingClick(status.sessionId));
    if (next) setStatus(next);
  }, [run, status]);

  const retry = useCallback(async () => {
    if (!status) return;
    const next = await run(() => retryMappingSample(status.sessionId));
    if (next) setStatus(next);
  }, [run, status]);

  const nextDisplay = useCallback(async () => {
    if (isLast) {
      onFinished();
      setStep("complete");
      return;
    }
    const index = queueIndex + 1;
    setQueueIndex(index);
    await beginDisplay(queue[index]);
  }, [beginDisplay, isLast, onFinished, queue, queueIndex]);

  const close = useCallback(() => {
    void cancelMapping().catch(() => undefined);
    onClose();
  }, [onClose]);

  // ---------------------------------------------------------------------
  // Target overlay — a full-screen layer while sampling
  // ---------------------------------------------------------------------
  const target = status?.target;
  const sampling = step === "nine-point" || step === "random-validation";

  return (
    <div className="dmw-backdrop" role="dialog" aria-modal="true" aria-label="Display mapping">
      {sampling && target && display ? (
        <TargetSurface
          target={target}
          display={display}
          onHit={recordClick}
          busy={busy}
          onRetry={retry}
          onCancel={close}
          feedback={status?.lastSample}
          canRedo={
            (status?.phase === "nine-point"
              ? status.ninePointCount
              : (status?.validationCount ?? 0)) > 0
          }
        />
      ) : (
        <div className="dmw-panel">
          {error && <p className="dmw-error">{error}</p>}

          {step === "intro" && (
            <>
              <h2 className="dmw-title">Check your displays</h2>
              <p className="dmw-body">
                ArcSonare needs to confirm that the coordinates it calculates land where it
                expects on each screen. You will click nine targets on each display, then five
                more to check the result.
              </p>
              <p className="dmw-note">
                This checks screen geometry only. It does not affect how well ArcSonare
                recognises what is on your screen.
              </p>
              <div className="dmw-actions">
                <button className="dmw-btn dmw-btn-ghost" onClick={close}>
                  Not now
                </button>
                <button
                  className="dmw-btn dmw-btn-primary"
                  disabled={busy || !queue.length}
                  onClick={() => void beginDisplay(queue[0])}
                >
                  Start
                </button>
              </div>
            </>
          )}

          {step === "identify-display" && display && (
            <>
              <h2 className="dmw-title">Is this the right display?</h2>
              <div className="dmw-display-card">
                <span className="dmw-display-label">{display.label}</span>
                <span className="dmw-display-name">{display.friendlyName}</span>
                <dl className="dmw-facts">
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
                  {display.primary && (
                    <div>
                      <dt>Primary</dt>
                      <dd>Yes</dd>
                    </div>
                  )}
                </dl>
              </div>
              <p className="dmw-body">
                A border should be showing around one of your screens. Confirm it is the one
                described above.
              </p>
              <div className="dmw-actions">
                <button className="dmw-btn dmw-btn-ghost" onClick={close}>
                  Cancel
                </button>
                <button
                  className="dmw-btn"
                  disabled={busy}
                  onClick={() => status && void run(() => identifyDisplay(status.sessionId))}
                >
                  Show again
                </button>
                <button
                  className="dmw-btn dmw-btn-primary"
                  disabled={busy}
                  onClick={() => void confirmIdentity()}
                >
                  Yes, continue
                </button>
              </div>
            </>
          )}

          {step === "result" && status?.summary && display && (
            <ResultPanel
              status={status}
              summary={status.summary}
              display={display}
              correctionApplied={status.correctionApplied === true}
              isLast={isLast}
              busy={busy}
              onRunAgain={() => void beginDisplay(display.displayId)}
              onNext={() => void nextDisplay()}
            />
          )}

          {step === "complete" && (
            <>
              <h2 className="dmw-title">Displays checked</h2>
              <p className="dmw-body">
                ArcSonare will use these measurements when placing highlights and moving the
                cursor.
              </p>
              <div className="dmw-actions">
                <button className="dmw-btn dmw-btn-primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Instructions while a native target is showing.
 *
 * There is deliberately no target element here. The ring is drawn by Rust at the
 * real desktop coordinate, because the main window covers only part of the
 * screen — a target positioned inside it lands wherever that fraction of the
 * window happens to fall, which measured a 443 px average error on the first
 * real run. All of that error was the wizard's own, and it would have been
 * recorded as the display's.
 *
 * The user aims the pointer at the native ring and presses Space. Space rather
 * than a click because the ring sits over whatever is on the desktop, and a
 * calibration run must not press things.
 */
function TargetSurface({
  target,
  display,
  onHit,
  onRetry,
  onCancel,
  busy,
  feedback,
  canRedo,
}: {
  target: NonNullable<WizardStatus["target"]>;
  display: DisplayConfigurationSummary;
  onHit: () => void;
  onRetry: () => void;
  onCancel: () => void;
  busy: boolean;
  feedback?: WizardStatus["lastSample"];
  canRedo: boolean;
}) {
  const calibrating = target.phase === "nine-point";
  const phaseLabel = calibrating ? "Calibration" : "Validation";
  // The five extra targets after the ninth are the surprising part: without
  // saying why they appeared, a user reasonably concludes the wizard is stuck
  // and starts pressing Space again.
  const phaseExplanation = calibrating
    ? "Nine points to learn where this display is."
    : "Calibration complete. Five fresh points to check the result.";

  // One sample per deliberate press. Holding Space produces a stream of keydown
  // events, and without this a leaned-on key would record the same cursor
  // position for every remaining target and call the display verified.
  const armed = useRef(true);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        // Also stops Space activating whichever button happens to have focus,
        // and stops the page scrolling under the HUD.
        e.preventDefault();
        if (e.repeat || !armed.current || busy) return;
        armed.current = false;
        onHit();
      } else if (e.key === "Escape") {
        onCancel();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") armed.current = true;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [busy, onCancel, onHit]);

  return (
    <div className="dmw-target-surface">
      <div className="dmw-target-hud">
        <span
          className={
            calibrating ? "dmw-target-phase" : "dmw-target-phase dmw-phase-validation"
          }
        >
          {phaseLabel}
        </span>
        <span className="dmw-target-progress">
          Point {target.index + 1} of {target.total}
          {target.label ? ` — ${target.label}` : ""}
        </span>
        <span className="dmw-phase-explain">{phaseExplanation}</span>
        <span className="dmw-target-hint">
          Move the pointer to the centre dot of the target on{" "}
          <strong>{display.label}</strong>. <strong>Do not click.</strong> Press{" "}
          <kbd>Space</kbd> to record — it works from any window.
        </span>
        {/* Feedback per press. Without it the user cannot tell a recorded point
            from an ignored one, presses again, and the second press lands at the
            old position — which is how three samples were lost on the first
            physical run. */}
        {feedback && (
          <span className={feedback.accepted ? "dmw-feedback-ok" : "dmw-feedback-bad"}>
            {feedback.message}
          </span>
        )}
        {/* No "record" button: pressing one would put the cursor on the button
            rather than the ring, and that position is what gets measured. */}
        <div className="dmw-target-hud-actions">
          {/* Nothing to redo until something has been accepted. */}
          <button
            className="dmw-btn dmw-btn-ghost"
            onClick={onRetry}
            disabled={busy || !canRedo}
          >
            Redo last
          </button>
          <button className="dmw-btn dmw-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultPanel({
  status,
  summary,
  display,
  correctionApplied,
  isLast,
  busy,
  onRunAgain,
  onNext,
}: {
  status: WizardStatus;
  summary: NonNullable<WizardStatus["summary"]>;
  display: DisplayConfigurationSummary;
  correctionApplied: boolean;
  isLast: boolean;
  busy: boolean;
  onRunAgain: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <h2 className="dmw-title">
        {summary.passed ? "Display verified" : "Display verification needs another run"}
      </h2>
      <p className={summary.passed ? "dmw-rating-ok" : "dmw-rating-bad"}>
        Accuracy: <strong>{ratingLabel(summary.rating)}</strong>
      </p>
      <div className="dmw-display-card">
        <span className="dmw-display-label">{display.label}</span>
        <span className="dmw-display-name">{display.friendlyName}</span>
      </div>
      {/* Two runs, reported separately. Showing one "Samples: 5" after a
          fourteen-point session leaves the user unable to tell which half the
          numbers describe. */}
      <h3 className="dmw-section">Calibration</h3>
      <dl className="dmw-facts dmw-facts-wide">
        <div>
          <dt>Accepted</dt>
          <dd>{status.ninePointCount}</dd>
        </div>
        <div>
          <dt>Rejected attempts</dt>
          <dd>{status.rejectedCount}</dd>
        </div>
        <div>
          <dt>Outliers removed</dt>
          <dd>{status.outliersRemoved}</dd>
        </div>
        <div>
          <dt>Fit residual</dt>
          <dd>
            {status.calibrationResidualPx !== undefined
              ? `${status.calibrationResidualPx.toFixed(1)} px`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Correction</dt>
          <dd>{correctionApplied ? "Applied" : "Identity retained"}</dd>
        </div>
      </dl>
      {/* Why, in the wizard's own words. A fitted correction that reproduces its
          own calibration points proves nothing; what matters is whether it beat
          identity on the five points it never saw. */}
      {status.correctionDecision && (
        <p className="dmw-note">{status.correctionDecision.reason}.</p>
      )}

      <h3 className="dmw-section">Validation</h3>
      <dl className="dmw-facts dmw-facts-wide">
        <div>
          <dt>Accepted</dt>
          <dd>{summary.sampleCount}</dd>
        </div>
        <div>
          <dt>Average error</dt>
          <dd>{summary.averageErrorPx.toFixed(1)} px</dd>
        </div>
        <div>
          <dt>Maximum error</dt>
          <dd>{summary.maximumErrorPx.toFixed(1)} px</dd>
        </div>
        <div>
          <dt>Wrong display</dt>
          <dd>{summary.wrongDisplayCount}</dd>
        </div>
        <div>
          <dt>Out of bounds</dt>
          <dd>{summary.outOfBoundsCount}</dd>
        </div>
      </dl>
      {summary.passed ? (
        <p className="dmw-note">
          Coordinates on this display are accurate. This says nothing about how well ArcSonare
          recognises what is on screen — that is measured separately.
        </p>
      ) : (
        <p className="dmw-error">
          The measurements were outside tolerance. Visual actions stay blocked on this display
          until a run passes.
        </p>
      )}
      <p className="dmw-thresholds">
        Excellent: average ≤ {ACCURACY_THRESHOLDS.excellent.average} px, maximum ≤{" "}
        {ACCURACY_THRESHOLDS.excellent.maximum} px · Valid: average ≤{" "}
        {ACCURACY_THRESHOLDS.valid.average} px, maximum ≤ {ACCURACY_THRESHOLDS.valid.maximum} px
      </p>
      <div className="dmw-actions">
        <button className="dmw-btn" onClick={onRunAgain} disabled={busy}>
          Run again
        </button>
        <button className="dmw-btn dmw-btn-primary" onClick={onNext} disabled={busy}>
          {isLast ? "Finish" : "Next display"}
        </button>
      </div>
    </>
  );
}
