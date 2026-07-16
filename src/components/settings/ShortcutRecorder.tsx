import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

function modifiersFrom(event: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (event.metaKey) mods.push("Super");
  return mods;
}

interface ShortcutRecorderProps {
  shortcut: string;
}

/**
 * Displays the current global shortcut and records a replacement.
 *
 * While recording, keystrokes are captured at the window level (capture
 * phase, so the settings window's own Escape handling is bypassed). The new
 * combination is sent to Rust, which registers it *before* unregistering the
 * old one — a failed registration therefore never destroys the previous
 * shortcut, and the error from Windows is surfaced here.
 */
export function ShortcutRecorder({ shortcut }: ShortcutRecorderProps) {
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

      if (MODIFIER_CODES.has(event.code)) {
        setHeldModifiers(modifiersFrom(event));
        return;
      }

      const modifiers = modifiersFrom(event);
      if (modifiers.length === 0) {
        setError(
          "Include at least one modifier key (Ctrl, Alt, Shift or Win).",
        );
        return;
      }

      const candidate = [...modifiers, event.code].join("+");
      if (BLOCKED_SHORTCUTS.has(candidate)) {
        setError("That combination is reserved by Windows.");
        return;
      }

      setSaving(true);
      invoke("set_global_shortcut", { shortcut: candidate })
        .then(() => {
          setError(null);
          stopRecording();
        })
        .catch((err) => {
          setError(
            typeof err === "string" ? err : "The shortcut could not be set.",
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
  }, [recording, stopRecording]);

  const startRecording = () => {
    setError(null);
    setHeldModifiers([]);
    setRecording(true);
  };

  const displayedKeys = recording
    ? heldModifiers.map(keyLabel)
    : shortcutKeys(shortcut);

  return (
    <div className="shortcut-recorder">
      <div
        className={`shortcut-field${recording ? " recording" : ""}`}
        aria-live="polite"
      >
        {recording && displayedKeys.length === 0 ? (
          <span className="shortcut-placeholder">Press a new shortcut…</span>
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
