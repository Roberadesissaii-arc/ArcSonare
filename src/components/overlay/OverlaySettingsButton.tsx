import { invoke } from "@tauri-apps/api/core";
import { GearIcon } from "../Icons";

/** Circular settings button on the right edge of the overlay. */
export function OverlaySettingsButton() {
  const openSettings = () => {
    invoke("open_settings").catch((err) =>
      console.error("[ArcSonare] failed to open settings:", err),
    );
  };

  return (
    <button
      type="button"
      className="overlay-settings-button"
      onClick={openSettings}
      aria-label="Open ArcSonare settings"
      title="Settings"
    >
      <GearIcon size={19} />
    </button>
  );
}
