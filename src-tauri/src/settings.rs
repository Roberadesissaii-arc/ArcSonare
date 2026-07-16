//! Typed, validated, file-backed application settings.
//!
//! Rust owns the settings file; the frontend reads and patches settings only
//! through commands. Every change is broadcast to all windows via the
//! `sonare:settings-changed` event so the UI stays in sync.

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

pub const SETTINGS_CHANGED_EVENT: &str = "sonare:settings-changed";
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";

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
        self
    }
}

/// Managed at Builder time (before any webview can invoke a command) with
/// defaults; `initialize` swaps in the persisted values during setup.
#[derive(Default)]
pub struct SettingsState(pub Mutex<Settings>);

/// Loads the persisted settings into the already-managed state and broadcasts
/// them so windows that rendered against the defaults update immediately.
pub fn initialize(app: &AppHandle) {
    let loaded = load(app);
    apply(app, loaded);
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join("settings.json")),
        Err(e) => {
            log::error!("could not resolve app config directory: {e}");
            None
        }
    }
}

/// Loads settings from disk (used once, during `initialize`).
fn load(app: &AppHandle) -> Settings {
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

pub fn current(app: &AppHandle) -> Settings {
    app.state::<SettingsState>().0.lock().unwrap().clone()
}

/// Stores + persists + broadcasts a new settings value.
pub fn apply(app: &AppHandle, settings: Settings) {
    *app.state::<SettingsState>().0.lock().unwrap() = settings.clone();
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

/// Applies a full settings object from the frontend. The global shortcut and
/// autostart flag are managed by dedicated commands with native side effects,
/// so any values for them in this payload are ignored.
#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) {
    let mut incoming = settings.sanitized();
    let current_settings = current(&app);
    incoming.global_shortcut = current_settings.global_shortcut.clone();
    incoming.launch_at_startup = current_settings.launch_at_startup;

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
    crate::overlay::reposition_if_visible(&app);
    Ok(())
}
