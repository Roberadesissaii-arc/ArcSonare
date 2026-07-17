//! Path security: every filesystem mutation is validated here before it runs.
//! Never trust a path because it came from the model.

use std::path::{Component, Path, PathBuf};

const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Validate a single file/folder *name* (no separators, no traversal).
pub fn validate_item_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name is empty.".into());
    }
    if trimmed.len() > 200 {
        return Err("Name is too long (max 200 characters).".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("Name may not be a relative path component.".into());
    }
    if trimmed
        .chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
    {
        return Err(r#"Name contains characters not allowed on Windows (<>:"/\|?*)."#.into());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Name contains control characters.".into());
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("Name may not end with a dot or space on Windows.".into());
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed);
    if RESERVED_NAMES.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        return Err(format!("\"{trimmed}\" is a reserved Windows device name."));
    }
    Ok(())
}

/// Reject device namespaces, alternate data streams and traversal in raw input.
fn validate_raw_path_text(raw: &str) -> Result<(), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Path is empty.".into());
    }
    if trimmed.len() > 4096 {
        return Err("Path is too long.".into());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Path contains control characters.".into());
    }
    if trimmed.starts_with(r"\\?\") || trimmed.starts_with(r"\\.\") {
        return Err("Device namespace paths are not allowed.".into());
    }
    // Alternate data streams: any ':' beyond the drive-letter position.
    let colons = trimmed
        .match_indices(':')
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    for idx in colons {
        if idx != 1 {
            return Err("Alternate data streams are not supported.".into());
        }
    }
    Ok(())
}

/// Normalize + absolutize a user/model supplied path without touching the disk.
pub fn normalize_path(raw: &str) -> Result<PathBuf, String> {
    validate_raw_path_text(raw)?;
    let p = Path::new(raw.trim());
    if !p.is_absolute() {
        return Err("Only absolute paths are accepted.".into());
    }
    // Resolve `.` / `..` components lexically so traversal cannot escape checks.
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::ParentDir => {
                if !out.pop() {
                    return Err("Path escapes its root.".into());
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    Ok(out)
}

fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

/// Directories protected from any mutation (case-insensitive prefix match).
fn protected_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for var in ["WINDIR", "SystemRoot"] {
        if let Some(p) = env_path(var) {
            roots.push(p);
        }
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
        if let Some(p) = env_path(var) {
            roots.push(p);
        }
    }
    // ArcSonare's own executable directory.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    roots
}

fn starts_with_ci(path: &Path, root: &Path) -> bool {
    let p = path.to_string_lossy().to_lowercase();
    let r = root.to_string_lossy().to_lowercase();
    let r = r.trim_end_matches('\\').to_string();
    p == r || p.starts_with(&format!("{r}\\"))
}

fn is_drive_root(path: &Path) -> bool {
    // "C:\" style — a root with no further components.
    path.parent().is_none()
}

/// Mutations (create/rename/move/copy-dest/write) must stay inside the user
/// profile or the temp directory, and outside protected system roots.
pub fn validate_mutation_target(path: &Path) -> Result<(), String> {
    if is_drive_root(path) {
        return Err("Drive roots cannot be modified.".into());
    }
    let home = dirs::home_dir().ok_or("Could not resolve the user profile directory.")?;
    if path == home {
        return Err("The user profile root itself cannot be modified.".into());
    }
    let temp = std::env::temp_dir();
    let allowed = starts_with_ci(path, &home) || starts_with_ci(path, &temp);
    if !allowed {
        return Err(format!(
            "\"{}\" is outside the folders ArcSonare may modify (your user profile and temp).",
            path.display()
        ));
    }
    for root in protected_roots() {
        if starts_with_ci(path, &root) {
            return Err(format!(
                "\"{}\" is inside a protected system location.",
                path.display()
            ));
        }
    }
    Ok(())
}

/// Deletion has the same scope as mutation plus extra guards.
pub fn validate_delete_target(path: &Path) -> Result<(), String> {
    validate_mutation_target(path)?;
    let home = dirs::home_dir().ok_or("Could not resolve the user profile directory.")?;
    // Refuse the first level of well-known containers themselves.
    for known in [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
        dirs::picture_dir(),
        dirs::video_dir(),
        dirs::audio_dir(),
        Some(home),
    ]
    .into_iter()
    .flatten()
    {
        if path == known {
            return Err(format!(
                "\"{}\" is a Windows known folder and cannot be deleted.",
                path.display()
            ));
        }
    }
    Ok(())
}

/// Reads may target any absolute non-device path; existence is checked later.
pub fn validate_read_target(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("Path is empty.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_reserved_names() {
        assert!(validate_item_name("CON").is_err());
        assert!(validate_item_name("con.txt").is_err());
        assert!(validate_item_name("lpt3").is_err());
        assert!(validate_item_name("Client Videos").is_ok());
    }

    #[test]
    fn rejects_separators_and_traversal_in_names() {
        assert!(validate_item_name("a/b").is_err());
        assert!(validate_item_name(r"a\b").is_err());
        assert!(validate_item_name("..").is_err());
        assert!(validate_item_name("normal-name_1.txt").is_ok());
    }

    #[test]
    fn rejects_trailing_dot_and_normalizes_trailing_space() {
        assert!(validate_item_name("folder.").is_err());
        // Trailing spaces are trimmed before any use, so the input is safe.
        assert!(validate_item_name("folder ").is_ok());
    }

    #[test]
    fn normalizes_traversal() {
        let p = normalize_path(r"C:\Users\test\Desktop\..\Desktop\ok").unwrap();
        assert_eq!(p, PathBuf::from(r"C:\Users\test\Desktop\ok"));
    }

    #[test]
    fn rejects_relative_and_device_paths() {
        assert!(normalize_path("Desktop/notes").is_err());
        assert!(normalize_path(r"\\?\C:\Windows").is_err());
        assert!(normalize_path(r"C:\file.txt:stream").is_err());
    }

    #[test]
    fn rejects_drive_root_mutation() {
        assert!(validate_mutation_target(Path::new(r"C:\")).is_err());
    }

    #[test]
    fn rejects_windows_dir_mutation() {
        if let Some(windir) = env_path("WINDIR") {
            assert!(validate_mutation_target(&windir.join("test.txt")).is_err());
        }
    }

    #[test]
    fn rejects_mutation_outside_profile() {
        assert!(validate_mutation_target(Path::new(r"D:\SomewhereElse\x")).is_err());
    }

    #[test]
    fn allows_mutation_in_home() {
        if let Some(home) = dirs::home_dir() {
            assert!(validate_mutation_target(&home.join("Desktop").join("New Folder")).is_ok());
        }
    }

    #[test]
    fn rejects_known_folder_deletion() {
        if let Some(desktop) = dirs::desktop_dir() {
            assert!(validate_delete_target(&desktop).is_err());
            assert!(validate_delete_target(&desktop.join("Client Videos")).is_ok());
        }
    }
}
