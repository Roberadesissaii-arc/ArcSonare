import { useEffect, useRef } from "react";
import { CloseIcon } from "../../components/Icons";
import { Slider } from "../../components/settings/Slider";
import { SonareMarbleOrb } from "../../components/voice/SonareMarbleOrb";
import { VOICE_CHARACTERS, type VoiceCharacter } from "./voiceCharacters";

interface ManageVoicesDrawerProps {
  selectedId: string;
  speakingSpeed: number;
  pitch: number;
  expressiveness: number;
  onSelect: (id: string) => void;
  onSpeed: (v: number) => void;
  onPitch: (v: number) => void;
  onExpressiveness: (v: number) => void;
  onClose: () => void;
  speechConfigured: boolean;
}

export function ManageVoicesDrawer({
  selectedId,
  speakingSpeed,
  pitch,
  expressiveness,
  onSelect,
  onSpeed,
  onPitch,
  onExpressiveness,
  onClose,
  speechConfigured,
}: ManageVoicesDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const selected =
    VOICE_CHARACTERS.find((c) => c.id === selectedId) ?? VOICE_CHARACTERS[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  return (
    <div className="voice-drawer-backdrop" role="presentation">
      <aside
        ref={panelRef}
        className="voice-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Manage voices"
      >
        <header className="voice-drawer-head">
          <div>
            <h2>Manage voices</h2>
            <p>Characters, tone, and speaking style.</p>
          </div>
          <button type="button" className="voice-round-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </header>

        <section className="voice-drawer-section">
          <h3>Characters</h3>
          <ul className="voice-drawer-list">
            {VOICE_CHARACTERS.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === selectedId ? "is-selected" : undefined}
                  onClick={() => onSelect(c.id)}
                >
                  <SonareMarbleOrb status="idle" size={30} tint={c.marbleTint} />
                  <span>
                    <strong>{c.displayName}</strong>
                    <em>{c.personality}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <CharacterDetails character={selected} speechConfigured={speechConfigured} />

        <section className="voice-drawer-section">
          <h3>Speaking style</h3>
          <label className="voice-field-label">Speed</label>
          <Slider
            value={speakingSpeed}
            min={50}
            max={200}
            step={5}
            onChange={onSpeed}
            label="Speaking speed"
            format={(v) => `${v}%`}
          />
          <label className="voice-field-label">Pitch</label>
          <Slider
            value={pitch}
            min={50}
            max={150}
            step={5}
            onChange={onPitch}
            label="Pitch"
            format={(v) => `${v}%`}
          />
          <label className="voice-field-label">Expressiveness</label>
          <Slider
            value={expressiveness}
            min={0}
            max={100}
            onChange={onExpressiveness}
            label="Expressiveness"
            format={(v) => `${v}%`}
          />
        </section>
      </aside>
    </div>
  );
}

function CharacterDetails({
  character,
  speechConfigured,
}: {
  character: VoiceCharacter;
  speechConfigured: boolean;
}) {
  return (
    <section className="voice-drawer-section">
      <h3>Selected</h3>
      <p className="voice-drawer-selected-name">{character.displayName}</p>
      <p className="voice-help">{character.description}</p>
      <p className="voice-help">
        Provider voice mapping:{" "}
        {speechConfigured
          ? character.preferredProviderVoiceId || "Uses default speech model voice"
          : "Unavailable until a speech model is configured in Models."}
      </p>
    </section>
  );
}
