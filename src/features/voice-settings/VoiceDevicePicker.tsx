import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, RefreshIcon } from "../../components/Icons";

interface VoiceDevicePickerProps {
  label: string;
  icon: ReactNode;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
  ariaLabel: string;
  refreshLabel: string;
}

/** Titanium device field for mic/speaker — not a plain browser dropdown. */
export function VoiceDevicePicker({
  label,
  icon,
  options,
  value,
  onChange,
  onRefresh,
  ariaLabel,
  refreshLabel,
}: VoiceDevicePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="voice-device-picker" ref={rootRef}>
      <span className="voice-field-label">{label}</span>
      <div className="voice-device-picker-row">
        <button
          type="button"
          className={`voice-device-field${open ? " is-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="voice-device-field-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="voice-device-field-text">{current?.label ?? "No device"}</span>
          <ChevronDownIcon size={14} />
        </button>
        <button
          type="button"
          className="voice-device-refresh"
          onClick={onRefresh}
          aria-label={refreshLabel}
          title={refreshLabel}
        >
          <RefreshIcon size={14} />
        </button>
      </div>
      {open ? (
        <ul className="voice-device-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? "is-selected" : undefined}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {selected ? <CheckIcon size={13} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
