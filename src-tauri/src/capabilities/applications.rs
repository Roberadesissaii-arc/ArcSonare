//! Real Windows application discovery, resolution, launch and verification.
//! Index sources: Start Menu shortcuts (user + common), registered App Paths,
//! known protocol handlers, the curated trusted registry, and running apps.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use super::system::{process_running, window_opaque_id};
use super::types::{ResultBuilder, ToolResult, VerificationEvidence};
use crate::top_overlay::app_registry::APP_REGISTRY;
use crate::top_overlay::web_launcher::open_approved_url;

const INDEX_TTL: Duration = Duration::from_secs(60 * 60 * 12);
const LAUNCH_VERIFY_BUDGET: Duration = Duration::from_secs(4);

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

fn index_cache_path(app: &AppHandle) -> Option<PathBuf> {
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
    entries.extend(scan_protocols());
    // Deduplicate by normalized canonical name, preferring installed win32
    // entries with a resolved executable over shortcuts over web entries.
    let mut best: HashMap<String, IndexedApplication> = HashMap::new();
    let rank = |e: &IndexedApplication| -> u8 {
        match (e.installed, e.target_type.as_str()) {
            (true, "win32") => 0,
            (true, "shortcut") => 1,
            (true, "protocol") => 2,
            _ => 3,
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

pub fn get_index(app: &AppHandle, force_refresh: bool) -> Vec<IndexedApplication> {
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
                if age >= 0 && (age as u64) < INDEX_TTL.as_secs() {
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
            version: 1,
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
    let q = normalize_name(query);
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

pub fn resolve(app: &AppHandle, args: ResolveArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.resolve");
    let preference = args.preference.as_deref().unwrap_or("native-first");
    let entries = get_index(app, false);
    let candidates = score_candidates(&entries, &args.query, preference);
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
    let entries = get_index(app, false);

    let entry: Option<IndexedApplication> = if let Some(target_id) = &args.target_id {
        entries.iter().find(|e| &e.id == target_id).cloned()
    } else if let Some(query) = &args.query {
        let candidates = score_candidates(&entries, query, preference);
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
}

pub fn list_applications(app: &AppHandle, args: ListArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.list");
    let entries = get_index(app, false);
    let filter = args.filter.as_deref().map(normalize_name);
    let limit = args.limit.unwrap_or(50).clamp(1, 200);
    let items: Vec<serde_json::Value> = entries
        .iter()
        .filter(|e| e.installed)
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
            })
        })
        .collect();
    let count = items.len();
    rb.success(
        format!(
            "{count} installed application{} indexed.",
            if count == 1 { "" } else { "s" }
        ),
        json!({ "applications": items, "count": count }),
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
    let entries = get_index(app, false);
    let candidates = score_candidates(&entries, &args.query, "native-first");
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
    let entries = get_index(app, false);
    let candidates = score_candidates(&entries, &args.query, "native-first");
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
