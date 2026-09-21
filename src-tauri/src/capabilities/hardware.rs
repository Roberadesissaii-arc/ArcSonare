//! Volume, screen brightness and screen recording.
//!
//! Each of these uses the mechanism Windows actually exposes rather than the
//! one that sounds tidiest:
//!
//!  * Volume goes through the media keys. Absolute level needs COM
//!    (IAudioEndpointVolume); the media keys are always present, need no
//!    elevation, and move the same system volume the user sees.
//!  * Brightness goes through WMI, which is the only interface that works on
//!    laptop panels. It is genuinely unavailable on most desktop monitors, and
//!    this says so rather than silently doing nothing.
//!  * Recording drives the Game Bar capture that ships with Windows, because
//!    ArcSonare bundles no encoder.

use serde::Deserialize;
use serde_json::json;

use super::types::{ResultBuilder, ToolResult, VerificationEvidence};

#[derive(Debug, Deserialize)]
pub struct VolumeArgs {
    /// "up", "down", "mute", "unmute"
    pub direction: String,
    /// How many 2% steps to move. Defaults to 5 (~10%).
    #[serde(default)]
    pub steps: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct BrightnessArgs {
    /// Target percentage 0-100, or omit and use `direction`.
    #[serde(default)]
    pub level: Option<i32>,
    /// "up" or "down" when no explicit level is given.
    #[serde(default)]
    pub direction: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RecordArgs {
    /// "start" or "stop"
    pub action: String,
}

#[cfg(windows)]
mod keys {
    pub const VOLUME_MUTE: u8 = 0xAD;
    pub const VOLUME_DOWN: u8 = 0xAE;
    pub const VOLUME_UP: u8 = 0xAF;
    pub const LWIN: u8 = 0x5B;
    pub const MENU: u8 = 0x12; // Alt
    pub const KEY_R: u8 = 0x52;

    const KEYEVENTF_KEYUP: u32 = 0x0002;

    #[link(name = "user32")]
    extern "system" {
        fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
    }

    pub fn tap(vk: u8) {
        unsafe {
            keybd_event(vk, 0, 0, 0);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        }
    }

    pub fn down(vk: u8) {
        unsafe { keybd_event(vk, 0, 0, 0) };
    }

    pub fn up(vk: u8) {
        unsafe { keybd_event(vk, 0, KEYEVENTF_KEYUP, 0) };
    }
}

/// Nudge the system volume, or mute it.
pub fn set_volume(args: VolumeArgs) -> ToolResult {
    let rb = ResultBuilder::new("system.set_volume");
    #[cfg(not(windows))]
    {
        let _ = args;
        return rb.error("not-supported", "Volume control is Windows only.", false);
    }
    #[cfg(windows)]
    {
        // Each media-key press moves Windows' volume by 2%.
        let steps = args.steps.unwrap_or(5).min(50);
        let direction = args.direction.to_lowercase();
        let (vk, summary) = match direction.as_str() {
            "up" | "increase" | "louder" => (
                keys::VOLUME_UP,
                format!("Turned the volume up {}%.", steps * 2),
            ),
            "down" | "decrease" | "quieter" | "lower" => (
                keys::VOLUME_DOWN,
                format!("Turned the volume down {}%.", steps * 2),
            ),
            // Mute is a toggle at the OS level, so both words hit the same key.
            "mute" => (keys::VOLUME_MUTE, "Muted the volume.".to_string()),
            "unmute" => (keys::VOLUME_MUTE, "Unmuted the volume.".to_string()),
            other => {
                return rb.error(
                    "invalid-arguments",
                    format!("\"{other}\" is not a volume direction. Use up, down, mute or unmute."),
                    true,
                )
            }
        };

        let presses = if vk == keys::VOLUME_MUTE { 1 } else { steps };
        for _ in 0..presses {
            keys::tap(vk);
            std::thread::sleep(std::time::Duration::from_millis(12));
        }
        rb.success(
            summary,
            json!({ "direction": direction, "steps": presses }),
            VerificationEvidence::verified_with("media-key-sent", json!({})),
        )
    }
}

/// Read/write laptop panel brightness through WMI.
#[cfg(windows)]
fn powershell(script: &str) -> Result<String, String> {
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("Could not run the brightness helper: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn set_brightness(args: BrightnessArgs) -> ToolResult {
    let rb = ResultBuilder::new("system.set_brightness");
    #[cfg(not(windows))]
    {
        let _ = args;
        return rb.error(
            "not-supported",
            "Brightness control is Windows only.",
            false,
        );
    }
    #[cfg(windows)]
    {
        let current = powershell(
            "(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop).CurrentBrightness",
        );
        let Ok(current_text) = current else {
            // Desktop monitors genuinely do not expose this. Say so plainly
            // instead of reporting a change that never happened.
            return rb.error(
                "not-supported",
                "This display doesn't support software brightness control — that's normal for desktop monitors, it only works on laptop screens.",
                false,
            );
        };
        let current_level: i32 = current_text
            .lines()
            .next()
            .unwrap_or("50")
            .trim()
            .parse()
            .unwrap_or(50);

        let target = match (args.level, args.direction.as_deref()) {
            (Some(level), _) => level.clamp(0, 100),
            (None, Some(d))
                if matches!(d.to_lowercase().as_str(), "up" | "increase" | "brighter") =>
            {
                (current_level + 20).clamp(0, 100)
            }
            (None, Some(d))
                if matches!(d.to_lowercase().as_str(), "down" | "decrease" | "dimmer") =>
            {
                (current_level - 20).clamp(0, 100)
            }
            _ => {
                return rb.error(
                    "invalid-arguments",
                    "Give a level (0-100) or a direction (up / down).",
                    true,
                )
            }
        };

        let script = format!(
            "(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods).WmiSetBrightness(1,{target})"
        );
        if let Err(e) = powershell(&script) {
            return rb.error("brightness-failed", format!("Windows refused: {e}"), true);
        }
        rb.success(
            format!("Set the screen brightness to {target}%."),
            json!({ "level": target, "previous": current_level }),
            VerificationEvidence::verified_with("wmi-set", json!({ "level": target })),
        )
    }
}

/// Start/stop the Game Bar screen recorder (Win+Alt+R).
pub fn screen_record(args: RecordArgs) -> ToolResult {
    let rb = ResultBuilder::new("screen.record");
    #[cfg(not(windows))]
    {
        let _ = args;
        return rb.error("not-supported", "Screen recording is Windows only.", false);
    }
    #[cfg(windows)]
    {
        let action = args.action.to_lowercase();
        if !matches!(action.as_str(), "start" | "stop") {
            return rb.error(
                "invalid-arguments",
                "Use action \"start\" or \"stop\".",
                true,
            );
        }
        // Win+Alt+R toggles capture. ArcSonare ships no encoder, so this drives
        // the recorder Windows already has.
        keys::down(keys::LWIN);
        keys::down(keys::MENU);
        keys::tap(keys::KEY_R);
        keys::up(keys::MENU);
        keys::up(keys::LWIN);
        std::thread::sleep(std::time::Duration::from_millis(400));

        let summary = if action == "start" {
            "Started recording the screen. Windows saves it to Videos\\Captures."
        } else {
            "Stopped recording. The clip is in Videos\\Captures."
        };
        // The hotkey is fire-and-forget: Windows gives back no state, and Game
        // Bar can be disabled entirely, so this is not claimed as verified.
        rb.partial(
            summary.to_string(),
            json!({ "action": action, "folder": "Videos\\Captures" }),
            VerificationEvidence::unverified("hotkey-sent"),
        )
    }
}
