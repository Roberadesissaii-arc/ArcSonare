import { CheckIcon, PlayIcon } from "../../components/Icons";
import { VOICE_CHARACTERS } from "../voice-settings/voiceCharacters";

/**
 * ArcSonare voice profiles. These are local profile definitions that map to
 * a provider voice once a speech provider is configured — no provider claims
 * are made here, and preview is disabled until one exists.
 */
export interface VoiceProfile {
  id: string;
  name: string;
  description: string;
  tone: string;
  languages: string;
}

export const VOICE_PROFILES: VoiceProfile[] = VOICE_CHARACTERS.map((c) => ({
  id: c.id,
  name: c.displayName,
  description: c.description,
  tone: c.personality,
  languages: "English",
}));

interface VoiceSelectorProps {
  value: string;
  onChange: (voiceId: string) => void;
  /** True once a speech provider is configured; enables previews. */
  providerConfigured: boolean;
  onPreview: (voiceId: string) => void;
}

/** Polished voice browser. Preview is provider-gated and honest. */
export function VoiceSelector({
  value,
  onChange,
  providerConfigured,
  onPreview,
}: VoiceSelectorProps) {
  return (
    <div className="voice-browser">
      {VOICE_PROFILES.map((voice) => {
        const selected = voice.id === value;
        return (
          <div
            key={voice.id}
            className={`voice-card${selected ? " selected" : ""}`}
            role="radio"
            aria-checked={selected}
            tabIndex={0}
            onClick={() => onChange(voice.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChange(voice.id);
              }
            }}
          >
            <div className="voice-card-head">
              <span className="voice-card-name">{voice.name}</span>
              {selected ? (
                <span className="voice-card-check" aria-hidden="true">
                  <CheckIcon size={14} />
                </span>
              ) : null}
            </div>
            <p className="voice-card-desc">{voice.description}</p>
            <div className="voice-card-meta">
              <span className="voice-card-tone">{voice.tone}</span>
              <span className="voice-card-lang">{voice.languages}</span>
            </div>
            <button
              type="button"
              className="btn btn-small voice-card-preview"
              disabled={!providerConfigured}
              onClick={(e) => {
                e.stopPropagation();
                onPreview(voice.id);
              }}
              title={
                providerConfigured
                  ? `Preview ${voice.name}`
                  : "Voice preview requires a configured speech provider."
              }
            >
              <PlayIcon size={12} />
              Preview
            </button>
          </div>
        );
      })}
    </div>
  );
}
