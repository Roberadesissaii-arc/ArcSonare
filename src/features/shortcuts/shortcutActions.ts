/**
 * Bindable global-shortcut actions. Ids must match `KNOWN_ACTIONS` in
 * src-tauri/src/shortcuts.rs. Rust dispatches native actions itself and
 * forwards the rest to the main window via `sonare:shortcut-action`.
 */
export interface ShortcutAction {
  id: string;
  label: string;
  description: string;
  /** True when the effect lives entirely in the main window. */
  frontendOnly?: boolean;
}

export const DEFAULT_SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "voice-toggle",
    label: "Activate or deactivate voice overlay",
    description: "Toggles the global voice overlay from anywhere in Windows.",
  },
  {
    id: "cancel-voice",
    label: "Cancel current voice request",
    description: "Stops listening and hides the overlay.",
  },
  {
    id: "select-voice-sonare",
    label: "Select voice: Sonare",
    description: "Selects the calm, clear default Sonare voice.",
    frontendOnly: true,
  },
  {
    id: "select-voice-vela",
    label: "Select voice: Vela",
    description: "Selects the warm Vela voice.",
    frontendOnly: true,
  },
  {
    id: "select-voice-orion",
    label: "Select voice: Orion",
    description: "Selects the professional Orion voice.",
    frontendOnly: true,
  },
  {
    id: "select-voice-lyra",
    label: "Select voice: Lyra",
    description: "Selects the energetic Lyra voice.",
    frontendOnly: true,
  },
  {
    id: "select-voice-nova",
    label: "Select voice: Nova",
    description: "Selects the expressive Nova voice.",
    frontendOnly: true,
  },
  {
    id: "select-voice-jane",
    label: "Select voice: Jane",
    description: "Selects the conversational Jane voice.",
    frontendOnly: true,
  },
  {
    id: "open-app",
    label: "Open ArcSonare",
    description: "Shows and focuses the Command Center window.",
  },
  {
    id: "hide-app",
    label: "Hide ArcSonare",
    description: "Hides the Command Center to the tray.",
  },
  {
    id: "command-palette",
    label: "Open command palette",
    description: "Opens ArcSonare and the search palette.",
    frontendOnly: true,
  },
  {
    id: "create-task",
    label: "Create task",
    description: "Opens ArcSonare with the new-task dialog.",
    frontendOnly: true,
  },
  {
    id: "dashboard-chat",
    label: "Dashboard: Open Chat",
    description: "Opens the Dashboard directly on Chat from anywhere.",
    frontendOnly: true,
  },
  {
    id: "dashboard-next-view",
    label: "Dashboard: Next view",
    description: "Moves forward through the dashboard views and stops at Chat.",
    frontendOnly: true,
  },
  {
    id: "dashboard-previous-view",
    label: "Dashboard: Previous view",
    description: "Moves backward through the dashboard views and stops at Overview.",
    frontendOnly: true,
  },
  {
    id: "open-tasks",
    label: "Open Tasks",
    description: "Jumps to the Tasks page.",
    frontendOnly: true,
  },
  {
    id: "open-agent",
    label: "Open Agent",
    description: "Jumps to the Agent workspace.",
    frontendOnly: true,
  },
  {
    id: "open-connect",
    label: "Open Connect",
    description: "Jumps to the Connect page.",
    frontendOnly: true,
  },
  {
    id: "open-settings",
    label: "Open Settings",
    description: "Jumps to the last visited Settings section.",
  },
  {
    id: "mute",
    label: "Mute ArcSonare",
    description: "Toggles spoken responses off and on.",
    frontendOnly: true,
  },
  {
    id: "stop-speaking",
    label: "Stop speaking",
    description: "Interrupts the current spoken response.",
    frontendOnly: true,
  },
];
