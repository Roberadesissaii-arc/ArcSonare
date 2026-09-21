//! A harmless thing to click at.
//!
//! Every claim about click reliability needs a target whose state can be read
//! back afterwards. Clicking a real application to find out whether clicking
//! works is both unreliable (the app may ignore input, or do something) and
//! unsafe. This is a plain top-level window that counts what it receives and
//! does nothing else — no files, no network, no settings.
//!
//! It is a normal opaque window rather than one of the layered overlays in
//! `native_overlay.rs` for two reasons: those are click-through by design, and
//! a normal window is what a real click target actually looks like to Windows.
//! It is not a Tauri webview because WebView2 gives this process only two, both
//! already spoken for.

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::Mutex;

type Hwnd = isize;

static HWND: AtomicIsize = AtomicIsize::new(0);
static LEFT_CLICKS: AtomicU32 = AtomicU32::new(0);
static RIGHT_CLICKS: AtomicU32 = AtomicU32::new(0);
static DOUBLE_CLICKS: AtomicU32 = AtomicU32::new(0);
/// Clicks that landed in the window but outside the button. Counted separately
/// so "hit the window but missed the target" is distinguishable from a miss.
static OFF_TARGET: AtomicU32 = AtomicU32::new(0);
static VISIBLE: AtomicBool = AtomicBool::new(false);
static LAST_ACTION: Mutex<String> = Mutex::new(String::new());

pub const WINDOW_TITLE: &str = "ArcSonare Visual Interaction Test";
pub const BUTTON_TEST_ID: &str = "arcsonare-test-click-target";
const WINDOW_W: i32 = 460;
const WINDOW_H: i32 = 260;
/// The button, in client coordinates. Deliberately generous: this measures
/// whether the pipeline lands on the right *place*, not pixel precision.
const BUTTON: (i32, i32, i32, i32) = (60, 150, 340, 72);

const WS_EX_TOPMOST: u32 = 0x0000_0008;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const WS_POPUP: u32 = 0x8000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_BORDER: u32 = 0x0080_0000;
const CS_DBLCLKS: u32 = 0x0008;

const SW_HIDE: i32 = 0;
const SW_SHOWNOACTIVATE: i32 = 4;
const SWP_NOACTIVATE: u32 = 0x0010;
const SWP_SHOWWINDOW: u32 = 0x0040;
const HWND_TOPMOST: isize = -1;

const WM_DESTROY: u32 = 0x0002;
const WM_PAINT: u32 = 0x000F;
const WM_LBUTTONDOWN: u32 = 0x0201;
const WM_LBUTTONDBLCLK: u32 = 0x0203;
const WM_RBUTTONDOWN: u32 = 0x0204;
const IDC_ARROW: usize = 32512;
const TRANSPARENT_BK: i32 = 1;
const DT_LEFT: u32 = 0x0000;
const DT_SINGLELINE: u32 = 0x0020;
const DT_VCENTER: u32 = 0x0004;
const DT_CENTER: u32 = 0x0001;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct PaintStruct {
    hdc: isize,
    erase: i32,
    paint: Rect,
    restore: i32,
    inc_update: i32,
    reserved: [u8; 32],
}

#[repr(C)]
struct WndClassExW {
    cb_size: u32,
    style: u32,
    wnd_proc: Option<unsafe extern "system" fn(isize, u32, usize, isize) -> isize>,
    cb_cls_extra: i32,
    cb_wnd_extra: i32,
    instance: isize,
    icon: isize,
    cursor: isize,
    background: isize,
    menu_name: *const u16,
    class_name: *const u16,
    icon_sm: isize,
}

#[link(name = "user32")]
extern "system" {
    fn RegisterClassExW(class: *const WndClassExW) -> u16;
    fn CreateWindowExW(
        ex_style: u32,
        class_name: *const u16,
        window_name: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: isize,
        menu: isize,
        instance: isize,
        param: *const core::ffi::c_void,
    ) -> isize;
    fn DefWindowProcW(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize;
    fn GetMessageW(msg: *mut [u32; 12], hwnd: isize, min: u32, max: u32) -> i32;
    fn TranslateMessage(msg: *const [u32; 12]) -> i32;
    fn DispatchMessageW(msg: *const [u32; 12]) -> isize;
    fn LoadCursorW(instance: isize, name: *const u16) -> isize;
    fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
    fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32)
        -> i32;
    fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
    fn InvalidateRect(hwnd: isize, rect: *const Rect, erase: i32) -> i32;
    fn BeginPaint(hwnd: isize, ps: *mut PaintStruct) -> isize;
    fn EndPaint(hwnd: isize, ps: *const PaintStruct) -> i32;
    fn FillRect(dc: isize, rect: *const Rect, brush: isize) -> i32;
    fn DrawTextW(dc: isize, text: *const u16, count: i32, rect: *mut Rect, format: u32) -> i32;
    fn GetClientRect(hwnd: isize, rect: *mut Rect) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateSolidBrush(color: u32) -> isize;
    fn DeleteObject(obj: isize) -> i32;
    fn SetBkMode(dc: isize, mode: i32) -> i32;
    fn SetTextColor(dc: isize, color: u32) -> u32;
    fn SelectObject(dc: isize, obj: isize) -> isize;
    fn CreateFontW(
        height: i32,
        width: i32,
        escapement: i32,
        orientation: i32,
        weight: i32,
        italic: u32,
        underline: u32,
        strike_out: u32,
        char_set: u32,
        out_precision: u32,
        clip_precision: u32,
        quality: u32,
        pitch_and_family: u32,
        face: *const u16,
    ) -> isize;
}

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(name: *const u16) -> isize;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// COLORREF is 0x00BBGGRR, which is the reverse of how colours are written.
const fn rgb(r: u8, g: u8, b: u8) -> u32 {
    (r as u32) | ((g as u32) << 8) | ((b as u32) << 16)
}

fn set_last_action(action: &str) {
    if let Ok(mut last) = LAST_ACTION.lock() {
        *last = action.to_string();
    }
}

fn point_in_button(x: i32, y: i32) -> bool {
    let (bx, by, bw, bh) = BUTTON;
    x >= bx && y >= by && x < bx + bw && y < by + bh
}

unsafe extern "system" fn wnd_proc(hwnd: isize, msg: u32, _wp: usize, lp: isize) -> isize {
    // Mouse coordinates arrive packed as two signed 16-bit values in lparam.
    let mx = (lp & 0xffff) as u16 as i16 as i32;
    let my = ((lp >> 16) & 0xffff) as u16 as i16 as i32;
    match msg {
        WM_LBUTTONDOWN => {
            if point_in_button(mx, my) {
                LEFT_CLICKS.fetch_add(1, Ordering::SeqCst);
                set_last_action("left-click");
            } else {
                OFF_TARGET.fetch_add(1, Ordering::SeqCst);
                set_last_action("left-click-off-target");
            }
            InvalidateRect(hwnd, std::ptr::null(), 1);
            0
        }
        WM_LBUTTONDBLCLK => {
            // A double-click also delivers a WM_LBUTTONDOWN first, so the left
            // counter has already moved. Recording it separately is what lets a
            // test tell "one click" from "one click that Windows coalesced".
            if point_in_button(mx, my) {
                DOUBLE_CLICKS.fetch_add(1, Ordering::SeqCst);
                set_last_action("double-click");
            }
            InvalidateRect(hwnd, std::ptr::null(), 1);
            0
        }
        WM_RBUTTONDOWN => {
            if point_in_button(mx, my) {
                RIGHT_CLICKS.fetch_add(1, Ordering::SeqCst);
                set_last_action("right-click");
            } else {
                OFF_TARGET.fetch_add(1, Ordering::SeqCst);
                set_last_action("right-click-off-target");
            }
            InvalidateRect(hwnd, std::ptr::null(), 1);
            0
        }
        WM_PAINT => {
            paint(hwnd);
            0
        }
        WM_DESTROY => {
            HWND.store(0, Ordering::SeqCst);
            0
        }
        _ => DefWindowProcW(hwnd, msg, _wp, lp),
    }
}

unsafe fn draw_text(dc: isize, text: &str, rect: &mut Rect, format: u32) {
    let w = wide(text);
    DrawTextW(dc, w.as_ptr(), -1, rect, format);
}

unsafe fn paint(hwnd: isize) {
    let mut ps: PaintStruct = std::mem::zeroed();
    let dc = BeginPaint(hwnd, &mut ps);
    let mut client = Rect::default();
    GetClientRect(hwnd, &mut client);

    let background = CreateSolidBrush(rgb(24, 24, 32));
    FillRect(dc, &client, background);
    DeleteObject(background);

    let clicks = LEFT_CLICKS.load(Ordering::SeqCst);
    let activated = clicks > 0;

    // The button changes colour once activated so a human watching the physical
    // test can see the outcome without reading the counter.
    let (br, bg, bb) = if activated {
        (34, 197, 94)
    } else {
        (99, 102, 241)
    };
    let button_brush = CreateSolidBrush(rgb(br, bg, bb));
    let (bx, by, bw, bh) = BUTTON;
    let button_rect = Rect {
        left: bx,
        top: by,
        right: bx + bw,
        bottom: by + bh,
    };
    FillRect(dc, &button_rect, button_brush);
    DeleteObject(button_brush);

    SetBkMode(dc, TRANSPARENT_BK);
    let face = wide("Segoe UI");
    let title_font = CreateFontW(-20, 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 5, 0, face.as_ptr());
    let body_font = CreateFontW(-16, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, face.as_ptr());
    let button_font = CreateFontW(-18, 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 5, 0, face.as_ptr());

    let old_font = SelectObject(dc, title_font);
    SetTextColor(dc, rgb(244, 244, 250));
    let mut line = Rect {
        left: 24,
        top: 20,
        right: client.right - 24,
        bottom: 50,
    };
    draw_text(dc, WINDOW_TITLE, &mut line, DT_LEFT | DT_SINGLELINE);

    SelectObject(dc, body_font);
    SetTextColor(dc, rgb(168, 170, 190));
    line = Rect {
        left: 24,
        top: 62,
        right: client.right - 24,
        bottom: 88,
    };
    let state = if activated { "Activated" } else { "Ready" };
    draw_text(
        dc,
        &format!("Target state: {state}"),
        &mut line,
        DT_LEFT | DT_SINGLELINE,
    );

    line = Rect {
        left: 24,
        top: 90,
        right: client.right - 24,
        bottom: 116,
    };
    draw_text(
        dc,
        &format!("Clicks received: {clicks}"),
        &mut line,
        DT_LEFT | DT_SINGLELINE,
    );

    line = Rect {
        left: 24,
        top: 116,
        right: client.right - 24,
        bottom: 142,
    };
    let last = LAST_ACTION.lock().map(|l| l.clone()).unwrap_or_default();
    draw_text(
        dc,
        &format!(
            "Last action: {}",
            if last.is_empty() { "none" } else { &last }
        ),
        &mut line,
        DT_LEFT | DT_SINGLELINE,
    );

    SelectObject(dc, button_font);
    SetTextColor(dc, rgb(255, 255, 255));
    let mut label = button_rect;
    draw_text(
        dc,
        "Test Click Target",
        &mut label,
        DT_CENTER | DT_SINGLELINE | DT_VCENTER,
    );

    SelectObject(dc, old_font);
    DeleteObject(title_font);
    DeleteObject(body_font);
    DeleteObject(button_font);
    EndPaint(hwnd, &ps);
}

/// Start the test window's thread. Idempotent; the window stays hidden until
/// something asks for it.
pub fn init() {
    if HWND.load(Ordering::SeqCst) != 0 {
        return;
    }
    std::thread::spawn(|| {
        let class_name = wide("ArcSonareVisualTestTarget");
        let title = wide(WINDOW_TITLE);
        unsafe {
            let class = WndClassExW {
                cb_size: std::mem::size_of::<WndClassExW>() as u32,
                // CS_DBLCLKS is what makes WM_LBUTTONDBLCLK arrive at all.
                style: CS_DBLCLKS,
                wnd_proc: Some(wnd_proc),
                cb_cls_extra: 0,
                cb_wnd_extra: 0,
                instance: GetModuleHandleW(std::ptr::null()),
                icon: 0,
                cursor: LoadCursorW(0, IDC_ARROW as *const u16),
                background: 0,
                menu_name: std::ptr::null(),
                class_name: class_name.as_ptr(),
                icon_sm: 0,
            };
            RegisterClassExW(&class);

            let hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                class_name.as_ptr(),
                title.as_ptr(),
                WS_POPUP | WS_BORDER,
                -20_000,
                -20_000,
                WINDOW_W,
                WINDOW_H,
                0,
                0,
                GetModuleHandleW(std::ptr::null()),
                std::ptr::null(),
            );
            if hwnd == 0 {
                return;
            }
            HWND.store(hwnd, Ordering::SeqCst);

            let mut msg = [0u32; 12];
            while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    });
}

fn wait_for_window() -> Result<Hwnd, String> {
    init();
    for _ in 0..80 {
        let h = HWND.load(Ordering::SeqCst);
        if h != 0 {
            return Ok(h);
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    Err("the visual test window did not start".into())
}

/// Where the window and its button are, in desktop pixels.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestTargetRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestTargetState {
    pub visible: bool,
    pub title: String,
    pub button_test_id: String,
    pub window: Option<TestTargetRect>,
    /// The button in desktop coordinates — what a click test should aim at.
    pub button: Option<TestTargetRect>,
    pub clicks: u32,
    pub right_clicks: u32,
    pub double_clicks: u32,
    pub off_target_clicks: u32,
    pub last_action: String,
    pub state_label: &'static str,
}

fn window_rect(hwnd: Hwnd) -> Option<TestTargetRect> {
    let mut r = Rect::default();
    if unsafe { GetWindowRect(hwnd, &mut r) } == 0 {
        return None;
    }
    Some(TestTargetRect {
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
    })
}

pub fn state() -> TestTargetState {
    let hwnd = HWND.load(Ordering::SeqCst);
    let visible = VISIBLE.load(Ordering::SeqCst) && hwnd != 0;
    let win = if hwnd != 0 { window_rect(hwnd) } else { None };
    // WS_POPUP | WS_BORDER: the client area starts one pixel in on each side.
    let border = 1;
    let button = win.map(|w| TestTargetRect {
        x: w.x + border + BUTTON.0,
        y: w.y + border + BUTTON.1,
        width: BUTTON.2,
        height: BUTTON.3,
    });
    let clicks = LEFT_CLICKS.load(Ordering::SeqCst);
    TestTargetState {
        visible,
        title: WINDOW_TITLE.to_string(),
        button_test_id: BUTTON_TEST_ID.to_string(),
        window: win,
        button: if visible { button } else { None },
        clicks,
        right_clicks: RIGHT_CLICKS.load(Ordering::SeqCst),
        double_clicks: DOUBLE_CLICKS.load(Ordering::SeqCst),
        off_target_clicks: OFF_TARGET.load(Ordering::SeqCst),
        last_action: LAST_ACTION.lock().map(|l| l.clone()).unwrap_or_default(),
        state_label: if clicks > 0 { "Activated" } else { "Ready" },
    }
}

/// Show the window with its top-left at a desktop point.
pub fn show_at(x: i32, y: i32) -> Result<TestTargetState, String> {
    let hwnd = wait_for_window()?;
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            x,
            y,
            WINDOW_W,
            WINDOW_H,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        InvalidateRect(hwnd, std::ptr::null(), 1);
    }
    VISIBLE.store(true, Ordering::SeqCst);
    // Give the compositor a moment: a capture taken immediately can catch the
    // window mid-move, which would look like a stale frame later.
    std::thread::sleep(std::time::Duration::from_millis(180));
    Ok(state())
}

/// Centre the window on a display, given its bounds.
pub fn show_centered_on(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<TestTargetState, String> {
    let cx = x + (width as i32 - WINDOW_W) / 2;
    let cy = y + (height as i32 - WINDOW_H) / 2;
    show_at(cx, cy)
}

pub fn hide() {
    let hwnd = HWND.load(Ordering::SeqCst);
    if hwnd != 0 {
        unsafe { ShowWindow(hwnd, SW_HIDE) };
    }
    VISIBLE.store(false, Ordering::SeqCst);
}

pub fn reset() {
    LEFT_CLICKS.store(0, Ordering::SeqCst);
    RIGHT_CLICKS.store(0, Ordering::SeqCst);
    DOUBLE_CLICKS.store(0, Ordering::SeqCst);
    OFF_TARGET.store(0, Ordering::SeqCst);
    set_last_action("");
    let hwnd = HWND.load(Ordering::SeqCst);
    if hwnd != 0 {
        unsafe { InvalidateRect(hwnd, std::ptr::null(), 1) };
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — diagnostics only.
//
// Nothing user-facing routes here. The window performs no filesystem, network,
// account or destructive action; the worst it can do is count to one.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn visual_test_show(x: i32, y: i32) -> Result<TestTargetState, String> {
    show_at(x, y)
}

#[tauri::command]
pub fn visual_test_hide() {
    hide();
}

#[tauri::command]
pub fn visual_test_reset() {
    reset();
}

#[tauri::command]
pub fn visual_test_state() -> TestTargetState {
    state()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_button_rectangle_sits_inside_the_window() {
        let (bx, by, bw, bh) = BUTTON;
        assert!(bx > 0 && by > 0);
        assert!(bx + bw < WINDOW_W, "button runs off the right edge");
        assert!(by + bh < WINDOW_H, "button runs off the bottom edge");
    }

    #[test]
    fn only_points_inside_the_button_count_as_a_hit() {
        let (bx, by, bw, bh) = BUTTON;
        assert!(point_in_button(bx + bw / 2, by + bh / 2));
        assert!(point_in_button(bx, by), "the top-left corner is inside");
        // Exclusive on the far edges, matching every other rect in the codebase.
        assert!(!point_in_button(bx + bw, by));
        assert!(!point_in_button(bx, by + bh));
        assert!(!point_in_button(bx - 1, by));
        assert!(!point_in_button(0, 0), "the title area is not the button");
    }

    #[test]
    fn a_reset_target_reports_ready_and_no_clicks() {
        reset();
        let s = state();
        assert_eq!(s.clicks, 0);
        assert_eq!(s.state_label, "Ready");
        assert_eq!(s.button_test_id, BUTTON_TEST_ID);
    }

    #[test]
    fn a_hidden_target_offers_no_button_to_aim_at() {
        // A stale rectangle for a window nobody can see is worse than none:
        // a test would click empty desktop and call it a miss.
        hide();
        assert!(state().button.is_none());
    }
}
