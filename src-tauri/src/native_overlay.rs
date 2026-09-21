//! The purple pointer and the match outline, drawn as native layered windows.
//!
//! These used to be Tauri webview windows and never once appeared on screen.
//! WebView2 in this environment gives the process exactly two live webviews —
//! `main` and `sonare-overlay`. Every third one, however it was configured,
//! failed with 0x8007139F and left behind a window that reported itself as
//! healthy but painted nothing: the click still landed (the system cursor was
//! being moved underneath), so the symptom was "there is no purple pointer,
//! it's using my actual pointer".
//!
//! Layered windows are drawn straight to the screen with per-pixel alpha, need
//! no webview, and cannot hit that limit.

#![cfg(windows)]

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Mutex;

type Hwnd = isize;

static POINTER_HWND: AtomicIsize = AtomicIsize::new(0);
static HIGHLIGHT_HWND: AtomicIsize = AtomicIsize::new(0);
static DRAW_HWND: AtomicIsize = AtomicIsize::new(0);
/// True while the draw overlay is armed and taking the mouse.
static DRAWING_ARMED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Whether *we* hid the system cursor, so it is restored exactly once.
static CURSOR_HIDDEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Points of the stroke in progress, in virtual-screen pixels.
static STROKE: std::sync::Mutex<Vec<(i32, i32)>> = std::sync::Mutex::new(Vec::new());
/// Strokes already finished this session. Marking two things to compare them
/// is a normal request, so a completed stroke stays on screen and the region
/// handed over is the area covering all of them.
static FINISHED: std::sync::Mutex<Vec<Vec<(i32, i32)>>> = std::sync::Mutex::new(Vec::new());
/// Bumped every time a stroke ends; the idle timer only acts if it is still
/// the newest one, so drawing again cancels the pending fade.
static STROKE_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// How long the ink stays after the last stroke before fading away.
const HOLD_MS: u64 = 4000;
/// Set once the stroke is finished, for the caller to collect.
static LAST_REGION: std::sync::Mutex<Option<(i32, i32, i32, i32)>> = std::sync::Mutex::new(None);

const SM_XVIRTUALSCREEN: i32 = 76;
const SM_YVIRTUALSCREEN: i32 = 77;
const SM_CXVIRTUALSCREEN: i32 = 78;
const SM_CYVIRTUALSCREEN: i32 = 79;
const GWL_EXSTYLE: i32 = -20;
const WM_MOUSEMOVE: u32 = 0x0200;
const WM_LBUTTONDOWN: u32 = 0x0201;
const WM_LBUTTONUP: u32 = 0x0202;
const WM_RBUTTONDOWN: u32 = 0x0204;
const WM_SETCURSOR: u32 = 0x0020;
const IDC_ARROW: usize = 32512;
/// Stroke colour: red, so the user's mark never reads as the agent's purple.
const INK: (u8, u8, u8) = (239, 68, 68);

pub const POINTER_SIZE: i32 = 76;
/// Where the arrow's tip sits inside the pointer surface. Not the centre: the
/// body runs down-right from the tip, and the glow needs room up-left of it.
pub const TIP_X: i32 = 24;
pub const TIP_Y: i32 = 20;
/// Room for the glow to bleed outside the matched box without being clipped.
pub const HIGHLIGHT_PADDING: i32 = 10;

/// Win32 `RECT`. Declared here so `GetWindowRect`'s signature matches the one in
/// `visual_test_target` — two different declarations of the same import is a
/// linker-level hazard, not just a warning.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct WinRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

const WS_EX_LAYERED: u32 = 0x0008_0000;
const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
const WS_EX_TOPMOST: u32 = 0x0000_0008;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
const WS_POPUP: u32 = 0x8000_0000;

const SWP_NOACTIVATE: u32 = 0x0010;
const SWP_NOSIZE: u32 = 0x0001;
const SWP_NOMOVE: u32 = 0x0002;
const SWP_SHOWWINDOW: u32 = 0x0040;
const HWND_TOPMOST: isize = -1;

const SW_HIDE: i32 = 0;
const ULW_ALPHA: u32 = 0x0000_0002;
const AC_SRC_OVER: u8 = 0x00;
const AC_SRC_ALPHA: u8 = 0x01;
const BI_RGB: u32 = 0;
const DIB_RGB_COLORS: u32 = 0;

#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: i32,
    y: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    cx: i32,
    cy: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct BlendFunction {
    blend_op: u8,
    blend_flags: u8,
    source_constant_alpha: u8,
    alpha_format: u8,
}

#[repr(C)]
struct BitmapInfoHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_pels_per_meter: i32,
    y_pels_per_meter: i32,
    clr_used: u32,
    clr_important: u32,
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
    fn UpdateLayeredWindow(
        hwnd: isize,
        dst_dc: isize,
        dst_pt: *const Point,
        size: *const Size,
        src_dc: isize,
        src_pt: *const Point,
        color_key: u32,
        blend: *const BlendFunction,
        flags: u32,
    ) -> i32;
    fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
    fn GetWindowRect(hwnd: isize, rect: *mut WinRect) -> i32;
    fn RedrawWindow(hwnd: isize, rect: *const WinRect, region: isize, flags: u32) -> i32;
    fn GetClassNameW(hwnd: isize, class: *mut u16, max: i32) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn EnumWindows(callback: unsafe extern "system" fn(isize, isize) -> i32, param: isize) -> i32;
    fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
    fn GetDC(hwnd: isize) -> isize;
    fn ReleaseDC(hwnd: isize, dc: isize) -> i32;
    fn GetSystemMetrics(index: i32) -> i32;
    fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
    fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
    fn SetCapture(hwnd: isize) -> isize;
    fn ReleaseCapture() -> i32;
    fn ShowCursor(show: i32) -> i32;
    fn LoadCursorW(instance: isize, name: *const u16) -> isize;
    fn SetCursor(cursor: isize) -> isize;
    fn GetCursorPos(p: *mut Point) -> i32;
    fn SetForegroundWindow(hwnd: isize) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(dc: isize) -> isize;
    fn DeleteDC(dc: isize) -> i32;
    fn CreateDIBSection(
        dc: isize,
        info: *const BitmapInfoHeader,
        usage: u32,
        bits: *mut *mut core::ffi::c_void,
        section: isize,
        offset: u32,
    ) -> isize;
    fn SelectObject(dc: isize, obj: isize) -> isize;
    fn DeleteObject(obj: isize) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(name: *const u16) -> isize;
    fn GetLastError() -> u32;
    fn DestroyWindow(hwnd: isize) -> i32;
}

/// Record why the overlays could not be created. They are drawn outside the
/// webview, so nothing in the UI can report a failure here.
fn diag(msg: &str) {
    if let Ok(dir) = std::env::var("LOCALAPPDATA") {
        let path = std::path::Path::new(&dir).join("ArcSonare-overlay.log");
        let _ = std::fs::write(path, msg);
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn wnd_proc(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize {
    // Only the draw overlay ever takes input; the pointer and the highlight are
    // click-through and never see these messages.
    if hwnd == DRAW_HWND.load(Ordering::SeqCst) && DRAWING_ARMED.load(Ordering::SeqCst) {
        match msg {
            WM_LBUTTONDOWN => {
                STROKE.lock().unwrap().clear();
                SetCapture(hwnd);
                push_cursor_point();
                repaint_stroke(1.0);
                return 0;
            }
            WM_MOUSEMOVE => {
                // wp bit 0 is MK_LBUTTON: only draw while the button is held.
                if wp & 0x0001 != 0 {
                    push_cursor_point();
                    repaint_stroke(1.0);
                }
                return 0;
            }
            WM_LBUTTONUP => {
                ReleaseCapture();
                finish_stroke();
                return 0;
            }
            WM_SETCURSOR => {
                // Blank cursor over the draw surface only; repaint_stroke
                // paints a red crosshair in its place. Nothing global is
                // touched, so there is no counter to leak.
                SetCursor(0);
                return 1;
            }
            // Right-click cancels without handing anything over.
            WM_RBUTTONDOWN => {
                STROKE.lock().unwrap().clear();
                disarm_draw();
                return 0;
            }
            _ => {}
        }
    }
    DefWindowProcW(hwnd, msg, wp, lp)
}

pub fn virtual_screen() -> (i32, i32, i32, i32) {
    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    }
}

fn push_cursor_point() {
    let mut p = Point { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut p) } == 0 {
        return;
    }
    let mut stroke = STROKE.lock().unwrap();
    // Points that have not moved add nothing and cost a full repaint.
    if stroke.last().is_some_and(|&(x, y)| x == p.x && y == p.y) {
        return;
    }
    stroke.push((p.x, p.y));
}

/// Draw a round-capped line between two points.
fn stroke_segment(s: &mut Surface, a: (i32, i32), b: (i32, i32), width: f32, alpha: f32) {
    if alpha <= 0.0 {
        return;
    }
    let (ax, ay) = (a.0 as f32, a.1 as f32);
    let (bx, by) = (b.0 as f32, b.1 as f32);
    let (dx, dy) = (bx - ax, by - ay);
    let len_sq = (dx * dx + dy * dy).max(0.0001);
    let pad = width + 4.0;
    let min_x = (ax.min(bx) - pad).floor().max(0.0) as i32;
    let max_x = (ax.max(bx) + pad).ceil().min(s.w as f32) as i32;
    let min_y = (ay.min(by) - pad).floor().max(0.0) as i32;
    let max_y = (ay.max(by) + pad).ceil().min(s.h as f32) as i32;

    for y in min_y..max_y {
        for x in min_x..max_x {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let t = (((px - ax) * dx + (py - ay) * dy) / len_sq).clamp(0.0, 1.0);
            let (cx, cy) = (ax + dx * t, ay + dy * t);
            let d = ((px - cx).powi(2) + (py - cy).powi(2)).sqrt();
            if d <= width {
                let a = (width - d).clamp(0.0, 1.0) * alpha;
                s.blend(x, y, INK.0, INK.1, INK.2, a);
            } else if d <= width + 3.0 {
                // Soft edge, so the line does not look jagged.
                let a = (1.0 - (d - width) / 3.0).clamp(0.0, 1.0) * alpha * 0.35;
                s.blend(x, y, INK.0, INK.1, INK.2, a);
            }
        }
    }
}

/// Repaint the whole stroke at the given opacity.
fn repaint_stroke(alpha: f32) {
    let hwnd = DRAW_HWND.load(Ordering::SeqCst);
    if hwnd == 0 {
        return;
    }
    let (ox, oy, w, h) = virtual_screen();
    let mut surface = Surface::new(w, h);
    let stroke = STROKE.lock().unwrap().clone();

    // Stroke points are virtual-screen coordinates; the surface starts at the
    // virtual-screen origin, which is negative when a monitor sits left/above.
    let mut all: Vec<Vec<(i32, i32)>> = FINISHED.lock().unwrap().clone();
    all.push(stroke);
    for one in &all {
        let local: Vec<(i32, i32)> = one.iter().map(|&(x, y)| (x - ox, y - oy)).collect();
        for pair in local.windows(2) {
            stroke_segment(&mut surface, pair[0], pair[1], 2.6, alpha);
        }
        if local.len() == 1 {
            stroke_segment(&mut surface, local[0], local[0], 2.6, alpha);
        }
    }

    // The system cursor is hidden while armed, so one is drawn here — red, so
    // the user's own mark never reads as the agent's purple pointer.
    if DRAWING_ARMED.load(Ordering::SeqCst) {
        let mut p = Point { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut p) } != 0 {
            let (cx, cy) = (p.x - ox, p.y - oy);
            stroke_segment(&mut surface, (cx - 9, cy), (cx - 3, cy), 1.4, 1.0);
            stroke_segment(&mut surface, (cx + 3, cy), (cx + 9, cy), 1.4, 1.0);
            stroke_segment(&mut surface, (cx, cy - 9), (cx, cy - 3), 1.4, 1.0);
            stroke_segment(&mut surface, (cx, cy + 3), (cx, cy + 9), 1.4, 1.0);
        }
    }
    let _ = paint(hwnd, &surface, ox, oy);
}

/// Bounding box of the stroke, in virtual-screen pixels.
pub fn stroke_bounds_of(points: &[(i32, i32)]) -> Option<(i32, i32, i32, i32)> {
    if points.len() < 2 {
        return None;
    }
    let min_x = points.iter().map(|p| p.0).min()?;
    let max_x = points.iter().map(|p| p.0).max()?;
    let min_y = points.iter().map(|p| p.1).min()?;
    let max_y = points.iter().map(|p| p.1).max()?;
    // People circle around a thing rather than exactly on it, so pad a little.
    let pad = 6;
    Some((
        min_x - pad,
        min_y - pad,
        (max_x - min_x) + pad * 2,
        (max_y - min_y) + pad * 2,
    ))
}

/// Record the region, fade the ink out, and hand the mouse back.
fn finish_stroke() {
    let points = STROKE.lock().unwrap().clone();
    if points.len() >= 2 {
        FINISHED.lock().unwrap().push(points);
    }
    STROKE.lock().unwrap().clear();

    // The region covers every stroke drawn this session: marking two things to
    // compare them should hand over both, not just the last one.
    let all: Vec<(i32, i32)> = FINISHED.lock().unwrap().iter().flatten().copied().collect();
    if let Some(region) = stroke_bounds_of(&all) {
        *LAST_REGION.lock().unwrap() = Some(region);
    }
    repaint_stroke(1.0);

    // Stay armed: the user may well draw a second shape. The ink is held, and
    // only an idle stretch with no new stroke ends the session.
    let generation = STROKE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(HOLD_MS));
        // Another stroke started after this one: that timer owns the fade now.
        if STROKE_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        if !DRAWING_ARMED.load(Ordering::SeqCst) {
            return;
        }
        // Stop taking the mouse before fading, so the click the user makes
        // next lands on their app and not on an invisible overlay.
        DRAWING_ARMED.store(false, Ordering::SeqCst);
        show_system_cursor();
        set_click_through(DRAW_HWND.load(Ordering::SeqCst), true);
        for step in 0..14 {
            if STROKE_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            repaint_stroke(1.0 - (step as f32 / 14.0));
            std::thread::sleep(std::time::Duration::from_millis(38));
        }
        FINISHED.lock().unwrap().clear();
        STROKE.lock().unwrap().clear();
        let hwnd = DRAW_HWND.load(Ordering::SeqCst);
        if hwnd != 0 {
            unsafe { ShowWindow(hwnd, SW_HIDE) };
        }
    });
}

/// Toggle WS_EX_TRANSPARENT: off to receive the mouse, on to let clicks pass.
fn set_click_through(hwnd: Hwnd, through: bool) {
    if hwnd == 0 {
        return;
    }
    unsafe {
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if through {
            ex |= WS_EX_TRANSPARENT;
        } else {
            ex &= !WS_EX_TRANSPARENT;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);
    }
}

/// Hide the system cursor, but only if it is not already hidden by us.
fn hide_system_cursor() {
    // Deliberately empty. This used to call ShowCursor(0), whose counter is
    // per-input-queue: the cursor vanished over ArcSonare's own windows and
    // stayed that way until a restart, while looking fine over other apps.
    // WM_SETCURSOR now blanks it over the draw overlay only.
    CURSOR_HIDDEN.store(true, Ordering::SeqCst);
}

/// Restore the system cursor no matter how unbalanced the counter got.
///
/// ShowCursor keeps an internal count, not a flag: two hides need two shows.
/// An unmatched hide left the mouse invisible everywhere — still working, just
/// impossible to see, which is what was happening across the whole desktop.
fn show_system_cursor() {
    CURSOR_HIDDEN.store(false, Ordering::SeqCst);
    // Repair any imbalance left by an older build that did call ShowCursor(0):
    // without this, upgrading mid-session would keep the cursor hidden.
    unsafe {
        let mut guard = 0;
        while ShowCursor(1) < 0 && guard < 16 {
            guard += 1;
        }
    }
}

fn disarm_draw() {
    DRAWING_ARMED.store(false, Ordering::SeqCst);
    show_system_cursor();
    STROKE.lock().unwrap().clear();
    FINISHED.lock().unwrap().clear();
    let hwnd = DRAW_HWND.load(Ordering::SeqCst);
    set_click_through(hwnd, true);
    if hwnd != 0 {
        unsafe { ShowWindow(hwnd, SW_HIDE) };
    }
}

/// Arm draw mode: the next drag marks a region.
pub fn arm_draw() -> Result<(), String> {
    // Arming twice would hide the cursor twice and leave it invisible.
    if DRAWING_ARMED.load(Ordering::SeqCst) {
        return Ok(());
    }
    let hwnd = wait_for(&DRAW_HWND)?;
    STROKE.lock().unwrap().clear();
    FINISHED.lock().unwrap().clear();
    STROKE_GENERATION.fetch_add(1, Ordering::SeqCst);
    *LAST_REGION.lock().unwrap() = None;
    let (ox, oy, w, h) = virtual_screen();
    set_click_through(hwnd, false);
    unsafe {
        // Deliberately no SetForegroundWindow: taking focus deactivates
        // whatever the user is marking up — their window dims, and apps that
        // hide on focus loss disappear entirely. It also swallowed the first
        // click as an activation click, so the first stroke never drew.
        // WS_EX_NOACTIVATE means mouse messages arrive without focus.
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            ox,
            oy,
            w,
            h,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    // Hide the system arrow; repaint_stroke draws a red crosshair instead.
    hide_system_cursor();
    DRAWING_ARMED.store(true, Ordering::SeqCst);
    // Track the pointer immediately so the crosshair follows the mouse before
    // the first click, rather than appearing only once a stroke starts.
    std::thread::spawn(|| {
        while DRAWING_ARMED.load(Ordering::SeqCst) {
            if STROKE.lock().unwrap().is_empty() {
                repaint_stroke(1.0);
            }
            std::thread::sleep(std::time::Duration::from_millis(33));
        }
    });
    repaint_stroke(1.0);
    Ok(())
}

/// The region from the last completed stroke. Taking it clears it, so a region
/// is never silently reused for a later, unrelated request.
pub fn take_drawn_region() -> Option<(i32, i32, i32, i32)> {
    LAST_REGION.lock().unwrap().take()
}

pub fn is_draw_armed() -> bool {
    DRAWING_ARMED.load(Ordering::SeqCst)
}

/// Feed a synthetic stroke in, for the verification script: it exercises the
/// real painting and bounds code without needing a physical mouse.
pub fn test_stroke(points: Vec<(i32, i32)>) -> Option<(i32, i32, i32, i32)> {
    let hwnd = wait_for(&DRAW_HWND).ok()?;
    let (ox, oy, w, h) = virtual_screen();
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            ox,
            oy,
            w,
            h,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    *STROKE.lock().unwrap() = points.clone();
    repaint_stroke(1.0);

    // Clear itself down afterwards. Left up, the test stroke sat on screen
    // permanently AND kept a topmost window over everything, which looked like
    // "the app starts with a red rectangle and my windows go behind it".
    std::thread::spawn(|| {
        // Long enough for a verifier to wait out app start-up and still
        // photograph the ink, but never permanent.
        std::thread::sleep(std::time::Duration::from_millis(25_000));
        STROKE.lock().unwrap().clear();
        let hwnd = DRAW_HWND.load(Ordering::SeqCst);
        if hwnd != 0 {
            unsafe { ShowWindow(hwnd, SW_HIDE) };
        }
    });
    stroke_bounds_of(&points)
}

/// A premultiplied-alpha BGRA surface. UpdateLayeredWindow requires the colour
/// channels to be pre-multiplied by alpha, otherwise edges fringe white.
struct Surface {
    w: i32,
    h: i32,
    px: Vec<u32>,
}

impl Surface {
    fn new(w: i32, h: i32) -> Self {
        Self {
            w,
            h,
            px: vec![0; (w.max(1) * h.max(1)) as usize],
        }
    }

    fn blend(&mut self, x: i32, y: i32, r: u8, g: u8, b: u8, a: f32) {
        if x < 0 || y < 0 || x >= self.w || y >= self.h || a <= 0.0 {
            return;
        }
        let a = a.min(1.0);
        let idx = (y * self.w + x) as usize;
        let dst = self.px[idx];
        let (dr, dg, db, da) = (
            ((dst >> 16) & 0xff) as f32,
            ((dst >> 8) & 0xff) as f32,
            (dst & 0xff) as f32,
            ((dst >> 24) & 0xff) as f32 / 255.0,
        );
        // Source is premultiplied on the way in.
        let (sr, sg, sb) = (r as f32 * a, g as f32 * a, b as f32 * a);
        let out_a = a + da * (1.0 - a);
        let out = |s: f32, d: f32| (s + d * (1.0 - a)).round().clamp(0.0, 255.0) as u32;
        self.px[idx] = (((out_a * 255.0).round().clamp(0.0, 255.0) as u32) << 24)
            | (out(sr, dr) << 16)
            | (out(sg, dg) << 8)
            | out(sb, db);
    }
}

/// Signed distance to a polygon: negative inside, positive outside.
/// Filling everything within `r` of a slim core polygon is what gives the
/// arrow its evenly rounded corners.
fn sd_polygon(pts: &[(f32, f32)], px: f32, py: f32) -> f32 {
    let mut d = f32::MAX;
    let mut sign = 1.0f32;
    let n = pts.len();
    let mut j = n - 1;
    for i in 0..n {
        let (ax, ay) = pts[i];
        let (bx, by) = pts[j];
        let (ex, ey) = (bx - ax, by - ay);
        let (wx, wy) = (px - ax, py - ay);
        let t = ((wx * ex + wy * ey) / (ex * ex + ey * ey)).clamp(0.0, 1.0);
        let (cx, cy) = (wx - ex * t, wy - ey * t);
        d = d.min(cx * cx + cy * cy);
        if ((py >= ay) && (py < by) && (ex * wy > ey * wx))
            || ((py < ay) && (py >= by) && (ex * wy < ey * wx))
        {
            sign = -sign;
        }
        j = i;
    }
    sign * d.sqrt()
}

/// The arrow, drawn so its tip lands exactly on the click point.
fn draw_pointer(s: &mut Surface) {
    // Heavy rounding turned this into an unrecognisable blob. A cursor is read
    // by its silhouette — sharp tip, straight left edge, tail notch — so the
    // rounding only softens the corners.
    const ROUND: f32 = 1.8;
    const CASING: f32 = 2.6;

    // The classic seven-point pointer, relative to its tip.
    let core: [(f32, f32); 7] = [
        (0.0, 0.0),
        (0.0, 31.0),
        (7.6, 23.6),
        (12.2, 33.6),
        (17.0, 31.4),
        (12.6, 21.6),
        (22.0, 21.0),
    ];

    // Dilation pushes the tip outward along its bisector, so the core is
    // shifted back by that much to keep the tip on the click point.
    let norm = |x: f32, y: f32| {
        let l = (x * x + y * y).sqrt().max(0.0001);
        (x / l, y / l)
    };
    let (e1x, e1y) = norm(core[0].0 - core[1].0, core[0].1 - core[1].1);
    let (e2x, e2y) = norm(core[0].0 - core[6].0, core[0].1 - core[6].1);
    let (bx, by) = norm(e1x + e2x, e1y + e2y);
    let ox = TIP_X as f32 - bx * ROUND;
    let oy = TIP_Y as f32 - by * ROUND;
    let pts: Vec<(f32, f32)> = core.iter().map(|(x, y)| (x + ox, y + oy)).collect();

    // Light violet at the tip to a deeper one at the tail, so it reads as a
    // solid object rather than a flat blob.
    let (top, bottom) = ((196.0, 141.0, 253.0), (109.0, 40.0, 217.0));

    for y in 0..s.h {
        for x in 0..s.w {
            let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
            let d = sd_polygon(&pts, fx, fy);

            // No halo: the glow read as a tail smeared around the arrow. The
            // white casing alone holds it against any background.
            let casing_edge = ROUND + CASING;
            if d < casing_edge {
                let a = (casing_edge - d).clamp(0.0, 1.0);
                s.blend(x, y, 255, 255, 255, a);
            }
            if d < ROUND {
                let a = (ROUND - d).clamp(0.0, 1.0);
                let k = ((fy - TIP_Y as f32) / 30.0).clamp(0.0, 1.0);
                let mix = |c0: f32, c1: f32| (c0 + (c1 - c0) * k) as u8;
                s.blend(
                    x,
                    y,
                    mix(top.0, bottom.0),
                    mix(top.1, bottom.1),
                    mix(top.2, bottom.2),
                    a,
                );
            }
        }
    }
}

/// Hollow rounded border sitting exactly on the matched box.
/// The calibration target window is a fixed square centred on the point.
pub const CALIBRATION_TARGET_SIZE: i32 = 64;

/// A calibration target: thin ring, crosshair arms, and a small centre dot.
///
/// Deliberately not the ordinary highlight. The first physical run produced a
/// consistent (âˆ’3, âˆ’7) px bias on every clean sample — not random aiming noise,
/// but the arrow cursor's hotspot sitting up-left of where a person reads the
/// pointer as being. Against a padded rounded rectangle there is nothing to
/// correct that against; the user aims at the middle of a shape and is reliably
/// several pixels out.
///
/// So the centre is drawn explicitly and left visible: the arms stop short of
/// it, and the dot is small enough to place a cursor tip on precisely. Every
/// stroke carries a dark halo so it reads on a white window and on a dark
/// wallpaper alike.
/// What a calibration target is currently saying.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CalibrationTargetState {
    /// Aim here. ArcSonare's violet.
    Active,
    /// That one counted. Green, briefly.
    Accepted,
    /// That one did not count, and the target has not moved. Amber.
    Rejected,
}

impl CalibrationTargetState {
    /// Ring, crosshair and dot colour.
    fn colour(&self) -> (u8, u8, u8) {
        match self {
            // The accent used throughout ArcSonare, so the active target reads
            // as "the app wants this" rather than as a system artefact.
            Self::Active => (192, 132, 252),
            Self::Accepted => (122, 209, 154),
            Self::Rejected => (215, 178, 106),
        }
    }
}

fn draw_calibration_target(s: &mut Surface) {
    draw_calibration_target_in(s, CalibrationTargetState::Active)
}

fn draw_calibration_target_in(s: &mut Surface, state: CalibrationTargetState) {
    let cx = s.w as f32 / 2.0;
    let cy = s.h as f32 / 2.0;
    const RING_RADIUS: f32 = 22.0;
    const RING_THICKNESS: f32 = 1.5;
    const DOT_RADIUS: f32 = 2.0;
    /// Arms stop here so the exact centre is never covered.
    const ARM_INNER: f32 = 7.0;
    const ARM_OUTER: f32 = 17.0;
    const ARM_HALF_WIDTH: f32 = 0.9;

    // Dark first, bright on top: the halo is what makes a 1.5px white line
    // readable over a pale window.
    let (w, h) = (s.w, s.h);
    let (cr, cg, cb) = state.colour();
    // Dark halo first, colour on top: that is what keeps a 1.5px line readable
    // over a pale window as well as a dark wallpaper. A white core is added
    // under the colour so the hue stays bright rather than muddying.
    let mut stroke = move |s: &mut Surface, x: i32, y: i32, coverage: f32| {
        if coverage <= 0.0 {
            return;
        }
        let a = coverage.clamp(0.0, 1.0);
        s.blend(x, y, 0, 0, 0, a * 0.55);
        s.blend(x, y, 255, 255, 255, a * 0.45);
        s.blend(x, y, cr, cg, cb, a);
    };

    for y in 0..h {
        for x in 0..w {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let dx = px - cx;
            let dy = py - cy;
            let r = (dx * dx + dy * dy).sqrt();

            // Outer ring.
            let ring = 1.0 - ((r - RING_RADIUS).abs() - RING_THICKNESS).max(0.0);
            // Centre dot.
            let dot = 1.0 - (r - DOT_RADIUS).max(0.0);
            // Crosshair arms, horizontal and vertical, stopping short of centre.
            let along_x = dx.abs() >= ARM_INNER && dx.abs() <= ARM_OUTER;
            let along_y = dy.abs() >= ARM_INNER && dy.abs() <= ARM_OUTER;
            let arm_h = if along_x {
                1.0 - (dy.abs() - ARM_HALF_WIDTH).max(0.0)
            } else {
                0.0
            };
            let arm_v = if along_y {
                1.0 - (dx.abs() - ARM_HALF_WIDTH).max(0.0)
            } else {
                0.0
            };

            stroke(s, x, y, ring.max(dot).max(arm_h).max(arm_v));
        }
    }
}

/// Show the calibration target centred exactly on a desktop point.
///
/// Takes a centre rather than a rectangle so no caller can introduce an offset
/// between the point being verified and the thing the user aims at.
pub fn show_calibration_target(centre_x: i32, centre_y: i32) -> Result<(), String> {
    show_calibration_target_in(centre_x, centre_y, CalibrationTargetState::Active)
}

/// Show the target in a given state, centred exactly on a desktop point.
pub fn show_calibration_target_in(
    centre_x: i32,
    centre_y: i32,
    state: CalibrationTargetState,
) -> Result<(), String> {
    let hwnd = wait_for(&HIGHLIGHT_HWND)?;
    let half = CALIBRATION_TARGET_SIZE / 2;
    let (x, y) = (centre_x - half, centre_y - half);
    let mut surface = Surface::new(CALIBRATION_TARGET_SIZE, CALIBRATION_TARGET_SIZE);
    draw_calibration_target_in(&mut surface, state);
    // Clear where the previous target was before moving there. Without this the
    // old ring stays painted on the desktop behind us.
    repaint_desktop();
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            x,
            y,
            CALIBRATION_TARGET_SIZE,
            CALIBRATION_TARGET_SIZE,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    paint(hwnd, &surface, x, y)?;
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    Ok(())
}

/// One of ArcSonare's native overlay windows, as Windows sees it.
#[derive(Debug, Clone, Copy)]
pub struct OverlayWindow {
    pub hwnd: isize,
    pub visible: bool,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Every window of ArcSonare's overlay class currently in existence.
///
/// The invariant this exists to police: at most one calibration target may be
/// visible at a time, and none at all once a session ends. Asserting that from
/// the handle statics would be circular — the bug it catches is precisely a
/// window the statics no longer point at — so this asks Windows directly.
pub fn overlay_window_census() -> Vec<OverlayWindow> {
    static mut FOUND: Vec<OverlayWindow> = Vec::new();

    unsafe extern "system" fn visit(hwnd: isize, _param: isize) -> i32 {
        let mut class = [0u16; 64];
        let len = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
        if len > 0 {
            let name = String::from_utf16_lossy(&class[..len as usize]);
            if name == "ArcSonareOverlay" {
                let mut rect = WinRect::default();
                let ok = GetWindowRect(hwnd, &mut rect) != 0;
                #[allow(static_mut_refs)]
                FOUND.push(OverlayWindow {
                    hwnd,
                    visible: IsWindowVisible(hwnd) != 0,
                    x: rect.left,
                    y: rect.top,
                    width: if ok { rect.right - rect.left } else { 0 },
                    height: if ok { rect.bottom - rect.top } else { 0 },
                });
            }
        }
        1
    }

    unsafe {
        #[allow(static_mut_refs)]
        {
            FOUND.clear();
            EnumWindows(visit, 0);
            FOUND.clone()
        }
    }
}

/// How many overlay windows are currently showing something.
///
/// The pointer window parks itself off-screen rather than hiding, so a window
/// sitting outside the virtual desktop does not count as visible to a user.
pub fn visible_overlay_count() -> usize {
    let (vx, vy, vw, vh) = virtual_screen();
    overlay_window_census()
        .into_iter()
        .filter(|w| {
            w.visible && w.x + w.width > vx && w.y + w.height > vy && w.x < vx + vw && w.y < vy + vh
        })
        .count()
}

/// Where the calibration target's centre actually is, read back from Windows.
pub fn calibration_target_centre() -> Option<(i32, i32)> {
    let hwnd = HIGHLIGHT_HWND.load(Ordering::SeqCst);
    if hwnd == 0 {
        return None;
    }
    let mut rect = WinRect::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    Some((
        rect.left + (rect.right - rect.left) / 2,
        rect.top + (rect.bottom - rect.top) / 2,
    ))
}

fn draw_highlight(s: &mut Surface) {
    let pad = HIGHLIGHT_PADDING as f32;
    let (x0, y0) = (pad, pad);
    let (x1, y1) = (s.w as f32 - pad, s.h as f32 - pad);
    let radius = 8.0f32.min((x1 - x0) / 2.0).min((y1 - y0) / 2.0);
    let thickness = 2.5f32;

    let dist = |px: f32, py: f32| -> f32 {
        let cx = px.clamp(x0 + radius, x1 - radius);
        let cy = py.clamp(y0 + radius, y1 - radius);
        let (dx, dy) = (px - cx, py - cy);
        (dx * dx + dy * dy).sqrt() - radius
    };

    for y in 0..s.h {
        for x in 0..s.w {
            let d = dist(x as f32 + 0.5, y as f32 + 0.5);
            let edge = d.abs();
            if edge <= thickness {
                let a = (1.0 - (edge - (thickness - 1.0)).max(0.0)).clamp(0.0, 1.0);
                s.blend(x, y, 255, 255, 255, a * 0.5);
                s.blend(x, y, 192, 132, 252, a);
            } else if edge <= thickness + 7.0 {
                let t = 1.0 - (edge - thickness) / 7.0;
                s.blend(x, y, 192, 132, 252, t * t * 0.45);
            }
        }
    }
}

/// Push a surface onto a layered window at the given screen position.
fn paint(hwnd: Hwnd, surface: &Surface, x: i32, y: i32) -> Result<(), String> {
    unsafe {
        let screen_dc = GetDC(0);
        let mem_dc = CreateCompatibleDC(screen_dc);
        let header = BitmapInfoHeader {
            size: std::mem::size_of::<BitmapInfoHeader>() as u32,
            width: surface.w,
            // Negative height makes it a top-down DIB, matching our row order.
            height: -surface.h,
            planes: 1,
            bit_count: 32,
            compression: BI_RGB,
            size_image: 0,
            x_pels_per_meter: 0,
            y_pels_per_meter: 0,
            clr_used: 0,
            clr_important: 0,
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let dib = CreateDIBSection(mem_dc, &header, DIB_RGB_COLORS, &mut bits, 0, 0);
        if dib == 0 || bits.is_null() {
            DeleteDC(mem_dc);
            ReleaseDC(0, screen_dc);
            return Err("could not allocate the overlay bitmap".into());
        }
        std::ptr::copy_nonoverlapping(surface.px.as_ptr(), bits as *mut u32, surface.px.len());
        let old = SelectObject(mem_dc, dib);

        let pos = Point { x, y };
        let size = Size {
            cx: surface.w,
            cy: surface.h,
        };
        let src = Point { x: 0, y: 0 };
        let blend = BlendFunction {
            blend_op: AC_SRC_OVER,
            blend_flags: 0,
            source_constant_alpha: 255,
            alpha_format: AC_SRC_ALPHA,
        };
        let ok = UpdateLayeredWindow(
            hwnd, screen_dc, &pos, &size, mem_dc, &src, 0, &blend, ULW_ALPHA,
        );

        SelectObject(mem_dc, old);
        DeleteObject(dib);
        DeleteDC(mem_dc);
        ReleaseDC(0, screen_dc);
        if ok == 0 {
            return Err("could not paint the overlay window".into());
        }
    }
    Ok(())
}

fn create_window(class: &[u16], w: i32, h: i32) -> Hwnd {
    unsafe {
        CreateWindowExW(
            // NOACTIVATE + TRANSPARENT: never steals focus, never eats the click
            // it is pointing at.
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class.as_ptr(),
            std::ptr::null(),
            WS_POPUP,
            -10_000,
            -10_000,
            w,
            h,
            0,
            0,
            GetModuleHandleW(std::ptr::null()),
            std::ptr::null(),
        )
    }
}

/// Create the overlays on a dedicated thread that owns their message loop.
/// Set the first time `init` runs, so it can never run twice.
static INIT_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Create the overlay windows. Safe to call from anywhere, any number of times.
///
/// The idempotence is load-bearing, and its absence was a real bug. Each call
/// used to spawn a thread and create three fresh windows, then overwrite the
/// handle statics with the newest ones — orphaning the previous windows *while
/// they were still visible and painted*. Nothing could hide them afterwards,
/// because the only handle to them had been overwritten.
///
/// The calibration wizard called this before drawing every target, so a
/// nine-point run left nine rings on screen at once and `hide_highlight` cleared
/// exactly one of them. The rings were not stale pixels; they were live windows.
pub fn init() {
    if INIT_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        let class_name = wide("ArcSonareOverlay");
        unsafe {
            let class = WndClassExW {
                cb_size: std::mem::size_of::<WndClassExW>() as u32,
                style: 0,
                wnd_proc: Some(wnd_proc),
                cb_cls_extra: 0,
                cb_wnd_extra: 0,
                instance: GetModuleHandleW(std::ptr::null()),
                icon: 0,
                // A NULL class cursor means Windows sets no cursor over these
                // windows: the pointer keeps whatever shape it last had, so
                // once it was hidden it stayed hidden over the whole app until
                // a restart. A real class cursor makes that impossible.
                cursor: LoadCursorW(0, IDC_ARROW as *const u16),
                background: 0,
                menu_name: std::ptr::null(),
                class_name: class_name.as_ptr(),
                icon_sm: 0,
            };
            let atom = RegisterClassExW(&class);
            if atom == 0 {
                diag(&format!("RegisterClassExW failed: {}", GetLastError()));
            }
        }

        let pointer = create_window(&class_name, POINTER_SIZE, POINTER_SIZE);
        let err_p = unsafe { GetLastError() };
        let highlight = create_window(&class_name, 200, 200);
        let err_h = unsafe { GetLastError() };
        // Full virtual desktop, so a stroke can cross monitors.
        let (_, _, vw, vh) = virtual_screen();
        let draw = create_window(&class_name, vw.max(1), vh.max(1));
        if pointer == 0 || highlight == 0 {
            diag(&format!(
                "CreateWindowExW failed: pointer={pointer} (err {err_p}), highlight={highlight} (err {err_h})"
            ));
            log::error!("could not create the native overlay windows");
            return;
        }
        diag(&format!(
            "created pointer={pointer} highlight={highlight} draw={draw}"
        ));

        // The arrow never changes, so paint it once up front.
        let mut surface = Surface::new(POINTER_SIZE, POINTER_SIZE);
        draw_pointer(&mut surface);
        if let Err(e) = paint(pointer, &surface, -10_000, -10_000) {
            log::error!("could not paint the agent pointer: {e}");
        }

        POINTER_HWND.store(pointer, Ordering::SeqCst);
        HIGHLIGHT_HWND.store(highlight, Ordering::SeqCst);
        DRAW_HWND.store(draw, Ordering::SeqCst);

        // Set ARCSONARE_OVERLAY_SELFTEST=<x>,<y>,<w>,<h> to park the marker and
        // the outline on screen so they can be photographed and checked.
        if let Ok(spec) = std::env::var("ARCSONARE_OVERLAY_SELFTEST") {
            let n: Vec<i32> = spec
                .split(',')
                .filter_map(|v| v.trim().parse().ok())
                .collect();
            if n.len() == 4 {
                let _ = show_highlight(n[0], n[1], n[2], n[3]);
                // Tip at the top-left corner: the body runs down-right, so it
                // stays inside the outline instead of spilling past its edge
                // and inflating what the verifier measures.
                let _ = show_pointer(n[0], n[1]);
                log::info!("overlay self-test showing at {spec}");
            }
        }

        // ARCSONARE_DRAW_SELFTEST=<x>,<y>,<w>,<h> paints a rectangular stroke
        // so the drawing path can be photographed without a mouse.
        if let Ok(spec) = std::env::var("ARCSONARE_DRAW_SELFTEST") {
            let n: Vec<i32> = spec
                .split(',')
                .filter_map(|v| v.trim().parse().ok())
                .collect();
            if n.len() == 4 {
                let (x, y, w, h) = (n[0], n[1], n[2], n[3]);
                let mut pts = Vec::new();
                let mut i = 0;
                while i <= w {
                    pts.push((x + i, y));
                    i += 6;
                }
                let mut i = 0;
                while i <= h {
                    pts.push((x + w, y + i));
                    i += 6;
                }
                let mut i = w;
                while i >= 0 {
                    pts.push((x + i, y + h));
                    i -= 6;
                }
                let mut i = h;
                while i >= 0 {
                    pts.push((x, y + i));
                    i -= 6;
                }
                let region = test_stroke(pts);
                log::info!("draw self-test painted, region {region:?}");
            }
        }

        // Layered windows still need their messages pumped or Windows treats
        // them as hung and stops compositing them.
        let mut msg = [0u32; 12];
        unsafe {
            while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    });
}

fn wait_for(handle: &AtomicIsize) -> Result<Hwnd, String> {
    for _ in 0..40 {
        let h = handle.load(Ordering::SeqCst);
        if h != 0 {
            return Ok(h);
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    Err("the overlay window is not ready yet".into())
}

/// Put the arrow's tip on (x, y) in virtual-screen pixels.
pub fn show_pointer(x: i32, y: i32) -> Result<(), String> {
    let hwnd = wait_for(&POINTER_HWND)?;
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            x - TIP_X,
            y - TIP_Y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    Ok(())
}

pub fn hide_pointer() {
    let hwnd = POINTER_HWND.load(Ordering::SeqCst);
    if hwnd != 0 {
        unsafe { ShowWindow(hwnd, SW_HIDE) };
    }
}

/// Outline the region (x, y, w, h) in virtual-screen pixels.
pub fn show_highlight(x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    if w <= 0 || h <= 0 {
        return Err("the highlight needs a positive width and height".into());
    }
    let hwnd = wait_for(&HIGHLIGHT_HWND)?;
    let (fw, fh) = (w + HIGHLIGHT_PADDING * 2, h + HIGHLIGHT_PADDING * 2);
    let (fx, fy) = (x - HIGHLIGHT_PADDING, y - HIGHLIGHT_PADDING);
    let mut surface = Surface::new(fw, fh);
    draw_highlight(&mut surface);
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            fx,
            fy,
            fw,
            fh,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    paint(hwnd, &surface, fx, fy)?;
    // Re-assert topmost only — without SWP_NOMOVE this call would drag the
    // outline to the screen corner, which is exactly what it used to do.
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    Ok(())
}

/// The rectangle the highlight is actually outlining, read back from Windows.
///
/// Not the rectangle it was asked to outline: `SetWindowPos` can clamp, and a
/// DPI-virtualised process gets silently rescaled. Measuring the drawn result
/// rather than the requested one is the difference between "the call returned
/// Ok" and "the border is where it should be".
///
/// The padding the window carries so the outline is not clipped is removed
/// again here, so the answer is comparable with the target rectangle.
pub fn highlight_target_rect() -> Option<(i32, i32, i32, i32)> {
    let hwnd = HIGHLIGHT_HWND.load(Ordering::SeqCst);
    if hwnd == 0 {
        return None;
    }
    let mut rect = WinRect::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    Some((
        rect.left + HIGHLIGHT_PADDING,
        rect.top + HIGHLIGHT_PADDING,
        (rect.right - rect.left) - HIGHLIGHT_PADDING * 2,
        (rect.bottom - rect.top) - HIGHLIGHT_PADDING * 2,
    ))
}

pub fn hide_highlight() {
    let hwnd = HIGHLIGHT_HWND.load(Ordering::SeqCst);
    if hwnd != 0 {
        unsafe { ShowWindow(hwnd, SW_HIDE) };
        repaint_desktop();
    }
}

/// Ask everything underneath to redraw.
///
/// Hiding or moving a layered window does not reliably repaint what was behind
/// it: the desktop and other windows only redraw when told to. Stepping a
/// calibration target through nine positions left a visible ring at every one of
/// them, still on screen after the target had moved on — which reads exactly
/// like nine overlays that were never cleaned up.
fn repaint_desktop() {
    const RDW_INVALIDATE: u32 = 0x0001;
    const RDW_ERASE: u32 = 0x0004;
    const RDW_ALLCHILDREN: u32 = 0x0080;
    unsafe {
        RedrawWindow(
            0,
            std::ptr::null(),
            0,
            RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN,
        );
    }
}

// ---------------------------------------------------------------------------
// Annotation windows
//
// `show_highlight` above owns one global window drawing one rounded rectangle.
// That is right for "point at this" and cannot express a border and a circle at
// once, which is what the annotation manager needs. These create windows of the
// same class — so the existing census counts them — but hand the handle back to
// the caller instead of storing it in a static. Ownership lives in
// `annotations::AnnotationManager`; this file just draws.
// ---------------------------------------------------------------------------

/// Windows created here, so a leak is detectable without trusting the manager.
static ANNOTATION_WINDOWS: Mutex<Vec<Hwnd>> = Mutex::new(Vec::new());

/// Draw one annotation shape, creating its window if it does not have one yet.
///
/// Returns the handle to reuse next time. Reusing it is what makes "make the
/// circle red" repaint rather than open a second window on top of the first.
pub fn show_annotation(
    existing: Hwnd,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    kind: crate::annotations::shapes::ShapeKind,
    style: &crate::annotations::shapes::AnnotationStyle,
) -> Option<Hwnd> {
    use crate::annotations::shapes::{render, ShapeBox, SHAPE_PADDING};
    if w <= 0 || h <= 0 {
        return None;
    }
    let (fw, fh) = (w + SHAPE_PADDING * 2, h + SHAPE_PADDING * 2);
    let (fx, fy) = (x - SHAPE_PADDING, y - SHAPE_PADDING);

    let hwnd = if existing != 0 {
        existing
    } else {
        let class = wide("ArcSonareOverlay");
        let created = create_window(&class, fw.max(1), fh.max(1));
        if created == 0 {
            diag(&format!("annotation window failed: {}", unsafe { GetLastError() }));
            return None;
        }
        ANNOTATION_WINDOWS.lock().ok()?.push(created);
        created
    };

    let mut surface = Surface::new(fw, fh);
    render(
        kind,
        ShapeBox { width: w, height: h },
        style,
        |px, py, r, g, b, a| surface.blend(px, py, r, g, b, a),
    );

    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            fx,
            fy,
            fw,
            fh,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    paint(hwnd, &surface, fx, fy).ok()?;
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
    Some(hwnd)
}

/// Park a window off-screen. Kept alive so a restore can repaint it without
/// paying to create a window again.
pub fn hide_annotation(hwnd: Hwnd) {
    if hwnd == 0 {
        return;
    }
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            -30_000,
            -30_000,
            1,
            1,
            SWP_NOACTIVATE,
        );
    }
}

/// Destroy a window and stop tracking it.
pub fn destroy_annotation(hwnd: Hwnd) {
    if hwnd == 0 {
        return;
    }
    if let Ok(mut list) = ANNOTATION_WINDOWS.lock() {
        list.retain(|&h| h != hwnd);
    }
    unsafe {
        DestroyWindow(hwnd);
    }
    repaint_desktop();
}

/// How many annotation windows exist right now.
///
/// Counted from this module's own list rather than from the manager's map, so
/// the two can be compared. Agreement is the assertion; a difference is a leak.
pub fn annotation_window_count() -> usize {
    ANNOTATION_WINDOWS.lock().map(|l| l.len()).unwrap_or(0)
}

/// Destroy every annotation window. Called on shutdown, so nothing outlives
/// the process that drew it.
pub fn destroy_all_annotations() -> usize {
    let handles: Vec<Hwnd> = ANNOTATION_WINDOWS
        .lock()
        .map(|mut l| std::mem::take(&mut *l))
        .unwrap_or_default();
    let n = handles.len();
    for hwnd in handles {
        unsafe {
            DestroyWindow(hwnd);
        }
    }
    if n > 0 {
        repaint_desktop();
    }
    n
}
