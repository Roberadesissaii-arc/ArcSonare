import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

/** Titanium device field for mic/speaker — menu portaled so it never clips. */
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
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  const updatePos = () => {
    if (!fieldRef.current) return;
    const rect = fieldRef.current.getBoundingClientRect();
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(260, openUp ? spaceAbove : spaceBelow));
    setPos(
      openUp
        ? {
            position: "fixed",
            left: rect.left,
            width: rect.width,
            bottom: window.innerHeight - rect.top + gap,
            maxHeight,
            zIndex: 10050,
          }
        : {
            position: "fixed",
            left: rect.left,
            width: rect.width,
            top: rect.bottom + gap,
            maxHeight,
            zIndex: 10050,
          },
    );
  };

  useLayoutEffect(() => {
    if (open) updatePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePos();
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  return (
    <div className={`voice-device-picker${open ? " is-open" : ""}`} ref={rootRef}>
      <span className="voice-field-label">{label}</span>
      <div className="voice-device-picker-row">
        <button
          ref={fieldRef}
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
      {open && pos
        ? createPortal(
            <ul
              ref={menuRef}
              className="voice-device-menu voice-device-menu-portal"
              role="listbox"
              aria-label={ariaLabel}
              style={pos}
            >
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
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
