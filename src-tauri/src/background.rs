//! Custom Dashboard/Tasks/Agent background image. The user picks any image
//! via a native file dialog; we copy it into app data so ArcSonare never
//! depends on the source file staying where it was picked from.

use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

fn backgrounds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("data directory unavailable: {e}"))?
        .join("backgrounds");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create backgrounds folder: {e}"))?;
    Ok(dir)
}

fn remove_existing_custom(dir: &PathBuf) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_custom = path
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|stem| stem.starts_with("custom"));
        if is_custom {
            let _ = fs::remove_file(&path);
        }
    }
}

/// Opens a native "choose an image" dialog and copies the selection into app
/// data. Returns `None` if the user cancels.
#[tauri::command]
pub fn pick_background_image(app: AppHandle) -> Result<Option<String>, String> {
    let mut dialog =
        rfd::FileDialog::new().add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp"]);

    // Without an owner, Windows can place the dialog behind the main window
    // with no taskbar/focus cue — it looks like nothing happened.
    if let Some(window) = app.get_webview_window(crate::panels::MAIN_LABEL) {
        dialog = dialog.set_parent(&window);
    }

    // Courtesy default — only used if it happens to exist on this machine.
    let preferred = PathBuf::from(r"C:\Users\rober\Desktop\ArcSonare\background");
    if let Some(dir) = if preferred.is_dir() {
        Some(preferred)
    } else {
        dirs::picture_dir()
    } {
        dialog = dialog.set_directory(dir);
    }

    let Some(picked) = dialog.pick_file() else {
        return Ok(None);
    };

    let ext = picked
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();

    let dir = backgrounds_dir(&app)?;
    remove_existing_custom(&dir);
    // Unique filename per pick — the frontend caches image URLs, so reusing a
    // stable name would keep showing the previous file after picking a new one.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = dir.join(format!("custom-{stamp}.{ext}"));
    fs::copy(&picked, &dest).map_err(|e| format!("could not copy background image: {e}"))?;

    Ok(Some(dest.to_string_lossy().to_string()))
}

/// Removes the stored custom background, restoring the default look.
#[tauri::command]
pub fn clear_background_image(app: AppHandle) -> Result<(), String> {
    let dir = backgrounds_dir(&app)?;
    remove_existing_custom(&dir);
    Ok(())
}
