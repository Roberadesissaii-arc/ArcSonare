//! The settings window and the custom tray quick-menu window.
//!
//! Both windows are created hidden from tauri.conf.json and are only ever
//! shown/hidden — never destroyed — so exactly one instance of each exists.

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

use crate::window_position;

pub const MAIN_LABEL: &str = "main";
pub const SETTINGS_LABEL: &str = "sonare-settings";
pub const QUICK_MENU_LABEL: &str = "sonare-quick-menu";

fn get_window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    let window = app.get_webview_window(label);
    if window.is_none() {
        log::error!("window '{label}' not found");
    }
    window
}

/// Shows and focuses the settings window, centering it on the active monitor
/// the first time (an already-visible window keeps the position the user
/// gave it).
pub fn show_settings(app: &AppHandle) {
    log::info!("opening settings window");
    let Some(window) = get_window(app, SETTINGS_LABEL) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        if let Err(e) = window_position::center_on_active_monitor(
            app,
            &window,
            window_position::SETTINGS_WIDTH,
            window_position::SETTINGS_HEIGHT,
        ) {
            log::warn!("could not center settings window: {e}");
        }
    }
    if let Err(e) = window.show() {
        log::error!("failed to show settings window: {e}");
        return;
    }
    if let Err(e) = window.set_focus() {
        log::warn!("failed to focus settings window: {e}");
    }
    // Opening settings from the quick menu should dismiss the menu.
    hide_window(app, QUICK_MENU_LABEL);
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

/// True when the main Command Center window is both visible and focused —
/// the case where the global shortcut drives the in-app voice console
/// instead of the top-screen overlay.
pub fn main_window_is_active(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_LABEL)
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false)
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
pub fn hide_settings(app: AppHandle) {
    hide_window(&app, SETTINGS_LABEL);
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
