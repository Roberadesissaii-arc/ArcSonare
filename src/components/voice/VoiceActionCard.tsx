import { invoke } from "@tauri-apps/api/core";
import { GearIcon } from "../Icons";
import { useSettings } from "../../hooks/useSettings";
import { shortcutKeys } from "../../services/shortcutFormat";
import { useVoiceState } from "../../stores/voiceStore";
import { SonareLiveWaveform } from "./SonareLiveWaveform";

/** The suggested / most recent voice action, with the shared violet waveform. */
export function VoiceActionCard() {
  const { status } = useVoiceState();
  const { settings } = useSettings();
  const keys = shortcutKeys(settings?.globalShortcut ?? "Ctrl+Shift+Space");

  const openShortcutSettings = () => {
    invoke("open_settings").catch((err) =>
      console.error("[ArcSonare] failed to open settings:", err),
    );
  };

  return (
    <section className="card voice-action-card">
      <div className="card-head">
        <span className="card-label">Voice Action</span>
      </div>
      <h2 className="card-title">Schedule deep work block</h2>
      <div className="voice-action-wave">
        <SonareLiveWaveform
          variant={status === "idle" ? "idle" : status}
          width={252}
          height={46}
          bars={48}
        />
      </div>
      <div className="voice-action-foot">
        <span className="voice-action-hint">
          Press {keys.join(" + ")} to speak
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={openShortcutSettings}
          aria-label="Configure voice shortcut"
          title="Voice settings"
        >
          <GearIcon size={14} />
        </button>
      </div>
    </section>
  );
}
