import { useState } from "react";
import { GearIcon } from "../Icons";
import { useSettings } from "../../hooks/useSettings";
import { shortcutKeys } from "../../services/shortcutFormat";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";
import { navigateSettings } from "../../stores/appStore";
import { useVoiceState, VOICE_STATUS_TEXT } from "../../stores/voiceStore";
import {
  VOICE_CHARACTERS,
  characterById,
  type VoiceCharacter,
} from "../../features/voice-settings/voiceCharacters";
import {
  previewVoiceCharacter,
  stopVoiceCharacterPreview,
} from "../../features/voice-settings/previewVoiceCharacter";
import { SonareLiveWaveform } from "./SonareLiveWaveform";
import { SonareMarbleOrb } from "./SonareMarbleOrb";

/** Voice Action card: marble, waveform, and inline character picker. */
export function VoiceActionCard() {
  const { status } = useVoiceState();
  const { settings } = useSettings();
  const prefs = usePrefs();
  const keys = shortcutKeys(settings?.globalShortcut ?? "Ctrl+Shift+Space");
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const character = characterById(prefs.voice.voiceId);
  const voiceName = character.displayName;

  const openVoiceSettings = () => {
    navigateSettings("voice");
  };

  const selectCharacter = async (next: VoiceCharacter) => {
    patchPrefs("voice", { voiceId: next.id });
    setPreviewingId(next.id);
    try {
      await previewVoiceCharacter(next);
    } catch (err) {
      console.error("[ArcSonare] voice preview failed:", err);
    } finally {
      setPreviewingId((id) => (id === next.id ? null : id));
    }
  };

  const prompt =
    status === "idle" || status === "cancelled"
      ? "Talk with Sonare"
      : VOICE_STATUS_TEXT[status];

  const voiceStateLabel =
    status === "thinking"
      ? "Thinking…"
      : status === "listening"
        ? "Listening now"
        : status === "responding"
          ? "Responding…"
          : "Ready when you are";

  return (
    <section className="card sonare-card voice-action-card">
      <div className="card-head">
        <span className="card-label">Voice Action</span>
      </div>
      <p className="card-lede">Talk hands-free with your voice shortcut.</p>

      <div className="voice-action-identity">
        <SonareMarbleOrb
          status={status === "idle" ? "idle" : status}
          size={44}
          tint={character.marbleTint}
        />
        <div className="voice-action-voice-meta">
          <h2 className="voice-action-prompt">{prompt}</h2>
          <span className="voice-action-voice-name">
            {voiceName} · {voiceStateLabel}
          </span>
        </div>
      </div>

      <div className="voice-action-wave">
        <SonareLiveWaveform
          variant={status === "idle" ? "idle" : status}
          width={260}
          height={32}
          bars={56}
        />
      </div>

      <div
        className="voice-action-characters"
        role="radiogroup"
        aria-label="Voice characters"
      >
        {VOICE_CHARACTERS.map((c) => {
          const selected = c.id === prefs.voice.voiceId;
          const previewing = previewingId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${c.displayName}. ${c.personality}`}
              title={`${c.displayName} · ${c.personality}`}
              className={`voice-action-char${selected ? " is-selected" : ""}${
                previewing ? " is-previewing" : ""
              }`}
              onClick={() => {
                stopVoiceCharacterPreview();
                void selectCharacter(c);
              }}
            >
              <SonareMarbleOrb
                status={previewing ? "responding" : "idle"}
                size={26}
                tint={c.marbleTint}
              />
              <span className="voice-action-char-name">{c.displayName}</span>
            </button>
          );
        })}
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
