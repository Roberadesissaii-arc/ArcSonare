mod overlay;
mod shortcuts;
mod tray;
mod window_position;

pub fn run() {
    // Log to stderr during development (RUST_LOG overrides the default level).
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

    tauri::Builder::default()
        // Must be the first plugin: a second launch forwards to the running
        // instance (which opens the overlay) and then exits immediately.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log::info!("second instance launch detected; opening overlay in the running instance");
            overlay::open_overlay(app);
        }))
        .plugin(shortcuts::init())
        .manage(overlay::OverlayState::default())
        .invoke_handler(tauri::generate_handler![
            overlay::request_close,
            overlay::overlay_hidden
        ])
        .setup(|app| {
            if let Err(e) = tray::create_tray(app.handle()) {
                // The app is still usable via the global shortcut.
                log::error!("failed to initialize the system tray: {e}");
            }
            shortcuts::register_toggle(app.handle());
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
