import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { initializeAuth } from "../auth/authService";
import { getAuthSnapshot, setAuthState, useAuthStore } from "../auth/authStore";
import { useSettings } from "../hooks/useSettings";
import { useAppearance } from "../hooks/useTheme";
import { navigate, openPalette, useAppState, type MainPage } from "../stores/appStore";
import type { TaskFilter } from "../stores/taskStore";
import { NAVIGATE_EVENT, NAVIGATED_EVENT } from "../features/capabilities/frontendExecutors";
import { hydrateProfileDisplayName } from "../features/account/accountProfile";
import { hydrateAgentsFromDb } from "../features/agents/agentStore";
import { syncConnectionBrokerFromIntegrations } from "../services/integrationStatusService";
import { bindShortcutActions } from "../features/shortcuts/bindShortcutActions";
import { patchPrefs, usePrefs, useSettingsHydrated } from "../stores/settingsStore";
import { resolveBackgroundSrc } from "../config/backgroundLibrary";
import { hydrateTasksFromDb, listenForTaskChanges } from "../stores/taskStore";
import { setConversationScope } from "../features/conversation/conversationContext";
import { ACCENT_SWATCHES } from "../components/settings/ColorPicker";
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
import { AuthWelcomePage } from "../pages/AuthWelcomePage";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { DisplayMappingPrompt } from "../features/display-mapping/DisplayMappingPrompt";
import { LocationPermissionModal } from "../features/location/LocationPermissionModal";

/** The main Command Center window. */
export function AppShell() {
  const { settings } = useSettings();
  const prefs = usePrefs();
  const settingsHydrated = useSettingsHydrated();
  const auth = useAuthStore();
  useAppearance(settings, { applyTheme: true });
  const { page } = useAppState();
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);

  // A bundled key with no model selected still answered "nothing connected".
  // Runs after settings hydrate so it never races the saved selection.
  useEffect(() => {
    if (!settingsHydrated) return;
    void import("../features/models/autoSelectDefault").then((m) =>
      m.autoSelectDefaultModel(),
    );
  }, [settingsHydrated]);

  useEffect(() => {
    hydrateProfileDisplayName();
    void hydrateTasksFromDb();
    // Another window (the voice overlay) may create tasks; hear about them.
    void listenForTaskChanges();
    void hydrateAgentsFromDb();
    // Auth must run even when onboarding is already done — otherwise the
    // session stays "initializing" and the voice overlay never unlocks.
    void initializeAuth();
    void syncConnectionBrokerFromIntegrations();
  }, []);

  // Re-sync ConnectionBroker whenever the user leaves Connect — covers the
  // "just connected/disconnected Google" case without a network health probe.
  useEffect(() => {
    if (page === "connect") return;
    void syncConnectionBrokerFromIntegrations();
  }, [page]);

  // Hard failsafe: never leave the UI on "Checking your account…" forever.
  useEffect(() => {
    if (auth.state !== "initializing") return;
    const timer = window.setTimeout(() => {
      if (getAuthSnapshot().state === "initializing") {
        setAuthState("signed-out", {
          error: "Account check took too long. Sign in to continue.",
          user: null,
        });
      }
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [auth.state]);

  // Keep voice overlay unlocked whenever a real account session is active.
  useEffect(() => {
    if (!settingsHydrated) return;
    if (auth.state !== "signed-in" && auth.state !== "offline-authenticated") return;
    if (prefs.general.overlayUnlocked) return;
    patchPrefs("general", { overlayUnlocked: true });
    void invoke("set_overlay_unlocked", { unlocked: true }).catch((err) => {
      console.error("[ArcSonare] failed to persist overlay unlock:", err);
    });
  }, [settingsHydrated, auth.state, prefs.general.overlayUnlocked]);

  // Point the conversation ledger at the signed-in account.
  //
  // Changing account replaces the ledger rather than filtering it, so an entity
  // recorded for one user can never be resolved by another — "open it" after a
  // switch finds nothing and asks, instead of opening the previous user's file.
  useEffect(() => {
    setConversationScope("main-chat", auth.user?.id ?? "anonymous");
  }, [auth.user?.id]);

  // First signed-in launch: greet out loud, once. Uses a pre-generated clip
  // so the welcome does not depend on a provider being connected yet.
  useEffect(() => {
    if (!settingsHydrated) return;
    if (auth.state !== "signed-in" && auth.state !== "offline-authenticated") return;
    if (prefs.general.welcomePlayed) return;
    patchPrefs("general", { welcomePlayed: true });
    const timer = window.setTimeout(() => {
      void import("../services/builtinVoice").then(({ playBuiltinVoice }) =>
        playBuiltinVoice("welcome"),
      );
    }, 900);
    return () => window.clearTimeout(timer);
  }, [settingsHydrated, auth.state, prefs.general.welcomePlayed]);

  // After a signed-in session is ready, ask once for location.
  useEffect(() => {
    if (auth.state !== "signed-in" && auth.state !== "offline-authenticated") return;
    if (!prefs.general.onboardingDone) return;
    if (prefs.general.locationPrompted) return;
    const timer = window.setTimeout(() => setLocationPromptOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, [
    auth.state,
    prefs.general.onboardingDone,
    prefs.general.locationPrompted,
  ]);

  useEffect(() => bindShortcutActions(), []);

  // Apply accent swatch to CSS variables (selected controls / indicators).
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.appearance.accent === "monochrome") {
      root.style.removeProperty("--sonare-violet");
      root.style.removeProperty("--sonare-violet-light");
      root.style.removeProperty("--sonare-violet-glow");
      return;
    }
    const swatch =
      ACCENT_SWATCHES.find((s) => s.id === prefs.appearance.accentColor) ??
      ACCENT_SWATCHES[0];
    root.style.setProperty("--sonare-violet", swatch.color);
    root.style.setProperty("--sonare-violet-light", swatch.color);
    root.style.setProperty("--sonare-violet-glow", `${swatch.color}4d`);
  }, [prefs.appearance.accent, prefs.appearance.accentColor]);

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
  // Overlay notice CTAs emit arcsonare://navigate for Connect / other pages.
  useEffect(() => {
    const unlistenSettings = listen("sonare://open-settings", () => {
      navigate("settings");
    });
    const pages: MainPage[] = ["dashboard", "tasks", "agent", "connect", "settings"];
    const unlistenNavigate = listen<{ page: string; taskFilter?: TaskFilter }>(
      NAVIGATE_EVENT,
      (event) => {
        const page = event.payload.page as MainPage;
        if (!pages.includes(page)) return;
        navigate(
          page,
          event.payload.taskFilter
            ? { taskFilter: event.payload.taskFilter }
            : undefined,
        );
        void emit(NAVIGATED_EVENT, { page });
      },
    );
    return () => {
      unlistenSettings.then((fn) => fn()).catch(() => {});
      unlistenNavigate.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const openCreateTask = () => setCreateTaskOpen(true);

  const customBackgroundSrc = resolveBackgroundSrc(
    prefs.appearance.customBackgroundPath,
    convertFileSrc,
  );
  const shellStyle = customBackgroundSrc
    ? ({
        "--sonare-custom-bg-image": `url("${customBackgroundSrc}")`,
      } as React.CSSProperties)
    : undefined;

  const signedIn =
    auth.state === "signed-in" || auth.state === "offline-authenticated";
  // Only the first bootstrap uses "initializing". Do not block on "signing-in"
  // with a full-window splash — AuthWelcome already shows a busy state.
  const authPending = auth.state === "initializing";

  // Wait for real settings before choosing auth vs dashboard — otherwise the
  // default onboardingDone:false flashes auth and can race the post-sign-in handoff.
  if (!settingsHydrated || authPending) {
    return (
      <div className={`app-shell auth-app-shell${hidden ? " app-paused" : ""}`}>
        <CustomTitleBar />
        <div className="app-boot-splash" role="status" aria-live="polite">
          <p>{authPending ? "Checking your account…" : "Starting ArcSonare…"}</p>
        </div>
      </div>
    );
  }

  // Account is required — guest / local-only no longer opens the Command Center.
  if (!signedIn) {
    return (
      <div
        className={`app-shell auth-app-shell${hidden ? " app-paused" : ""}${customBackgroundSrc ? " has-custom-background" : ""}`}
        style={shellStyle}
      >
        <CustomTitleBar />
        <AppErrorBoundary fallbackTitle="Sign-in failed to load">
          <AuthWelcomePage />
        </AppErrorBoundary>
      </div>
    );
  }

  return (
    <AppErrorBoundary fallbackTitle="ArcSonare failed to open">
      <div
        className={`app-shell${hidden ? " app-paused" : ""}${customBackgroundSrc ? " has-custom-background" : ""}`}
        style={shellStyle}
      >
        <CustomTitleBar />
        <AppHeader onCreateTask={openCreateTask} />
        <main className="app-main" key={page}>
          <AppErrorBoundary fallbackTitle="This page failed to load">
            {page === "dashboard" && <DashboardPage onCreateTask={openCreateTask} />}
            {page === "tasks" && <TasksPage onCreateTask={openCreateTask} />}
            {page === "agent" && <AgentPage />}
            {page === "connect" && <ConnectPage />}
            {page === "settings" && <SettingsPage />}
          </AppErrorBoundary>
        </main>
        <footer className="app-statusbar">
          <span className="statusbar-left">ArcSonare · Ready</span>
          <SystemStatus />
        </footer>
        <CommandPalette onCreateTask={openCreateTask} />
        <CreateTaskModal open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
        <LocationPermissionModal
          open={locationPromptOpen}
          onClose={() => setLocationPromptOpen(false)}
        />
        {/* Non-blocking: it appears over the shell, and everything native keeps
            working whether or not the user acts on it. */}
        <DisplayMappingPrompt />
      </div>
    </AppErrorBoundary>
  );
}
