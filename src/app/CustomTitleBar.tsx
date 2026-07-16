import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

/**
 * 44px borderless title bar with macOS-style traffic lights on the left.
 * Red hides ArcSonare to the tray (the app keeps running), yellow minimizes,
 * green toggles maximize. Everything else is a drag region.
 */
export function CustomTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    const sync = () =>
      appWindow
        .isMaximized()
        .then((m) => {
          if (mounted) setMaximized(m);
        })
        .catch(() => undefined);
    sync();
    const unlisten = appWindow.onResized(sync);
    return () => {
      mounted = false;
      unlisten.then((f) => f());
    };
  }, []);

  const hideToTray = () => {
    appWindow
      .hide()
      .catch((err) => console.error("[ArcSonare] failed to hide:", err));
  };
  const minimize = () => {
    appWindow
      .minimize()
      .catch((err) => console.error("[ArcSonare] failed to minimize:", err));
  };
  const toggleMaximize = () => {
    appWindow
      .toggleMaximize()
      .catch((err) => console.error("[ArcSonare] failed to maximize:", err));
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic-lights">
        <button
          type="button"
          className="tl tl-close"
          onClick={hideToTray}
          aria-label="Hide ArcSonare to the tray"
          title="Hide to tray"
        >
          <svg viewBox="0 0 8 8" aria-hidden="true">
            <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
          </svg>
        </button>
        <button
          type="button"
          className="tl tl-min"
          onClick={minimize}
          aria-label="Minimize"
          title="Minimize"
        >
          <svg viewBox="0 0 8 8" aria-hidden="true">
            <path d="M1.2 4h5.6" />
          </svg>
        </button>
        <button
          type="button"
          className="tl tl-max"
          onClick={toggleMaximize}
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
        >
          <svg viewBox="0 0 8 8" aria-hidden="true">
            {maximized ? (
              <path d="M2.4 4.8L4 3.2l1.6 1.6M2.4 6.4h3.2" />
            ) : (
              <path d="M1.6 4.6V1.6h3M6.4 3.4v3h-3" />
            )}
          </svg>
        </button>
      </div>
    </header>
  );
}
