interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  /** Optional value formatter shown at the right (e.g. "70%"). */
  format?: (value: number) => string;
  disabled?: boolean;
}

/** Monochrome range slider with a compact value readout. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
  disabled,
}: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className={`slider${disabled ? " is-disabled" : ""}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        disabled={disabled}
        style={{ "--slider-fill": `${percent}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">
        {format ? format(value) : String(value)}
      </span>
    </div>
  );
}
