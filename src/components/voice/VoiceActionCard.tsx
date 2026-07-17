import { useState } from "react";
import { DotsIcon, GearIcon } from "../Icons";
import { useSettings } from "../../hooks/useSettings";
import { shortcutKeys } from "../../services/shortcutFormat";
import { getPrefs } from "../../stores/settingsStore";
import { navigateSettings } from "../../stores/appStore";
import { useVoiceState } from "../../stores/voiceStore";
import { SonareLiveWaveform } from "./SonareLiveWaveform";
import { SonareMarbleOrb } from "./SonareMarbleOrb";

/** Expanded Voice Action card: marble, current voice, waveform, shortcut. */
export function VoiceActionCard() {
  const { status } = useVoiceState();
  const { settings } = useSettings();
  const keys = shortcutKeys(settings?.globalShortcut ?? "Ctrl+Shift+Space");
  const prefs = getPrefs();
  const [voiceOpen, setVoiceOpen] = useState(false);

  const voiceConfigured = Boolean(prefs.voice.voiceId?.trim());
  const voiceName = voiceConfigured ? prefs.voice.voiceId : null;

  const openVoiceSettings = () => {
    navigateSettings("voice");
  };

  return (
    <section className="card sonare-card voice-action-card">
      <div className="card-head">
        <span className="card-label">Voice Action</span>
        <button type="button" className="icon-button" aria-label="Voice action options">
          <DotsIcon size={15} />
        </button>
      </div>

      <div className="voice-action-identity">
        <SonareMarbleOrb
          status={status === "idle" ? "idle" : status}
          size={42}
        />
        <div className="voice-action-voice-meta">
          <span className="voice-action-voice-label">Current voice</span>
          <span className="voice-action-voice-name">
            {voiceName ? String(voiceName) : "No speech provider configured"}
          </span>
        </div>
        <button
          type="button"
          className="text-action"
          onClick={() => {
            if (!voiceName) {
              openVoiceSettings();
              return;
            }
            setVoiceOpen((v) => !v);
          }}
        >
          Change
        </button>
      </div>

      {voiceOpen ? (
        <div className="mode-list" role="dialog" aria-label="Voice selector" style={{ position: "relative", marginBottom: 8 }}>
          <p className="card-text" style={{ margin: "8px 10px" }}>
            Configure voices in Settings → Voice.
          </p>
          <button type="button" className="mode-option" onClick={openVoiceSettings}>
            Open Voice settings
          </button>
        </div>
      ) : null}

      <h2 className="card-title">Schedule deep work block</h2>

      <div className="voice-action-wave">
        <SonareLiveWaveform
          variant={status === "idle" ? "idle" : status}
          width={280}
          height={44}
          bars={60}
        />
      </div>

      <div className="voice-action-foot">
        <span className="voice-action-hint">
          Press {keys.join(" + ")} to speak
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={openVoiceSettings}
          aria-label="Open voice settings"
          title="Voice settings"
        >
          <GearIcon size={14} />
        </button>
      </div>
    </section>
  );
}
