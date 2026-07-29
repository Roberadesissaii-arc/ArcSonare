import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArcSonareLogo } from "../components/brand/ArcSonareLogo";

const appWindow = getCurrentWindow();

/**
 * Borderless title bar with Windows-style window controls on the right,
 * smoked-titanium chrome matching ArcSonare (not macOS traffic lights).
 * Close hides to tray; minimize / maximize behave normally.
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
      <div className="titlebar-brand" data-tauri-drag-region>
        <ArcSonareLogo size={16} />
        <span>ArcSonare</span>
      </div>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <div className="window-controls" role="group" aria-label="Window">
        <button
          type="button"
          className="win-btn win-min"
          onClick={minimize}
          aria-label="Minimize"
          title="Minimize"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1.5 5h7" />
          </svg>
        </button>
        <button
          type="button"
          className="win-btn win-max"
          onClick={toggleMaximize}
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            {maximized ? (
              <>
                <path d="M3.2 2.2h4.6v4.6" />
                <rect x="1.6" y="3.4" width="4.6" height="4.6" rx="0.4" />
              </>
            ) : (
              <rect x="1.8" y="1.8" width="6.4" height="6.4" rx="0.5" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className="win-btn win-close"
          onClick={hideToTray}
          aria-label="Hide ArcSonare to the tray"
          title="Hide to tray"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.2 2.2l5.6 5.6M7.8 2.2l-5.6 5.6" />
          </svg>
        </button>
      </div>
    </header>
  );
}
