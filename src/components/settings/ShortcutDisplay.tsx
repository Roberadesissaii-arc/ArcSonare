import { PenIcon } from "../Icons";

interface ShortcutDisplayProps {
  shortcut: string | null | undefined;
  onEdit?: () => void;
  ariaLabel?: string;
}

function splitKeys(shortcut: string): string[] {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Renders a shortcut as individual key chips with an optional edit control. */
export function ShortcutDisplay({
  shortcut,
  onEdit,
  ariaLabel = "Edit shortcut",
}: ShortcutDisplayProps) {
  const keys = shortcut ? splitKeys(shortcut) : [];

  return (
    <div className="shortcut-display">
      {keys.length ? (
        <div className="shortcut-chips" aria-label={shortcut ?? undefined}>
          {keys.map((key) => (
            <kbd key={key} className="shortcut-chip">
              {key}
            </kbd>
          ))}
        </div>
      ) : (
        <span className="shortcut-display-empty">Not set</span>
      )}
      {onEdit ? (
        <button
          type="button"
          className="shortcut-edit-btn"
          onClick={onEdit}
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <PenIcon size={13} />
        </button>
      ) : null}
    </div>
  );
}
