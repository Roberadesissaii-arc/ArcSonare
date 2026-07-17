mod capabilities;
mod credentials;
mod data;
mod deepseek;
mod ollama;
mod overlay;
mod panels;
mod screen_context;
mod settings;
mod shortcuts;
mod top_overlay;
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
        .plugin(tauri_plugin_notification::init())
        .manage(overlay::OverlayState::default())
        .manage(top_overlay::PendingOverlayCommand::default())
        // Managed before any window exists: webviews created from the config
        // may invoke commands before `setup` runs.
        .manage(settings::SettingsState::default())
        .manage(shortcuts::ShortcutActions::default())
        .manage(screen_context::ScreenContextState::default())
        .manage(capabilities::ConfirmationStore::default())
        .manage(capabilities::AuditStore::default())
        .manage(capabilities::ApplicationIndexState::default())
        .invoke_handler(tauri::generate_handler![
            capabilities::executor::capability_execute,
            capabilities::executor::capability_confirm_prepare,
            capabilities::executor::capability_health,
            capabilities::executor::capability_audit_list,
            capabilities::executor::capability_audit_clear,
            overlay::request_close,
            overlay::overlay_hidden,
            overlay::toggle_overlay_cmd,
            top_overlay::overlay_launch_app,
            top_overlay::overlay_open_url,
            top_overlay::overlay_web_search,
            top_overlay::overlay_open_service,
            top_overlay::overlay_queue_command,
            top_overlay::overlay_take_pending_command,
            top_overlay::overlay_window::resize_overlay,
            settings::get_settings,
            settings::update_settings,
            settings::set_autostart,
            settings::clear_local_data,
            shortcuts::set_global_shortcut,
            shortcuts::set_action_shortcut,
            shortcuts::probe_shortcut,
            panels::open_settings,
            panels::hide_quick_menu,
            panels::show_overlay,
            panels::show_main_window,
            panels::hide_main,
            panels::quit_app,
            credentials::set_provider_key,
            credentials::has_provider_key,
            credentials::delete_provider_key,
            ollama::ollama_status,
            ollama::ollama_chat,
            ollama::ollama_cloud_status,
            ollama::ollama_cloud_chat,
            deepseek::deepseek_chat,
            data::get_data_usage,
            data::scan_data_storage,
            data::open_data_folder,
            data::open_data_subfolder,
            data::clear_category_files,
            data::open_microphone_privacy_settings,
            data::send_test_notification,
            screen_context::screen_context_status,
            screen_context::start_screen_context,
            screen_context::stop_screen_context,
            screen_context::monitors::list_monitors,
            screen_context::capture::capture_screen,
            screen_context::capture::get_capture_data_url,
            screen_context::capture::save_annotated_capture,
            screen_context::storage::list_captures,
            screen_context::storage::delete_capture,
            screen_context::storage::clear_capture_history,
            screen_context::overlay::open_annotation,
            screen_context::overlay::close_annotation,
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
            // Enforce the configured retention on captures left from earlier runs.
            screen_context::storage::apply_retention(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the ArcSonare application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                shortcuts::unregister_all(app);
                // Never leave a capture session or its indicators behind.
                screen_context::stop_all(app);
                log::info!("ArcSonare exited cleanly");
            }
        });
}
