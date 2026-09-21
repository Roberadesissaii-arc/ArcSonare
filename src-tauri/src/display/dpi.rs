//! What DPI context this process actually runs under, measured rather than assumed.
//!
//! Root cause RC1 was recorded as "the process never declares DPI awareness"
//! because nothing in the repository sets it. That is true of the repository,
//! but not necessarily of the running process: `tauri-build` embeds a default
//! Windows manifest, and Tauri may set an awareness context itself.
//!
//! Guessing either way is how a coordinate bug gets "fixed" into a worse one —
//! declaring awareness that is already declared changes nothing, and applying a
//! manual scale correction on top of an already-correct API doubles the error.
//! So this measures the context and cross-checks two independent coordinate
//! sources against each other.

#![cfg(windows)]

use serde::Serialize;

type Handle = isize;

// DPI_AWARENESS_CONTEXT values are sentinel handles, not enum members.
const UNAWARE: Handle = -1;
const SYSTEM_AWARE: Handle = -2;
const PER_MONITOR_AWARE: Handle = -3;
const PER_MONITOR_AWARE_V2: Handle = -4;
const UNAWARE_GDISCALED: Handle = -5;

const SM_XVIRTUALSCREEN: i32 = 76;
const SM_YVIRTUALSCREEN: i32 = 77;
const SM_CXVIRTUALSCREEN: i32 = 78;
const SM_CYVIRTUALSCREEN: i32 = 79;

#[link(name = "user32")]
extern "system" {
    fn GetThreadDpiAwarenessContext() -> Handle;
    fn AreDpiAwarenessContextsEqual(a: Handle, b: Handle) -> i32;
    fn GetSystemMetrics(index: i32) -> i32;
    fn SetProcessDpiAwarenessContext(ctx: Handle) -> i32;
}

#[derive(Debug, Clone, Serialize)]
pub struct DpiReport {
    /// Human-readable awareness context of the calling thread.
    pub awareness: String,
    /// True when the process reports per-monitor awareness (V1 or V2).
    pub per_monitor: bool,
    /// Virtual desktop as Win32 sees it.
    pub win32_virtual: (i32, i32, i32, i32),
    /// Virtual desktop as computed from the xcap monitor list.
    pub xcap_virtual: (i32, i32, i32, i32),
    /// True when both sources agree. Disagreement means one of them is being
    /// DPI-virtualised, and every coordinate crossing between them is wrong.
    pub sources_agree: bool,
}

fn awareness_name() -> (String, bool) {
    unsafe {
        let ctx = GetThreadDpiAwarenessContext();
        for (value, name, per_monitor) in [
            (PER_MONITOR_AWARE_V2, "per-monitor-v2", true),
            (PER_MONITOR_AWARE, "per-monitor-v1", true),
            (SYSTEM_AWARE, "system-aware", false),
            (UNAWARE_GDISCALED, "unaware-gdi-scaled", false),
            (UNAWARE, "unaware", false),
        ] {
            if AreDpiAwarenessContextsEqual(ctx, value) != 0 {
                return (name.to_string(), per_monitor);
            }
        }
        (format!("unknown({ctx})"), false)
    }
}

/// Measure the process DPI context and cross-check the two coordinate sources.
pub fn report() -> DpiReport {
    let (awareness, per_monitor) = awareness_name();

    let win32_virtual = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };

    let xcap_virtual = match super::topology::read_topology() {
        Ok(t) => (
            t.virtual_desktop.left,
            t.virtual_desktop.top,
            t.virtual_desktop.width as i32,
            t.virtual_desktop.height as i32,
        ),
        Err(_) => (0, 0, 0, 0),
    };

    // Win32 and xcap must describe the same desktop. If they differ, one is
    // reporting scaled coordinates and mapping between them is unsound.
    let sources_agree = win32_virtual == xcap_virtual;

    DpiReport {
        awareness,
        per_monitor,
        win32_virtual,
        xcap_virtual,
        sources_agree,
    }
}

/// Ask Windows for per-monitor-v2, if it is not already in effect.
///
/// Must run before any window exists. Returns whether the context is
/// per-monitor afterwards. Failure is not fatal: when the embedded manifest has
/// already set awareness, this call is rejected and the manifest value stands,
/// which is the correct outcome.
pub fn ensure_per_monitor_v2() -> bool {
    let (_, already) = awareness_name();
    if already {
        return true;
    }
    unsafe {
        SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2);
    }
    awareness_name().1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_process_dpi_context_is_reported_and_sources_agree() {
        let r = report();
        eprintln!(
            "DPI awareness: {} (per-monitor: {})",
            r.awareness, r.per_monitor
        );
        eprintln!("win32 virtual desktop: {:?}", r.win32_virtual);
        eprintln!("xcap  virtual desktop: {:?}", r.xcap_virtual);
        eprintln!("sources agree: {}", r.sources_agree);

        // A mismatch here is the actual RC1 symptom: two APIs describing the
        // same desktop differently because one is being virtualised.
        assert!(
            r.sources_agree,
            "Win32 and xcap disagree about the virtual desktop — coordinates \
             crossing between them cannot be trusted. win32={:?} xcap={:?}",
            r.win32_virtual, r.xcap_virtual
        );
    }
}
