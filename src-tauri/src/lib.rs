mod overlay;
mod panels;
mod settings;
mod shortcuts;
mod tray;
mod window_position;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

pub fn run() {
    // Log to stderr during development (RUST_LOG overrides the default level).
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

    tauri::Builder::default()
        // Must be the first plugin: a second launch forwards to the running
        // instance (which opens the overlay) and then exits immediately.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log::info!(
                "second instance launch detected; showing the Command Center in the running instance"
            );
            panels::show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(shortcuts::init())
        .manage(overlay::OverlayState::default())
        // Managed before any window exists: webviews created from the config
        // may invoke commands before `setup` runs.
        .manage(settings::SettingsState::default())
        .invoke_handler(tauri::generate_handler![
            overlay::request_close,
            overlay::overlay_hidden,
            settings::get_settings,
            settings::update_settings,
            settings::set_autostart,
            settings::clear_local_data,
            shortcuts::set_global_shortcut,
            panels::open_settings,
            panels::hide_quick_menu,
            panels::show_overlay,
            panels::show_main_window,
            panels::hide_main,
            panels::quit_app,
        ])
        .on_window_event(|window, event| match event {
            // None of our windows may ever be destroyed (e.g. via Alt+F4);
            // closing always means hiding while ArcSonare keeps running.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if window.label() == overlay::OVERLAY_LABEL {
                    overlay::force_hide(window.app_handle());
                } else if let Err(e) = window.hide() {
                    log::error!("failed to hide '{}' on close request: {e}", window.label());
                }
            }
            // Clicking anywhere outside the quick menu dismisses it.
            tauri::WindowEvent::Focused(false) if window.label() == panels::QUICK_MENU_LABEL => {
                let _ = window.hide();
            }
            _ => {}
        })
        .setup(|app| {
            let handle = app.handle();
            settings::initialize(handle);
            settings::sync_autostart_state(handle);

            if let Err(e) = tray::create_tray(handle) {
                // The app is still usable via the global shortcut.
                log::error!("failed to initialize the system tray: {e}");
            }
            shortcuts::register_from_settings(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the ArcSonare application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                shortcuts::unregister_all(app);
                log::info!("ArcSonare exited cleanly");
            }
        });
}
