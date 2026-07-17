import { CheckIcon, PlayIcon } from "../../components/Icons";

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

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "sonare",
    name: "Sonare",
    description: "The signature ArcSonare voice.",
    tone: "Calm · Natural",
    languages: "English",
  },
  {
    id: "vela",
    name: "Vela",
    description: "Soft and friendly for long sessions.",
    tone: "Warm · Conversational",
    languages: "English",
  },
  {
    id: "orion",
    name: "Orion",
    description: "Grounded and precise for briefings.",
    tone: "Deep · Professional",
    languages: "English",
  },
  {
    id: "lyra",
    name: "Lyra",
    description: "Bright and articulate for quick answers.",
    tone: "Clear · Energetic",
    languages: "English",
  },
  {
    id: "atlas",
    name: "Atlas",
    description: "Composed and formal for work contexts.",
    tone: "Professional",
    languages: "English",
  },
  {
    id: "nova",
    name: "Nova",
    description: "Lively and expressive.",
    tone: "Energetic · Natural",
    languages: "English",
  },
];

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
