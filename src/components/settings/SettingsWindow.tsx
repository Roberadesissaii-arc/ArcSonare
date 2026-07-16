import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../hooks/useSettings";
import { useAppearance } from "../../hooks/useTheme";
import { SettingsSidebar, type PageId } from "./SettingsSidebar";
import { SettingsHeader } from "./SettingsHeader";
import { GeneralPage } from "./pages/GeneralPage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import { AppearancePage } from "./pages/AppearancePage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ConnectPage } from "./pages/ConnectPage";
import { AboutPage } from "./pages/AboutPage";

export function SettingsWindow() {
  const { settings, update } = useSettings();
  useAppearance(settings, { applyTheme: true });
  const [page, setPage] = useState<PageId>("general");

  // Escape hides the settings window (the shortcut recorder captures and
  // stops Escape first while recording).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        invoke("hide_settings").catch((err) =>
          console.error("[ArcSonare] failed to hide settings:", err),
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="settings-shell">
      <div className="settings-frame">
        <SettingsSidebar page={page} onNavigate={setPage} />
        <div className="settings-main">
          <SettingsHeader />
          <div className="settings-content">
            {settings ? (
              <>
                {page === "general" && (
                  <GeneralPage settings={settings} update={update} />
                )}
                {page === "shortcuts" && <ShortcutsPage settings={settings} />}
                {page === "appearance" && (
                  <AppearancePage settings={settings} update={update} />
                )}
                {page === "notifications" && (
                  <NotificationsPage settings={settings} update={update} />
                )}
                {page === "privacy" && <PrivacyPage />}
                {page === "connect" && <ConnectPage />}
                {page === "about" && <AboutPage />}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
