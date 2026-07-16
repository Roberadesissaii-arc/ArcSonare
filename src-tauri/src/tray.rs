//! System tray: Show / Hide / Quit, plus double-click to open.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show ArcSonare", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide ArcSonare", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ArcSonare", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("arcsonare-tray")
        .tooltip("ArcSonare — Ctrl+Shift+Space")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => crate::overlay::open_overlay(app),
            "hide" => crate::overlay::close_overlay(app),
            "quit" => {
                log::info!("quit requested from tray");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                crate::overlay::open_overlay(tray.app_handle());
            }
        });

    match app.default_window_icon() {
        Some(icon) => builder = builder.icon(icon.clone()),
        None => log::warn!("no default window icon found; tray icon may be invisible"),
    }

    builder.build(app)?;
    Ok(())
}
