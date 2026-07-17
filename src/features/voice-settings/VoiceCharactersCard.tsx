import { CheckIcon, VolumeIcon } from "../../components/Icons";
import { SonareMarbleOrb } from "../../components/voice/SonareMarbleOrb";
import { VoiceSettingsCard } from "./VoiceSettingsCard";
import { VOICE_CHARACTERS, type VoiceCharacter } from "./voiceCharacters";

interface VoiceCharactersCardProps {
  selectedId: string;
  onSelect: (id: string) => void;
  onManage: () => void;
}

export function VoiceCharactersCard({
  selectedId,
  onSelect,
  onManage,
}: VoiceCharactersCardProps) {
  return (
    <VoiceSettingsCard
      icon={<VolumeIcon size={15} />}
      title="Voice characters"
      description="Choose the personality ArcSonare speaks with."
      action={
        <button type="button" className="voice-solid-btn is-ghost" onClick={onManage}>
          Manage voices
        </button>
      }
      className="voice-characters-card"
    >
      <div className="voice-character-grid" role="radiogroup" aria-label="Voice characters">
        {VOICE_CHARACTERS.map((character) => (
          <CharacterTile
            key={character.id}
            character={character}
            selected={character.id === selectedId}
            onSelect={() => onSelect(character.id)}
          />
        ))}
      </div>
      <div className="voice-character-pages" aria-hidden="true">
        <span className="is-active" />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </VoiceSettingsCard>
  );
}

function CharacterTile({
  character,
  selected,
  onSelect,
}: {
  character: VoiceCharacter;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`voice-character-tile${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      {selected ? (
        <span className="voice-character-check" aria-hidden="true">
          <CheckIcon size={11} />
        </span>
      ) : null}
      <span className="voice-character-marble" aria-hidden="true">
        <SonareMarbleOrb status="idle" size={46} tint={character.marbleTint} />
      </span>
      <span className="voice-character-name">{character.displayName}</span>
      <span className="voice-character-personality">{character.personality}</span>
      <span className="voice-character-desc">{character.description}</span>
    </button>
  );
}
