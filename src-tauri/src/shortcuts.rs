//! Global shortcut registration and user customization.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

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

/// Builds the global-shortcut plugin. Only the toggle shortcut is ever
/// registered, so any press event simply toggles the global voice overlay —
/// voice activation always lives in the dedicated overlay window.
pub fn init() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::overlay::toggle_overlay(app);
            }
        })
        .build()
}

/// Registers the shortcut stored in settings at startup. Failure (e.g. the
/// combination is owned by another application) is reported but not fatal —
/// the tray remains available as a fallback.
pub fn register_from_settings(app: &AppHandle) {
    let stored = crate::settings::current(app).global_shortcut;
    let shortcut = match parse_shortcut(&stored) {
        Some(s) => s,
        None => {
            log::error!("stored shortcut '{stored}' is invalid; falling back to default");
            parse_shortcut(crate::settings::DEFAULT_SHORTCUT)
                .expect("default shortcut must be valid")
        }
    };
    match app.global_shortcut().register(shortcut) {
        Ok(()) => log::info!("registered global shortcut {stored}"),
        Err(e) => {
            log::error!("could not register {stored} (is it in use by another application?): {e}")
        }
    }
}

/// Swaps the active registration to `new_value`. The new shortcut is
/// registered *before* the old one is unregistered, so a failure leaves the
/// previous shortcut fully functional. Does not persist settings.
pub fn apply_shortcut(app: &AppHandle, new_value: &str) -> Result<(), String> {
    let new_shortcut = parse_shortcut(new_value).ok_or_else(|| {
        "This combination can't be used. Include at least one modifier key (Ctrl, Alt, Shift or Win) plus a regular key.".to_string()
    })?;

    let old_value = crate::settings::current(app).global_shortcut;
    let old_shortcut = parse_shortcut(&old_value);
    if old_shortcut == Some(new_shortcut) {
        return Ok(());
    }

    let global_shortcut = app.global_shortcut();
    global_shortcut.register(new_shortcut).map_err(|e| {
        format!("Windows rejected this shortcut — it may already be in use by another application. ({e})")
    })?;

    if let Some(old) = old_shortcut {
        if let Err(e) = global_shortcut.unregister(old) {
            log::warn!("could not unregister previous shortcut {old_value}: {e}");
        }
    }
    Ok(())
}

/// Changes, persists and broadcasts the global shortcut.
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

/// Unregisters everything on exit.
pub fn unregister_all(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().unregister_all() {
        log::warn!("failed to unregister global shortcuts on exit: {e}");
    }
}
