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
    id: "screen-context-toggle",
    label: "Toggle Screen Context",
    description: "Starts or stops the screen indicator using your configured target.",
    frontendOnly: true,
  },
  {
    id: "screen-annotation",
    label: "Start screen annotation",
    description: "Captures the configured target and opens the drawing overlay.",
    frontendOnly: true,
  },
  {
    id: "capture-active-window",
    label: "Capture active window",
    description: "Captures the foreground window into Screen Context.",
    frontendOnly: true,
  },
  {
    id: "capture-region",
    label: "Capture selected region",
    description: "Captures a monitor and lets you crop a region in the annotation view.",
    frontendOnly: true,
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
