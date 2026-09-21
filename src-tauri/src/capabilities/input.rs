//! Pointer input: move + click at absolute screen coordinates.
//! Used by vision-guided UI clicks (Gemini finds the target; we click it).

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};

use super::types::{ResultBuilder, ToolResult, VerificationEvidence};

/// The only coordinate space `input.click_at` accepts.
///
/// Spelled out in the payload rather than assumed. Two numbers called `x` and
/// `y` have meant model-normalised, screenshot, CSS, display-local and desktop
/// pixels at various points in this codebase, and every confusion between them
/// produced a click somewhere nobody asked for. A caller that cannot say which
/// space it is in does not know where it is clicking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Inputcoordinate_space {
    /// Final physical pixels on the virtual desktop, origin at the primary
    /// monitor's top-left, negative to the left of and above it.
    PhysicalVirtualDesktop,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClickAtArgs {
    pub x: i32,
    pub y: i32,
    /// left | right | double â€” default left
    #[serde(default)]
    pub button: Option<String>,
    /// Which space `x` and `y` are in. Mandatory: there is exactly one accepted
    /// value, and requiring it means a caller has to have thought about which
    /// space it is in rather than have desktop pixels assumed on its behalf.
    pub coordinate_space: Inputcoordinate_space,
}

// `mouse_monitor_bounds` used to live here: it reported the origin of whichever
// monitor the pointer happened to be on, and the vision path used that as the
// coordinate origin for a screenshot taken from some *other* monitor. That is
// removed rather than fixed â€” where a screenshot came from is a property of the
// screenshot, recorded at capture time in `display::frame::CapturedFrame`, and
// there is no correct way to recover it from the cursor.

/// Read the pointer position. Verification and diagnostics only.
///
/// Nothing may use this to decide *where* to act. It exists so a move can be
/// checked afterwards, which is the opposite direction of the old fallback.
pub fn read_cursor_position() -> Option<(i32, i32)> {
    cursor_pos().ok()
}

/// Put the pointer somewhere. No click, no glide, no verification.
pub fn set_cursor_position(x: i32, y: i32) -> Result<(), String> {
    move_cursor(x, y)
}

/// Click at an already-validated desktop point.
///
/// Exposed for `display::visual_commands`, which has resolved the point through
/// the frame registry. Callers that have not done that should not be clicking.
pub fn click_at_point(x: i32, y: i32, button: &str) -> Result<(), String> {
    perform_click(x, y, button)
}

/// Click a raw desktop point, if the display containing it has been verified.
///
/// **Gated, and deliberately not corrected.** The profile's affine correction
/// belongs earlier in the pipeline â€” `visual_commands::resolve` applies it while
/// converting a model answer into a desktop point. A caller here is handing over
/// a *final* desktop coordinate, so applying the correction again would move the
/// click a second time. This path therefore checks the profile is valid and
/// clicks exactly where it was told.
pub fn click_at<R: Runtime>(app: &AppHandle<R>, args: ClickAtArgs) -> ToolResult {
    let rb = ResultBuilder::new("input.click_at");
    let button = args
        .button
        .as_deref()
        .unwrap_or("left")
        .trim()
        .to_ascii_lowercase();
    if !matches!(button.as_str(), "left" | "right" | "double") {
        return rb.error(
            "invalid-arguments",
            "button must be left, right, or double.",
            true,
        );
    }
    // Any other space is rejected by serde before this point: the enum has one
    // variant and the field is required, so a caller sending model or screenshot
    // pixels fails to deserialise rather than being quietly reinterpreted into a
    // plausible-looking wrong click.
    debug_assert_eq!(
        args.coordinate_space,
        Inputcoordinate_space::PhysicalVirtualDesktop
    );

    // A click is a visual action wherever it comes from. The gate answers with
    // an `AuthorizedPoint` or a typed refusal — and the click below cannot be
    // reached without the former, so a refusal injects nothing by construction
    // rather than by the order of the statements.
    #[cfg(windows)]
    let authorized = match crate::display::gate::authorize_desktop_point(app, args.x, args.y) {
        Ok(p) => p,
        Err(e) => {
            // The typed code survives the capability boundary. Previously every
            // one of eleven distinct reasons became `display-not-verified`,
            // which the planner could not act on and the UI could not explain.
            return rb.error_with(
                e.code.as_str(),
                e.message.clone(),
                e.allows_automatic_retry,
                Some(e.recommended_action.clone()),
                serde_json::to_value(&e).ok(),
            );
        }
    };
    #[cfg(not(windows))]
    let _ = app;

    #[cfg(windows)]
    let outcome = {
        use crate::display::side_effects::VisualSideEffects;
        crate::display::side_effects::NativeSideEffects.click(
            authorized,
            crate::display::side_effects::MouseButton::from_str(&button),
        )
    };
    #[cfg(not(windows))]
    let outcome = perform_click(args.x, args.y, &button);

    match outcome {
        Ok(()) => rb.success(
            format!("Clicked at ({}, {}).", args.x, args.y),
            json!({
                "x": args.x,
                "y": args.y,
                "button": button,
            }),
            VerificationEvidence::verified("return-code"),
        ),
        Err(e) => rb.error("click-failed", e, true),
    }
}

#[cfg(windows)]
fn cursor_pos() -> Result<(i32, i32), String> {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(lp_point: *mut Point) -> i32;
    }
    let mut p = Point { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut p) };
    if ok == 0 {
        return Err("GetCursorPos failed.".into());
    }
    Ok((p.x, p.y))
}

#[cfg(not(windows))]
fn cursor_pos() -> Result<(i32, i32), String> {
    Err("Cursor position is only available on Windows.".into())
}

#[cfg(windows)]
fn move_cursor(x: i32, y: i32) -> Result<(), String> {
    #[link(name = "user32")]
    extern "system" {
        fn SetCursorPos(x: i32, y: i32) -> i32;
    }
    if unsafe { SetCursorPos(x, y) } == 0 {
        return Err("SetCursorPos failed.".into());
    }
    // The OS needs a moment to settle the move before anything reads it back.
    std::thread::sleep(std::time::Duration::from_millis(30));
    Ok(())
}

#[cfg(not(windows))]
fn move_cursor(_x: i32, _y: i32) -> Result<(), String> {
    Err("Cursor movement is only available on Windows.".into())
}

#[cfg(windows)]
fn perform_click(x: i32, y: i32, button: &str) -> Result<(), String> {
    #[link(name = "user32")]
    extern "system" {
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn mouse_event(dw_flags: u32, dx: u32, dy: u32, dw_data: u32, dw_extra_info: usize);
    }
    const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
    const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
    const MOUSEEVENTF_RIGHTDOWN: u32 = 0x0008;
    const MOUSEEVENTF_RIGHTUP: u32 = 0x0010;

    // Smooth glide from current cursor â†’ target so the user sees ArcSonare "point".
    let (sx, sy) = cursor_pos().unwrap_or((x, y));
    let steps = 20i32;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        // Ease-out cubic
        let ease = 1.0 - (1.0 - t).powi(3);
        let cx = (sx as f64 + (x - sx) as f64 * ease).round() as i32;
        let cy = (sy as f64 + (y - sy) as f64 * ease).round() as i32;
        let ok = unsafe { SetCursorPos(cx, cy) };
        if ok == 0 {
            return Err("SetCursorPos failed.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(12));
    }
    let ok = unsafe { SetCursorPos(x, y) };
    if ok == 0 {
        return Err("SetCursorPos failed.".into());
    }
    // Brief settle so the OS registers the move before the click.
    std::thread::sleep(std::time::Duration::from_millis(40));

    match button {
        "right" => unsafe {
            mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
        },
        "double" => unsafe {
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            std::thread::sleep(std::time::Duration::from_millis(40));
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        },
        _ => unsafe {
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        },
    }
    Ok(())
}

#[cfg(not(windows))]
fn perform_click(_x: i32, _y: i32, _button: &str) -> Result<(), String> {
    Err("Click is only available on Windows.".into())
}

// ---------------------------------------------------------------------------
// Keyboard + scroll
//
// These are what turn "look at the screen" into "use the screen": type into a
// field, press Ctrl+C / Ctrl+V, Tab between form fields, scroll a page.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypeTextArgs {
    /// Text to type into whatever currently has focus.
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PressKeysArgs {
    /// A chord like "ctrl+c", "ctrl+shift+n", "enter", "tab", "f5".
    pub keys: String,
    /// How many times to send it. Default 1.
    #[serde(default)]
    pub repeat: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScrollArgs {
    /// up | down | left | right
    pub direction: String,
    /// Notches; one notch is a typical wheel click. Default 3.
    #[serde(default)]
    pub amount: Option<i32>,
}

pub fn type_text<R: Runtime>(_app: &AppHandle<R>, args: TypeTextArgs) -> ToolResult {
    let rb = ResultBuilder::new("input.type_text");
    if args.text.is_empty() {
        return rb.error("invalid-arguments", "text is empty.", true);
    }
    if args.text.chars().count() > 10_000 {
        return rb.error("invalid-arguments", "text is too long to type.", true);
    }
    match send_unicode_text(&args.text) {
        Ok(n) => rb.success(
            format!("Typed {n} characters."),
            json!({ "characters": n }),
            VerificationEvidence::verified("return-code"),
        ),
        Err(e) => rb.error("type-failed", e, true),
    }
}

pub fn press_keys<R: Runtime>(_app: &AppHandle<R>, args: PressKeysArgs) -> ToolResult {
    let rb = ResultBuilder::new("input.press_keys");
    let repeat = args.repeat.unwrap_or(1).clamp(1, 50);
    let chord = args.keys.trim().to_ascii_lowercase();
    if chord.is_empty() {
        return rb.error("invalid-arguments", "keys is empty.", true);
    }
    for _ in 0..repeat {
        if let Err(e) = send_chord(&chord) {
            return rb.error("keys-failed", e, true);
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    rb.success(
        format!(
            "Pressed {chord}{}.",
            if repeat > 1 {
                format!(" Ã—{repeat}")
            } else {
                String::new()
            }
        ),
        json!({ "keys": chord, "repeat": repeat }),
        VerificationEvidence::verified("return-code"),
    )
}

pub fn scroll<R: Runtime>(_app: &AppHandle<R>, args: ScrollArgs) -> ToolResult {
    let rb = ResultBuilder::new("input.scroll");
    let dir = args.direction.trim().to_ascii_lowercase();
    if !matches!(dir.as_str(), "up" | "down" | "left" | "right") {
        return rb.error(
            "invalid-arguments",
            "direction must be up, down, left, or right.",
            true,
        );
    }
    let amount = args.amount.unwrap_or(3).clamp(1, 30);
    match send_scroll(&dir, amount) {
        Ok(()) => rb.success(
            format!("Scrolled {dir} {amount}."),
            json!({ "direction": dir, "amount": amount }),
            VerificationEvidence::verified("return-code"),
        ),
        Err(e) => rb.error("scroll-failed", e, true),
    }
}

// --- Windows keyboard/scroll plumbing --------------------------------------
//
// Typing goes through KEYEVENTF_UNICODE rather than virtual-key codes: it sends
// the character itself, so it is independent of the user's keyboard layout. A
// vk-based approach types the wrong characters on any non-US layout.

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct KeybdInput {
    w_vk: u16,
    w_scan: u16,
    dw_flags: u32,
    time: u32,
    dw_extra_info: usize,
}

#[cfg(windows)]
#[repr(C)]
struct InputRecord {
    r#type: u32,
    // Union padded to the largest member (MOUSEINPUT). Keyboard uses the head.
    ki: KeybdInput,
    _pad: [u8; 8],
}

#[cfg(windows)]
const INPUT_KEYBOARD: u32 = 1;
#[cfg(windows)]
const KEYEVENTF_KEYUP: u32 = 0x0002;
#[cfg(windows)]
const KEYEVENTF_UNICODE: u32 = 0x0004;

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn SendInput(c_inputs: u32, p_inputs: *const InputRecord, cb_size: i32) -> u32;
    fn keybd_event(b_vk: u8, b_scan: u8, dw_flags: u32, dw_extra_info: usize);
    fn mouse_event(dw_flags: u32, dx: u32, dy: u32, dw_data: u32, dw_extra_info: usize);
}

#[cfg(windows)]
fn send_unicode_text(text: &str) -> Result<usize, String> {
    let mut typed = 0usize;
    for ch in text.chars() {
        // Characters outside the BMP need both surrogate halves.
        let mut buf = [0u16; 2];
        for unit in ch.encode_utf16(&mut buf).iter() {
            let mk = |flags: u32| InputRecord {
                r#type: INPUT_KEYBOARD,
                ki: KeybdInput {
                    w_vk: 0,
                    w_scan: *unit,
                    dw_flags: KEYEVENTF_UNICODE | flags,
                    time: 0,
                    dw_extra_info: 0,
                },
                _pad: [0; 8],
            };
            let events = [mk(0), mk(KEYEVENTF_KEYUP)];
            let sent = unsafe {
                SendInput(
                    events.len() as u32,
                    events.as_ptr(),
                    std::mem::size_of::<InputRecord>() as i32,
                )
            };
            if sent == 0 {
                return Err("SendInput was blocked (the focused window may be elevated).".into());
            }
        }
        typed += 1;
        // A short gap keeps browsers and Electron apps from dropping keys.
        std::thread::sleep(std::time::Duration::from_millis(4));
    }
    Ok(typed)
}

/// Type text into whatever currently has focus.
///
/// Exposed for adapters that have *already* focused a specific window and
/// verified it. Callers must not reach this without doing both: `SendInput`
/// goes to the foreground window, so typing without a verified focus sends the
/// text wherever the user happened to click.
pub fn type_unicode_text(text: &str) -> Result<(), String> {
    send_unicode_text(text).map(|_| ())
}

/// Press Enter. Same contract as `type_unicode_text` — focus first.
pub fn press_enter() -> Result<(), String> {
    send_chord("enter")
}

/// Press one key chord. Same contract as `type_unicode_text` — focus first.
pub fn press_chord(chord: &str) -> Result<(), String> {
    send_chord(chord)
}

/// Map a chord token to a Windows virtual-key code.
#[cfg(windows)]
fn vk_for(token: &str) -> Option<u8> {
    let vk = match token {
        "ctrl" | "control" => 0x11,
        "shift" => 0x10,
        "alt" => 0x12,
        "win" | "super" | "meta" => 0x5B,
        "enter" | "return" => 0x0D,
        "tab" => 0x09,
        "esc" | "escape" => 0x1B,
        "space" => 0x20,
        "backspace" => 0x08,
        "delete" | "del" => 0x2E,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        _ if token.len() == 1 => {
            let b = token.as_bytes()[0];
            // Letters and digits map straight onto their ASCII virtual-keys.
            if b.is_ascii_alphabetic() {
                return Some(b.to_ascii_uppercase());
            }
            if b.is_ascii_digit() {
                return Some(b);
            }
            return None;
        }
        _ => {
            // f1..f24
            if let Some(n) = token.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()) {
                if (1..=24).contains(&n) {
                    return Some(0x70 + n - 1);
                }
            }
            return None;
        }
    };
    Some(vk)
}

#[cfg(windows)]
fn send_chord(chord: &str) -> Result<(), String> {
    let tokens: Vec<&str> = chord
        .split('+')
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return Err("empty key chord".into());
    }
    let mut vks = Vec::with_capacity(tokens.len());
    for t in &tokens {
        match vk_for(t) {
            Some(vk) => vks.push(vk),
            None => return Err(format!("unknown key \"{t}\"")),
        }
    }
    // Press in order (modifiers first, as written), release in reverse.
    for vk in &vks {
        unsafe { keybd_event(*vk, 0, 0, 0) };
    }
    std::thread::sleep(std::time::Duration::from_millis(20));
    for vk in vks.iter().rev() {
        unsafe { keybd_event(*vk, 0, KEYEVENTF_KEYUP, 0) };
    }
    Ok(())
}

#[cfg(windows)]
fn send_scroll(direction: &str, amount: i32) -> Result<(), String> {
    const MOUSEEVENTF_WHEEL: u32 = 0x0800;
    const MOUSEEVENTF_HWHEEL: u32 = 0x1000;
    const WHEEL_DELTA: i32 = 120;
    let (flag, sign) = match direction {
        "up" => (MOUSEEVENTF_WHEEL, 1),
        "down" => (MOUSEEVENTF_WHEEL, -1),
        "right" => (MOUSEEVENTF_HWHEEL, 1),
        "left" => (MOUSEEVENTF_HWHEEL, -1),
        _ => return Err("bad direction".into()),
    };
    for _ in 0..amount {
        unsafe { mouse_event(flag, 0, 0, (sign * WHEEL_DELTA) as u32, 0) };
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    Ok(())
}

#[cfg(not(windows))]
fn send_unicode_text(_text: &str) -> Result<usize, String> {
    Err("Typing is only implemented on Windows.".into())
}
#[cfg(not(windows))]
fn send_chord(_chord: &str) -> Result<(), String> {
    Err("Key presses are only implemented on Windows.".into())
}
#[cfg(not(windows))]
fn send_scroll(_direction: &str, _amount: i32) -> Result<(), String> {
    Err("Scrolling is only implemented on Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Result<ClickAtArgs, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// The contract: a caller has to say which space it is in.
    #[test]
    fn a_click_without_a_coordinate_space_is_refused_before_it_reaches_windows() {
        assert!(
            parse(r#"{"x":100,"y":200}"#).is_err(),
            "omitting the space must not default to desktop pixels â€” that is the \
             assumption that turns screenshot coordinates into a real click"
        );
    }

    #[test]
    fn only_physical_virtual_desktop_pixels_are_accepted() {
        let ok = parse(r#"{"x":100,"y":200,"coordinate_space":"physical-virtual-desktop"}"#)
            .expect("the one supported space must parse");
        assert_eq!(
            ok.coordinate_space,
            Inputcoordinate_space::PhysicalVirtualDesktop
        );

        for wrong in [
            "screenshot",
            "display-local",
            "css",
            "logical",
            "model-normalized",
        ] {
            let json = format!(r#"{{"x":1,"y":2,"coordinate_space":"{wrong}"}}"#);
            assert!(
                parse(&json).is_err(),
                "{wrong} must be rejected rather than reinterpreted"
            );
        }
    }

    /// Nothing in the payload can ask to skip the display-profile gate.
    ///
    /// `deny_unknown_fields` is what enforces this: a model that invents
    /// `skip_profile_check` or `authority` fails to deserialise rather than
    /// having the field quietly ignored â€” which would look identical from the
    /// outside but leave the door visible in the schema.
    #[test]
    fn a_payload_cannot_request_a_bypass() {
        for forged in [
            r#"{"x":1,"y":2,"coordinate_space":"physical-virtual-desktop","skip_profile_check":true}"#,
            r#"{"x":1,"y":2,"coordinate_space":"physical-virtual-desktop","authority":"internal-diagnostic"}"#,
            r#"{"x":1,"y":2,"coordinate_space":"physical-virtual-desktop","session_id":"dmw-1"}"#,
        ] {
            assert!(parse(forged).is_err(), "{forged} must not deserialise");
        }
    }

    #[test]
    fn the_button_defaults_to_left_and_is_optional() {
        let args = parse(r#"{"x":1,"y":2,"coordinate_space":"physical-virtual-desktop"}"#).unwrap();
        assert!(args.button.is_none());
    }
}
