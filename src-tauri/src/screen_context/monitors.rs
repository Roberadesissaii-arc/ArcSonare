//! Monitor lookup used by the shared native capture path.

use xcap::Monitor;

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
