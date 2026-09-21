//! Real running-instance discovery.
//!
//! The defect this replaces: window enumeration produced pid, HWND, bounds and
//! title, and the frontend kept two of those — then collapsed every window of
//! an application into one anonymous catalog row. Two VS Code workspaces became
//! "VS Code", so "run this code" could not name which one it meant.
//!
//! Nothing here decides *what* to do with an instance. It only reports what is
//! actually on this machine, with enough identity that a preference recorded
//! today still points at the same thing tomorrow.

use std::collections::HashMap;

use super::catalog::{catalog_entry, match_catalog_id};
use super::model::{InstanceState, RunningAppInstance, WindowBounds};

/// Full executable path for a pid.
///
/// Worth the extra syscall: the process *name* is `Code.exe` for every VS Code
/// window and for every Electron fork that copied the name, while the path
/// distinguishes an install from a portable copy and is what an adapter needs
/// to decide whether it can talk to it at all.
#[cfg(windows)]
fn executable_path(pid: u32) -> Option<String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        fn QueryFullProcessImageNameW(
            process: isize,
            flags: u32,
            buffer: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: isize) -> i32;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle == 0 {
            return None;
        }
        let mut buffer = [0u16; 520];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        if ok == 0 || size == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..size as usize]))
    }
}

#[cfg(not(windows))]
fn executable_path(_pid: u32) -> Option<String> {
    None
}

/// pid → parent pid, from one Toolhelp snapshot.
///
/// Electron applications spawn helper processes that own no window; the parent
/// is how a helper is attributed to the application the user actually sees.
#[cfg(windows)]
fn parent_pids() -> HashMap<u32, u32> {
    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> isize;
        fn Process32FirstW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
        fn CloseHandle(handle: isize) -> i32;
    }
    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const INVALID_HANDLE_VALUE: isize = -1;

    let mut out = HashMap::new();
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return out;
    }
    let mut entry = ProcessEntry32W {
        dw_size: std::mem::size_of::<ProcessEntry32W>() as u32,
        cnt_usage: 0,
        th32_process_id: 0,
        th32_default_heap_id: 0,
        th32_module_id: 0,
        cnt_threads: 0,
        th32_parent_process_id: 0,
        pc_pri_class_base: 0,
        dw_flags: 0,
        sz_exe_file: [0; 260],
    };
    unsafe {
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                out.insert(entry.th32_process_id, entry.th32_parent_process_id);
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
    }
    out
}

#[cfg(not(windows))]
fn parent_pids() -> HashMap<u32, u32> {
    HashMap::new()
}

/// Stable monitor key for a window, from its centre point.
///
/// Deliberately not `xcap`'s monitor id: those are enumeration ordinals that
/// change when a display is unplugged, so persisting one makes a stored
/// preference silently point at a different screen. `display::identity` already
/// owns the EDID-derived key; this only asks it.
fn monitor_key_for(bounds: &WindowBounds) -> Option<String> {
    let cx = bounds.x + bounds.width / 2;
    let cy = bounds.y + bounds.height / 2;
    let monitors = crate::display::identity::enumerate_monitor_identities().ok()?;
    monitors
        .iter()
        .find(|m| {
            cx >= m.x
                && cx < m.x + m.width as i32
                && cy >= m.y
                && cy < m.y + m.height as i32
        })
        .or_else(|| monitors.iter().find(|m| m.primary))
        .map(|m| m.stable_key())
}

/// The part of a window title that identifies the document or workspace.
///
/// VS Code titles are `file — folder — Visual Studio Code`; the folder is the
/// workspace, and it is the only thing that distinguishes two editors from each
/// other for the whole lifetime of both. Browsers get the site, because that is
/// what "the YouTube window" means to a person.
pub fn workspace_identity(app_catalog_id: &str, title: &str) -> Option<String> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    match app_catalog_id {
        "vscode" | "cursor" => {
            // Segments are separated by an em dash (VS Code) or a hyphen.
            let parts: Vec<&str> = title
                .split(['—', '–'])
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect();
            let parts = if parts.len() > 1 {
                parts
            } else {
                title
                    .split(" - ")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .collect()
            };
            // Last segment is the product name; the one before it is the folder.
            if parts.len() >= 2 {
                let candidate = parts[parts.len() - 2];
                if !candidate.is_empty() && !is_product_name(candidate) {
                    return Some(candidate.to_string());
                }
            }
            parts.first().map(|s| s.to_string())
        }
        "chrome" | "edge" | "firefox" | "brave" => {
            let page = strip_browser_suffix(title);
            if page.is_empty() {
                None
            } else {
                Some(page)
            }
        }
        _ => None,
    }
}

fn is_product_name(segment: &str) -> bool {
    let s = segment.trim().to_lowercase();
    matches!(
        s.as_str(),
        "visual studio code"
            | "cursor"
            | "code"
            | "code - insiders"
            | "visual studio code - insiders"
    )
}

/// Drop the trailing browser name so the page identity is the page.
pub fn strip_browser_suffix(title: &str) -> String {
    let mut out = title.trim().to_string();
    for suffix in [
        " - Google Chrome",
        " — Google Chrome",
        " - Microsoft Edge",
        " — Microsoft Edge",
        " - Mozilla Firefox",
        " — Mozilla Firefox",
        " - Brave",
        " — Brave",
    ] {
        if out.len() > suffix.len() && out.ends_with(suffix) {
            out.truncate(out.len() - suffix.len());
            break;
        }
    }
    // Unread counters ("(3) Inbox") are noise for identity purposes.
    let trimmed = out.trim_start();
    if let Some(rest) = trimmed.strip_prefix('(') {
        if let Some(close) = rest.find(')') {
            if rest[..close].chars().all(|c| c.is_ascii_digit()) {
                out = rest[close + 1..].trim().to_string();
            }
        }
    }
    out.trim().to_string()
}

/// Whether an application's workspace identity is durable enough to be a key.
///
/// A VS Code folder is: it is the same string for the lifetime of that window,
/// and the same string again tomorrow. A browser's page identity is *not* —
/// it changes on every navigation. The live run caught this: a Chrome window
/// keyed `chrome:ws:ai-calibration-process` would have become a different
/// instance the moment the user opened another page, silently dropping any pin
/// and re-announcing the window as newly started.
fn workspace_is_durable(app_catalog_id: &str) -> bool {
    matches!(app_catalog_id, "vscode" | "cursor")
}

/// The identity a preference is filed under.
///
/// Must not contain the pid or the HWND. Both are recycled by Windows, so a
/// key built from either would rebind a pinned VS Code workspace to whatever
/// process happened to inherit the number after a restart.
pub fn instance_key(
    app_catalog_id: &str,
    executable_path: Option<&str>,
    workspace: Option<&str>,
    ordinal: usize,
) -> String {
    if workspace_is_durable(app_catalog_id) {
        if let Some(workspace) = workspace.filter(|w| !w.trim().is_empty()) {
            return format!("{app_catalog_id}:ws:{}", normalize_key(workspace));
        }
    }
    // The executable *name*, not its path. Discord installs under a versioned
    // folder (`app-1.0.9250`), so a path-derived key would change on every
    // update and orphan the user's pin — while the name distinguishes nothing
    // that matters once the catalog id is already in the key.
    if let Some(name) = executable_path
        .and_then(|p| p.rsplit(['\\', '/']).next())
        .filter(|n| !n.trim().is_empty())
    {
        return format!("{app_catalog_id}:exe:{}:{ordinal}", normalize_key(name));
    }
    format!("{app_catalog_id}:win:{ordinal}")
}

fn normalize_key(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Every window of every catalog-known application, as its own instance.
///
/// The important word is *every*. Grouping happens in the UI, where a person
/// can expand it; it must not happen here, or the model loses the ability to
/// say which window it acted on.
pub fn discover_instances() -> Result<Vec<RunningAppInstance>, String> {
    let own_pid = std::process::id();
    let windows = xcap::Window::all().map_err(|e| format!("enumerate windows: {e}"))?;
    let parents = parent_pids();
    let now = chrono::Utc::now().to_rfc3339();

    let mut exe_cache: HashMap<u32, Option<String>> = HashMap::new();
    let mut ordinals: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::new();

    for window in windows {
        let pid = window.pid().unwrap_or(0);
        if pid == 0 || pid == own_pid {
            continue;
        }
        let title = window.title().unwrap_or_default();
        let app_name = window.app_name().unwrap_or_default();
        if title.trim().is_empty() && app_name.trim().is_empty() {
            continue;
        }

        let exe_path = exe_cache
            .entry(pid)
            .or_insert_with(|| executable_path(pid))
            .clone();
        let exe_name = exe_path
            .as_deref()
            .and_then(|p| p.rsplit(['\\', '/']).next())
            .map(str::to_string)
            .unwrap_or_else(|| {
                if app_name.trim().is_empty() {
                    String::new()
                } else {
                    app_name.clone()
                }
            });

        let Some(app_catalog_id) = match_catalog_id(&exe_name, &app_name, &title) else {
            continue;
        };

        let bounds = WindowBounds {
            x: window.x().unwrap_or(0),
            y: window.y().unwrap_or(0),
            width: window.width().unwrap_or(0) as i32,
            height: window.height().unwrap_or(0) as i32,
        };
        let workspace = workspace_identity(&app_catalog_id, &title);
        let ordinal = {
            let slot = ordinals.entry(app_catalog_id.clone()).or_insert(0);
            let current = *slot;
            *slot += 1;
            current
        };
        let key = instance_key(
            &app_catalog_id,
            exe_path.as_deref(),
            workspace.as_deref(),
            ordinal,
        );
        let minimized = window.is_minimized().unwrap_or(false);

        out.push(RunningAppInstance {
            id: format!("inst-{key}"),
            instance_key: key,
            app_catalog_id,
            process_id: pid,
            executable_path: exe_path,
            executable_name: exe_name,
            window_id: window
                .id()
                .ok()
                .map(crate::capabilities::system::window_opaque_id),
            window_title: if title.trim().is_empty() {
                None
            } else {
                Some(title)
            },
            monitor_id: monitor_key_for(&bounds),
            window_bounds: Some(bounds),
            workspace_identity: workspace,
            parent_process_id: parents.get(&pid).copied().filter(|p| *p != 0),
            state: if minimized {
                InstanceState::Minimized
            } else {
                InstanceState::Running
            },
            started_at: None,
            last_seen_at: now.clone(),
        });
    }

    Ok(out)
}

/// Instances of one catalog application, in a stable order.
pub fn instances_for(app_catalog_id: &str, all: &[RunningAppInstance]) -> Vec<RunningAppInstance> {
    let mut matches: Vec<RunningAppInstance> = all
        .iter()
        .filter(|i| i.app_catalog_id == app_catalog_id)
        .cloned()
        .collect();
    matches.sort_by(|a, b| a.instance_key.cmp(&b.instance_key));
    matches
}

/// Display name for a catalog id, for a watch created from an instance.
pub fn display_name_for(app_catalog_id: &str) -> String {
    catalog_entry(app_catalog_id)
        .map(|e| e.display_name.to_string())
        .unwrap_or_else(|| app_catalog_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two VS Code windows on different folders must not collapse.
    ///
    /// This is the defect in one assertion: the old pipeline keyed on the
    /// catalog id, so both of these produced the key "vscode" and the second
    /// overwrote the first.
    #[test]
    fn two_workspaces_produce_two_keys() {
        let a = instance_key("vscode", Some(r"C:\Code\Code.exe"), Some("ArcSonare"), 0);
        let b = instance_key("vscode", Some(r"C:\Code\Code.exe"), Some("website"), 1);
        assert_ne!(a, b);
    }

    /// The same workspace must resolve to the same key across restarts, so a
    /// pinned instance stays pinned. Ordinal and pid must not participate.
    #[test]
    fn a_workspace_key_is_stable_across_window_order() {
        let first_run = instance_key("vscode", Some(r"C:\Code\Code.exe"), Some("ArcSonare"), 0);
        let second_run = instance_key("vscode", Some(r"C:\Code\Code.exe"), Some("ArcSonare"), 3);
        assert_eq!(
            first_run, second_run,
            "the ordinal must not leak into a workspace-identified key"
        );
    }

    /// A browser's page identity must not become its instance key.
    ///
    /// Found by the live run: a Chrome window was keyed from its page title, so
    /// navigating anywhere would have produced a different instance — dropping
    /// the user's pin and reporting the same window as newly started.
    #[test]
    fn a_browser_key_does_not_change_when_the_page_does() {
        let on_youtube = instance_key(
            "chrome",
            Some(r"C:\Program Files\Google\Chrome\chrome.exe"),
            Some("Some Video - YouTube"),
            0,
        );
        let after_navigating = instance_key(
            "chrome",
            Some(r"C:\Program Files\Google\Chrome\chrome.exe"),
            Some("Wikipedia"),
            0,
        );
        assert_eq!(
            on_youtube, after_navigating,
            "navigating must not turn a watched browser window into a new instance"
        );
    }

    /// An application that updates in place must keep its key.
    ///
    /// Discord installs under a versioned folder, so a path-derived key changed
    /// on every update and orphaned the pin. The executable name is what the
    /// key uses.
    #[test]
    fn an_application_update_does_not_change_the_key() {
        let before = instance_key(
            "discord",
            Some(r"C:\Users\a\AppData\Local\Discord\app-1.0.9250\Discord.exe"),
            None,
            0,
        );
        let after = instance_key(
            "discord",
            Some(r"C:\Users\a\AppData\Local\Discord\app-1.0.9310\Discord.exe"),
            None,
            0,
        );
        assert_eq!(before, after, "an in-place update must not orphan the pin");
        assert!(
            !before.contains("9250"),
            "the version must not be part of the key: {before}"
        );
    }

    #[test]
    fn vscode_titles_yield_the_folder_not_the_file() {
        assert_eq!(
            workspace_identity("vscode", "watchStore.ts — ArcSonare — Visual Studio Code")
                .as_deref(),
            Some("ArcSonare")
        );
        assert_eq!(
            workspace_identity("vscode", "main.rs - my-project - Visual Studio Code").as_deref(),
            Some("my-project")
        );
    }

    /// A window with only the product name must not claim a workspace called
    /// "Visual Studio Code" — that would make every empty editor the same
    /// instance as every other.
    #[test]
    fn a_bare_product_title_is_not_a_workspace() {
        assert_eq!(
            workspace_identity("vscode", "Visual Studio Code").as_deref(),
            Some("Visual Studio Code"),
            "single-segment titles fall back to the segment itself"
        );
        assert_eq!(
            workspace_identity("vscode", "index.ts — Visual Studio Code").as_deref(),
            Some("index.ts"),
            "the product name is never treated as the folder"
        );
    }

    #[test]
    fn browser_page_identity_drops_the_browser_and_unread_count() {
        assert_eq!(
            strip_browser_suffix("(3) Some Video - YouTube - Google Chrome"),
            "Some Video - YouTube"
        );
        assert_eq!(
            strip_browser_suffix("Inbox — Mozilla Firefox"),
            "Inbox"
        );
    }

    #[test]
    fn instances_are_filtered_and_ordered_deterministically() {
        let now = chrono::Utc::now().to_rfc3339();
        let make = |app: &str, key: &str| RunningAppInstance {
            id: format!("inst-{key}"),
            instance_key: key.into(),
            app_catalog_id: app.into(),
            process_id: 1,
            executable_path: None,
            executable_name: "x.exe".into(),
            window_id: None,
            window_title: None,
            window_bounds: None,
            monitor_id: None,
            workspace_identity: None,
            parent_process_id: None,
            state: InstanceState::Running,
            started_at: None,
            last_seen_at: now.clone(),
        };
        let all = vec![
            make("vscode", "vscode:ws:b"),
            make("spotify", "spotify:exe:s:0"),
            make("vscode", "vscode:ws:a"),
        ];
        let vscode = instances_for("vscode", &all);
        assert_eq!(vscode.len(), 2);
        assert_eq!(vscode[0].instance_key, "vscode:ws:a");
    }
}
