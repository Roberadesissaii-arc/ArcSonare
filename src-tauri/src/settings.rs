//! Typed, validated, file-backed application settings.
//!
//! Rust owns the settings file; the frontend reads and patches settings only
//! through commands. Every change is broadcast to all windows via the
//! `sonare:settings-changed` event so the UI stays in sync.

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

pub const SETTINGS_CHANGED_EVENT: &str = "sonare:settings-changed";
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";
// Bump when a new one-time shortcut-default migration is introduced.
const SHORTCUT_DEFAULTS_VERSION: u64 = 12;

const DEFAULT_ACTION_SHORTCUTS: &[(&str, &str)] = &[
    ("cancel-voice", "Ctrl+Alt+KeyQ"),
    ("select-voice-sonare", "Ctrl+Alt+Digit1"),
    ("select-voice-vela", "Ctrl+Alt+Digit2"),
    ("select-voice-orion", "Ctrl+Alt+Digit3"),
    ("select-voice-lyra", "Ctrl+Alt+Digit4"),
    ("select-voice-nova", "Ctrl+Alt+Digit5"),
    ("select-voice-jane", "Ctrl+Alt+Digit6"),
    ("open-app", "Ctrl+Alt+KeyA"),
    ("hide-app", "Ctrl+Alt+KeyH"),
    ("command-palette", "Ctrl+Alt+KeyP"),
    ("create-task", "Ctrl+Alt+KeyT"),
    ("dashboard-chat", "Ctrl+Alt+KeyC"),
    ("dashboard-next-view", "Ctrl+Alt+KeyN"),
    ("dashboard-previous-view", "Ctrl+Alt+KeyB"),
    ("open-tasks", "Ctrl+Alt+KeyL"),
    ("open-agent", "Ctrl+Alt+KeyG"),
    ("open-connect", "Ctrl+Alt+KeyI"),
    ("open-settings", "Ctrl+Alt+KeyS"),
    ("mute", "Ctrl+Alt+Shift+KeyM"),
    ("stop-speaking", "Ctrl+Alt+KeyX"),
];

fn default_prefs() -> serde_json::Value {
    let shortcuts = DEFAULT_ACTION_SHORTCUTS
        .iter()
        .map(|(action, shortcut)| {
            (
                (*action).to_string(),
                serde_json::Value::String((*shortcut).to_string()),
            )
        })
        .collect::<serde_json::Map<String, serde_json::Value>>();
    serde_json::json!({
        "schemaVersion": SHORTCUT_DEFAULTS_VERSION,
        "shortcuts": shortcuts,
    })
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub global_shortcut: String,
    pub launch_at_startup: bool,
    pub theme: String,
    pub overlay_position: String,
    pub ui_sounds: bool,
    pub reduced_motion: bool,
    pub notifications_enabled: bool,
    pub completion_notifications: bool,
    pub error_notifications: bool,
    /// Free-form preference tree owned by the frontend (typed + validated in
    /// src/config/prefs.ts). Rust persists and broadcasts it; the pieces Rust
    /// itself consumes (extra shortcuts, screen-context options) are read
    /// through the accessors below.
    pub prefs: serde_json::Value,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            global_shortcut: DEFAULT_SHORTCUT.into(),
            launch_at_startup: false,
            theme: "dark".into(),
            overlay_position: "top-center".into(),
            ui_sounds: false,
            reduced_motion: false,
            notifications_enabled: true,
            completion_notifications: true,
            error_notifications: true,
            prefs: default_prefs(),
        }
    }
}

impl Settings {
    /// Clamps any invalid persisted values back to safe defaults.
    fn sanitized(mut self) -> Self {
        if !matches!(self.theme.as_str(), "light" | "dark" | "system") {
            self.theme = "dark".into();
        }
        if !matches!(
            self.overlay_position.as_str(),
            "top-center" | "top-left" | "top-right"
        ) {
            self.overlay_position = "top-center".into();
        }
        if crate::shortcuts::parse_shortcut(&self.global_shortcut).is_none() {
            self.global_shortcut = DEFAULT_SHORTCUT.into();
        }
        if !self.prefs.is_object() {
            self.prefs = default_prefs();
        }
        let schema_version = self
            .prefs
            .get("schemaVersion")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        if schema_version < SHORTCUT_DEFAULTS_VERSION {
            let prefs = self.prefs.as_object_mut().expect("prefs was normalized above");
            let shortcuts = prefs
                .entry("shortcuts")
                .or_insert_with(|| serde_json::Value::Object(Default::default()));
            if !shortcuts.is_object() {
                *shortcuts = serde_json::Value::Object(Default::default());
            }
            let shortcuts = shortcuts
                .as_object_mut()
                .expect("shortcuts was normalized above");
            for (action, shortcut) in DEFAULT_ACTION_SHORTCUTS {
                shortcuts
                    .entry((*action).to_string())
                    .or_insert_with(|| serde_json::Value::String((*shortcut).to_string()));
            }
            prefs.insert(
                "schemaVersion".into(),
                serde_json::Value::from(SHORTCUT_DEFAULTS_VERSION),
            );
        }
        self
    }

    /// `prefs.shortcuts` — action id → shortcut string for the extra global
    /// shortcuts (the voice toggle stays in `global_shortcut`).
    pub fn action_shortcuts(&self) -> Vec<(String, String)> {
        let Some(map) = self.prefs.get("shortcuts").and_then(|v| v.as_object()) else {
            return Vec::new();
        };
        map.iter()
            .filter_map(|(action, value)| {
                value
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(|s| (action.clone(), s.to_string()))
            })
            .collect()
    }

    /// Reads a boolean from the prefs tree by dotted path, with a default.
    pub fn pref_bool(&self, path: &str, default: bool) -> bool {
        let mut node = &self.prefs;
        for part in path.split('.') {
            match node.get(part) {
                Some(next) => node = next,
                None => return default,
            }
        }
        node.as_bool().unwrap_or(default)
    }
}

/// Managed at Builder time (before any webview can invoke a command) with
/// defaults; `ensure_loaded` / `initialize` swap in the persisted values.
/// Webviews can race ahead of `setup`, so every public reader must call
/// `ensure_loaded` first — otherwise empty defaults wipe onboardingDone.
pub struct SettingsState {
    pub inner: Mutex<Settings>,
    loaded: AtomicBool,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Settings::default()),
            loaded: AtomicBool::new(false),
        }
    }
}

/// Loads the persisted settings into the already-managed state and broadcasts
/// them so windows that rendered against the defaults update immediately.
pub fn initialize(app: &AppHandle) {
    ensure_loaded(app);
    let settings = current(app);
    if let Err(e) = app.emit(SETTINGS_CHANGED_EVENT, &settings) {
        log::error!("failed to broadcast settings change: {e}");
    }
}

/// Idempotent disk load. Safe to call from commands before `setup` finishes.
pub fn ensure_loaded<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<SettingsState>();
    if state.loaded.load(Ordering::Acquire) {
        return;
    }
    let loaded = load(app);
    let mut guard = state.inner.lock().unwrap();
    if state.loaded.load(Ordering::Acquire) {
        return;
    }
    *guard = loaded;
    state.loaded.store(true, Ordering::Release);
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join("settings.json")),
        Err(e) => {
            log::error!("could not resolve app config directory: {e}");
            None
        }
    }
}

/// Loads settings from disk (used once, during `ensure_loaded` / `initialize`).
fn load<R: Runtime>(app: &AppHandle<R>) -> Settings {
    let Some(path) = settings_path(app) else {
        return Settings::default();
    };
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Settings>(&raw) {
            Ok(settings) => settings.sanitized(),
            Err(e) => {
                log::warn!("settings file is invalid, using defaults: {e}");
                Settings::default()
            }
        },
        Err(_) => Settings::default(),
    }
}

fn save(app: &AppHandle, settings: &Settings) {
    let Some(path) = settings_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            log::error!("could not create config directory: {e}");
            return;
        }
    }
    match serde_json::to_string_pretty(settings) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                log::error!("could not write settings file: {e}");
            }
        }
        Err(e) => log::error!("could not serialize settings: {e}"),
    }
}

pub fn current<R: Runtime>(app: &AppHandle<R>) -> Settings {
    ensure_loaded(app);
    app.state::<SettingsState>().inner.lock().unwrap().clone()
}

/// Stores + persists + broadcasts a new settings value.
pub fn apply(app: &AppHandle, settings: Settings) {
    ensure_loaded(app);
    *app.state::<SettingsState>().inner.lock().unwrap() = settings.clone();
    app.state::<SettingsState>()
        .loaded
        .store(true, Ordering::Release);
    save(app, &settings);
    if let Err(e) = app.emit(SETTINGS_CHANGED_EVENT, &settings) {
        log::error!("failed to broadcast settings change: {e}");
    }
}

/// Aligns the persisted `launch_at_startup` flag with the actual OS state.
pub fn sync_autostart_state(app: &AppHandle) {
    match app.autolaunch().is_enabled() {
        Ok(actual) => {
            let mut settings = current(app);
            if settings.launch_at_startup != actual {
                settings.launch_at_startup = actual;
                apply(app, settings);
            }
        }
        Err(e) => log::warn!("could not query autostart state: {e}"),
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    current(&app)
}

/// Persist voice-overlay unlock without a full frontend settings round-trip.
#[tauri::command]
pub fn set_overlay_unlocked(app: AppHandle, unlocked: bool) {
    let mut settings = current(&app);
    let mut prefs = settings.prefs.clone();
    if !prefs.is_object() {
        prefs = serde_json::json!({});
    }
    if let Some(obj) = prefs.as_object_mut() {
        let general = obj
            .entry("general")
            .or_insert_with(|| serde_json::json!({}));
        if let Some(general_obj) = general.as_object_mut() {
            general_obj.insert("overlayUnlocked".into(), serde_json::Value::Bool(unlocked));
        } else {
            *general = serde_json::json!({ "overlayUnlocked": unlocked });
        }
    }
    settings.prefs = prefs;
    apply(&app, settings);
}

/// Applies a full settings object from the frontend. The global shortcut and
/// autostart flag are managed by dedicated commands with native side effects,
/// so any values for them in this payload are ignored.
#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) {
    let mut incoming = settings.sanitized();
    let current_settings = current(&app);
    incoming.global_shortcut = current_settings.global_shortcut.clone();
    incoming.launch_at_startup = current_settings.launch_at_startup;

    // Action shortcuts require native registration and are only writable
    // through the dedicated `set_action_shortcut` command.
    if let Some(incoming_obj) = incoming.prefs.as_object_mut() {
        match current_settings.prefs.get("shortcuts") {
            Some(current_shortcuts) => {
                incoming_obj.insert("shortcuts".into(), current_shortcuts.clone());
            }
            None => {
                incoming_obj.remove("shortcuts");
            }
        }
    }

    let reposition = incoming.overlay_position != current_settings.overlay_position;
    if incoming == current_settings {
        return;
    }
    apply(&app, incoming);
    if reposition {
        crate::overlay::reposition_if_visible(&app);
    }
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    result.map_err(|e| format!("Windows did not accept the startup change: {e}"))?;

    let mut settings = current(&app);
    settings.launch_at_startup = enabled;
    apply(&app, settings);
    Ok(())
}

/// Deletes the settings file and restores every preference to its default,
/// including re-registering the default shortcut and disabling autostart.
#[tauri::command]
pub fn clear_local_data(app: AppHandle) -> Result<(), String> {
    let defaults = Settings::default();

    if let Err(e) = crate::shortcuts::apply_shortcut(&app, &defaults.global_shortcut) {
        log::warn!("could not restore default shortcut while clearing data: {e}");
    }
    if let Err(e) = app.autolaunch().disable() {
        log::warn!("could not disable autostart while clearing data: {e}");
    }
    if let Some(path) = settings_path(&app) {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Could not delete local data: {e}"))?;
        }
    }
    apply(&app, defaults);
    Ok(())
}
