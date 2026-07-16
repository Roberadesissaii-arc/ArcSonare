import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppShell } from "./app/AppShell";
import { SonareOverlay } from "./components/overlay/SonareOverlay";
import { SettingsWindow } from "./components/settings/SettingsWindow";
import { QuickMenu } from "./components/tray/QuickMenu";

/** One Vite app serves every window; the window label picks the UI. */
export default function App() {
  const label = getCurrentWindow().label;
  if (label === "sonare-overlay") return <SonareOverlay />;
  if (label === "sonare-settings") return <SettingsWindow />;
  if (label === "sonare-quick-menu") return <QuickMenu />;
  return <AppShell />;
}
