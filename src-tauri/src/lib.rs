mod agent_highlight;
mod agent_pointer;
mod annotations;
mod background;
mod browser;
mod build_info;
mod capabilities;
mod chat_message;
mod credentials;
mod data;
mod database;
mod deepseek;
#[cfg(debug_assertions)]
mod eval_broker;
mod display;
mod gemini;
mod google_api;
mod google_docs;
mod google_oauth;
mod google_write;
mod interaction;
#[cfg(debug_assertions)]
mod dev_unlock;
mod local_auth;
mod meeting;
#[cfg(debug_assertions)]
mod locate_trace;
mod native_overlay;
mod release_safety;
mod openai_realtime;
mod openai_vision;
mod overlay;
mod overlay_log;

mod panels;
mod screen_context;
mod settings;
mod shortcuts;
mod spatial_context;
mod top_overlay;
mod tray;
#[cfg(windows)]
mod visual_test_target;
mod voice_session;
mod watch;
mod web_answer;
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
        .manage(capabilities::ApprovalStore::default())
        .manage(capabilities::PlanStore::default())
        .manage(capabilities::PendingActionStore::default())
        .manage(browser::DownloadStore::default())
        .manage(screen_context::ScreenContextService::default())
        .manage(screen_context::InteractionSessionStore::default())
        .manage(annotations::AnnotationManager::default())
        .manage(capabilities::AuditStore::default())
        .manage(capabilities::ApplicationIndexState::default())
        .manage(database::DatabaseManager::default())
        // One frame registry for the whole process: capture registers here and
        // overlay/cursor/click resolve from here, so they cannot disagree about
        // which display a screenshot came from.
        .manage(display::runtime::VisualRuntime::new())
        // One display-mapping session at a time: two wizards sampling the same
        // cursor would each record the other's clicks.
        .manage(display::wizard::WizardState::default())
        // One voice session for the whole process. `sonare-overlay` is its own
        // WebView2 heap, so a TypeScript `speaking` flag would be two flags and
        // the overlay's recogniser would transcribe what the main window says.
        .manage(voice_session::VoiceSession::default())
        .invoke_handler(tauri::generate_handler![
            capabilities::executor::capability_execute,
            capabilities::approval::approval_grant,
            capabilities::approval::approval_covers,
            capabilities::approval::approval_revoke,
            capabilities::approval::approval_revoke_conversation,
            capabilities::approval::approval_uses,
            capabilities::approval_plan::plan_propose,
            capabilities::approval_plan::plan_approve,
            capabilities::approval_plan::plan_reject,
            capabilities::approval_plan::plan_claim_step,
            capabilities::approval_plan::plan_settle_step,
            capabilities::approval_plan::plan_outcome,
            capabilities::approval_plan::plan_revoke_conversation,
            capabilities::pending::pending_open,
            capabilities::pending::pending_approve,
            capabilities::pending::pending_cancel,
            capabilities::pending::pending_claim,
            capabilities::pending::pending_mark_side_effect,
            capabilities::pending::pending_settle,
            capabilities::pending::pending_awaiting,
            capabilities::pending::pending_get,
            capabilities::pending::pending_revoke_conversation,
            browser::commands::browser_find_link,
            browser::commands::browser_download,
            browser::commands::browser_download_progress,
            browser::commands::browser_list_downloads,
            browser::commands::installer_inspect,
            browser::commands::installer_list_installed,
            browser::commands::installer_verify,
            annotations::annotation_create,
            annotations::annotation_update,
            annotations::annotation_remove,
            annotations::annotation_list,
            annotations::annotation_by_target,
            annotations::annotation_clear_request,
            annotations::annotation_clear_conversation,
            annotations::annotation_clear_all_temporary,
            annotations::annotation_census,
            annotations::annotation_window_moved,
            annotations::annotation_window_visibility,
            annotations::annotation_source_closed,
            interaction::commands::plan_action,
            interaction::commands::plan_and_execute_action,
            interaction::commands::plan_and_dispatch_action,
            interaction::commands::get_available_capabilities,
            display::visual_commands::resolve_visual_target_cmd,
            display::visual_commands::preview_visual_target,
            display::visual_commands::move_to_visual_target,
            display::visual_commands::execute_visual_target,
            display::visual_commands::clear_visual_overlay,
            display::wizard::get_display_configuration_summary,
            display::wizard::display_mapping_needs_attention,
            display::wizard::start_display_mapping_session,
            display::wizard::identify_display,
            display::wizard::begin_nine_point,
            display::wizard::show_mapping_target,
            display::wizard::record_mapping_click,
            display::wizard::retry_mapping_sample,
            display::wizard::run_random_validation,
            display::wizard::complete_display_mapping,
            display::wizard::cancel_display_mapping,
            display::wizard::test_display_overlay,
            display::wizard::test_display_cursor,
            display::wizard::ignore_display,
            display::wizard::enable_display,
            display::wizard::remove_display_profile,
            display::wizard::get_display_mapping_diagnostics,
            build_info::get_build_info,
            voice_session::voice_status,
            voice_session::voice_set_state,
            voice_session::voice_begin_playback,
            voice_session::voice_end_playback,
            voice_session::voice_consider_transcript,
            voice_session::voice_set_cooldown_ms,
            voice_session::voice_reset,
            visual_test_target::visual_test_show,
            visual_test_target::visual_test_hide,
            visual_test_target::visual_test_reset,
            visual_test_target::visual_test_state,
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
            database::tasks::tasks_get_local,
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
            agent_highlight::agent_highlight_show,
            agent_highlight::agent_highlight_hide,
            google_write::gmail_send_message,
            google_write::gmail_create_draft,
            google_write::gmail_update_draft,
            google_write::gmail_list_drafts,
            google_write::gmail_reply_message,
            google_write::calendar_update_event,
            google_write::calendar_delete_event,
            google_docs::docs_create,
            google_docs::docs_append,
            google_docs::docs_list,
            web_answer::web_grounded_answer,
            spatial_context::spatial_arm_draw,
            spatial_context::spatial_take_region,
            spatial_context::spatial_is_armed,
            spatial_context::spatial_test_stroke,
            agent_pointer::agent_pointer_show,
            agent_pointer::agent_pointer_move,
            agent_pointer::agent_pointer_hide,
            agent_pointer::agent_cursor_pos,
            agent_pointer::agent_set_cursor_pos,
            deepseek::deepseek_chat,
            deepseek::deepseek_chat_tools,
            #[cfg(debug_assertions)]
            eval_broker::eval_model_selection,
            #[cfg(debug_assertions)]
            eval_broker::eval_provider_available,
            gemini::gemini_chat,
            gemini::gemini_vision,
            google_oauth::google_oauth_connect,
            google_oauth::google_oauth_disconnect,
            google_oauth::google_oauth_has_tokens,
            google_oauth::google_oauth_status,
            google_oauth::google_oauth_list_accounts,
            google_oauth::google_oauth_set_active_account,
            google_oauth::set_google_oauth_client_id,
            google_oauth::set_google_oauth_client_secret,
            google_oauth::has_google_oauth_client_secret,
            google_api::gmail_list_messages,
            google_api::gmail_read_message,
            google_api::calendar_list_events,
            openai_realtime::openai_realtime_client_secret,
            openai_realtime::openai_realtime_configured,
            openai_vision::openai_vision,
            google_api::calendar_create_event,
            google_api::drive_list_files,
            data::get_data_usage,
            data::scan_data_storage,
            data::save_desktop_test_image,
            data::save_desktop_image_from_url,
            data::open_data_folder,
            data::open_data_subfolder,
            data::clear_category_files,
            data::open_microphone_privacy_settings,
            data::send_test_notification,
            screen_context::capture::capture_screen,
            screen_context::capture::get_capture_data_url,
            screen_context::capture::get_capture_region_data_url,
            screen_context::storage::clear_capture_history,
            background::pick_background_image,
            background::clear_background_image,
            #[cfg(debug_assertions)]
            dev_unlock::dev_unlock_available,
            #[cfg(debug_assertions)]
            dev_unlock::dev_unlock,
            #[cfg(debug_assertions)]
            locate_trace::locate_trace_write,
            #[cfg(debug_assertions)]
            locate_trace::locate_trace_read,
            #[cfg(debug_assertions)]
            locate_trace::locate_trace_clear,
            local_auth::hash_local_password,
            local_auth::verify_local_password,
            watch::commands::watch_snapshot,
            watch::commands::watch_running_instances,
            watch::commands::watch_add,
            watch::commands::watch_remove,
            watch::commands::watch_set_paused,
            watch::commands::watch_pin_instance,
            watch::commands::watch_set_privacy,
            watch::commands::watch_report_adapter_health,
            watch::commands::watch_resolve,
            watch::commands::watch_bind,
            watch::commands::watch_clear_conversation,
            watch::commands::watch_focus_instance,
            watch::commands::watch_account_changed,
            watch::commands::watch_scope_get,
            watch::commands::watch_scope_set,
            watch::commands::watch_scope_toggle,
            watch::commands::watch_scope_bind_instance,
            meeting::commands::meeting_backend_available,
            meeting::commands::meeting_session_create,
            meeting::commands::meeting_sessions_list,
            meeting::commands::meeting_session_update_state,
            meeting::commands::meeting_session_start_recording,
            meeting::commands::meeting_session_end,
            meeting::commands::meeting_transcript_insert,
            meeting::commands::meeting_transcript_list,
            meeting::commands::meeting_transcribe_chunk,
            meeting::commands::meeting_summary_save,
            meeting::commands::meeting_summary_get,
            overlay_log::commands::overlay_log_session_start,
            overlay_log::commands::overlay_log_session_end,
            overlay_log::commands::overlay_log_turn_start,
            overlay_log::commands::overlay_log_turn_update,
            overlay_log::commands::overlay_log_event_record,
            overlay_log::commands::overlay_log_get_settings,
            overlay_log::commands::overlay_log_update_settings,
            overlay_log::commands::overlay_log_get_summary,
            overlay_log::commands::overlay_log_sessions_list,
            overlay_log::commands::overlay_log_session_get,
            overlay_log::commands::overlay_log_session_delete,
            overlay_log::commands::overlay_log_clear_all,
            overlay_log::commands::overlay_log_export,

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
            // Fill empty credential slots from keys compiled in at build time.
            // Runs before anything reads a provider key.
            credentials::seed_bundled_keys();
            // Load the pointer webview now so the first point is instant.
            agent_pointer::prewarm(handle);
            // Draw-on-screen: Ctrl+Shift+D arms a red stroke that marks a
            // region and hands it to the next request as spatial context.
            if let Err(e) = shortcuts::register_action(handle, "draw-region", "Ctrl+Shift+D") {
                log::warn!("could not register the draw shortcut: {e}");
            }
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
            // Reconcile watched applications against what is actually running,
            // so the first Running Apps render is real rather than empty.
            watch::commands::prime(handle);
            // Enforce the configured retention on captures left from earlier runs.
            screen_context::storage::apply_retention(handle);
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
