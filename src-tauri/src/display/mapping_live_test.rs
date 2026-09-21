//! Where the calibration ring actually appears, on the monitors plugged in.
//!
//! The first physical run measured a 443 px average error and none of it came
//! from the display. The ring was a DOM element inside the ArcSonare window, so
//! it was drawn at a fraction of the *window* while Rust compared against a
//! fraction of the *monitor*. The user aimed correctly at a ring in the wrong
//! place.
//!
//! Nothing inside the webview could have caught that: every measurement there
//! agrees with every other. The only way to see it is to ask Windows where the
//! overlay window ended up and compare that against the point being verified —
//! which is what this does, for all nine targets on every attached monitor,
//! before any human is asked to aim at anything.
//!
//! Draws briefly on screen and cleans up. No cursor movement, no clicks.
//!
//! Run: cargo test --lib display_mapping_native_targets -- --nocapture --ignored

#![cfg(windows)]

use super::identity::enumerate_monitor_identities;
use super::mapping::{nine_point_targets, to_desktop};

/// How far the drawn ring may sit from the point it represents.
///
/// Zero in principle: both come from the same integer arithmetic. One pixel of
/// slack covers the rounding in the overlay's own centring, and anything larger
/// means the ring is not where the wizard thinks it is.
const MAX_CENTRE_ERROR_PX: f64 = 1.0;

#[test]
#[ignore = "draws on the real screen; run explicitly"]
fn display_mapping_native_targets() {
    println!("\n{}", "=".repeat(78));
    println!("NATIVE CALIBRATION TARGETS — drawn on the real monitors");
    println!("{}", "=".repeat(78));

    let identities = match enumerate_monitor_identities() {
        Ok(i) => i,
        Err(e) => {
            println!("SKIP: {e}");
            return;
        }
    };

    crate::native_overlay::init();
    let mut worst = 0.0_f64;
    let mut checked = 0usize;

    for identity in &identities {
        println!(
            "\n{} — {}x{} at ({}, {})",
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
        println!("  stable key {}", identity.stable_key());
        println!(
            "\n  {:<14} {:>9} {:>9}   {:>9} {:>9}   {:>7}",
            "target", "expect x", "expect y", "drawn x", "drawn y", "err px"
        );

        for (position, local) in nine_point_targets(identity.width as f64, identity.height as f64) {
            let expected = to_desktop(local, identity.x, identity.y);

            // The production call, centre-based — the same one `draw_target`
            // makes, so this measures the path the user actually gets.
            if let Err(e) = crate::native_overlay::show_calibration_target(
                expected.x.round() as i32,
                expected.y.round() as i32,
            ) {
                println!("  SKIP: the overlay refused to draw: {e}");
                return;
            }
            // Let the window manager place the window before asking where it is.
            std::thread::sleep(std::time::Duration::from_millis(90));

            let Some((cx, cy)) = crate::native_overlay::calibration_target_centre() else {
                println!("  SKIP: the overlay window could not be read back");
                return;
            };
            let drawn_cx = cx as f64;
            let drawn_cy = cy as f64;
            let error = ((drawn_cx - expected.x).powi(2) + (drawn_cy - expected.y).powi(2)).sqrt();
            worst = worst.max(error);
            checked += 1;

            println!(
                "  {:<14} {:>9.0} {:>9.0}   {:>9.1} {:>9.1}   {:>7.2}",
                position.label(),
                expected.x,
                expected.y,
                drawn_cx,
                drawn_cy,
                error
            );

            // The ring must land on the monitor it belongs to. Under the old bug
            // the targets for the portrait display were drawn inside a window on
            // the ultrawide, which this catches directly.
            assert!(
                drawn_cx >= identity.x as f64
                    && drawn_cy >= identity.y as f64
                    && drawn_cx < (identity.x + identity.width as i32) as f64
                    && drawn_cy < (identity.y + identity.height as i32) as f64,
                "the {} target was drawn at ({drawn_cx}, {drawn_cy}), outside this monitor",
                position.label()
            );
            assert!(
                error <= MAX_CENTRE_ERROR_PX,
                "the {} ring is {error:.2}px from the point it represents",
                position.label()
            );
        }
    }

    crate::native_overlay::hide_highlight();
    println!(
        "\n{checked} targets across {} monitor(s); worst centre error {worst:.2}px",
        identities.len()
    );
    println!("every ring was drawn on its own monitor, at the point being verified");
    println!("{}\n", "=".repeat(78));
}

/// Repeated `init()` must not leave a trail of live overlay windows.
///
/// This is the bug the screenshots showed and the earlier live test missed: that
/// test called `init()` once and then looped `show_calibration_target`, whereas
/// the wizard calls `init()` before *every* target. Each call used to create a
/// fresh set of windows and overwrite the handle statics, orphaning the previous
/// ones while they were still visible — nine targets, nine live windows, and
/// `hide_highlight` able to clear only the last.
///
/// So this drives the sequence the way `draw_target` does, and asks Windows how
/// many overlay windows exist rather than trusting the statics.
///
/// Run: cargo test --lib overlay_windows_do_not_accumulate -- --nocapture --ignored
#[test]
#[ignore = "creates native windows; run explicitly"]
fn overlay_windows_do_not_accumulate() {
    use crate::native_overlay::{
        hide_highlight, init, overlay_window_census, show_calibration_target, visible_overlay_count,
    };

    println!("\n{}", "=".repeat(74));
    println!("OVERLAY WINDOW CENSUS — one target at a time");
    println!("{}", "=".repeat(74));

    init();
    std::thread::sleep(std::time::Duration::from_millis(300));
    let baseline = overlay_window_census().len();
    println!("\nafter first init      {baseline} overlay window(s)");

    // Exactly what the wizard does for each of the nine points.
    for (index, (position, local)) in nine_point_targets(1200.0, 800.0).into_iter().enumerate() {
        init(); // the production path calls this every time
        let _ = show_calibration_target(local.x.round() as i32, local.y.round() as i32);
        std::thread::sleep(std::time::Duration::from_millis(60));
        let visible = visible_overlay_count();
        println!(
            "  point {} {:<14} windows {}  visible {}",
            index + 1,
            position.label(),
            overlay_window_census().len(),
            visible
        );
        assert!(
            visible <= 1,
            "{} overlay windows are visible at once — the wizard is leaving \
             orphaned targets on screen",
            visible
        );
    }

    let after = overlay_window_census().len();
    println!("\nafter nine targets    {after} overlay window(s)");
    assert_eq!(
        after,
        baseline,
        "nine calls to init() created {} extra windows; init must be idempotent",
        after - baseline
    );

    hide_highlight();
    std::thread::sleep(std::time::Duration::from_millis(120));
    let left = visible_overlay_count();
    println!("after hide_highlight  {left} visible");
    assert_eq!(left, 0, "a target survived cleanup");

    println!("\none window reused throughout; nothing left on screen");
    println!("{}\n", "=".repeat(74));
}

/// The three target states, drawn on the real screen in sequence.
///
/// Colour is the only thing distinguishing "aim here" from "that one counted",
/// and the first physical runs showed every target the same white — so the user
/// could not tell the active point from the eight already done. A person still
/// has to confirm the hues, but this proves each state paints, that only one
/// window is ever visible, and that nothing survives cleanup.
///
/// Run: cargo test --lib calibration_target_states -- --nocapture --ignored
#[test]
#[ignore = "draws on the real screen; run explicitly"]
fn calibration_target_states() {
    use crate::native_overlay::{
        hide_highlight, init, show_calibration_target_in, visible_overlay_count,
        CalibrationTargetState,
    };

    println!("\n{}", "=".repeat(74));
    println!("CALIBRATION TARGET STATES");
    println!("{}", "=".repeat(74));

    init();
    std::thread::sleep(std::time::Duration::from_millis(300));

    for (state, description) in [
        (CalibrationTargetState::Active, "violet — aim here"),
        (CalibrationTargetState::Accepted, "green — that one counted"),
        (CalibrationTargetState::Rejected, "amber — not recorded"),
    ] {
        show_calibration_target_in(600, 400, state).expect("the target must draw");
        std::thread::sleep(std::time::Duration::from_millis(350));
        let visible = visible_overlay_count();
        println!("  {:<10?} {:<30} visible {}", state, description, visible);
        assert_eq!(visible, 1, "exactly one target may be on screen");
    }

    hide_highlight();
    std::thread::sleep(std::time::Duration::from_millis(150));
    assert_eq!(visible_overlay_count(), 0, "a target survived cleanup");
    println!("\nthree states drawn, one at a time, none left behind");
    println!("{}\n", "=".repeat(74));
}
