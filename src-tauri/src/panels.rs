//! The main Command Center window and the custom tray quick-menu window.
//!
//! The quick menu is created hidden from tauri.conf.json and is only ever
//! shown/hidden — never destroyed — so exactly one instance exists.

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

use crate::window_position;

pub const MAIN_LABEL: &str = "main";
pub const QUICK_MENU_LABEL: &str = "sonare-quick-menu";

fn get_window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    let window = app.get_webview_window(label);
    if window.is_none() {
        log::error!("window '{label}' not found");
    }
    window
}

/// Settings lives inside the main window: show and focus the Command Center,
/// then ask its webview to navigate to the Settings page.
pub fn show_settings(app: &AppHandle) {
    log::info!("opening settings page in the main window");
    show_main(app);
    if let Some(window) = get_window(app, MAIN_LABEL) {
        if let Err(e) = window.emit("sonare://open-settings", ()) {
            log::error!("failed to request settings navigation: {e}");
        }
    }
}

fn hide_window(app: &AppHandle, label: &str) {
    if let Some(window) = get_window(app, label) {
        if window.is_visible().unwrap_or(false) {
            if let Err(e) = window.hide() {
                log::error!("failed to hide window '{label}': {e}");
            }
        }
    }
}

/// Toggles the quick menu near the tray click position.
pub fn toggle_quick_menu(app: &AppHandle, cursor: PhysicalPosition<f64>) {
    let Some(window) = get_window(app, QUICK_MENU_LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        if let Err(e) = window.hide() {
            log::error!("failed to hide quick menu: {e}");
        }
        return;
    }
    if let Err(e) = window_position::position_quick_menu(app, &window, cursor) {
        log::warn!("could not position quick menu: {e}");
    }
    if let Err(e) = window.show() {
        log::error!("failed to show quick menu: {e}");
        return;
    }
    // Focus is required so losing it (clicking outside) auto-hides the menu.
    if let Err(e) = window.set_focus() {
        log::warn!("failed to focus quick menu: {e}");
    }
}

/// Shows and focuses the main Command Center window (tray / quick menu).
pub fn show_main(app: &AppHandle) {
    let Some(window) = get_window(app, MAIN_LABEL) else {
        return;
    };
    if window.is_minimized().unwrap_or(false) {
        if let Err(e) = window.unminimize() {
            log::warn!("failed to unminimize main window: {e}");
        }
    }
    if let Err(e) = window.show() {
        log::error!("failed to show main window: {e}");
        return;
    }
    if let Err(e) = window.set_focus() {
        log::warn!("failed to focus main window: {e}");
    }
    hide_window(app, QUICK_MENU_LABEL);
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
pub fn hide_main(app: AppHandle) {
    hide_window(&app, MAIN_LABEL);
}

#[tauri::command]
pub fn open_settings(app: AppHandle) {
    show_settings(&app);
}

#[tauri::command]
pub fn hide_quick_menu(app: AppHandle) {
    hide_window(&app, QUICK_MENU_LABEL);
}

/// Opens the overlay from the quick menu (and dismisses the menu).
#[tauri::command]
pub fn show_overlay(app: AppHandle) {
    hide_window(&app, QUICK_MENU_LABEL);
    crate::overlay::open_overlay(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    log::info!("quit requested");
    app.exit(0);
}
