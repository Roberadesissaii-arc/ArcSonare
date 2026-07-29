mod background;
mod capabilities;
mod credentials;
mod data;
mod database;
mod deepseek;
mod gemini;
mod google_oauth;
mod local_auth;
mod ollama;
mod overlay;
mod panels;
mod pocket_tts;
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
        .manage(capabilities::ConfirmationStore::default())
        .manage(capabilities::AuditStore::default())
        .manage(capabilities::ApplicationIndexState::default())
        .manage(database::DatabaseManager::default())
        .manage(pocket_tts::PocketTtsState::default())
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
            settings::set_overlay_unlocked,
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
            credentials::secure_storage_get,
            credentials::secure_storage_set,
            credentials::secure_storage_remove,
            credentials::secure_storage_has,
            database::manager::database_open_guest,
            database::manager::database_open_for_user,
            database::manager::database_close_current_user,
            database::manager::database_status,
            database::manager::database_remove_current_user_files,
            database::tasks::tasks_list_local,
            database::tasks::tasks_upsert_local,
            database::tasks::tasks_soft_delete_local,
            database::agents::agents_list_local,
            database::agents::agents_upsert_local,
            database::agents::agents_soft_delete_local,
            database::sync::sync_get_status,
            database::sync::sync_push_batch,
            database::sync::sync_pull,
            database::sync::sync_advance_cursor,
            database::sync::sync_mark_outbox_completed,
            ollama::ollama_status,
            ollama::ollama_chat,
            ollama::ollama_chat_stream,
            ollama::ollama_chat_tools,
            ollama::ollama_cloud_status,
            ollama::ollama_cloud_catalog,
            ollama::ollama_cloud_chat,
            deepseek::deepseek_chat,
            deepseek::deepseek_chat_tools,
            gemini::gemini_chat,
            google_oauth::google_oauth_connect,
            google_oauth::google_oauth_disconnect,
            google_oauth::google_oauth_has_tokens,
            google_oauth::google_oauth_status,
            google_oauth::set_google_oauth_client_secret,
            google_oauth::has_google_oauth_client_secret,
            pocket_tts::pocket_tts_status,
            pocket_tts::pocket_tts_ensure,
            pocket_tts::pocket_tts_synthesize,
            data::get_data_usage,
            data::scan_data_storage,
            data::open_data_folder,
            data::open_data_subfolder,
            data::clear_category_files,
            data::open_microphone_privacy_settings,
            data::send_test_notification,
            screen_context::capture::capture_screen,
            screen_context::capture::get_capture_data_url,
            screen_context::storage::clear_capture_history,
            background::pick_background_image,
            background::clear_background_image,
            local_auth::hash_local_password,
            local_auth::verify_local_password,
        ])
        .on_window_event(|window, event| match event {
            // Main / tray / voice overlay stay alive (hide instead of destroy).
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let label = window.label();
                api.prevent_close();
                if label == overlay::OVERLAY_LABEL {
                    overlay::force_hide(window.app_handle());
                } else if let Err(e) = window.hide() {
                    log::error!("failed to hide '{label}' on close request: {e}");
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

            if let Err(e) = app.state::<database::DatabaseManager>().open_guest(handle) {
                log::error!("failed to open guest database: {e}");
            }

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
                pocket_tts::stop_all(app);
                log::info!("ArcSonare exited cleanly");
            }
        });
}
