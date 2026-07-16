import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloseIcon, MinimizeIcon } from "../Icons";

/**
 * Thin draggable strip across the top of the content column with the window
 * controls. Closing hides the window — ArcSonare keeps running.
 */
export function SettingsHeader() {
  const close = () => {
    invoke("hide_settings").catch((err) =>
      console.error("[ArcSonare] failed to hide settings:", err),
    );
  };
  const minimize = () => {
    getCurrentWindow()
      .minimize()
      .catch((err) => console.error("[ArcSonare] failed to minimize:", err));
  };

  return (
    <header className="settings-header" data-tauri-drag-region>
      <button
        type="button"
        className="icon-button"
        onClick={minimize}
        aria-label="Minimize settings window"
        title="Minimize"
      >
        <MinimizeIcon size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={close}
        aria-label="Close settings window"
        title="Close (Esc)"
      >
        <CloseIcon size={15} />
      </button>
    </header>
  );
}
