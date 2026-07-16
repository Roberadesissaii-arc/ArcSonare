import { getCurrentWindow } from "@tauri-apps/api/window";
import { SonareOverlay } from "./components/overlay/SonareOverlay";
import { SettingsWindow } from "./components/settings/SettingsWindow";
import { QuickMenu } from "./components/tray/QuickMenu";

/** One Vite app serves all three windows; the window label picks the UI. */
export default function App() {
  const label = getCurrentWindow().label;
  if (label === "sonare-settings") return <SettingsWindow />;
  if (label === "sonare-quick-menu") return <QuickMenu />;
  return <SonareOverlay />;
}
