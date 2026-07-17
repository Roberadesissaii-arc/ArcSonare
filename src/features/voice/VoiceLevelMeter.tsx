interface VoiceLevelMeterProps {
  /** 0..1 live level; null when the meter is inactive. */
  level: number | null;
}

/** Segmented input-level meter (grey → violet as the level rises). */
export function VoiceLevelMeter({ level }: VoiceLevelMeterProps) {
  const segments = 24;
  const lit = level === null ? 0 : Math.round(level * segments);
  return (
    <div
      className={`level-meter${level === null ? " inactive" : ""}`}
      role="meter"
      aria-label="Microphone input level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={level === null ? 0 : Math.round(level * 100)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`level-seg${i < lit ? " lit" : ""}${i >= segments - 5 && i < lit ? " hot" : ""}`}
        />
      ))}
    </div>
  );
}
