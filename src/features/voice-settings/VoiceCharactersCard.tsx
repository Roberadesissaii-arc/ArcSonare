import { useMemo, useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  VolumeIcon,
} from "../../components/Icons";
import { SonareMarbleOrb } from "../../components/voice/SonareMarbleOrb";
import { VoiceSettingsCard } from "./VoiceSettingsCard";
import {
  previewVoiceCharacter,
  stopVoiceCharacterPreview,
} from "./previewVoiceCharacter";
import { VOICE_CHARACTERS, type VoiceCharacter } from "./voiceCharacters";

interface VoiceCharactersCardProps {
  selectedId: string;
  onSelect: (id: string) => void;
  onManage: () => void;
}

const PAGE_SIZE = 3;

export function VoiceCharactersCard({
  selectedId,
  onSelect,
  onManage,
}: VoiceCharactersCardProps) {
  const pageCount = Math.max(1, Math.ceil(VOICE_CHARACTERS.length / PAGE_SIZE));
  const selectedIndex = Math.max(
    0,
    VOICE_CHARACTERS.findIndex((c) => c.id === selectedId),
  );
  const [page, setPage] = useState(() =>
    Math.floor(selectedIndex / PAGE_SIZE),
  );
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const start = page * PAGE_SIZE;
    return VOICE_CHARACTERS.slice(start, start + PAGE_SIZE);
  }, [page]);

  const go = (next: number) => {
    setPage(Math.max(0, Math.min(pageCount - 1, next)));
  };

  const selectAndPreview = async (character: VoiceCharacter) => {
    onSelect(character.id);
    setPreviewError(null);
    setPreviewingId(character.id);
    try {
      await previewVoiceCharacter(character);
    } catch (err) {
      setPreviewError(
        err instanceof Error
          ? err.message
          : "Could not play this voice preview. Check Voice Lab / Pocket TTS.",
      );
    } finally {
      setPreviewingId((id) => (id === character.id ? null : id));
    }
  };

  return (
    <VoiceSettingsCard
      icon={<VolumeIcon size={15} />}
      title="Voice characters"
      description="Choose a personality — tap a card to hear how it sounds."
      action={
        <button type="button" className="voice-solid-btn is-ghost" onClick={onManage}>
          Manage voices
        </button>
      }
      className="voice-characters-card"
    >
      <div className="voice-character-carousel">
        <button
          type="button"
          className="voice-character-nav"
          aria-label="Previous characters"
          disabled={page <= 0}
          onClick={() => go(page - 1)}
        >
          <ChevronLeftIcon size={16} />
        </button>

        <div
          className="voice-character-grid"
          role="radiogroup"
          aria-label="Voice characters"
        >
          {visible.map((character) => (
            <CharacterTile
              key={character.id}
              character={character}
              selected={character.id === selectedId}
              previewing={previewingId === character.id}
              onSelect={() => void selectAndPreview(character)}
            />
          ))}
        </div>

        <button
          type="button"
          className="voice-character-nav"
          aria-label="Next characters"
          disabled={page >= pageCount - 1}
          onClick={() => go(page + 1)}
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>

      <div className="voice-character-pages" role="tablist" aria-label="Character pages">
        {Array.from({ length: pageCount }, (_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === page}
            aria-label={`Page ${i + 1}`}
            className={i === page ? "is-active" : undefined}
            onClick={() => go(i)}
          />
        ))}
      </div>

      {previewError ? (
        <p className="voice-help" role="alert" style={{ marginTop: 10 }}>
          {previewError}{" "}
          <button
            type="button"
            className="text-action"
            onClick={() => {
              stopVoiceCharacterPreview();
              setPreviewError(null);
            }}
          >
            Dismiss
          </button>
        </p>
      ) : (
        <p className="voice-help" style={{ marginTop: 10 }}>
          Each character uses a different Pocket TTS voice. Selecting one also
          sets the overlay speaking voice.
        </p>
      )}
    </VoiceSettingsCard>
  );
}

function CharacterTile({
  character,
  selected,
  previewing,
  onSelect,
}: {
  character: VoiceCharacter;
  selected: boolean;
  previewing: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${character.displayName}. ${character.personality}. Press to select and hear a preview.`}
      className={`voice-character-tile${selected ? " is-selected" : ""}${previewing ? " is-previewing" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
      }}
    >
      {selected ? (
        <span className="voice-character-check" aria-hidden="true">
          <CheckIcon size={11} />
        </span>
      ) : null}
      <span className="voice-character-marble" aria-hidden="true">
        <SonareMarbleOrb
          status={previewing ? "responding" : "idle"}
          size={46}
          tint={character.marbleTint}
        />
      </span>
      <span className="voice-character-name">{character.displayName}</span>
      <span className="voice-character-personality">{character.personality}</span>
      <span className="voice-character-desc">{character.description}</span>
    </button>
  );
}
