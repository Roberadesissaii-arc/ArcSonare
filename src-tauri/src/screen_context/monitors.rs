//! Real monitor enumeration via xcap (id, bounds, scale, primary flag).

use serde::Serialize;
use xcap::Monitor;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub is_primary: bool,
}

pub fn all() -> Result<Vec<MonitorInfo>, String> {
    let monitors = Monitor::all().map_err(|e| format!("Could not enumerate monitors: {e}"))?;
    let mut out = Vec::new();
    for monitor in monitors {
        match describe(&monitor) {
            Ok(info) => out.push(info),
            Err(e) => log::warn!("skipping monitor that failed to describe itself: {e}"),
        }
    }
    if out.is_empty() {
        return Err("No monitors could be enumerated.".into());
    }
    Ok(out)
}

pub fn by_id(id: &str) -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| format!("Could not enumerate monitors: {e}"))?;
    for monitor in monitors {
        if let Ok(mid) = monitor.id() {
            if mid.to_string() == id {
                return Ok(monitor);
            }
        }
    }
    Err(format!("Monitor '{id}' was not found."))
}

pub fn describe(monitor: &Monitor) -> Result<MonitorInfo, String> {
    let err = |e: xcap::XCapError| format!("monitor property unavailable: {e}");
    Ok(MonitorInfo {
        id: monitor.id().map_err(err)?.to_string(),
        name: monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .unwrap_or_else(|_| "Display".into()),
        x: monitor.x().map_err(err)?,
        y: monitor.y().map_err(err)?,
        width: monitor.width().map_err(err)?,
        height: monitor.height().map_err(err)?,
        scale_factor: monitor.scale_factor().unwrap_or(1.0),
        is_primary: monitor.is_primary().unwrap_or(false),
    })
}

#[tauri::command]
pub fn list_monitors() -> Result<Vec<MonitorInfo>, String> {
    all()
}
