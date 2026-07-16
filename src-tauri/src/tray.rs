//! System tray: left click opens the custom quick menu, right click shows a
//! native fallback menu.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show ArcSonare", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide ArcSonare", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ArcSonare", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &settings, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("arcsonare-tray")
        .tooltip("ArcSonare")
        .menu(&menu)
        // Left click is reserved for the custom quick menu; the native menu
        // stays available on right click as a fallback.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => crate::overlay::open_overlay(app),
            "hide" => crate::overlay::close_overlay(app),
            "settings" => crate::panels::show_settings(app),
            "quit" => {
                log::info!("quit requested from tray");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                crate::panels::toggle_quick_menu(tray.app_handle(), position);
            }
        });

    match app.default_window_icon() {
        Some(icon) => builder = builder.icon(icon.clone()),
        None => log::warn!("no default window icon found; tray icon may be invisible"),
    }

    builder.build(app)?;
    Ok(())
}
