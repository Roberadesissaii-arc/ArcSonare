import type { CSSProperties } from "react";

export interface AccentSwatch {
  id: string;
  label: string;
  color: string;
}

export const ACCENT_SWATCHES: AccentSwatch[] = [
  { id: "violet", label: "ArcSonare violet", color: "#9168ff" },
  { id: "blue", label: "Blue", color: "#5b8cff" },
  { id: "cyan", label: "Cyan", color: "#3ec7c7" },
  { id: "green", label: "Green", color: "#4db87a" },
  { id: "orange", label: "Orange", color: "#e09a4a" },
  { id: "red", label: "Red", color: "#e06b6b" },
];

interface ColorPickerProps {
  value: string;
  onChange: (id: string) => void;
  swatches?: AccentSwatch[];
  ariaLabel?: string;
}

/** Compact circular accent swatches. */
export function ColorPicker({
  value,
  onChange,
  swatches = ACCENT_SWATCHES,
  ariaLabel = "Accent color",
}: ColorPickerProps) {
  return (
    <div className="color-picker" role="radiogroup" aria-label={ariaLabel}>
      {swatches.map((swatch) => {
        const selected = swatch.id === value;
        return (
          <button
            key={swatch.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={swatch.label}
            title={swatch.label}
            className={`color-swatch${selected ? " selected" : ""}`}
            style={{ "--swatch-color": swatch.color } as CSSProperties}
            onClick={() => onChange(swatch.id)}
          />
        );
      })}
    </div>
  );
}
