import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "../Icons";

interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface DropdownProps<T extends string> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Dark custom dropdown with basic keyboard support. */
export function Dropdown<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const select = (next: T) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = options.findIndex((o) => o.value === value);
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else select(options[Math.min(index + 1, options.length - 1)].value);
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      select(options[Math.max(index - 1, 0)].value);
    }
  };

  return (
    <div className="dropdown" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label}</span>
        <ChevronDownIcon size={14} />
      </button>
      {open ? (
        <ul className="dropdown-list" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`dropdown-option${option.value === value ? " selected" : ""}`}
              onClick={() => select(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value ? <CheckIcon size={14} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
