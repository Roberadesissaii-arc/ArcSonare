//! Native system information: real local time, environment, displays,
//! processes, active window, battery. Never asks a model to guess.

use serde::Deserialize;
use serde_json::json;

use super::types::{ResultBuilder, ToolResult, VerificationEvidence};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct DatetimeArgs {
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub include_timezone: Option<bool>,
}

pub fn get_local_datetime(args: DatetimeArgs) -> ToolResult {
    let rb = ResultBuilder::new("system.get_local_datetime");
    let now = chrono::Local::now();
    let tz_name = iana_time_zone::get_timezone().unwrap_or_else(|_| "local".into());
    let offset = now.format("%:z").to_string();
    let format = args.format.as_deref().unwrap_or("spoken");

    let time_spoken = now.format("%-I:%M %p").to_string();
    let date_spoken = now.format("%A, %B %-d, %Y").to_string();
    let local_datetime = match format {
        "iso" => now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
        "full" => now.format("%A, %B %-d, %Y at %-I:%M:%S %p").to_string(),
        _ => format!("{time_spoken} on {date_spoken}"),
    };

    let data = json!({
        "local_datetime": local_datetime,
        "date": date_spoken,
        "time": time_spoken,
        "iso": now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
        "weekday": now.format("%A").to_string(),
        "timezone_name": tz_name,
        "utc_offset": offset,
    });

    // The OS clock call itself is the verification: a valid datetime came back.
    rb.success(
        format!("It's {time_spoken} on {date_spoken}."),
        data,
        VerificationEvidence::verified("state-readback"),
    )
}

pub fn get_environment_summary(app: &tauri::AppHandle) -> ToolResult {
    let rb = ResultBuilder::new("system.get_environment_summary");
    let os_version = os_version_string();
    let arch = std::env::consts::ARCH;
    let app_version = app.package_info().version.to_string();
    let username = std::env::var("USERNAME").unwrap_or_default();
    let device = std::env::var("COMPUTERNAME").unwrap_or_default();
    let tz = iana_time_zone::get_timezone().unwrap_or_else(|_| "local".into());
    // Safe values only — no environment variables, no secrets.
    let data = json!({
        "windows_version": os_version,
        "architecture": arch,
        "arcsonare_version": app_version,
        "username": username,
        "device_name": device,
        "timezone": tz,
        "locale": sys_locale(),
    });
    rb.success(
        format!("Windows {os_version} on {arch}, ArcSonare {app_version}."),
        data,
        VerificationEvidence::verified("state-readback"),
    )
}

fn sys_locale() -> String {
    // LANG-style env vars are rare on Windows; fall back to a stable default.
    std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_else(|_| "en-US".into())
}

#[cfg(windows)]
fn os_version_string() -> String {
    // RtlGetVersion reports honestly even under compatibility shims.
    #[repr(C)]
    struct OsVersionInfoW {
        os_version_info_size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform_id: u32,
        csd_version: [u16; 128],
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfoW) -> i32;
    }
    let mut info = OsVersionInfoW {
        os_version_info_size: std::mem::size_of::<OsVersionInfoW>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform_id: 0,
        csd_version: [0; 128],
    };
    let status = unsafe { RtlGetVersion(&mut info) };
    if status == 0 {
        let name = if info.build >= 22000 { "11" } else { "10" };
        format!("{name} (build {})", info.build)
    } else {
        "unknown".into()
    }
}

#[cfg(not(windows))]
fn os_version_string() -> String {
    "unsupported".into()
}

pub fn list_displays() -> ToolResult {
    let rb = ResultBuilder::new("system.list_displays");
    match xcap::Monitor::all() {
        Ok(monitors) => {
            let items: Vec<serde_json::Value> = monitors
                .iter()
                .map(|m| {
                    json!({
                        "id": m.id().map(|i| i.to_string()).unwrap_or_default(),
                        "name": m.name().unwrap_or_default(),
                        "primary": m.is_primary().unwrap_or(false),
                        "bounds": {
                            "x": m.x().unwrap_or(0),
                            "y": m.y().unwrap_or(0),
                            "width": m.width().unwrap_or(0),
                            "height": m.height().unwrap_or(0),
                        },
                        "scale": m.scale_factor().unwrap_or(1.0),
                        "rotation": m.rotation().unwrap_or(0.0),
                    })
                })
                .collect();
            let count = items.len();
            rb.success(
                format!(
                    "{count} display{} detected.",
                    if count == 1 { "" } else { "s" }
                ),
                json!({ "displays": items, "count": count }),
                VerificationEvidence::verified("state-readback"),
            )
        }
        Err(e) => rb.error("display-enumeration-failed", e.to_string(), true),
    }
}

/// Opaque window id — HWND is never handed to the model as a raw handle.
pub fn window_opaque_id(raw: u32) -> String {
    format!("w{raw:x}")
}

pub fn parse_window_id(id: &str) -> Option<u32> {
    id.strip_prefix('w')
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
}

pub fn get_active_window() -> ToolResult {
    let rb = ResultBuilder::new("system.get_active_window");
    let windows = match xcap::Window::all() {
        Ok(w) => w,
        Err(e) => return rb.error("window-enumeration-failed", e.to_string(), true),
    };
    let own_pid = std::process::id();
    let active = windows
        .into_iter()
        .find(|w| w.pid().unwrap_or(0) != own_pid && w.is_focused().unwrap_or(false));
    match active {
        Some(w) => {
            let data = json!({
                "id": window_opaque_id(w.id().unwrap_or(0)),
                "title": w.title().unwrap_or_default(),
                "process_name": w.app_name().unwrap_or_default(),
                "bounds": {
                    "x": w.x().unwrap_or(0),
                    "y": w.y().unwrap_or(0),
                    "width": w.width().unwrap_or(0),
                    "height": w.height().unwrap_or(0),
                },
                "minimized": w.is_minimized().unwrap_or(false),
                "maximized": w.is_maximized().unwrap_or(false),
            });
            let title = w.title().unwrap_or_default();
            rb.success(
                format!("Active window: {title}"),
                data,
                VerificationEvidence::verified("window-detected"),
            )
        }
        None => rb.not_found("No focused window outside ArcSonare was found."),
    }
}

#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub name: String,
    pub pid: u32,
}

/// Snapshot of running processes via Toolhelp32 (no elevation required).
#[cfg(windows)]
pub fn running_processes() -> Result<Vec<ProcessInfo>, String> {
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

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("Could not snapshot running processes.".into());
    }
    let mut out = Vec::new();
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
                let len = entry
                    .sz_exe_file
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.sz_exe_file.len());
                let name = String::from_utf16_lossy(&entry.sz_exe_file[..len]);
                out.push(ProcessInfo {
                    name,
                    pid: entry.th32_process_id,
                });
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
    }
    Ok(out)
}

#[cfg(not(windows))]
pub fn running_processes() -> Result<Vec<ProcessInfo>, String> {
    Err("Process enumeration is only supported on Windows.".into())
}

/// True when a process with this executable name is currently running.
pub fn process_running(exe_name: &str) -> bool {
    running_processes()
        .map(|procs| procs.iter().any(|p| p.name.eq_ignore_ascii_case(exe_name)))
        .unwrap_or(false)
}

pub fn get_running_processes() -> ToolResult {
    let rb = ResultBuilder::new("system.get_running_processes");
    let procs = match running_processes() {
        Ok(p) => p,
        Err(e) => return rb.error("process-snapshot-failed", e, true),
    };
    // User-facing default: processes owning a visible window.
    let window_pids: std::collections::HashMap<u32, String> = xcap::Window::all()
        .map(|ws| {
            ws.iter()
                .filter(|w| {
                    !w.is_minimized().unwrap_or(false)
                        || w.title().map(|t| !t.is_empty()).unwrap_or(false)
                })
                .filter_map(|w| Some((w.pid().ok()?, w.title().unwrap_or_default())))
                .collect()
        })
        .unwrap_or_default();
    let mut items: Vec<serde_json::Value> = procs
        .iter()
        .filter(|p| window_pids.contains_key(&p.pid))
        .map(|p| {
            json!({
                "name": p.name,
                "pid": p.pid,
                "has_window": true,
                "window_title": window_pids.get(&p.pid),
            })
        })
        .collect();
    items.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .cmp(&b["name"].as_str().unwrap_or_default().to_lowercase())
    });
    items.dedup_by(|a, b| a["pid"] == b["pid"]);
    let count = items.len();
    rb.success(
        format!(
            "{count} application process{} with windows.",
            if count == 1 { "" } else { "es" }
        ),
        json!({ "processes": items, "count": count, "scope": "windowed-applications" }),
        VerificationEvidence::verified("process-detected"),
    )
}

#[cfg(windows)]
pub fn get_battery_status() -> ToolResult {
    let rb = ResultBuilder::new("system.get_battery_status");
    #[repr(C)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        system_status_flag: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
    }
    let mut status = SystemPowerStatus {
        ac_line_status: 255,
        battery_flag: 255,
        battery_life_percent: 255,
        system_status_flag: 0,
        battery_life_time: u32::MAX,
        battery_full_life_time: u32::MAX,
    };
    let ok = unsafe { GetSystemPowerStatus(&mut status) };
    if ok == 0 {
        return rb.error(
            "power-status-failed",
            "Windows did not return power status.",
            true,
        );
    }
    if status.battery_flag == 128 {
        return rb.success(
            "This device has no battery (desktop power).",
            json!({ "has_battery": false, "ac_power": status.ac_line_status == 1 }),
            VerificationEvidence::verified("state-readback"),
        );
    }
    let percent = if status.battery_life_percent == 255 {
        None
    } else {
        Some(status.battery_life_percent as u32)
    };
    let charging = status.ac_line_status == 1;
    let summary = match percent {
        Some(p) => format!(
            "Battery at {p}%{}.",
            if charging { ", charging" } else { "" }
        ),
        None => "Battery level unknown.".into(),
    };
    rb.success(
        summary,
        json!({
            "has_battery": true,
            "percent": percent,
            "charging": charging,
        }),
        VerificationEvidence::verified("state-readback"),
    )
}

#[cfg(not(windows))]
pub fn get_battery_status() -> ToolResult {
    ResultBuilder::new("system.get_battery_status")
        .unsupported("Battery status is only supported on Windows.")
}

pub fn get_audio_status() -> ToolResult {
    // Honest: WASAPI volume readout is not implemented yet. Do not fake it.
    ResultBuilder::new("system.get_audio_status")
        .unsupported("Audio device status is not implemented yet on this build.")
}
