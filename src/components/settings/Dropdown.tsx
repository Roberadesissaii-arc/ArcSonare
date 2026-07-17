import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon } from "../Icons";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading content (icon, color swatch, etc.). */
  leading?: ReactNode;
}

interface DropdownProps<T extends string> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  /** Match trigger width (default) or grow with content. */
  matchTriggerWidth?: boolean;
}

interface MenuPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
}

function computePos(trigger: HTMLElement): MenuPos {
  const rect = trigger.getBoundingClientRect();
  const gap = 6;
  const viewportPad = 8;
  const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPad;
  const spaceAbove = rect.top - gap - viewportPad;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(120, Math.min(280, openUp ? spaceAbove : spaceBelow));
  return {
    top: openUp ? rect.top - gap : rect.bottom + gap,
    left: rect.left,
    width: rect.width,
    maxHeight,
    openUp,
  };
}

/**
 * ArcSonare custom dropdown. Menu is portaled to document.body so it is never
 * clipped by overflow:hidden cards or settings scroll panes.
 */
export function Dropdown<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  matchTriggerWidth = true,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  const updatePos = () => {
    if (!buttonRef.current) return;
    setPos(computePos(buttonRef.current));
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePos();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
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
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      else select(options[Math.max(index - 1, 0)].value);
    } else if (event.key === "Enter" || event.key === " ") {
      if (!open) {
        event.preventDefault();
        setOpen(true);
      }
    }
  };

  const menuStyle: CSSProperties | undefined = pos
    ? {
        position: "fixed",
        left: pos.left,
        width: matchTriggerWidth ? Math.max(pos.width, 160) : undefined,
        minWidth: matchTriggerWidth ? pos.width : 180,
        maxHeight: pos.maxHeight,
        zIndex: 10050,
        ...(pos.openUp
          ? { bottom: window.innerHeight - pos.top, top: "auto" }
          : { top: pos.top }),
      }
    : undefined;

  return (
    <div
      className={`dropdown${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dropdown-button-main">
          {current?.leading ? (
            <span className="dropdown-leading" aria-hidden="true">
              {current.leading}
            </span>
          ) : null}
          <span className="dropdown-button-label">{current?.label}</span>
        </span>
        <ChevronDownIcon size={14} />
      </button>
      {open && pos
        ? createPortal(
            <ul
              ref={menuRef}
              id={listId}
              className={`dropdown-list dropdown-list-portal${pos.openUp ? " is-up" : ""}`}
              role="listbox"
              aria-label={ariaLabel}
              style={menuStyle}
            >
              {options.map((option) => (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={`dropdown-option${option.value === value ? " selected" : ""}`}
                  onClick={() => select(option.value)}
                >
                  <span className="dropdown-option-main">
                    {option.leading ? (
                      <span className="dropdown-leading" aria-hidden="true">
                        {option.leading}
                      </span>
                    ) : null}
                    <span>{option.label}</span>
                  </span>
                  {option.value === value ? <CheckIcon size={14} /> : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
