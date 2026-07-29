/**
 * Settings field classification for account vs device sync.
 * Device-scoped fields must never overwrite another machine.
 */

export type SettingScope = "account" | "device" | "user-selectable";

export const SETTINGS_SCOPE_MAP = {
  account: [
    "general.interfaceLanguage",
    "general.voiceLanguage",
    "general.timeFormat",
    "general.firstDayOfWeek",
    "general.dateFormat",
    "voice.voiceId",
    "voice.responseLength",
    "voice.speakingSpeed",
    "voice.pitch",
    "voice.expressiveness",
    "models.roles",
    "models.autoRouting",
    "models.preferFastSimple",
    "models.preferLocalPrivate",
    "models.costPreference",
    "models.fallbackModelId",
    "notifications.categories",
    "notifications.quietHours",
    "dataPrivacy.allowCloud",
    "dataPrivacy.askBeforeCloud",
    "dataPrivacy.retention",
  ],
  device: [
    "general.startMinimized",
    "general.keepRunningOnClose",
    "general.restoreWindow",
    "general.rememberMonitor",
    // First-run / auth gate must stay on this device — never reset by cloud prefs.
    "general.onboardingDone",
    "general.overlayUnlocked",
    "general.locationPrompted",
    "general.locationPermission",
    "voice.inputDeviceId",
    "voice.outputDeviceId",
    "voice.activationMode",
    "voice.sttEngine",
    "voice.whisperModel",
    "models.ollamaModel",
    "models.ollamaCloudModel",
    "models.offlineFallbackModelId",
    "sounds.outputDeviceId",
    "sounds.outputMode",
    "shortcuts",
    "globalShortcut",
    "launchAtStartup",
  ],
  userSelectable: [
    "appearance.accent",
    "appearance.accentColor",
    "appearance.density",
    "appearance.textScale",
    "theme",
    "reducedMotion",
    "notifications.desktop",
    "notifications.inApp",
    "voice.speakingSpeed",
  ],
} as const;
