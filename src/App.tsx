import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppShell } from "./app/AppShell";
import { GlobalTopOverlay } from "./features/top-overlay/GlobalTopOverlay";
import { QuickMenu } from "./components/tray/QuickMenu";

/** One Vite app serves every window; the window label picks the UI. */
export default function App() {
  const label = getCurrentWindow().label;
  if (label === "sonare-overlay") return <GlobalTopOverlay />;
  if (label === "sonare-quick-menu") return <QuickMenu />;
  return <AppShell />;
}
