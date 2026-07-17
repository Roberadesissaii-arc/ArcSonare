/**
 * Typed preference tree persisted inside the Rust-owned settings file
 * (`Settings.prefs`). Rust stores and broadcasts the tree without knowing its
 * shape; this module owns the schema, defaults and validation.
 *
 * Versioned: bump `schemaVersion` and extend `normalizePrefs` when the shape
 * changes in a way a deep default-merge cannot absorb.
 */

export type StartPage = "dashboard" | "tasks" | "agent" | "connect" | "last";
export type TimeFormat = "system" | "12h" | "24h";
export type ResponseLength = "brief" | "balanced" | "detailed";
export type VoiceActivationMode = "push-to-talk" | "toggle" | "hands-free";
export type TurnDetectionMode = "push-release" | "silence" | "semantic";
export type FollowUpWindow = "off" | "30s" | "1m" | "2m" | "5m";
/** Where speech-to-text runs. Local uses Whisper; cloud arrives later. */
export type SttEngine = "local" | "cloud";
export type WhisperModelSize =
  | "tiny"
  | "base"
  | "small"
  | "medium"
  | "turbo";
export type CostPreference = "economy" | "balanced" | "best";
export type CaptureTarget =
  | "active-window"
  | "mouse-monitor"
  | "primary-monitor"
  | "selected-monitor"
  | "all-monitors"
  | "region";
export type ScreenRetention = "none" | "15m" | "1h" | "1d" | "7d";
export type DataRetention =
  | "never"
  | "after-processing"
  | "1h"
  | "1d"
  | "7d"
  | "30d"
  | "manual";
export type EdgeStyle = "perimeter" | "corners" | "pulse";
export type Density = "compact" | "comfortable" | "spacious";
export type AccentMode = "violet" | "monochrome";
export type NotificationDelivery = "banner" | "center" | "windows";

/** Model roles ArcSonare can assign a model to. */
export const MODEL_ROLES = [
  "assistant",
  "fast",
  "reasoning",
  "research",
  "screen",
  "image",
  "transcription",
  "speech",
  "background",
] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** Interface-sound events. */
export const SOUND_EVENTS = [
  "overlay-open",
  "overlay-close",
  "listening",
  "thinking",
  "responding",
  "task-completed",
  "confirmation",
  "error",
  "notification",
  "screen-context-start",
  "screen-context-stop",
  "annotation-confirmed",
  "wake-word",
] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

/** Notification categories. */
export const NOTIFICATION_CATEGORIES = [
  "task-created",
  "task-completed",
  "task-overdue",
  "deadline",
  "agent-started",
  "agent-completed",
  "agent-confirmation",
  "agent-failed",
  "connection-lost",
  "connection-restored",
  "screen-context-started",
  "screen-context-stopped",
  "model-unavailable",
  "app-update",
  "system-error",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Data types with independent retention. */
export const RETENTION_DATA_TYPES = [
  "voice-transcripts",
  "raw-audio",
  "screen-captures",
  "screen-annotations",
  "agent-activity",
  "search-history",
  "command-history",
] as const;
export type RetentionDataType = (typeof RETENTION_DATA_TYPES)[number];

export interface Prefs {
  schemaVersion: number;

  general: {
    startMinimized: boolean;
    keepRunningOnClose: boolean;
    openOnPage: StartPage;
    restoreWindow: boolean;
    rememberMonitor: boolean;
    autoUpdateCheck: boolean;
    interfaceLanguage: string;
    voiceLanguage: string;
    autoDetectLanguage: boolean;
    timeFormat: TimeFormat;
    firstDayOfWeek: "system" | "monday" | "sunday";
    dateFormat: "system" | "dmy" | "mdy" | "ymd";
    showGreeting: boolean;
    showStatusFooter: boolean;
    orbitalMotion: boolean;
    pauseWhenUnfocused: boolean;
    confirmQuit: boolean;
    onboardingDone: boolean;
  };

  voice: {
    inputDeviceId: string;
    outputDeviceId: string;
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
    backgroundFilter: boolean;
    inputSensitivity: number; // 0..100
    activationMode: VoiceActivationMode;
    outputVolume: number; // 0..100
    muteResponses: boolean;
    duckOtherAudio: boolean;
    stopOnInterrupt: boolean;
    systemOutputFallback: boolean;
    voiceId: string;
    speakingSpeed: number; // 50..200 (%)
    pitch: number; // 50..150 (%)
    expressiveness: number; // 0..100
    responseLength: ResponseLength;
    allowInterruption: boolean;
    speakConfirmations: boolean;
    speakErrors: boolean;
    speakTaskCompletions: boolean;
    turnDetection: TurnDetectionMode;
    silenceDurationMs: number; // 300..3000
    interruptionSensitivity: number; // 0..100
    minSpeechMs: number; // 100..2000
    cancelAccidental: boolean;
    followUpWindow: FollowUpWindow;
    /** Speech-to-text engine. Local → Whisper; cloud is reserved. */
    sttEngine: SttEngine;
    whisperModel: WhisperModelSize;
  };

  wakeWord: {
    enabled: boolean;
    phrase: string;
    sensitivity: number; // 0..100
    listenAfterStartup: boolean;
    pauseWhileSpeaking: boolean;
    pauseDuringCalls: boolean;
    audibleConfirmation: boolean;
    visualConfirmation: boolean;
    localOnly: boolean;
    pushToTalkFallback: boolean;
  };

  models: {
    roles: Record<ModelRole, string | null>;
    /** Installed Ollama model name, e.g. "llama3.2". */
    ollamaModel: string;
    autoRouting: boolean;
    preferFastSimple: boolean;
    preferLocalPrivate: boolean;
    askBeforeScreenCloud: boolean;
    fallbackWhenUnavailable: boolean;
    costPreference: CostPreference;
    /** Cloud-capable fallback when the primary model is unavailable. */
    fallbackModelId: string | null;
    /** Local-only fallback when offline. */
    offlineFallbackModelId: string | null;
    /** Models settings browser chrome (filter/sort/view). */
    browser: {
      filter: string;
      sort: string;
      view: "grid" | "list";
      recentlyUsed: string[];
    };
  };

  screenContext: {
    enabled: boolean;
    requireConfirmation: boolean;
    showIndicator: boolean;
    playCaptureSound: boolean;
    includePointer: boolean;
    includeShadows: boolean;
    hideArcSonareWindows: boolean;
    autoDeleteTemp: boolean;
    askBeforeCloud: boolean;
    defaultTarget: CaptureTarget;
    selectedMonitorIds: string[];
    showLabel: boolean;
    edgeIntensity: number; // 0..100
    edgeStyle: EdgeStyle;
    annotation: {
      pen: boolean;
      rectangle: boolean;
      ellipse: boolean;
      arrow: boolean;
      highlighter: boolean;
      redact: boolean;
      thickness: number; // 1..10
      color: string;
      showToolbar: boolean;
      keepAfterCapture: boolean;
      autoCrop: boolean;
    };
    privacy: {
      saveHistory: boolean;
      retention: ScreenRetention;
      localOnly: boolean;
      removeAfterProcessing: boolean;
      excludePasswordFields: boolean;
    };
  };

  appearance: {
    accent: AccentMode;
    /** Swatch id used when accent is violet (violet/blue/cyan/green/orange/red). */
    accentColor: string;
    density: Density;
    textScale: number; // 85..125 (%)
    cardContrast: number; // 0..100
    transparency: number; // 0..100
    backgroundBlur: boolean;
    disableOrbital: boolean;
    disableWaveform: boolean;
    disableGlow: boolean;
    overlayOffset: number; // px from top, 0..64
    overlayScale: number; // 85..115 (%)
  };

  sounds: {
    enabled: boolean;
    masterVolume: number; // 0..100
    respectQuietHours: boolean;
    muteWhilePresenting: boolean;
    events: Record<SoundEvent, { enabled: boolean; volume: number }>;
  };

  notifications: {
    desktop: boolean;
    inApp: boolean;
    windows: boolean;
    sounds: boolean;
    badge: boolean;
    markReadOnOpen: boolean;
    group: boolean;
    delivery: NotificationDelivery;
    categories: Record<NotificationCategory, boolean>;
    quietHours: {
      enabled: boolean;
      start: string; // "22:00"
      end: string; // "08:00"
      allowUrgent: boolean;
      allowDeadlines: boolean;
      allowAgentFailures: boolean;
    };
    privacy: {
      hideContent: boolean;
      hideTaskNames: boolean;
      hideContactNames: boolean;
      genericOnly: boolean;
    };
  };

  dataPrivacy: {
    retention: Record<RetentionDataType, DataRetention>;
    storeTranscripts: boolean;
    storeRawAudio: boolean;
    storeCaptures: boolean;
    allowCloud: boolean;
    askBeforeCloud: boolean;
    diagnostics: boolean;
    crashReports: boolean;
    perfMetrics: boolean;
  };

  /** Extra global shortcuts (action id → shortcut). Written only through the
   * `set_action_shortcut` command after native registration succeeds. */
  shortcuts: Record<string, string>;
}

function defaultSoundEvents(): Prefs["sounds"]["events"] {
  const events = {} as Prefs["sounds"]["events"];
  for (const id of SOUND_EVENTS) {
    events[id] = { enabled: true, volume: 70 };
  }
  return events;
}

function defaultCategories(): Prefs["notifications"]["categories"] {
  const categories = {} as Prefs["notifications"]["categories"];
  for (const id of NOTIFICATION_CATEGORIES) {
    categories[id] = true;
  }
  return categories;
}

function defaultRetention(): Prefs["dataPrivacy"]["retention"] {
  return {
    "voice-transcripts": "7d",
    "raw-audio": "never",
    "screen-captures": "after-processing",
    "screen-annotations": "7d",
    "agent-activity": "30d",
    "search-history": "7d",
    "command-history": "7d",
  };
}

export const DEFAULT_PREFS: Prefs = {
  schemaVersion: 5,
  general: {
    startMinimized: false,
    keepRunningOnClose: true,
    openOnPage: "dashboard",
    restoreWindow: true,
    rememberMonitor: true,
    autoUpdateCheck: true,
    interfaceLanguage: "en-US",
    voiceLanguage: "en-US",
    autoDetectLanguage: true,
    timeFormat: "system",
    firstDayOfWeek: "system",
    dateFormat: "system",
    showGreeting: true,
    showStatusFooter: true,
    orbitalMotion: true,
    pauseWhenUnfocused: true,
    confirmQuit: false,
    onboardingDone: false,
  },
  voice: {
    inputDeviceId: "default",
    outputDeviceId: "default",
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    backgroundFilter: false,
    inputSensitivity: 60,
    activationMode: "toggle",
    outputVolume: 80,
    muteResponses: false,
    duckOtherAudio: true,
    stopOnInterrupt: true,
    systemOutputFallback: true,
    voiceId: "sonare",
    speakingSpeed: 100,
    pitch: 100,
    expressiveness: 55,
    responseLength: "balanced",
    allowInterruption: true,
    speakConfirmations: true,
    speakErrors: true,
    speakTaskCompletions: true,
    turnDetection: "silence",
    silenceDurationMs: 900,
    interruptionSensitivity: 50,
    minSpeechMs: 300,
    cancelAccidental: true,
    followUpWindow: "30s",
    sttEngine: "local",
    whisperModel: "base",
  },
  wakeWord: {
    enabled: false,
    phrase: "Hey ArcSonare",
    sensitivity: 55,
    listenAfterStartup: false,
    pauseWhileSpeaking: true,
    pauseDuringCalls: true,
    audibleConfirmation: true,
    visualConfirmation: true,
    localOnly: true,
    pushToTalkFallback: true,
  },
  models: {
    roles: {
      assistant: "ollama-local",
      fast: null,
      reasoning: null,
      research: null,
      screen: null,
      image: null,
      transcription: null,
      speech: null,
      background: null,
    },
    ollamaModel: "",
    autoRouting: true,
    preferFastSimple: true,
    preferLocalPrivate: true,
    askBeforeScreenCloud: true,
    fallbackWhenUnavailable: true,
    costPreference: "balanced",
    fallbackModelId: null,
    offlineFallbackModelId: "ollama-local",
    browser: {
      filter: "all",
      sort: "recommended",
      view: "grid",
      recentlyUsed: [],
    },
  },
  screenContext: {
    enabled: false,
    requireConfirmation: true,
    showIndicator: true,
    playCaptureSound: true,
    includePointer: false,
    includeShadows: true,
    hideArcSonareWindows: true,
    autoDeleteTemp: true,
    askBeforeCloud: true,
    defaultTarget: "mouse-monitor",
    selectedMonitorIds: [],
    showLabel: true,
    edgeIntensity: 70,
    edgeStyle: "perimeter",
    annotation: {
      pen: true,
      rectangle: true,
      ellipse: true,
      arrow: true,
      highlighter: true,
      redact: true,
      thickness: 3,
      color: "#A576FF",
      showToolbar: true,
      keepAfterCapture: true,
      autoCrop: false,
    },
    privacy: {
      saveHistory: true,
      retention: "1h",
      localOnly: true,
      removeAfterProcessing: false,
      excludePasswordFields: true,
    },
  },
  appearance: {
    accent: "violet",
    accentColor: "violet",
    density: "comfortable",
    textScale: 100,
    cardContrast: 50,
    transparency: 50,
    backgroundBlur: true,
    disableOrbital: false,
    disableWaveform: false,
    disableGlow: false,
    overlayOffset: 16,
    overlayScale: 100,
  },
  sounds: {
    enabled: true,
    masterVolume: 60,
    respectQuietHours: true,
    muteWhilePresenting: false,
    events: defaultSoundEvents(),
  },
  notifications: {
    desktop: true,
    inApp: true,
    windows: false,
    sounds: true,
    badge: true,
    markReadOnOpen: false,
    group: true,
    delivery: "banner",
    categories: defaultCategories(),
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "08:00",
      allowUrgent: true,
      allowDeadlines: true,
      allowAgentFailures: true,
    },
    privacy: {
      hideContent: false,
      hideTaskNames: false,
      hideContactNames: false,
      genericOnly: false,
    },
  },
  dataPrivacy: {
    retention: defaultRetention(),
    storeTranscripts: true,
    storeRawAudio: false,
    storeCaptures: true,
    allowCloud: false,
    askBeforeCloud: true,
    diagnostics: false,
    crashReports: false,
    perfMetrics: false,
  },
  shortcuts: {},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Recursively merges a persisted (possibly partial or stale) tree over the
 * defaults. Only keys present in the defaults survive; a saved value is kept
 * only when its primitive type matches the default's. `shortcuts` is the one
 * open map (unknown keys allowed, string values only).
 */
function mergeNode<T>(defaults: T, saved: unknown): T {
  if (isPlainObject(defaults)) {
    const out: Record<string, unknown> = {};
    const savedObj = isPlainObject(saved) ? saved : {};
    for (const key of Object.keys(defaults as Record<string, unknown>)) {
      out[key] = mergeNode(
        (defaults as Record<string, unknown>)[key],
        savedObj[key],
      );
    }
    return out as T;
  }
  if (Array.isArray(defaults)) {
    return (Array.isArray(saved) ? saved : defaults) as T;
  }
  if (typeof saved === typeof defaults && saved !== null) {
    return saved as T;
  }
  return defaults;
}

export function normalizePrefs(raw: unknown): Prefs {
  const merged = mergeNode(DEFAULT_PREFS, raw);
  // Open map: preserve every valid saved shortcut binding.
  if (isPlainObject(raw) && isPlainObject(raw.shortcuts)) {
    const shortcuts: Record<string, string> = {};
    for (const [action, value] of Object.entries(raw.shortcuts)) {
      if (typeof value === "string" && value) shortcuts[action] = value;
    }
    merged.shortcuts = shortcuts;
  }
  merged.schemaVersion = DEFAULT_PREFS.schemaVersion;
  return merged;
}
