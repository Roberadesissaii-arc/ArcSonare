//! Data & Privacy — path resolution, storage scanning, and folder actions.
//!
//! Honesty rules:
//! - Report real byte sizes and file counts only.
//! - Never claim AES-256 application encryption (not implemented).
//! - Never invent backup timestamps (backup not configured).
//! - Deletion stays inside ArcSonare app data / config roots.

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryUsage {
    pub id: String,
    pub bytes: u64,
    pub file_count: u64,
    pub scan_errors: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageScanResult {
    pub data_dir: String,
    pub config_dir: String,
    pub folder_status: String,
    pub total_bytes: u64,
    pub total_files: u64,
    pub categories: Vec<CategoryUsage>,
    pub scanned_at: String,
    pub scan_duration_ms: u64,
    pub errors: Vec<String>,
    pub encryption_status: String,
    pub backup_status: String,
}

/// Legacy shape kept for older callers.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataUsage {
    pub data_dir: String,
    pub settings_bytes: u64,
    pub captures_bytes: u64,
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compact ISO-ish timestamp without chrono dependency.
    format!("{secs}")
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn walk_dir(path: &Path, bytes: &mut u64, files: &mut u64, errors: &mut u32) {
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => {
            *errors += 1;
            return;
        }
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => {
                *errors += 1;
                continue;
            }
        };
        if meta.is_dir() {
            // Avoid following junctions that could escape (best-effort).
            if meta.file_type().is_symlink() {
                continue;
            }
            walk_dir(&p, bytes, files, errors);
        } else if meta.is_file() {
            *bytes += meta.len();
            *files += 1;
        }
    }
}

fn measure(path: &Path) -> (u64, u64, u32) {
    if !path.exists() {
        return (0, 0, 0);
    }
    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut errors = 0u32;
    if path.is_file() {
        bytes = file_size(path);
        files = 1;
    } else {
        walk_dir(path, &mut bytes, &mut files, &mut errors);
    }
    (bytes, files, errors)
}

fn writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".arcsonare-write-probe");
    match fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn resolve_dirs(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("data directory unavailable: {e}"))?;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config directory unavailable: {e}"))?;
    Ok((data_dir, config_dir))
}

#[tauri::command]
pub fn get_data_usage(app: AppHandle) -> Result<DataUsage, String> {
    let (data_dir, config_dir) = resolve_dirs(&app)?;
    Ok(DataUsage {
        data_dir: data_dir.display().to_string(),
        settings_bytes: file_size(&config_dir.join("settings.json")),
        captures_bytes: crate::screen_context::storage::dir_size_bytes(&app),
    })
}

/// Full asynchronous-friendly storage scan (runs on async runtime).
#[tauri::command]
pub async fn scan_data_storage(app: AppHandle) -> Result<StorageScanResult, String> {
    let started = Instant::now();
    let (data_dir, config_dir) = resolve_dirs(&app)?;
    let _ = fs::create_dir_all(&data_dir);
    let _ = fs::create_dir_all(&config_dir);

    let mut errors: Vec<String> = Vec::new();
    let folder_status = if writable(&data_dir) {
        "ready".to_string()
    } else if data_dir.exists() {
        "read-only".to_string()
    } else {
        "unavailable".to_string()
    };

    let captures = data_dir.join("screen-context");
    let voice = data_dir.join("voice");
    let models = data_dir.join("models");
    let cache = data_dir.join("cache");
    let settings = config_dir.join("settings.json");

    let (cap_b, cap_f, cap_e) = measure(&captures);
    let (voice_b, voice_f, voice_e) = measure(&voice);
    let (model_b, model_f, model_e) = measure(&models);
    let (cache_b, cache_f, cache_e) = measure(&cache);
    let (set_b, set_f, set_e) = measure(&settings);

    // Remaining files under data_dir that are not in known category folders.
    let (data_all_b, data_all_f, data_all_e) = measure(&data_dir);
    let known_b = cap_b + voice_b + model_b + cache_b;
    let known_f = cap_f + voice_f + model_f + cache_f;
    let other_b = data_all_b.saturating_sub(known_b) + set_b;
    let other_f = data_all_f.saturating_sub(known_f) + set_f;
    let other_e = data_all_e + set_e;

    if cap_e + voice_e + model_e + cache_e + other_e > 0 {
        errors.push("Some storage locations could not be fully scanned.".into());
    }

    let categories = vec![
        CategoryUsage {
            id: "screen-captures".into(),
            bytes: cap_b,
            file_count: cap_f,
            scan_errors: cap_e,
        },
        CategoryUsage {
            id: "voice-transcripts".into(),
            bytes: voice_b,
            file_count: voice_f,
            scan_errors: voice_e,
        },
        CategoryUsage {
            id: "model-cache".into(),
            bytes: model_b + cache_b,
            file_count: model_f + cache_f,
            scan_errors: model_e + cache_e,
        },
        CategoryUsage {
            id: "other".into(),
            bytes: other_b,
            file_count: other_f,
            scan_errors: other_e,
        },
    ];

    let total_bytes = categories.iter().map(|c| c.bytes).sum();
    let total_files = categories.iter().map(|c| c.file_count).sum();

    Ok(StorageScanResult {
        data_dir: data_dir.display().to_string(),
        config_dir: config_dir.display().to_string(),
        folder_status,
        total_bytes,
        total_files,
        categories,
        scanned_at: now_iso(),
        scan_duration_ms: started.elapsed().as_millis() as u64,
        errors,
        // Honest: ArcSonare does not apply AES-256 to local files.
        encryption_status: "secrets-protected-separately".into(),
        backup_status: "not-configured".into(),
    })
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let (dir, _) = resolve_dirs(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create data folder: {e}"))?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("could not open Explorer: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_data_subfolder(app: AppHandle, folder: String) -> Result<(), String> {
    let (data_dir, config_dir) = resolve_dirs(&app)?;
    let target = match folder.as_str() {
        "captures" | "screen-context" => data_dir.join("screen-context"),
        "voice" => data_dir.join("voice"),
        "models" => data_dir.join("models"),
        "cache" => data_dir.join("cache"),
        "config" => config_dir.clone(),
        "data" => data_dir.clone(),
        _ => return Err("Unknown data subfolder.".into()),
    };
    fs::create_dir_all(&target).map_err(|e| format!("could not create folder: {e}"))?;

    // Path safety: must stay under data or config roots.
    let canon_target = fs::canonicalize(&target).unwrap_or(target.clone());
    let canon_data = fs::canonicalize(&data_dir).unwrap_or(data_dir);
    let canon_config = fs::canonicalize(&config_dir).unwrap_or(config_dir);
    if !(canon_target.starts_with(&canon_data) || canon_target.starts_with(&canon_config)) {
        return Err("Refusing to open a folder outside ArcSonare data roots.".into());
    }

    std::process::Command::new("explorer")
        .arg(&canon_target)
        .spawn()
        .map_err(|e| format!("could not open Explorer: {e}"))?;
    Ok(())
}

/// Clear only Screen Context capture files (existing command still preferred).
#[tauri::command]
pub fn clear_category_files(app: AppHandle, category: String) -> Result<String, String> {
    let (data_dir, _) = resolve_dirs(&app)?;
    match category.as_str() {
        "screen-captures" | "screen-annotations" => {
            crate::screen_context::storage::clear_capture_history(app)?;
            Ok("Screen Context captures and annotations cleared.".into())
        }
        "voice-transcripts" | "raw-audio" => {
            let dir = data_dir.join("voice");
            if dir.exists() {
                fs::remove_dir_all(&dir).map_err(|e| format!("could not clear voice data: {e}"))?;
            }
            let _ = fs::create_dir_all(data_dir.join("voice"));
            Ok("Voice data folder cleared.".into())
        }
        "model-cache" => {
            let cache = data_dir.join("cache");
            if cache.exists() {
                fs::remove_dir_all(&cache).map_err(|e| format!("could not clear cache: {e}"))?;
            }
            let _ = fs::create_dir_all(data_dir.join("cache"));
            Ok("Model cache cleared. Downloaded local models were not removed.".into())
        }
        _ => Err(format!(
            "Category '{category}' is cleared from the app UI (localStorage), not the filesystem."
        )),
    }
}

#[tauri::command]
pub fn open_microphone_privacy_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "ms-settings:privacy-microphone"])
        .spawn()
        .map_err(|e| format!("could not open Windows settings: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn send_test_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(if title.is_empty() {
            "ArcSonare".into()
        } else {
            title
        })
        .body(body)
        .show()
        .map_err(|e| format!("Windows did not accept the notification: {e}"))
}
