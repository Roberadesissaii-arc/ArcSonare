//! Which physical monitor this is, in a way that survives a restart.
//!
//! Display mappings have to be remembered across runs, and the obvious key —
//! the display id from `xcap` — is not one. It is an enumeration index handed
//! out per process, and testing showed it changing between restarts with the
//! hardware untouched. A profile keyed on it is silently attached to whichever
//! monitor happened to be enumerated in that slot next time, which is worse than
//! having no profile at all: a wrong mapping is applied confidently.
//!
//! Windows does expose a stable name. Every monitor has a device interface path
//! of the form
//!
//! ```text
//! \\?\DISPLAY#GSM5B09#5&1d2e3f4&0&UID4353#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}
//! ```
//!
//! which encodes the manufacturer, model and the connector it is plugged into.
//! It is derived from the monitor's own EDID, so it is the same string on every
//! boot, and two identical monitors on different ports still differ by `UID`.
//! That is the key profiles are stored under.
//!
//! Getting it means going through the monitor handle rather than the adapter:
//! `\\.\DISPLAY1` is a slot, not a monitor, and it changes when displays are
//! rearranged. `EnumDisplayMonitors` gives the handle, `GetMonitorInfoW` gives
//! the slot name and rectangle, and `EnumDisplayDevicesW` turns the slot into
//! the monitor actually attached to it.

#![cfg(windows)]

use serde::{Deserialize, Serialize};

use super::topology::DisplayTopology;

type Handle = isize;

const MONITORINFOF_PRIMARY: u32 = 0x01;
const EDD_GET_DEVICE_INTERFACE_NAME: u32 = 0x0000_0001;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct MonitorInfoExW {
    cb_size: u32,
    monitor: Rect,
    work: Rect,
    flags: u32,
    device: [u16; 32],
}

#[repr(C)]
struct DisplayDeviceW {
    cb: u32,
    device_name: [u16; 32],
    device_string: [u16; 128],
    state_flags: u32,
    device_id: [u16; 128],
    device_key: [u16; 128],
}

#[link(name = "user32")]
extern "system" {
    fn EnumDisplayMonitors(
        dc: Handle,
        clip: *const Rect,
        callback: unsafe extern "system" fn(Handle, Handle, *mut Rect, isize) -> i32,
        param: isize,
    ) -> i32;
    fn GetMonitorInfoW(monitor: Handle, info: *mut MonitorInfoExW) -> i32;
    fn EnumDisplayDevicesW(
        device: *const u16,
        index: u32,
        display_device: *mut DisplayDeviceW,
        flags: u32,
    ) -> i32;
}

fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// A monitor as Windows names it, independent of how it is currently arranged.
///
/// No longer `Eq`: the runtime scale is a float. Identity comparisons should use
/// `stable_key()` anyway, which is what a profile is filed under.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorIdentity {
    /// The device interface path. Stable across restarts — this is the key.
    pub device_path: String,
    /// "Dell U2720Q" or similar, for showing a person which screen is meant.
    pub friendly_name: String,
    /// `\\.\DISPLAY1`. Diagnostic only: it moves when displays are rearranged.
    pub adapter_slot: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
    /// The monitor's current scale, as Windows reports it now.
    ///
    /// Part of the identity's *runtime state* rather than its hardware identity:
    /// it never contributes to `stable_key()`, because changing the scale does
    /// not make a monitor a different monitor. It is here so `reconcile` can see
    /// it — a profile measured at 100% does not describe the same screen at
    /// 125%, and acting on it puts the cursor a quarter of the way off.
    #[serde(default = "default_scale")]
    pub scale_factor: f64,
    #[serde(default)]
    pub rotation_degrees: i32,
}

fn default_scale() -> f64 {
    1.0
}

impl MonitorIdentity {
    /// What a profile is filed under.
    ///
    /// Falls back to the geometry only when the interface path is unavailable,
    /// which is rare and worth being able to see in a stored profile.
    pub fn stable_key(&self) -> String {
        if self.device_path.is_empty() {
            format!(
                "geometry:{}x{}@{},{}",
                self.width, self.height, self.x, self.y
            )
        } else {
            self.device_path.clone()
        }
    }
}

struct Collector {
    monitors: Vec<MonitorIdentity>,
}

unsafe extern "system" fn visit(
    monitor: Handle,
    _dc: Handle,
    _rect: *mut Rect,
    param: isize,
) -> i32 {
    let collector = &mut *(param as *mut Collector);
    let mut info = MonitorInfoExW {
        cb_size: std::mem::size_of::<MonitorInfoExW>() as u32,
        monitor: Rect::default(),
        work: Rect::default(),
        flags: 0,
        device: [0; 32],
    };
    if GetMonitorInfoW(monitor, &mut info) == 0 {
        return 1; // keep going; one unreadable monitor is not fatal
    }
    let slot = from_wide(&info.device);

    // The slot name identifies an adapter output. Ask what is plugged into it.
    let mut device = DisplayDeviceW {
        cb: std::mem::size_of::<DisplayDeviceW>() as u32,
        device_name: [0; 32],
        device_string: [0; 128],
        state_flags: 0,
        device_id: [0; 128],
        device_key: [0; 128],
    };
    let slot_wide: Vec<u16> = slot.encode_utf16().chain(std::iter::once(0)).collect();
    let got = EnumDisplayDevicesW(
        slot_wide.as_ptr(),
        0,
        &mut device,
        EDD_GET_DEVICE_INTERFACE_NAME,
    );
    let (device_path, friendly_name) = if got != 0 {
        (
            from_wide(&device.device_id),
            from_wide(&device.device_string),
        )
    } else {
        (String::new(), String::new())
    };

    collector.monitors.push(MonitorIdentity {
        // Filled in by `enumerate_monitor_identities` from the topology, which
        // is the one place that already knows every monitor's scale.
        scale_factor: 1.0,
        rotation_degrees: 0,
        device_path,
        friendly_name,
        adapter_slot: slot,
        x: info.monitor.left,
        y: info.monitor.top,
        width: (info.monitor.right - info.monitor.left).max(0) as u32,
        height: (info.monitor.bottom - info.monitor.top).max(0) as u32,
        primary: info.flags & MONITORINFOF_PRIMARY != 0,
    });
    1
}

/// Every monitor currently attached, with its stable name.
pub fn enumerate_monitor_identities() -> Result<Vec<MonitorIdentity>, String> {
    let mut collector = Collector {
        monitors: Vec::new(),
    };
    let ok = unsafe {
        EnumDisplayMonitors(
            0,
            std::ptr::null(),
            visit,
            &mut collector as *mut Collector as isize,
        )
    };
    if ok == 0 && collector.monitors.is_empty() {
        return Err("Windows would not enumerate the attached monitors.".into());
    }
    // Scale and rotation come from the topology rather than a second DPI call,
    // so the number the gate compares is the same one the coordinate maths uses.
    // A monitor the topology does not report keeps the 1.0/0 default; it is
    // matched by origin, which is what the two enumerations already agree on.
    if let Ok(topology) = super::topology::read_topology() {
        for monitor in &mut collector.monitors {
            if let Some(d) = topology
                .displays
                .iter()
                .find(|d| d.x == monitor.x && d.y == monitor.y)
            {
                monitor.scale_factor = d.scale_factor;
                monitor.rotation_degrees = d.rotation as i32;
            }
        }
    }
    Ok(collector.monitors)
}

/// Pair each stable identity with the runtime display id currently standing for it.
///
/// The runtime id is what every other subsystem speaks, and the stable key is
/// what survives a restart. Nothing may persist the former; nothing may act on
/// the latter. This is the only place the two meet, and the mapping is rebuilt
/// on every run rather than stored.
pub fn pair_with_topology(
    identities: &[MonitorIdentity],
    topology: &DisplayTopology,
) -> Vec<(String, u32)> {
    let mut pairs = Vec::new();
    for identity in identities {
        // Position and size are what both sources agree on. Two monitors cannot
        // occupy the same rectangle, so this is unambiguous.
        if let Some(display) = topology.displays.iter().find(|d| {
            d.x == identity.x
                && d.y == identity.y
                && d.width == identity.width
                && d.height == identity.height
        }) {
            pairs.push((identity.stable_key(), display.display_id));
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(path: &str, x: i32, width: u32) -> MonitorIdentity {
        MonitorIdentity {
            scale_factor: 1.0,
            rotation_degrees: 0,
            device_path: path.into(),
            friendly_name: "Test Display".into(),
            adapter_slot: "\\\\.\\DISPLAY1".into(),
            x,
            y: 0,
            width,
            height: 1080,
            primary: x == 0,
        }
    }

    #[test]
    fn a_profile_is_filed_under_the_hardware_path_not_a_slot() {
        let m = identity("\\\\?\\DISPLAY#GSM5B09#5&1d2&0&UID4353#{guid}", 0, 3840);
        assert_eq!(
            m.stable_key(),
            "\\\\?\\DISPLAY#GSM5B09#5&1d2&0&UID4353#{guid}"
        );
        assert!(
            !m.stable_key().contains("DISPLAY1"),
            "the adapter slot moves when displays are rearranged"
        );
    }

    #[test]
    fn without_an_interface_path_the_key_falls_back_to_geometry() {
        let mut m = identity("", -1920, 1920);
        m.device_path = String::new();
        assert_eq!(m.stable_key(), "geometry:1920x1080@-1920,0");
    }

    /// Two identical monitors differ by the connector they are plugged into.
    #[test]
    fn two_identical_monitors_are_still_told_apart() {
        let a = identity("\\\\?\\DISPLAY#GSM5B09#5&1d2&0&UID4353#{guid}", 0, 1920);
        let b = identity("\\\\?\\DISPLAY#GSM5B09#5&1d2&0&UID4354#{guid}", 1920, 1920);
        assert_ne!(a.stable_key(), b.stable_key());
    }
}
