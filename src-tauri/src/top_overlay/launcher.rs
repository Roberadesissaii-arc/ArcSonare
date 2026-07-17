//! Safe desktop application launcher — never executes raw spoken input.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::app_registry::APP_REGISTRY;

#[derive(Debug)]
pub struct LaunchResult {
    pub method: String,
    pub message: String,
}

/// Expand `%VAR%` environment variables in a path template.
fn expand_env(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let bytes = path.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(end) = path[i + 1..].find('%') {
                let name = &path[i + 1..i + 1 + end];
                // WINDIR / SystemRoot are common on Windows; try both casings.
                let val = std::env::var(name)
                    .or_else(|_| std::env::var(name.to_ascii_uppercase()))
                    .or_else(|_| {
                        if name.eq_ignore_ascii_case("WINDIR") {
                            std::env::var("SystemRoot")
                        } else {
                            Err(std::env::VarError::NotPresent)
                        }
                    });
                if let Ok(val) = val {
                    out.push_str(&val);
                    i += end + 2;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Public wrapper so the capability engine can resolve curated candidates.
pub fn first_existing_public(candidates: &[&str]) -> Option<PathBuf> {
    first_existing(candidates)
}

fn first_existing(candidates: &[&str]) -> Option<PathBuf> {
    for c in candidates {
        let expanded = expand_env(c);
        // Skip glob-style paths we cannot safely resolve without shell.
        if expanded.contains('*') {
            continue;
        }
        let path = PathBuf::from(&expanded);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn spawn_exe(path: &Path) -> Result<(), String> {
    Command::new(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to start {}: {e}", path.display()))
}

/// Launch a registered application by id using only trusted executable paths.
pub fn launch_application(app_id: &str) -> Result<LaunchResult, String> {
    let entry = APP_REGISTRY
        .iter()
        .find(|e| e.id == app_id)
        .ok_or_else(|| format!("unknown application id: {app_id}"))?;

    if !entry.can_open_desktop {
        return Err(format!(
            "{} has no trusted desktop launcher; use the web URL instead",
            entry.display_name
        ));
    }

    if let Some(path) = first_existing(entry.exe_candidates) {
        spawn_exe(&path)?;
        return Ok(LaunchResult {
            method: "desktop".into(),
            message: format!("{} opened", entry.display_name),
        });
    }

    // Discord Update.exe needs --processStart; keep special-cases minimal and explicit.
    if app_id == "discord" {
        if let Some(update) = first_existing(&[r"%LOCALAPPDATA%\Discord\Update.exe"]) {
            Command::new(&update)
                .args(["--processStart", "Discord.exe"])
                .spawn()
                .map_err(|e| format!("failed to start Discord: {e}"))?;
            return Ok(LaunchResult {
                method: "desktop".into(),
                message: "Discord opened".into(),
            });
        }
    }

    Err(format!(
        "{} desktop app was not found on this system",
        entry.display_name
    ))
}
