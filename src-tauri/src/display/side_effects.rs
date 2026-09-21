//! The last inch before Windows: overlay, cursor, click.
//!
//! Every refusal in this subsystem is meant to produce *nothing* — no border, no
//! cursor movement, no injected click. Until now that was argued from control
//! flow: the refusal returns before the call, therefore the call cannot happen.
//! That reasoning has been wrong twice already in this codebase, both times
//! because a second path existed that nobody had traced.
//!
//! So the three native operations go through one trait. Production calls the
//! same Win32 functions it always did; tests swap in a recorder and count. A
//! refusal that leaks a side effect now fails a test instead of relying on
//! someone re-reading the control flow correctly.
//!
//! Deliberately narrow. It sits *below* the profile gate, frame ownership,
//! freshness and verification — none of that logic is duplicated or weakened,
//! and there is no mock-only execution path. Only the final backend differs.

#![cfg(windows)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use super::authority::{AuthorizedPoint, AuthorizedRect};

/// Which button, and how many presses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Right,
    Double,
}

impl MouseButton {
    pub fn from_str(s: &str) -> Self {
        match s {
            "right" => Self::Right,
            "double" => Self::Double,
            _ => Self::Left,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
            Self::Double => "double",
        }
    }
}

/// Final virtual-desktop physical pixels. Nothing here converts anything: by the
/// time a call reaches this trait the coordinate is already resolved, gated and
/// corrected, and re-deriving it would be the double-application bug.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopPoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Every method that changes the user's screen takes an authorized coordinate.
///
/// That is the whole enforcement mechanism. `AuthorizedPoint` and
/// `AuthorizedRect` have no public constructor, so the only way to call these is
/// to hold a `VisualExecutionAuthority` — which only the profile gate issues. A
/// new command that forgets the gate cannot compile.
///
/// `hide_overlay` and `read_cursor` stay unauthorized: one is cleanup that must
/// remain available on every refusal path, the other changes nothing.
pub trait VisualSideEffects: Send + Sync {
    fn show_overlay(&self, rect: AuthorizedRect) -> Result<(), String>;
    fn hide_overlay(&self);
    fn move_cursor(&self, point: AuthorizedPoint) -> Result<(), String>;
    fn read_cursor(&self) -> Option<DesktopPoint>;
    fn click(&self, point: AuthorizedPoint, button: MouseButton) -> Result<(), String>;
}

/// What ships. Every method forwards to the function that was already being
/// called at that point, so wiring the trait in changed no behaviour.
pub struct NativeSideEffects;

impl VisualSideEffects for NativeSideEffects {
    fn show_overlay(&self, rect: AuthorizedRect) -> Result<(), String> {
        let r = rect.desktop_rect();
        crate::native_overlay::show_highlight(r.x, r.y, r.width, r.height)
    }

    fn hide_overlay(&self) {
        crate::native_overlay::hide_highlight();
    }

    fn move_cursor(&self, point: AuthorizedPoint) -> Result<(), String> {
        crate::capabilities::input::set_cursor_position(point.x(), point.y())
    }

    fn read_cursor(&self) -> Option<DesktopPoint> {
        crate::capabilities::input::read_cursor_position().map(|(x, y)| DesktopPoint { x, y })
    }

    fn click(&self, point: AuthorizedPoint, button: MouseButton) -> Result<(), String> {
        crate::capabilities::input::click_at_point(point.x(), point.y(), button.as_str())
    }
}

/// Counts what production would have done, and does nothing.
///
/// The assertion this exists for is `== 0`, so it records rather than simulates:
/// a recorder that could itself fail would blur "the refusal worked" with "the
/// backend errored".
#[derive(Default)]
pub struct RecordingSideEffects {
    pub overlay_show_calls: AtomicUsize,
    pub overlay_hide_calls: AtomicUsize,
    pub cursor_move_calls: AtomicUsize,
    pub click_calls: AtomicUsize,
    pub overlay_rects: Mutex<Vec<DesktopRect>>,
    pub cursor_points: Mutex<Vec<DesktopPoint>>,
    pub click_points: Mutex<Vec<(DesktopPoint, MouseButton)>>,
    /// What `read_cursor` should answer, so verification can be exercised
    /// without a real pointer.
    pub cursor_reads_as: Mutex<Option<DesktopPoint>>,
}

impl RecordingSideEffects {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every counter that a refusal must leave at zero.
    pub fn totals(&self) -> SideEffectTotals {
        SideEffectTotals {
            overlay_show: self.overlay_show_calls.load(Ordering::SeqCst),
            overlay_hide: self.overlay_hide_calls.load(Ordering::SeqCst),
            cursor_move: self.cursor_move_calls.load(Ordering::SeqCst),
            click: self.click_calls.load(Ordering::SeqCst),
        }
    }

    /// Hide, for tests that need to prove cleanup survives a refusal without
    /// importing the trait.
    #[cfg(test)]
    pub fn hide_overlay_for_test(&self) {
        VisualSideEffects::hide_overlay(self);
    }

    /// Nothing reached Windows. `hide_overlay` is excluded on purpose — tidying
    /// up after a refusal is not a side effect on the user's screen, and
    /// forbidding it would push cleanup out of the failure paths.
    pub fn nothing_happened(&self) -> bool {
        let t = self.totals();
        t.overlay_show == 0 && t.cursor_move == 0 && t.click == 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SideEffectTotals {
    pub overlay_show: usize,
    pub overlay_hide: usize,
    pub cursor_move: usize,
    pub click: usize,
}

impl VisualSideEffects for RecordingSideEffects {
    fn show_overlay(&self, rect: AuthorizedRect) -> Result<(), String> {
        self.overlay_show_calls.fetch_add(1, Ordering::SeqCst);
        self.overlay_rects.lock().unwrap().push(rect.desktop_rect());
        Ok(())
    }

    fn hide_overlay(&self) {
        self.overlay_hide_calls.fetch_add(1, Ordering::SeqCst);
    }

    fn move_cursor(&self, point: AuthorizedPoint) -> Result<(), String> {
        self.cursor_move_calls.fetch_add(1, Ordering::SeqCst);
        self.cursor_points
            .lock()
            .unwrap()
            .push(point.desktop_point());
        *self.cursor_reads_as.lock().unwrap() = Some(point.desktop_point());
        Ok(())
    }

    fn read_cursor(&self) -> Option<DesktopPoint> {
        *self.cursor_reads_as.lock().unwrap()
    }

    fn click(&self, point: AuthorizedPoint, button: MouseButton) -> Result<(), String> {
        self.click_calls.fetch_add(1, Ordering::SeqCst);
        self.click_points
            .lock()
            .unwrap()
            .push((point.desktop_point(), button));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_recorder_has_seen_nothing() {
        let r = RecordingSideEffects::new();
        assert!(r.nothing_happened());
        assert_eq!(
            r.totals(),
            SideEffectTotals {
                overlay_show: 0,
                overlay_hide: 0,
                cursor_move: 0,
                click: 0,
            }
        );
    }

    #[test]
    fn the_recorder_counts_and_remembers_what_it_was_asked_to_do() {
        let r = RecordingSideEffects::new();
        let rect = DesktopRect {
            x: -1000,
            y: -600,
            width: 74,
            height: 70,
        };
        let a = super::super::authority::VisualExecutionAuthority::covering_for_test(
            2, -1080, -661, 1080, 1920,
        );
        let point = DesktopPoint { x: -540, y: 299 };
        r.show_overlay(a.vouch_rect_for_test(rect)).unwrap();
        r.move_cursor(a.vouch_for_test(point.x, point.y)).unwrap();
        r.click(a.vouch_for_test(point.x, point.y), MouseButton::Left)
            .unwrap();

        let t = r.totals();
        assert_eq!((t.overlay_show, t.cursor_move, t.click), (1, 1, 1));
        assert!(!r.nothing_happened());
        assert_eq!(r.overlay_rects.lock().unwrap()[0], rect);
        assert_eq!(r.cursor_points.lock().unwrap()[0], point);
        assert_eq!(
            r.click_points.lock().unwrap()[0],
            (point, MouseButton::Left)
        );
    }

    /// Cleaning up after a refusal must stay allowed.
    #[test]
    fn hiding_an_overlay_is_not_a_side_effect_on_the_user() {
        let r = RecordingSideEffects::new();
        r.hide_overlay();
        assert!(r.nothing_happened());
        assert_eq!(r.totals().overlay_hide, 1);
    }

    #[test]
    fn a_moved_cursor_reads_back_where_it_was_put() {
        let r = RecordingSideEffects::new();
        assert_eq!(r.read_cursor(), None);
        let a = super::super::authority::VisualExecutionAuthority::covering_for_test(
            1, 0, 0, 3840, 1080,
        );
        let p = DesktopPoint { x: 1920, y: 540 };
        r.move_cursor(a.vouch_for_test(p.x, p.y)).unwrap();
        assert_eq!(r.read_cursor(), Some(p));
    }

    #[test]
    fn button_names_round_trip() {
        for (name, button) in [
            ("left", MouseButton::Left),
            ("right", MouseButton::Right),
            ("double", MouseButton::Double),
        ] {
            assert_eq!(MouseButton::from_str(name), button);
            assert_eq!(button.as_str(), name);
        }
        // Anything unrecognised is the least destructive button, not a panic.
        assert_eq!(MouseButton::from_str("wheel-of-fortune"), MouseButton::Left);
    }
}
