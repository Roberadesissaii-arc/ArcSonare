import { shortcutKeys } from "../../services/shortcutFormat";

interface ShortcutHintProps {
  shortcut: string;
}

/** The current global shortcut inside a dark recessed capsule. */
export function ShortcutHint({ shortcut }: ShortcutHintProps) {
  const keys = shortcutKeys(shortcut);
  return (
    <div
      className="shortcut-hint"
      aria-label={`Shortcut: ${keys.join(" plus ")}`}
    >
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="hint-key">
          {key}
        </span>
      ))}
    </div>
  );
}
