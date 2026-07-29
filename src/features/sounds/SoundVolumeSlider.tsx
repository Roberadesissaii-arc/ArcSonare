import type { CSSProperties } from "react";

interface SoundVolumeSliderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  /** When false, only the range track is rendered (pct shown elsewhere). */
  showPercent?: boolean;
}

/** Custom violet volume slider — not the native browser range look. */
export function SoundVolumeSlider({
  value,
  onChange,
  label,
  disabled,
  className,
  showPercent = true,
}: SoundVolumeSliderProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`sound-volume-slider${className ? ` ${className}` : ""}${disabled ? " is-disabled" : ""}`}>
      <input
        type="range"
        min={0}
        max={100}
        value={clamped}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={`${clamped} percent`}
        style={{ "--sound-fill": `${clamped}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {showPercent ? (
        <span className="sound-volume-pct" aria-hidden="true">
          {clamped}%
        </span>
      ) : null}
    </div>
  );
}
