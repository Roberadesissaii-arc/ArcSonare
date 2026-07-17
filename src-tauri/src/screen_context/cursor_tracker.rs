//! Global cursor position tracker while Screen Context is active.
//!
//! Polls at ~60 Hz on Windows, slows when stationary, and stops immediately
//! when Screen Context stops. Never persists samples — only emits live events
//! for the click-through edge overlays (companion cursor + trail).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const CURSOR_EVENT: &str = "sonare:cursor-sample";

static RUNNING: OnceLock<AtomicBool> = OnceLock::new();

fn running_flag() -> &'static AtomicBool {
    RUNNING.get_or_init(|| AtomicBool::new(false))
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CursorSample {
    pub timestamp: u64,
    pub virtual_x: i32,
    pub virtual_y: i32,
    pub buttons: CursorButtons,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CursorButtons {
    pub left: bool,
    pub right: bool,
    pub middle: bool,
}

#[cfg(windows)]
#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

#[cfg(windows)]
fn read_cursor() -> Option<(i32, i32, CursorButtons)> {
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(lp_point: *mut Point) -> i32;
        fn GetAsyncKeyState(v_key: i32) -> i16;
    }
    const VK_LBUTTON: i32 = 0x01;
    const VK_RBUTTON: i32 = 0x02;
    const VK_MBUTTON: i32 = 0x04;

    let mut pt = Point { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut pt) };
    if ok == 0 {
        return None;
    }
    let buttons = CursorButtons {
        left: unsafe { GetAsyncKeyState(VK_LBUTTON) } as u16 & 0x8000 != 0,
        right: unsafe { GetAsyncKeyState(VK_RBUTTON) } as u16 & 0x8000 != 0,
        middle: unsafe { GetAsyncKeyState(VK_MBUTTON) } as u16 & 0x8000 != 0,
    };
    Some((pt.x, pt.y, buttons))
}

#[cfg(not(windows))]
fn read_cursor() -> Option<(i32, i32, CursorButtons)> {
    None
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Starts the tracker thread if it is not already running.
pub fn start(app: &AppHandle) {
    let flag = running_flag();
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    thread::spawn(move || {
        let mut last_x = i32::MIN;
        let mut last_y = i32::MIN;
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        while flag.load(Ordering::SeqCst) {
            let Some((x, y, buttons)) = read_cursor() else {
                thread::sleep(Duration::from_millis(32));
                continue;
            };
            let moved = x != last_x || y != last_y;
            let interval = if moved {
                Duration::from_millis(16)
            } else {
                Duration::from_millis(80)
            };
            if moved || last_emit.elapsed() >= Duration::from_millis(200) {
                let sample = CursorSample {
                    timestamp: now_ms(),
                    virtual_x: x,
                    virtual_y: y,
                    buttons,
                };
                if let Err(e) = handle.emit(CURSOR_EVENT, &sample) {
                    log::debug!("cursor sample emit failed: {e}");
                }
                last_x = x;
                last_y = y;
                last_emit = Instant::now();
            }
            thread::sleep(interval);
        }
    });
}

/// Stops cursor polling immediately.
pub fn stop() {
    running_flag().store(false, Ordering::SeqCst);
}
