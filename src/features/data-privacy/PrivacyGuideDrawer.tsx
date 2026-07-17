import { CloseIcon } from "../../components/Icons";
import type { Prefs } from "../../config/prefs";

interface PrivacyGuideDrawerProps {
  dataPrivacy: Prefs["dataPrivacy"];
  onClose: () => void;
}

export function PrivacyGuideDrawer({
  dataPrivacy: dp,
  onClose,
}: PrivacyGuideDrawerProps) {
  const leaves = dp.allowCloud
    ? "Cloud model requests may leave this device when you (or an approved workflow) send them."
    : "Cloud processing is off — AI requests stay on configured local/runtime paths only.";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside
        className="data-drawer"
        role="dialog"
        aria-label="Privacy guide"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="data-drawer-head">
          <div>
            <h2>Privacy guide</h2>
            <p>How ArcSonare handles local and cloud data on this device.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </header>
        <div className="data-guide-body">
          <section>
            <h3>Local-first</h3>
            <p>
              Tasks, agents, preferences, and Screen Context captures live under
              your ArcSonare data folder. API keys use Windows Credential Manager
              and are never written to localStorage.
            </p>
          </section>
          <section>
            <h3>What leaves this device?</h3>
            <p>{leaves}</p>
            <p>
              Ask before cloud processing:{" "}
              {dp.askBeforeCloud ? "enabled" : "disabled"}.
            </p>
          </section>
          <section>
            <h3>Voice & Screen Context</h3>
            <p>
              Transcripts stored: {dp.storeTranscripts ? "yes" : "no"}. Raw audio:{" "}
              {dp.storeRawAudio ? "yes" : "no"}. Captures stored:{" "}
              {dp.storeCaptures ? "yes" : "no"}.
            </p>
          </section>
          <section>
            <h3>Diagnostics</h3>
            <p>
              This build does not send anonymous diagnostics, crash reports, or
              performance metrics — regardless of toggle state.
            </p>
          </section>
          <section>
            <h3>Current limitations</h3>
            <p>
              Application-level AES encryption for files is not implemented.
              Automatic backup is not configured. Retention cleanup for some
              categories runs when those pipelines are active.
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
