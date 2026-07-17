//! Global shortcut registration, multi-action dispatch and user
//! customization.
//!
//! Two storage locations exist for historical compatibility:
//! - `Settings.global_shortcut` — the voice-overlay toggle (the original
//!   shortcut, edited via `set_global_shortcut`).
//! - `Settings.prefs.shortcuts` — every other action, edited via
//!   `set_action_shortcut`. A binding is persisted only after Windows
//!   accepted the native registration.

use std::{collections::HashMap, sync::Mutex};

use serde::Serialize;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const VOICE_ACTION: &str = "voice-toggle";
pub const ACTION_EVENT: &str = "sonare:shortcut-action";

/// Actions that can carry a global shortcut. Rust handles the native ones
/// directly; the rest are forwarded to the main window over an event.
pub const KNOWN_ACTIONS: &[&str] = &[
    VOICE_ACTION,
    "cancel-voice",
    "open-app",
    "hide-app",
    "command-palette",
    "create-task",
    "open-tasks",
    "open-agent",
    "open-connect",
    "open-settings",
    "screen-context-toggle",
    "screen-annotation",
    "capture-active-window",
    "capture-region",
    "mute",
    "stop-speaking",
];

/// shortcut id (`Shortcut::id()`) → action id, for dispatch.
#[derive(Default)]
pub struct ShortcutActions(pub Mutex<HashMap<u32, String>>);

/// Parses a stored shortcut string (e.g. "Ctrl+Shift+Space", "Ctrl+Alt+KeyA").
/// Returns `None` when the string is invalid or contains no modifier key —
/// bare-key global shortcuts are unsafe because they swallow normal typing.
pub fn parse_shortcut(value: &str) -> Option<Shortcut> {
    let has_modifier = value.split('+').any(|token| {
        matches!(
            token.trim().to_ascii_lowercase().as_str(),
            "ctrl" | "control" | "shift" | "alt" | "option" | "super" | "meta" | "cmd" | "command"
        )
    });
    if !has_modifier {
        return None;
    }
    value.parse::<Shortcut>().ok()
}

fn dispatch(app: &AppHandle, action: &str) {
    log::info!("global shortcut action: {action}");
    match action {
        VOICE_ACTION => crate::overlay::toggle_overlay(app),
        "cancel-voice" => crate::overlay::close_overlay(app),
        "open-app" => crate::panels::show_main(app),
        "hide-app" => crate::panels::hide_main_window(app),
        "open-settings" => crate::panels::show_settings(app),
        "screen-context-toggle" => {
            // Handled by the frontend so the configured target/confirmation
            // settings apply; bring the app forward only for confirmation.
            forward(app, action);
        }
        _ => forward(app, action),
    }
}

/// Forwards an action to the main window (shown first so the user sees the
/// result of pressing the shortcut).
fn forward(app: &AppHandle, action: &str) {
    // Mute / stop-speaking must not steal focus; everything else shows the app.
    if !matches!(action, "mute" | "stop-speaking" | "screen-context-toggle") {
        crate::panels::show_main(app);
    }
    if let Some(window) = app.get_webview_window(crate::panels::MAIN_LABEL) {
        if let Err(e) = window.emit(ACTION_EVENT, action) {
            log::error!("failed to forward shortcut action '{action}': {e}");
        }
    }
}

/// Builds the global-shortcut plugin with the multi-action handler.
pub fn init() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let action = app
                .state::<ShortcutActions>()
                .0
                .lock()
                .unwrap()
                .get(&shortcut.id())
                .cloned();
            match action {
                Some(action) => dispatch(app, &action),
                None => log::warn!("shortcut fired with no mapped action"),
            }
        })
        .build()
}

fn register_binding(app: &AppHandle, action: &str, value: &str) -> Result<(), String> {
    let shortcut = parse_shortcut(value).ok_or_else(|| {
        "This combination can't be used. Include at least one modifier key (Ctrl, Alt, Shift or Win) plus a regular key.".to_string()
    })?;
    app.global_shortcut().register(shortcut).map_err(|e| {
        format!("Windows rejected this shortcut — it may already be in use by another application. ({e})")
    })?;
    app.state::<ShortcutActions>()
        .0
        .lock()
        .unwrap()
        .insert(shortcut.id(), action.to_string());
    Ok(())
}

fn unregister_binding(app: &AppHandle, value: &str) {
    let Some(shortcut) = parse_shortcut(value) else {
        return;
    };
    if let Err(e) = app.global_shortcut().unregister(shortcut) {
        log::warn!("could not unregister shortcut '{value}': {e}");
    }
    app.state::<ShortcutActions>()
        .0
        .lock()
        .unwrap()
        .remove(&shortcut.id());
}

/// Registers every stored shortcut at startup: the voice toggle plus each
/// action binding from prefs. Individual failures are reported but not fatal.
pub fn register_from_settings(app: &AppHandle) {
    let settings = crate::settings::current(app);

    let voice_value = if parse_shortcut(&settings.global_shortcut).is_some() {
        settings.global_shortcut.clone()
    } else {
        log::error!(
            "stored shortcut '{}' is invalid; falling back to default",
            settings.global_shortcut
        );
        crate::settings::DEFAULT_SHORTCUT.to_string()
    };
    match register_binding(app, VOICE_ACTION, &voice_value) {
        Ok(()) => log::info!("registered voice shortcut {voice_value}"),
        Err(e) => log::error!("could not register voice shortcut {voice_value}: {e}"),
    }

    for (action, value) in settings.action_shortcuts() {
        if !KNOWN_ACTIONS.contains(&action.as_str()) {
            log::warn!("ignoring stored shortcut for unknown action '{action}'");
            continue;
        }
        match register_binding(app, &action, &value) {
            Ok(()) => log::info!("registered {action} shortcut {value}"),
            Err(e) => log::error!("could not register {action} shortcut {value}: {e}"),
        }
    }
}

/// Swaps the voice-toggle registration to `new_value`. The new shortcut is
/// registered *before* the old one is unregistered, so a failure leaves the
/// previous shortcut fully functional. Does not persist settings.
pub fn apply_shortcut(app: &AppHandle, new_value: &str) -> Result<(), String> {
    let old_value = crate::settings::current(app).global_shortcut;
    if parse_shortcut(&old_value) == parse_shortcut(new_value)
        && parse_shortcut(new_value).is_some()
    {
        return Ok(());
    }
    check_internal_conflict(app, new_value, VOICE_ACTION)?;
    register_binding(app, VOICE_ACTION, new_value)?;
    unregister_binding(app, &old_value);
    Ok(())
}

/// Rejects a combination already bound to a *different* ArcSonare action.
fn check_internal_conflict(app: &AppHandle, value: &str, action: &str) -> Result<(), String> {
    let Some(candidate) = parse_shortcut(value) else {
        return Ok(()); // parse errors are reported by the caller
    };
    let state = app.state::<ShortcutActions>();
    let map = state.0.lock().unwrap();
    if let Some(owner) = map.get(&candidate.id()) {
        if owner != action {
            return Err(format!(
                "This combination is already used by another ArcSonare action ({owner})."
            ));
        }
    }
    Ok(())
}

/// Changes, persists and broadcasts the voice-toggle shortcut.
#[tauri::command]
pub fn set_global_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    let value = shortcut.trim().to_string();
    let mut settings = crate::settings::current(&app);
    if settings.global_shortcut == value {
        return Ok(());
    }
    apply_shortcut(&app, &value)?;
    settings.global_shortcut = value;
    crate::settings::apply(&app, settings);
    Ok(())
}

/// Binds (or clears, when `shortcut` is null) a global shortcut for an
/// action. Persists only after the native registration succeeded.
#[tauri::command]
pub fn set_action_shortcut(
    app: AppHandle,
    action: String,
    shortcut: Option<String>,
) -> Result<(), String> {
    if !KNOWN_ACTIONS.contains(&action.as_str()) {
        return Err(format!("Unknown shortcut action '{action}'."));
    }
    if action == VOICE_ACTION {
        return Err("The voice shortcut is changed through set_global_shortcut.".into());
    }

    let mut settings = crate::settings::current(&app);
    let old_value = settings
        .prefs
        .get("shortcuts")
        .and_then(|s| s.get(&action))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match &shortcut {
        Some(value) => {
            let value = value.trim();
            if Some(value) == old_value.as_deref() {
                return Ok(());
            }
            check_internal_conflict(&app, value, &action)?;
            register_binding(&app, &action, value)?;
            if let Some(old) = &old_value {
                unregister_binding(&app, old);
            }
            write_pref_shortcut(&mut settings, &action, Some(value));
        }
        None => {
            if let Some(old) = &old_value {
                unregister_binding(&app, old);
            }
            write_pref_shortcut(&mut settings, &action, None);
        }
    }
    crate::settings::apply(&app, settings);
    Ok(())
}

fn write_pref_shortcut(settings: &mut crate::settings::Settings, action: &str, value: Option<&str>) {
    let prefs = settings
        .prefs
        .as_object_mut()
        .expect("prefs is sanitized to an object");
    let shortcuts = prefs
        .entry("shortcuts")
        .or_insert_with(|| serde_json::Value::Object(Default::default()));
    if let Some(map) = shortcuts.as_object_mut() {
        match value {
            Some(v) => {
                map.insert(action.to_string(), serde_json::Value::String(v.into()));
            }
            None => {
                map.remove(action);
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutProbe {
    pub ok: bool,
    pub error: Option<String>,
}

/// Validates a combination without keeping it: parse → register → unregister.
/// Lets the recorder show honest feedback before the user commits.
#[tauri::command]
pub fn probe_shortcut(app: AppHandle, shortcut: String) -> ShortcutProbe {
    let Some(parsed) = parse_shortcut(&shortcut) else {
        return ShortcutProbe {
            ok: false,
            error: Some(
                "Include at least one modifier key (Ctrl, Alt, Shift or Win) plus a regular key."
                    .into(),
            ),
        };
    };
    // Already ours → conflict handled at save time; report as in use.
    if app
        .state::<ShortcutActions>()
        .0
        .lock()
        .unwrap()
        .contains_key(&parsed.id())
    {
        return ShortcutProbe {
            ok: false,
            error: Some("This combination is already used by another ArcSonare action.".into()),
        };
    }
    match app.global_shortcut().register(parsed) {
        Ok(()) => {
            if let Err(e) = app.global_shortcut().unregister(parsed) {
                log::warn!("probe unregister failed: {e}");
            }
            ShortcutProbe { ok: true, error: None }
        }
        Err(e) => ShortcutProbe {
            ok: false,
            error: Some(format!(
                "Windows rejected this shortcut — it may already be in use by another application. ({e})"
            )),
        },
    }
}

/// Unregisters everything on exit.
pub fn unregister_all(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().unregister_all() {
        log::warn!("failed to unregister global shortcuts on exit: {e}");
    }
}
