import { useCallback, useEffect, useState } from "react";
import { keyLabel, shortcutKeys } from "../../services/shortcutFormat";

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/** Combinations Windows reserves at a level we can reasonably detect. */
const BLOCKED_SHORTCUTS = new Set([
  "Alt+F4",
  "Alt+Tab",
  "Ctrl+Alt+Delete",
  "Ctrl+Shift+Escape",
  "Super+KeyL",
  "Super+Tab",
]);

const FN_MESSAGE =
  "The Fn key is handled by your keyboard hardware and cannot be registered as a global shortcut on this system. Choose another key.";

function modifiersFrom(event: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (event.metaKey) mods.push("Super");
  return mods;
}

interface ShortcutRecorderProps {
  /** Current binding ("Ctrl+Shift+Space") or null when unbound. */
  shortcut: string | null;
  /**
   * Persists the combination. Must reject with a user-readable message when
   * native registration fails; the previous binding stays active in that
   * case (Rust registers the new one before dropping the old).
   */
  onCommit: (candidate: string) => Promise<void>;
  /** Shown when no binding exists. */
  emptyLabel?: string;
}

/**
 * Records a keyboard chord for a global shortcut. Each held key is shown
 * live; Escape cancels; the candidate is validated and only saved after
 * Windows accepted the native registration.
 */
export function ShortcutRecorder({
  shortcut,
  onCommit,
  emptyLabel = "Not set",
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [heldModifiers, setHeldModifiers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stopRecording = useCallback(() => {
    setRecording(false);
    setHeldModifiers([]);
  }, []);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.key === "Escape" && modifiersFrom(event).length === 0) {
        stopRecording();
        return;
      }

      // Fn rarely reaches the browser at all; when it does, be explicit.
      if (event.key === "Fn" || event.code === "Fn") {
        setError(FN_MESSAGE);
        return;
      }

      if (MODIFIER_CODES.has(event.code)) {
        setHeldModifiers(modifiersFrom(event));
        return;
      }

      const modifiers = modifiersFrom(event);
      if (modifiers.length === 0) {
        setError("Include at least one modifier key (Ctrl, Alt, Shift or Win).");
        return;
      }

      const candidate = [...modifiers, event.code].join("+");
      if (BLOCKED_SHORTCUTS.has(candidate)) {
        setError("That combination is reserved by Windows.");
        return;
      }

      setSaving(true);
      onCommit(candidate)
        .then(() => {
          setError(null);
          stopRecording();
        })
        .catch((err) => {
          setError(
            typeof err === "string"
              ? err
              : err instanceof Error
                ? err.message
                : "The shortcut could not be set.",
          );
          stopRecording();
        })
        .finally(() => setSaving(false));
    };

    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (MODIFIER_CODES.has(event.code)) {
        setHeldModifiers(modifiersFrom(event));
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [recording, stopRecording, onCommit]);

  const startRecording = () => {
    setError(null);
    setHeldModifiers([]);
    setRecording(true);
  };

  const displayedKeys = recording
    ? heldModifiers.map(keyLabel)
    : shortcut
      ? shortcutKeys(shortcut)
      : [];

  return (
    <div className="shortcut-recorder">
      <div
        className={`shortcut-field${recording ? " recording" : ""}`}
        aria-live="polite"
      >
        {displayedKeys.length === 0 ? (
          <span className="shortcut-placeholder">
            {recording ? "Press a new shortcut…" : emptyLabel}
          </span>
        ) : (
          <span className="shortcut-value">
            {displayedKeys.map((key, index) => (
              <span key={`${key}-${index}`} className="key-chip">
                {key}
              </span>
            ))}
          </span>
        )}
        {recording ? (
          <button type="button" className="btn btn-small" onClick={stopRecording}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-small"
            onClick={startRecording}
            disabled={saving}
          >
            Change
          </button>
        )}
      </div>
      {recording ? (
        <p className="field-help">
          Press the keys you want, or Esc to cancel. The Fn key is handled by
          keyboard hardware and can't be used.
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
