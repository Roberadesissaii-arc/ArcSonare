//! Global shortcut registration (Ctrl + Shift + Space).

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn toggle_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

/// Builds the global-shortcut plugin with the toggle handler attached.
pub fn init() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            log::debug!("shortcut event: {shortcut:?} state={:?}", event.state());
            if event.state() == ShortcutState::Pressed && shortcut == &toggle_shortcut() {
                crate::overlay::toggle_overlay(app);
            }
        })
        .build()
}

/// Registers Ctrl+Shift+Space. Registration failure (e.g. the combination is
/// already owned by another application) is reported but does not abort the
/// app — the tray remains available as a fallback.
pub fn register_toggle(app: &AppHandle) {
    match app.global_shortcut().register(toggle_shortcut()) {
        Ok(()) => log::info!("registered global shortcut Ctrl+Shift+Space"),
        Err(e) => log::error!(
            "could not register Ctrl+Shift+Space (is it in use by another application?): {e}"
        ),
    }
}

/// Unregisters everything on exit.
pub fn unregister_all(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().unregister_all() {
        log::warn!("failed to unregister global shortcuts on exit: {e}");
    }
}
