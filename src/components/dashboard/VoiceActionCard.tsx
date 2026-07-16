import { GearIcon } from "../Icons";
import { useSettings } from "../../hooks/useSettings";
import { shortcutKeys } from "../../services/shortcutFormat";
import { useVoiceState } from "../../stores/voiceStore";
import { SonareWaveform } from "../voice/SonareWaveform";
import { invoke } from "@tauri-apps/api/core";

/** The suggested / most recent voice action. */
export function VoiceActionCard() {
  const state = useVoiceState();
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
        <SonareWaveform state={state} width={190} />
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
