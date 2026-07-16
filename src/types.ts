/** UI animation phase of the overlay. */
export type OverlayPhase = "hidden" | "opening" | "visible" | "closing";

/** Visual states of the Sonare waveform. Only "idle" is active in Phase 2. */
export type WaveState = "idle" | "listening" | "thinking" | "success" | "error";

export type ThemePreference = "light" | "dark" | "system";

export type OverlayPosition = "top-center" | "top-left" | "top-right";

/** Mirrors the Rust `Settings` struct (serde camelCase). */
export interface Settings {
  globalShortcut: string;
  launchAtStartup: boolean;
  theme: ThemePreference;
  overlayPosition: OverlayPosition;
  uiSounds: boolean;
  reducedMotion: boolean;
  notificationsEnabled: boolean;
  completionNotifications: boolean;
  errorNotifications: boolean;
}

/** Emitted by Rust right after the native overlay window is shown. */
export const EVENT_OPEN = "sonare:open";

/** Emitted by Rust when the overlay should animate out. */
export const EVENT_CLOSE = "sonare:close";

/** Broadcast to every window whenever any setting changes. */
export const EVENT_SETTINGS_CHANGED = "sonare:settings-changed";

/** Emitted by Rust to the main window when the global shortcut fires while
 * the Command Center is visible and focused (instead of opening the
 * top-screen overlay). */
export const EVENT_VOICE_TOGGLE = "sonare:voice-toggle";
