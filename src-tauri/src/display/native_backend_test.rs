//! The production side-effect backend, against real Windows.
//!
//! Every enforcement test added so far uses `RecordingSideEffects`. Those prove
//! the *decisions* — that a refusal reaches no side effect and a permitted
//! action reaches exactly one. What they cannot prove is that
//! `NativeSideEffects` still forwards to the right Win32 call, because a
//! recorder answers identically whether the production backend is wired
//! correctly or not at all.
//!
//! So this exercises `NativeSideEffects` itself on both physical monitors and
//! reads the result back out of Windows: the overlay's real rectangle, the real
//! cursor position, and ArcSonare's own click counter.
//!
//! Only ArcSonare's own test window is ever clicked. Nothing else is touched.
//!
//! Run: cargo test --lib native_backend_physical -- --nocapture --ignored

#![cfg(windows)]

use super::authority::VisualExecutionAuthority;
use super::identity::enumerate_monitor_identities;
use super::side_effects::{
    DesktopPoint, DesktopRect, MouseButton, NativeSideEffects, VisualSideEffects,
};
use crate::visual_test_target as target;

/// How far the overlay may sit from where it was asked to go.
///
/// The same bar the calibration targets are held to. Both come from integer
/// arithmetic, so the honest expectation is zero; one pixel covers the rounding
/// in the overlay's own centring.
const MAX_PLACEMENT_ERROR_PX: f64 = 1.0;

/// A rectangle safely inside a monitor, away from the taskbar and the corners
/// Windows reserves.
fn safe_rect(x: i32, y: i32, width: u32, height: u32) -> DesktopRect {
    DesktopRect {
        x: x + (width as i32 / 4),
        y: y + (height as i32 / 4),
        width: 200,
        height: 140,
    }
}

#[test]
#[ignore = "draws and moves the pointer on the real screen; run explicitly"]
fn native_backend_physical() {
    println!("\n{}", "=".repeat(76));
    println!("NATIVE SIDE-EFFECT BACKEND — against real Windows");
    println!("{}", "=".repeat(76));

    let identities = match enumerate_monitor_identities() {
        Ok(i) if !i.is_empty() => i,
        _ => {
            println!("SKIP: no monitors reported");
            return;
        }
    };

    crate::native_overlay::init();
    std::thread::sleep(std::time::Duration::from_millis(300));
    let backend = NativeSideEffects;

    // -----------------------------------------------------------------------
    // Overlay, on every monitor
    // -----------------------------------------------------------------------
    for identity in &identities {
        println!(
            "\n--- {} {}x{} at ({}, {})",
            if identity.friendly_name.is_empty() {
                "Display"
            } else {
                &identity.friendly_name
            },
            identity.width,
            identity.height,
            identity.x,
            identity.y
        );
        println!("    identity {}", identity.stable_key());

        let requested = safe_rect(identity.x, identity.y, identity.width, identity.height);
        let cursor_before = backend.read_cursor();
        let authority = VisualExecutionAuthority::covering_for_test(
            0,
            identity.x,
            identity.y,
            identity.width,
            identity.height,
        );

        backend
            .show_overlay(authority.vouch_rect_for_test(requested))
            .expect("the production backend must draw");
        std::thread::sleep(std::time::Duration::from_millis(120));

        let drawn = crate::native_overlay::highlight_target_rect()
            .expect("the overlay window must be readable");
        let error = (((drawn.0 - requested.x) as f64).powi(2)
            + ((drawn.1 - requested.y) as f64).powi(2))
        .sqrt();
        let visible = crate::native_overlay::visible_overlay_count();

        println!(
            "    requested  ({}, {}) {}x{}",
            requested.x, requested.y, requested.width, requested.height
        );
        println!(
            "    actual     ({}, {}) {}x{}   [Win32 readback]",
            drawn.0, drawn.1, drawn.2, drawn.3
        );
        println!("    error      {error:.2} px      visible overlays {visible}");

        assert!(
            error <= MAX_PLACEMENT_ERROR_PX,
            "the native backend placed the overlay {error:.2}px from the request"
        );
        assert_eq!(visible, 1, "exactly one overlay may be on screen");

        // The overlay must land on the monitor it was aimed at — the check that
        // catches a negative origin being dropped or a sign flipped.
        let cx = drawn.0 + drawn.2 / 2;
        let cy = drawn.1 + drawn.3 / 2;
        assert!(
            cx >= identity.x
                && cy >= identity.y
                && cx < identity.x + identity.width as i32
                && cy < identity.y + identity.height as i32,
            "the overlay landed outside the monitor it was drawn for"
        );

        // Preview must not touch the pointer.
        assert_eq!(
            backend.read_cursor(),
            cursor_before,
            "showing an overlay moved the cursor"
        );

        backend.hide_overlay();
        std::thread::sleep(std::time::Duration::from_millis(120));
        assert_eq!(
            crate::native_overlay::visible_overlay_count(),
            0,
            "an overlay survived hide_overlay"
        );
        println!("    cleanup    0 visible");
    }

    // -----------------------------------------------------------------------
    // Cursor, on every monitor
    // -----------------------------------------------------------------------
    println!("\n--- cursor");
    for identity in &identities {
        let point = DesktopPoint {
            x: identity.x + identity.width as i32 / 2,
            y: identity.y + identity.height as i32 / 2,
        };
        let authority = VisualExecutionAuthority::covering_for_test(
            0,
            identity.x,
            identity.y,
            identity.width,
            identity.height,
        );
        backend
            .move_cursor(authority.vouch_for_test(point.x, point.y))
            .expect("the cursor must move");
        std::thread::sleep(std::time::Duration::from_millis(80));
        let actual = backend.read_cursor().expect("the cursor must be readable");
        let error =
            (((actual.x - point.x) as f64).powi(2) + ((actual.y - point.y) as f64).powi(2)).sqrt();
        println!(
            "    requested ({}, {})  actual ({}, {})  error {error:.2} px",
            point.x, point.y, actual.x, actual.y
        );
        assert!(
            error <= MAX_PLACEMENT_ERROR_PX,
            "the native backend put the cursor {error:.2}px from the request"
        );
        assert_eq!(
            crate::native_overlay::visible_overlay_count(),
            0,
            "moving the cursor drew something"
        );
    }

    // -----------------------------------------------------------------------
    // Click, against ArcSonare's own test window, on every monitor
    // -----------------------------------------------------------------------
    println!("\n--- click");
    target::init();
    std::thread::sleep(std::time::Duration::from_millis(300));

    for identity in &identities {
        target::reset();
        let state =
            match target::show_centered_on(identity.x, identity.y, identity.width, identity.height)
            {
                Ok(s) => s,
                Err(e) => {
                    println!("    SKIP on this monitor: {e}");
                    continue;
                }
            };
        std::thread::sleep(std::time::Duration::from_millis(250));

        let Some(button) = state.button else {
            println!("    SKIP: the test window reported no button");
            target::hide();
            continue;
        };
        let point = DesktopPoint {
            x: button.x + button.width / 2,
            y: button.y + button.height / 2,
        };
        let before = target::state().clicks;

        let authority = VisualExecutionAuthority::covering_for_test(
            0,
            identity.x,
            identity.y,
            identity.width,
            identity.height,
        );
        let authorized = authority.vouch_for_test(point.x, point.y);
        backend.move_cursor(authorized).expect("cursor");
        std::thread::sleep(std::time::Duration::from_millis(80));
        let landed = backend.read_cursor().expect("cursor readback");
        backend
            .click(authorized, MouseButton::Left)
            .expect("the production backend must click");
        std::thread::sleep(std::time::Duration::from_millis(300));

        let after = target::state().clicks;
        println!(
            "    button at ({}, {})  cursor ({}, {})  clicks {} -> {}",
            point.x, point.y, landed.x, landed.y, before, after
        );
        assert_eq!(
            after,
            before + 1,
            "the click must register exactly once — {before} -> {after}"
        );

        target::hide();
        std::thread::sleep(std::time::Duration::from_millis(120));
    }

    target::reset();
    target::hide();
    backend.hide_overlay();
    std::thread::sleep(std::time::Duration::from_millis(150));
    assert_eq!(
        crate::native_overlay::visible_overlay_count(),
        0,
        "something was left on screen"
    );

    println!("\nnative backend forwards correctly on all monitors; nothing left behind");
    println!("{}\n", "=".repeat(76));
}

/// A point on no monitor reaches no native input at all.
///
/// The refusal itself is unit-tested; this proves the *native* consequence —
/// that the cursor does not move and the counter does not change when the gate
/// says no.
#[test]
#[ignore = "reads the real cursor; run explicitly"]
fn native_backend_refuses_a_point_outside_every_display() {
    println!("\n{}", "=".repeat(76));
    println!("OUTSIDE ALL DISPLAYS — nothing may reach Windows");
    println!("{}", "=".repeat(76));

    let identities = match enumerate_monitor_identities() {
        Ok(i) if !i.is_empty() => i,
        _ => {
            println!("SKIP: no monitors reported");
            return;
        }
    };
    let backend = NativeSideEffects;
    crate::native_overlay::init();
    target::init();
    std::thread::sleep(std::time::Duration::from_millis(300));

    // Far outside anything attached.
    let (x, y) = (100_000, 100_000);
    assert!(
        !identities
            .iter()
            .any(|i| x >= i.x && y >= i.y && x < i.x + i.width as i32 && y < i.y + i.height as i32),
        "the test point must genuinely be off every monitor"
    );

    let cursor_before = backend.read_cursor();
    let clicks_before = target::state().clicks;
    let overlays_before = crate::native_overlay::visible_overlay_count();

    // The gate answers before any native call. Nothing below it runs.
    let refusal = super::wizard::require_verified_display_at_for_test(x, y);
    println!("\n    point      ({x}, {y})");
    println!("    refusal    {refusal:?}");
    assert!(refusal.is_err(), "a point on no display must be refused");

    std::thread::sleep(std::time::Duration::from_millis(120));
    let cursor_after = backend.read_cursor();
    println!("    cursor     {cursor_before:?} -> {cursor_after:?}");
    println!(
        "    clicks     {} -> {}",
        clicks_before,
        target::state().clicks
    );

    assert_eq!(cursor_after, cursor_before, "the cursor moved on a refusal");
    assert_eq!(
        target::state().clicks,
        clicks_before,
        "a click was sent on a refusal"
    );
    assert_eq!(
        crate::native_overlay::visible_overlay_count(),
        overlays_before,
        "an overlay appeared on a refusal"
    );

    target::hide();
    println!("\nnothing reached Windows");
    println!("{}\n", "=".repeat(76));
}
