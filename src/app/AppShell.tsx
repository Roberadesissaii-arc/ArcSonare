import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "../hooks/useSettings";
import { useAppearance } from "../hooks/useTheme";
import { navigate, openPalette, useAppState } from "../stores/appStore";
import { CustomTitleBar } from "./CustomTitleBar";
import { AppHeader } from "./AppHeader";
import { CommandPalette } from "../components/command/CommandPalette";
import { CreateTaskModal } from "../components/tasks/CreateTaskModal";
import { SystemStatus } from "../components/dashboard/SystemStatus";
import { DashboardPage } from "../pages/DashboardPage";
import { TasksPage } from "../pages/TasksPage";
import { AgentPage } from "../pages/AgentPage";
import { ConnectPage } from "../pages/ConnectPage";
import { SettingsPage } from "../pages/SettingsPage";

/** The main Command Center window. */
export function AppShell() {
  const { settings } = useSettings();
  useAppearance(settings, { applyTheme: true });
  const { page } = useAppState();
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);

  // Ctrl+K opens the command palette from anywhere in the window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Pause ambient animation (orbits, waveforms) while the window is hidden.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Tray / quick menu "Settings" shows this window and asks it to navigate.
  useEffect(() => {
    const unlisten = listen("sonare://open-settings", () => {
      navigate("settings");
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const openCreateTask = () => setCreateTaskOpen(true);

  return (
    <div className={`app-shell${hidden ? " app-paused" : ""}`}>
      <CustomTitleBar />
      <AppHeader onCreateTask={openCreateTask} />
      <main className="app-main" key={page}>
        {page === "dashboard" && <DashboardPage onCreateTask={openCreateTask} />}
        {page === "tasks" && <TasksPage onCreateTask={openCreateTask} />}
        {page === "agent" && <AgentPage />}
        {page === "connect" && <ConnectPage />}
        {page === "settings" && <SettingsPage />}
      </main>
      <footer className="app-statusbar">
        <span className="statusbar-left">ArcSonare · Ready</span>
        <SystemStatus />
      </footer>
      <CommandPalette onCreateTask={openCreateTask} />
      <CreateTaskModal open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
    </div>
  );
}
