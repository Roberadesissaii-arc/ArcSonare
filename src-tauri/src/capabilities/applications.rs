//! Real Windows application discovery, resolution, launch and verification.
//! Index sources: Start Menu shortcuts (user + common), registered App Paths,
//! known protocol handlers, the curated trusted registry, and running apps.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};

use super::system::{process_running, window_opaque_id};
use super::types::{ResultBuilder, ToolResult, VerificationEvidence};
use crate::top_overlay::app_registry::APP_REGISTRY;
use crate::top_overlay::web_launcher::open_approved_url;

const INDEX_TTL: Duration = Duration::from_secs(60 * 60 * 12);
const LAUNCH_VERIFY_BUDGET: Duration = Duration::from_secs(4);
const INDEX_CACHE_VERSION: u32 = 2;

/// URI protocols that may be launched (checked against the registry too).
const PROTOCOL_ALLOWLIST: &[(&str, &str)] = &[
    ("spotify", "Spotify"),
    ("discord", "Discord"),
    ("slack", "Slack"),
    ("notion", "Notion"),
    ("figma", "Figma"),
    ("obsidian", "Obsidian"),
    ("steam", "Steam"),
    ("epic", "Epic Games"),
    ("ms-settings", "Windows Settings"),
    ("ms-todo", "Microsoft To Do"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedApplication {
    pub id: String,
    pub canonical_name: String,
    pub display_name: String,
    pub normalized_names: Vec<String>,
    /// win32 | shortcut | protocol | web
    pub target_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcut_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub official_web_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    pub installed: bool,
    /// app-paths | start-menu | protocol | curated | web-catalog
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexCache {
    version: u32,
    built_at: i64,
    entries: Vec<IndexedApplication>,
}

#[derive(Default)]
pub struct ApplicationIndexState {
    cache: Mutex<Option<(Instant, Vec<IndexedApplication>)>>,
}

pub fn normalize_name(name: &str) -> String {
    let lowered: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    lowered.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Normalize conversational application references before matching the index.
/// This keeps product names while removing voice filler such as "my" and
/// wrappers such as "an application called".
pub fn normalize_application_query(query: &str) -> String {
    let normalized = normalize_name(query);
    let mut words: Vec<&str> = normalized.split_whitespace().collect();

    if words.len() >= 2 && matches!(words[0], "can" | "could" | "would") && words[1] == "you" {
        words.drain(0..2);
    }
    while matches!(
        words.first().copied(),
        Some("please" | "open" | "launch" | "start" | "run" | "up")
    ) {
        words.remove(0);
    }
    while matches!(words.first().copied(), Some("my" | "the" | "a" | "an")) {
        words.remove(0);
    }

    if words.len() >= 3
        && matches!(words[0], "desktop" | "windows")
        && matches!(words[1], "app" | "application" | "program")
        && matches!(words[2], "called" | "named")
    {
        words.drain(0..3);
    } else if words.len() >= 2
        && matches!(words[0], "app" | "application" | "program")
        && matches!(words[1], "called" | "named")
    {
        words.drain(0..2);
    } else if matches!(words.first().copied(), Some("called" | "named")) {
        words.remove(0);
    }

    while matches!(words.first().copied(), Some("my" | "the" | "a" | "an")) {
        words.remove(0);
    }
    if words.len() >= 2 && words[words.len() - 2..] == ["for", "me"] {
        words.truncate(words.len() - 2);
    }
    while matches!(
        words.last().copied(),
        Some("please" | "app" | "application" | "program")
    ) {
        words.pop();
    }

    words.join(" ")
}

fn index_cache_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("capabilities");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("app_index.json"))
}

// ---------------------------------------------------------------------------
// Index sources
// ---------------------------------------------------------------------------

fn scan_start_menu() -> Vec<IndexedApplication> {
    let mut roots = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Some(programdata) = std::env::var_os("ProgramData") {
        roots.push(PathBuf::from(programdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    let skip_words = [
        "uninstall",
        "readme",
        "documentation",
        "help",
        "website",
        "license",
        "report a bug",
        "release notes",
        "更新",
        "卸载",
    ];
    let mut out = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = roots.into_iter().map(|r| (r, 0)).collect();
    while let Some((dir, depth)) = stack.pop() {
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth < 3 {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            let is_lnk = path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("lnk"))
                .unwrap_or(false);
            if !is_lnk {
                continue;
            }
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let lower = stem.to_lowercase();
            if skip_words.iter().any(|w| lower.contains(w)) {
                continue;
            }
            let normalized = normalize_name(&stem);
            if normalized.is_empty() {
                continue;
            }
            out.push(IndexedApplication {
                id: format!("sm-{}", normalized.replace(' ', "-")),
                canonical_name: normalized.clone(),
                display_name: stem,
                normalized_names: vec![normalized],
                target_type: "shortcut".into(),
                executable_path: None,
                shortcut_path: Some(path.to_string_lossy().into_owned()),
                protocol_uri: None,
                official_web_url: None,
                process_name: None,
                installed: true,
                source: "start-menu".into(),
            });
        }
    }
    out
}

/// Windows' Start Apps catalog includes packaged/UWP apps and traditional
/// applications registered with an AppUserModelID. These do not always expose
/// an App Paths entry or a normal Start Menu shortcut.
#[cfg(windows)]
fn scan_start_apps() -> Vec<IndexedApplication> {
    let script = concat!(
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();",
        "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"
    );
    let Ok(output) = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw.trim()) else {
        return Vec::new();
    };
    let rows: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(items) => items.iter().collect(),
        serde_json::Value::Object(_) => vec![&value],
        _ => Vec::new(),
    };

    rows.into_iter()
        .filter_map(|row| {
            let name = row.get("Name")?.as_str()?.trim();
            let app_id = row.get("AppID")?.as_str()?.trim();
            let normalized = normalize_name(name);
            if normalized.is_empty() || app_id.is_empty() || app_id.chars().any(|c| c.is_control())
            {
                return None;
            }
            Some(IndexedApplication {
                id: format!("start-app-{}", normalized.replace(' ', "-")),
                canonical_name: normalized.clone(),
                display_name: name.to_string(),
                normalized_names: vec![normalized, normalize_name(app_id)],
                target_type: "app-id".into(),
                executable_path: None,
                shortcut_path: None,
                // Reuse the existing optional launch-target field. The value
                // comes from Windows, never from model/user arguments.
                protocol_uri: Some(app_id.to_string()),
                official_web_url: None,
                process_name: None,
                installed: true,
                source: "start-apps".into(),
            })
        })
        .collect()
}

#[cfg(not(windows))]
fn scan_start_apps() -> Vec<IndexedApplication> {
    Vec::new()
}

#[cfg(windows)]
fn scan_app_paths() -> Vec<IndexedApplication> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut out = Vec::new();
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let root = RegKey::predef(hive);
        let Ok(app_paths) =
            root.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths")
        else {
            continue;
        };
        for key_name in app_paths.enum_keys().flatten() {
            let Ok(sub) = app_paths.open_subkey(&key_name) else {
                continue;
            };
            let Ok(exe_path) = sub.get_value::<String, _>("") else {
                continue;
            };
            let exe_path = exe_path.trim_matches('"').to_string();
            if !Path::new(&exe_path).is_file() {
                continue;
            }
            let stem = Path::new(&key_name)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or(key_name.clone());
            let normalized = normalize_name(&stem);
            if normalized.is_empty() {
                continue;
            }
            out.push(IndexedApplication {
                id: format!("ap-{}", normalized.replace(' ', "-")),
                canonical_name: normalized.clone(),
                display_name: stem,
                normalized_names: vec![normalized],
                target_type: "win32".into(),
                executable_path: Some(exe_path),
                shortcut_path: None,
                protocol_uri: None,
                official_web_url: None,
                process_name: Some(key_name),
                installed: true,
                source: "app-paths".into(),
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn scan_app_paths() -> Vec<IndexedApplication> {
    Vec::new()
}

#[cfg(windows)]
fn protocol_registered(scheme: &str) -> bool {
    use winreg::enums::HKEY_CLASSES_ROOT;
    use winreg::RegKey;
    RegKey::predef(HKEY_CLASSES_ROOT)
        .open_subkey(scheme)
        .map(|key| {
            key.get_value::<String, _>("URL Protocol").is_ok() || {
                // Some handlers omit the value but have shell\open\command.
                key.open_subkey(r"shell\open\command").is_ok()
            }
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn protocol_registered(_scheme: &str) -> bool {
    false
}

fn scan_protocols() -> Vec<IndexedApplication> {
    PROTOCOL_ALLOWLIST
        .iter()
        .filter(|(scheme, _)| protocol_registered(scheme))
        .map(|(scheme, name)| {
            let normalized = normalize_name(name);
            IndexedApplication {
                id: format!("proto-{scheme}"),
                canonical_name: normalized.clone(),
                display_name: (*name).into(),
                normalized_names: vec![normalized, scheme.to_string()],
                target_type: "protocol".into(),
                executable_path: None,
                shortcut_path: None,
                protocol_uri: Some(format!("{scheme}:")),
                official_web_url: None,
                process_name: None,
                installed: true,
                source: "protocol".into(),
            }
        })
        .collect()
}

/// Curated trusted registry (existing APP_REGISTRY) — resolved on this machine.
fn scan_curated() -> Vec<IndexedApplication> {
    APP_REGISTRY
        .iter()
        .map(|entry| {
            let exe = crate::top_overlay::launcher::first_existing_public(entry.exe_candidates);
            let installed = exe.is_some();
            let normalized = normalize_name(entry.display_name);
            IndexedApplication {
                id: format!("cur-{}", entry.id),
                canonical_name: normalized.clone(),
                display_name: entry.display_name.into(),
                normalized_names: vec![normalized, normalize_name(entry.id)],
                target_type: if installed { "win32" } else { "web" }.into(),
                executable_path: exe.map(|p| p.to_string_lossy().into_owned()),
                shortcut_path: None,
                protocol_uri: None,
                official_web_url: entry.web_url.map(|u| u.to_string()),
                process_name: entry.process_names.first().map(|s| s.to_string()),
                installed,
                source: if installed { "curated" } else { "web-catalog" }.into(),
            }
        })
        .collect()
}

fn build_index() -> Vec<IndexedApplication> {
    let mut entries = Vec::new();
    entries.extend(scan_curated());
    entries.extend(scan_app_paths());
    entries.extend(scan_start_menu());
    entries.extend(scan_start_apps());
    entries.extend(scan_protocols());
    // Deduplicate by normalized canonical name, preferring installed win32
    // entries with a resolved executable over shortcuts over web entries.
    let mut best: HashMap<String, IndexedApplication> = HashMap::new();
    let rank = |e: &IndexedApplication| -> u8 {
        match (e.installed, e.target_type.as_str()) {
            (true, "win32") => 0,
            (true, "shortcut") => 1,
            (true, "app-id") => 2,
            (true, "protocol") => 3,
            _ => 4,
        }
    };
    for entry in entries {
        match best.get(&entry.canonical_name) {
            Some(existing) if rank(existing) <= rank(&entry) => {
                // Keep the better entry, but merge the web fallback URL.
                if existing.official_web_url.is_none() && entry.official_web_url.is_some() {
                    let mut merged = existing.clone();
                    merged.official_web_url = entry.official_web_url.clone();
                    best.insert(entry.canonical_name.clone(), merged);
                }
            }
            _ => {
                // Merge fallback URL from a lower-ranked duplicate we replace.
                let mut entry = entry;
                if entry.official_web_url.is_none() {
                    if let Some(existing) = best.get(&entry.canonical_name) {
                        entry.official_web_url = existing.official_web_url.clone();
                    }
                }
                best.insert(entry.canonical_name.clone(), entry);
            }
        }
    }
    let mut out: Vec<IndexedApplication> = best.into_values().collect();
    out.sort_by(|a, b| a.canonical_name.cmp(&b.canonical_name));
    out
}

pub fn get_index<R: Runtime>(app: &AppHandle<R>, force_refresh: bool) -> Vec<IndexedApplication> {
    let state = app.state::<ApplicationIndexState>();
    {
        let cache = state.cache.lock().unwrap();
        if !force_refresh {
            if let Some((built, entries)) = cache.as_ref() {
                if built.elapsed() < INDEX_TTL {
                    return entries.clone();
                }
            }
        }
    }
    // Try the persisted cache before a full rescan (unless forced).
    if !force_refresh {
        if let Some(path) = index_cache_path(app) {
            if let Some(cached) = std::fs::read_to_string(&path)
                .ok()
                .and_then(|raw| serde_json::from_str::<IndexCache>(&raw).ok())
            {
                let age = chrono::Local::now().timestamp() - cached.built_at;
                if cached.version == INDEX_CACHE_VERSION
                    && age >= 0
                    && (age as u64) < INDEX_TTL.as_secs()
                {
                    let mut cache = state.cache.lock().unwrap();
                    *cache = Some((Instant::now(), cached.entries.clone()));
                    return cached.entries;
                }
            }
        }
    }
    let entries = build_index();
    if let Some(path) = index_cache_path(app) {
        let cache_doc = IndexCache {
            version: INDEX_CACHE_VERSION,
            built_at: chrono::Local::now().timestamp(),
            entries: entries.clone(),
        };
        if let Ok(json) = serde_json::to_string(&cache_doc) {
            let _ = std::fs::write(path, json);
        }
    }
    let mut cache = state.cache.lock().unwrap();
    *cache = Some((Instant::now(), entries.clone()));
    entries
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolveArgs {
    pub query: String,
    #[serde(default)]
    pub intent: Option<String>,
    #[serde(default)]
    pub preference: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCandidate {
    pub id: String,
    pub display_name: String,
    pub target_type: String,
    pub installed: bool,
    pub running: bool,
    pub score: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub official_web_url: Option<String>,
}

fn running_app_names() -> HashMap<String, u32> {
    // process name (lowercase, no .exe) -> pid
    super::system::running_processes()
        .map(|procs| {
            procs
                .into_iter()
                .map(|p| {
                    (
                        p.name.to_lowercase().trim_end_matches(".exe").to_string(),
                        p.pid,
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn score_candidates(
    entries: &[IndexedApplication],
    query: &str,
    preference: &str,
) -> Vec<ResolvedCandidate> {
    let q = normalize_application_query(query);
    if q.is_empty() {
        return Vec::new();
    }
    let running = running_app_names();
    let mut out = Vec::new();
    for entry in entries {
        let mut score: u32 = 0;
        let exact = entry.normalized_names.iter().any(|n| n == &q);
        let prefix = entry.normalized_names.iter().any(|n| n.starts_with(&q));
        let word = entry
            .normalized_names
            .iter()
            .any(|n| n.split(' ').any(|w| w == q) || q.split(' ').all(|qt| n.contains(qt)));
        if exact {
            score += 100;
        } else if prefix {
            score += 60;
        } else if word {
            score += 40;
        } else {
            continue;
        }
        if entry.installed {
            score += 25;
        }
        let proc_key = entry
            .process_name
            .as_deref()
            .map(|p| p.to_lowercase().trim_end_matches(".exe").to_string());
        let is_running = proc_key
            .as_ref()
            .map(|k| running.contains_key(k))
            .unwrap_or(false);
        if is_running {
            score += 15;
        }
        match (preference, entry.target_type.as_str()) {
            ("web-first", "web") => score += 20,
            ("native-first", "win32" | "shortcut" | "protocol") => score += 10,
            _ => {}
        }
        out.push(ResolvedCandidate {
            id: entry.id.clone(),
            display_name: entry.display_name.clone(),
            target_type: entry.target_type.clone(),
            installed: entry.installed,
            running: is_running,
            score,
            official_web_url: entry.official_web_url.clone(),
        });
    }
    out.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(a.display_name.cmp(&b.display_name))
    });
    out.truncate(6);
    out
}

/// Resolve against the current index and automatically rebuild once on a miss.
/// This makes newly installed applications available immediately instead of
/// waiting for the persisted index TTL or a manual "rescan apps" command.
fn candidates_with_refresh(
    app: &AppHandle,
    query: &str,
    preference: &str,
) -> (Vec<IndexedApplication>, Vec<ResolvedCandidate>) {
    let mut entries = get_index(app, false);
    let mut candidates = score_candidates(&entries, query, preference);
    if candidates.is_empty() {
        entries = get_index(app, true);
        candidates = score_candidates(&entries, query, preference);
    }
    (entries, candidates)
}

pub fn resolve(app: &AppHandle, args: ResolveArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.resolve");
    let preference = args.preference.as_deref().unwrap_or("native-first");
    let (_entries, candidates) = candidates_with_refresh(app, &args.query, preference);
    if candidates.is_empty() {
        return rb.not_found(format!(
            "No installed app or known service matched \"{}\".",
            args.query
        ));
    }
    let top = &candidates[0];
    // Ambiguous when the runner-up is close and names differ.
    let ambiguous = candidates.len() > 1
        && candidates[1].score + 15 >= top.score
        && candidates[1].display_name != top.display_name;
    let data = json!({
        "query": args.query,
        "resolved": if ambiguous { serde_json::Value::Null } else { serde_json::to_value(top).unwrap_or_default() },
        "ambiguous": ambiguous,
        "candidates": candidates,
    });
    rb.success(
        if ambiguous {
            format!(
                "Multiple matches for \"{}\": {}.",
                args.query,
                candidates
                    .iter()
                    .take(3)
                    .map(|c| c.display_name.clone())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        } else {
            format!("Resolved \"{}\" to {}.", args.query, top.display_name)
        },
        data,
        VerificationEvidence::verified("state-readback"),
    )
}

// ---------------------------------------------------------------------------
// Launch + verification
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenArgs {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub preference: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OpenWithArgs {
    /// File or folder to hand to the application.
    pub path: String,
    /// What to open it with: "vs code", "terminal", "notepad", ...
    pub application: String,
}

/// Windows terminals, best first. Resolved by hand rather than through the app
/// index because "terminal" is a role, not a product name — the index answers
/// with whatever happens to be called Terminal, which is often nothing.
fn terminal_candidates() -> Vec<(&'static str, Vec<String>)> {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:/Windows".into());
    vec![
        (
            "Windows Terminal",
            vec![format!("{local}/Microsoft/WindowsApps/wt.exe")],
        ),
        (
            "PowerShell",
            vec![format!(
                "{sys}/System32/WindowsPowerShell/v1.0/powershell.exe"
            )],
        ),
        ("Command Prompt", vec![format!("{sys}/System32/cmd.exe")]),
    ]
}

fn wants_terminal(query: &str) -> bool {
    let q = query.to_lowercase();
    [
        "terminal",
        "command prompt",
        "cmd",
        "powershell",
        "shell",
        "console",
    ]
    .iter()
    .any(|k| q.contains(k))
}

/// Open `path` in a terminal rooted at the right directory.
fn launch_terminal(path: &Path) -> Result<String, String> {
    // A file means "a terminal where that file lives" — cd'ing into a file
    // fails, and that was the whole point of asking.
    let dir = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| format!("\"{}\" has no parent folder.", path.display()))?
    };

    for (name, paths) in terminal_candidates() {
        for exe in paths {
            let exe_path = Path::new(&exe);
            if !exe_path.is_file() {
                continue;
            }
            let mut cmd = std::process::Command::new(exe_path);
            if name == "Windows Terminal" {
                // wt resolves its own start directory; -d is the documented flag.
                cmd.arg("-d").arg(&dir);
            } else {
                cmd.current_dir(&dir);
            }
            if cmd.spawn().is_ok() {
                return Ok(format!("Opened {name} at {}", dir.display()));
            }
        }
    }
    Err("No terminal application could be started.".into())
}

/// Open a file or folder with a named application.
pub fn open_with(app: &AppHandle, args: OpenWithArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.open_with");
    let path = Path::new(&args.path);
    if !path.exists() {
        return rb.not_found(format!("\"{}\" does not exist.", args.path));
    }

    if wants_terminal(&args.application) {
        return match launch_terminal(path) {
            Ok(message) => rb.success(
                message,
                json!({
                    "path": args.path,
                    "application": "terminal",
                    "target_kind": if path.is_dir() { "folder" } else { "file" },
                }),
                VerificationEvidence::verified_with("process-spawned", json!({})),
            ),
            Err(e) => rb.error("launch-failed", e, true),
        };
    }

    // Everything else goes through the real installed-app index, so "vs code"
    // resolves to the executable actually on this machine.
    let (entries, candidates) = candidates_with_refresh(app, &args.application, "native-first");
    let Some(top) = candidates.first() else {
        return rb.not_found(format!(
            "I couldn't find an app called \"{}\" to open it with.",
            args.application
        ));
    };
    let Some(entry) = entries.iter().find(|e| e.id == top.id) else {
        return rb.not_found(format!("\"{}\" is not installed.", args.application));
    };

    // Handing a path to a web target or a protocol URI is meaningless.
    let Some(exe) = entry
        .executable_path
        .as_ref()
        .filter(|p| Path::new(p).is_file())
    else {
        return rb.error(
            "not-supported",
            format!(
                "{} can't be given a file to open — it has no executable on this computer.",
                entry.display_name
            ),
            false,
        );
    };

    match std::process::Command::new(exe).arg(path).spawn() {
        Ok(_) => rb.success(
            format!("Opened {} with {}.", args.path, entry.display_name),
            json!({
                "path": args.path,
                "application": entry.display_name,
                "target_id": entry.id,
                "target_kind": if path.is_dir() { "folder" } else { "file" },
            }),
            VerificationEvidence::verified_with("process-spawned", json!({})),
        ),
        Err(e) => rb.error(
            "launch-failed",
            format!("{} refused to open it: {e}", entry.display_name),
            true,
        ),
    }
}

fn find_window_for(process_name: Option<&str>, display_name: &str) -> Option<(u32, String)> {
    let windows = xcap::Window::all().ok()?;
    let own_pid = std::process::id();
    let proc_key = process_name.map(|p| p.to_lowercase().trim_end_matches(".exe").to_string());
    let name_key = normalize_name(display_name);
    for w in windows {
        if w.pid().unwrap_or(0) == own_pid {
            continue;
        }
        let app_name = w.app_name().unwrap_or_default().to_lowercase();
        let app_key = app_name.trim_end_matches(".exe").to_string();
        let matches = proc_key.as_ref().map(|k| &app_key == k).unwrap_or(false)
            || normalize_name(&app_name).contains(&name_key)
            || (!name_key.is_empty()
                && normalize_name(&w.title().unwrap_or_default()).contains(&name_key));
        if matches {
            return Some((w.id().unwrap_or(0), w.title().unwrap_or_default()));
        }
    }
    None
}

/// Poll for a process or window belonging to the launched app.
fn verify_launch(entry: &IndexedApplication) -> VerificationEvidence {
    let deadline = Instant::now() + LAUNCH_VERIFY_BUDGET;
    loop {
        if let Some(proc_name) = &entry.process_name {
            if process_running(proc_name) {
                return VerificationEvidence::verified_with(
                    "process-detected",
                    json!({ "process": proc_name }),
                );
            }
        }
        if let Some((id, title)) =
            find_window_for(entry.process_name.as_deref(), &entry.display_name)
        {
            return VerificationEvidence::verified_with(
                "window-detected",
                json!({ "window_id": window_opaque_id(id), "title": title }),
            );
        }
        if Instant::now() >= deadline {
            return VerificationEvidence::unverified("process-detected");
        }
        std::thread::sleep(Duration::from_millis(400));
    }
}

fn launch_entry(entry: &IndexedApplication) -> Result<String, String> {
    match entry.target_type.as_str() {
        "win32" => {
            let Some(exe) = &entry.executable_path else {
                return Err("No executable path recorded.".into());
            };
            let path = Path::new(exe);
            if !path.is_file() {
                return Err(format!("\"{exe}\" no longer exists (stale index)."));
            }
            // Structured spawn — never a shell string, never model-built args.
            std::process::Command::new(path)
                .spawn()
                .map(|_| format!("Launched {}", entry.display_name))
                .map_err(|e| format!("Windows refused the launch: {e}"))
        }
        "shortcut" => {
            let Some(lnk) = &entry.shortcut_path else {
                return Err("No shortcut path recorded.".into());
            };
            let path = Path::new(lnk);
            if !path.is_file() {
                return Err(format!("\"{lnk}\" no longer exists (stale index)."));
            }
            open::that(path)
                .map(|_| {
                    format!(
                        "Launched {} via its Start Menu shortcut",
                        entry.display_name
                    )
                })
                .map_err(|e| format!("Windows refused the launch: {e}"))
        }
        "app-id" => {
            let Some(app_id) = &entry.protocol_uri else {
                return Err("No Windows application id recorded.".into());
            };
            if app_id.is_empty() || app_id.chars().any(|c| c.is_control()) {
                return Err("The indexed Windows application id is invalid.".into());
            }
            let target = format!(r"shell:AppsFolder\{app_id}");
            std::process::Command::new("explorer.exe")
                .arg(&target)
                .spawn()
                .map(|_| format!("Launched {} via Windows Apps", entry.display_name))
                .map_err(|e| format!("Windows refused the app launch: {e}"))
        }
        "protocol" => {
            let Some(uri) = &entry.protocol_uri else {
                return Err("No protocol recorded.".into());
            };
            let scheme = uri.trim_end_matches(':');
            if !PROTOCOL_ALLOWLIST.iter().any(|(s, _)| *s == scheme) {
                return Err(format!("Protocol \"{scheme}:\" is not allowlisted."));
            }
            open::that(uri)
                .map(|_| format!("Launched {} via {uri}", entry.display_name))
                .map_err(|e| format!("Windows refused the protocol launch: {e}"))
        }
        other => Err(format!(
            "Target type \"{other}\" cannot be launched natively."
        )),
    }
}

pub fn open_application(app: &AppHandle, args: OpenArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.open");
    let preference = args.preference.as_deref().unwrap_or("native-first");
    let mut entries = get_index(app, false);

    let entry: Option<IndexedApplication> = if let Some(target_id) = &args.target_id {
        let mut found = entries.iter().find(|e| &e.id == target_id).cloned();
        if found.is_none() {
            entries = get_index(app, true);
            found = entries.iter().find(|e| &e.id == target_id).cloned();
        }
        found
    } else if let Some(query) = &args.query {
        let resolved = candidates_with_refresh(app, query, preference);
        entries = resolved.0;
        let candidates = resolved.1;
        if candidates.is_empty() {
            None
        } else {
            let top = &candidates[0];
            let ambiguous = candidates.len() > 1
                && candidates[1].score + 15 >= top.score
                && candidates[1].display_name != top.display_name;
            if ambiguous {
                return rb.needs_confirmation(
                    format!(
                        "I found {} matches for \"{query}\". Which one should I open?",
                        candidates.len()
                    ),
                    json!({
                        "reason": "ambiguous",
                        "candidates": candidates,
                    }),
                );
            }
            entries.iter().find(|e| e.id == top.id).cloned()
        }
    } else {
        return rb.error(
            "invalid-arguments",
            "Either query or target_id is required.",
            true,
        );
    };

    let Some(entry) = entry else {
        return rb.not_found(format!(
            "\"{}\" was not found as an installed app or known service.",
            args.query.or(args.target_id).unwrap_or_default()
        ));
    };

    // Web-first preference with a known URL skips the native attempt.
    let use_web_first = preference == "web-first" && entry.official_web_url.is_some();

    if entry.installed && !use_web_first {
        // Already running? Report and focus instead of duplicating instances.
        if let Some((id, title)) =
            find_window_for(entry.process_name.as_deref(), &entry.display_name)
        {
            let focused = super::windows::focus_hwnd(id);
            return rb.success(
                format!(
                    "{} is already running — focused its window.",
                    entry.display_name
                ),
                json!({
                    "application": entry.display_name,
                    "action": "focused-existing",
                    "window_id": window_opaque_id(id),
                    "window_title": title,
                    "focus_succeeded": focused,
                    "method": "native",
                }),
                VerificationEvidence::verified_with("window-detected", json!({ "title": title })),
            );
        }
        match launch_entry(&entry) {
            Ok(_message) => {
                let evidence = verify_launch(&entry);
                let data = json!({
                    "application": entry.display_name,
                    "target_id": entry.id,
                    "method": "native",
                    "target_type": entry.target_type,
                });
                if evidence.verified {
                    return rb.success(format!("Opened {}.", entry.display_name), data, evidence);
                }
                return rb.partial(
                    format!(
                        "Windows accepted the {} launch, but no window or process could be confirmed yet.",
                        entry.display_name
                    ),
                    data,
                    evidence,
                );
            }
            Err(native_error) => {
                // Fall through to web when available; report honestly otherwise.
                if let Some(url) = &entry.official_web_url {
                    return open_web_fallback(rb, &entry, url, Some(native_error));
                }
                return rb.error("launch-failed", native_error, true);
            }
        }
    }

    if let Some(url) = &entry.official_web_url {
        return open_web_fallback(rb, &entry, url, None);
    }

    rb.not_found(format!(
        "{} is not installed and has no known web version.",
        entry.display_name
    ))
}

fn open_web_fallback(
    mut rb: ResultBuilder,
    entry: &IndexedApplication,
    url: &str,
    native_error: Option<String>,
) -> ToolResult {
    if let Some(err) = &native_error {
        rb.warn(format!("Native launch failed first: {err}"));
    }
    match open_approved_url(url) {
        Ok(()) => {
            let summary = if entry.installed {
                format!("Opened {} in your browser.", entry.display_name)
            } else {
                format!(
                    "{} wasn't found as an installed app, so I opened the web version.",
                    entry.display_name
                )
            };
            rb.success(
                summary,
                json!({
                    "application": entry.display_name,
                    "target_id": entry.id,
                    "method": "web-fallback",
                    "url": url,
                }),
                // Honest: the OS accepted the browser-open; page load unverifiable.
                VerificationEvidence::unverified("return-code"),
            )
        }
        Err(e) => rb.error("web-open-failed", e, true),
    }
}

// ---------------------------------------------------------------------------
// List / status / focus / close
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListArgs {
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    /// Restrict to applications running right now. The index already knows
    /// this, but the flag was never exposed — so the assistant could not answer
    /// "what do I have open?" and had to guess.
    #[serde(default)]
    pub running_only: Option<bool>,
}

pub fn list_applications(app: &AppHandle, args: ListArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.list");
    let entries = get_index(app, false);
    let filter = args.filter.as_deref().map(normalize_name);
    let limit = args.limit.unwrap_or(50).clamp(1, 200);
    let running_only = args.running_only.unwrap_or(false);
    // IndexedApplication has no `running` field — it is derived at query time
    // from the live process list, the same way `resolve` does it.
    let running_now = running_app_names();
    let is_running = |e: &IndexedApplication| {
        e.normalized_names
            .iter()
            .any(|n| running_now.contains_key(n.as_str()))
    };
    let items: Vec<serde_json::Value> = entries
        .iter()
        .filter(|e| e.installed)
        .filter(|e| !running_only || is_running(e))
        .filter(|e| {
            filter
                .as_ref()
                .map(|f| e.normalized_names.iter().any(|n| n.contains(f.as_str())))
                .unwrap_or(true)
        })
        .take(limit)
        .map(|e| {
            json!({
                "id": e.id,
                "name": e.display_name,
                "target_type": e.target_type,
                "source": e.source,
                // Exposed so the assistant can answer "what's open?" and decide
                // whether a request means open, focus, or close.
                "running": is_running(e),
            })
        })
        .collect();
    let count = items.len();
    let running_count = entries
        .iter()
        .filter(|e| e.installed && is_running(e))
        .count();
    rb.success(
        if running_only {
            format!(
                "{count} application{} running right now.",
                if count == 1 { "" } else { "s" }
            )
        } else {
            format!(
                "{count} installed application{} indexed, {running_count} running.",
                if count == 1 { "" } else { "s" }
            )
        },
        json!({
            "applications": items,
            "count": count,
            "running_count": running_count,
        }),
        VerificationEvidence::verified("state-readback"),
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefreshArgs {}

pub fn refresh_index(app: &AppHandle, _args: RefreshArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.refresh_index");
    let entries = get_index(app, true);
    let installed = entries.iter().filter(|e| e.installed).count();
    rb.success(
        format!("Application index rebuilt — {installed} installed apps found."),
        json!({ "total": entries.len(), "installed": installed }),
        VerificationEvidence::verified("state-readback"),
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FocusCloseArgs {
    pub query: String,
}

pub fn focus_application(app: &AppHandle, args: FocusCloseArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.focus");
    let (entries, candidates) = candidates_with_refresh(app, &args.query, "native-first");
    let entry = candidates
        .first()
        .and_then(|c| entries.iter().find(|e| e.id == c.id));
    let (proc_name, display) = match entry {
        Some(e) => (e.process_name.clone(), e.display_name.clone()),
        None => (None, args.query.clone()),
    };
    let Some((id, title)) = find_window_for(proc_name.as_deref(), &display) else {
        return rb.not_found(format!("No running window matched \"{}\".", args.query));
    };
    let ok = super::windows::focus_hwnd(id);
    if ok {
        rb.success(
            format!("Focused {display}."),
            json!({ "window_id": window_opaque_id(id), "title": title }),
            VerificationEvidence::verified_with("window-detected", json!({ "title": title })),
        )
    } else {
        rb.partial(
            format!("Windows did not allow bringing {display} to the foreground."),
            json!({ "window_id": window_opaque_id(id), "title": title }),
            VerificationEvidence::unverified("window-detected"),
        )
    }
}

pub fn close_application(app: &AppHandle, args: FocusCloseArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.close");
    let (entries, candidates) = candidates_with_refresh(app, &args.query, "native-first");
    let entry = candidates
        .first()
        .and_then(|c| entries.iter().find(|e| e.id == c.id));
    let (proc_name, display) = match entry {
        Some(e) => (e.process_name.clone(), e.display_name.clone()),
        None => (None, args.query.clone()),
    };
    let Some((id, title)) = find_window_for(proc_name.as_deref(), &display) else {
        return rb.not_found(format!("\"{}\" does not appear to be running.", args.query));
    };
    // Polite close request only — forced termination is not exposed.
    if !super::windows::request_close_hwnd(id) {
        return rb.error(
            "close-request-failed",
            format!("Windows rejected the close request for {display}."),
            true,
        );
    }
    // Verify the window actually went away (apps may prompt to save).
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if find_window_for(proc_name.as_deref(), &display).is_none() {
            return rb.success(
                format!("Closed {display}."),
                json!({ "window_title": title }),
                VerificationEvidence::verified_with(
                    "window-detected",
                    json!({ "window_absent": true }),
                ),
            );
        }
        if Instant::now() >= deadline {
            return rb.partial(
                format!(
                    "Asked {display} to close, but its window is still open — it may be waiting for you (unsaved work?)."
                ),
                json!({ "window_title": title }),
                VerificationEvidence::unverified("window-detected"),
            );
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn indexed(name: &str) -> IndexedApplication {
        let normalized = normalize_name(name);
        IndexedApplication {
            id: format!("test-{}", normalized.replace(' ', "-")),
            canonical_name: normalized.clone(),
            display_name: name.to_string(),
            normalized_names: vec![normalized],
            target_type: "shortcut".into(),
            executable_path: None,
            shortcut_path: Some(format!(r"C:\Test\{name}.lnk")),
            protocol_uri: None,
            official_web_url: None,
            process_name: None,
            installed: true,
            source: "test".into(),
        }
    }

    #[test]
    fn application_query_removes_voice_wrappers() {
        assert_eq!(normalize_application_query("my Discord"), "discord");
        assert_eq!(
            normalize_application_query("an application called Arduino"),
            "arduino"
        );
        assert_eq!(
            normalize_application_query("Could you open up the Arduino IDE app for me"),
            "arduino ide"
        );
    }

    #[test]
    fn conversational_queries_match_installed_apps() {
        let entries = vec![indexed("Discord"), indexed("Arduino IDE")];

        let discord = score_candidates(&entries, "my Discord", "native-first");
        assert_eq!(
            discord.first().map(|c| c.display_name.as_str()),
            Some("Discord")
        );

        let arduino = score_candidates(&entries, "an application called Arduino", "native-first");
        assert_eq!(
            arduino.first().map(|c| c.display_name.as_str()),
            Some("Arduino IDE")
        );
    }
}
