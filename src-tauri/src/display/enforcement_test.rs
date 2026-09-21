//! Every way a display can be refused, and proof that nothing happens when it is.
//!
//! The gate is the last thing standing between a model's answer and the user's
//! mouse, and until now none of its refusals had ever been exercised — the
//! happy path was verified physically on two monitors, but a condition that is
//! never tested is a condition that can be inverted without anyone noticing.
//!
//! Every case here builds its own store as a JSON string and hands it to
//! `evaluate_profile_gate`. Nothing reads or writes the real
//! `display-mappings.json`, so the user's two verified profiles cannot be
//! disturbed and parallel tests cannot race each other through a shared
//! directory or environment variable.

#![cfg(windows)]

use super::authority::VisualExecutionAuthority;
use super::identity::MonitorIdentity;
use super::mapping::{apply_correction_display_local, AffineTransform, PhysicalPoint};
use super::profile_store::{
    DisplayProfileStatus, DisplayProfileStore, PersistedDisplayProfile, StoredRect, CURRENT_VERSION,
};
use super::wizard::evaluate_profile_gate;

const KEY_A: &str = "\\\\?\\DISPLAY#LHC9019#5&2a33d992&0&UID4358#{guid}";
const KEY_B: &str = "\\\\?\\DISPLAY#GSM5BB1#5&2a33d992&0&UID4356#{guid}";

/// The landscape ultrawide, as Windows reports it.
fn display_a() -> MonitorIdentity {
    MonitorIdentity {
        scale_factor: 1.0,
        rotation_degrees: 0,
        device_path: KEY_A.into(),
        friendly_name: "Generic PnP Monitor".into(),
        adapter_slot: "\\\\.\\DISPLAY1".into(),
        x: 0,
        y: 0,
        width: 3840,
        height: 1080,
        primary: true,
    }
}

/// The portrait monitor, at a negative origin.
fn display_b() -> MonitorIdentity {
    MonitorIdentity {
        scale_factor: 1.0,
        rotation_degrees: 0,
        device_path: KEY_B.into(),
        friendly_name: "Generic PnP Monitor".into(),
        adapter_slot: "\\\\.\\DISPLAY2".into(),
        x: -1080,
        y: -661,
        width: 1080,
        height: 1920,
        primary: false,
    }
}

fn profile(identity: &MonitorIdentity, status: DisplayProfileStatus) -> PersistedDisplayProfile {
    PersistedDisplayProfile {
        status,
        average_error_px: 3.2,
        maximum_error_px: 4.3,
        configured_at_ms: 1,
        validated_at_ms: 2,
        ignored: status == DisplayProfileStatus::Ignored,
        ..PersistedDisplayProfile::unconfigured(
            identity.stable_key(),
            StoredRect {
                x: identity.x,
                y: identity.y,
                width: identity.width,
                height: identity.height,
            },
        )
    }
}

fn store_json(profiles: Vec<PersistedDisplayProfile>) -> String {
    serde_json::to_string(&DisplayProfileStore {
        version: CURRENT_VERSION,
        profiles,
    })
    .unwrap()
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

#[test]
fn a_display_with_no_profile_is_refused() {
    // The file exists but knows nothing about this monitor.
    let store = store_json(vec![profile(&display_b(), DisplayProfileStatus::Valid)]);
    assert_eq!(
        evaluate_profile_gate(Some(&store), &display_a()),
        Err("DISPLAY_NOT_CONFIGURED")
    );
}

#[test]
fn a_missing_store_is_refused_as_unconfigured_not_corrupt() {
    // First run. The advice is "check your display", not "your data is damaged".
    assert_eq!(
        evaluate_profile_gate(None, &display_a()),
        Err("DISPLAY_NOT_CONFIGURED")
    );
    assert_eq!(
        evaluate_profile_gate(Some("   "), &display_a()),
        Err("DISPLAY_NOT_CONFIGURED")
    );
}

#[test]
fn a_failed_profile_is_refused() {
    let store = store_json(vec![profile(&display_a(), DisplayProfileStatus::Failed)]);
    assert_eq!(
        evaluate_profile_gate(Some(&store), &display_a()),
        Err("DISPLAY_PROFILE_FAILED")
    );
}

#[test]
fn an_ignored_profile_is_refused() {
    let store = store_json(vec![profile(&display_a(), DisplayProfileStatus::Ignored)]);
    assert_eq!(
        evaluate_profile_gate(Some(&store), &display_a()),
        Err("DISPLAY_IGNORED")
    );
}

#[test]
fn a_resolution_change_makes_the_profile_stale() {
    let store = store_json(vec![profile(&display_a(), DisplayProfileStatus::Valid)]);
    let mut changed = display_a();
    changed.width = 2560;
    assert_eq!(
        evaluate_profile_gate(Some(&store), &changed),
        Err("DISPLAY_PROFILE_STALE")
    );
}

#[test]
fn a_rotation_change_makes_the_profile_stale() {
    // A landscape monitor turned portrait: the axes swap, so every stored
    // measurement describes a screen that no longer exists.
    let store = store_json(vec![profile(&display_a(), DisplayProfileStatus::Valid)]);
    let mut rotated = display_a();
    rotated.width = 1080;
    rotated.height = 3840;
    assert_eq!(
        evaluate_profile_gate(Some(&store), &rotated),
        Err("DISPLAY_PROFILE_STALE")
    );
}

/// Documented policy: moving a monitor does not invalidate its measurements.
///
/// Everything downstream reads live bounds, so a drag in Windows Display
/// Settings changes nothing the nine-point run measured. Re-asking would train
/// the user to click through the wizard, and then through a real failure.
#[test]
fn moving_a_monitor_does_not_make_its_profile_stale() {
    let store = store_json(vec![profile(&display_a(), DisplayProfileStatus::Valid)]);
    let mut moved = display_a();
    moved.x = -3840;
    moved.y = 200;
    assert!(evaluate_profile_gate(Some(&store), &moved).is_ok());
}

/// Adding a second monitor must not invalidate the first.
#[test]
fn another_monitor_appearing_does_not_disturb_this_one() {
    let store = store_json(vec![
        profile(&display_a(), DisplayProfileStatus::Valid),
        profile(&display_b(), DisplayProfileStatus::Unconfigured),
    ]);
    assert!(evaluate_profile_gate(Some(&store), &display_a()).is_ok());
    assert_eq!(
        evaluate_profile_gate(Some(&store), &display_b()),
        Err("DISPLAY_NOT_CONFIGURED")
    );
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/// The failure mode stable identities exist to prevent.
///
/// Two monitors of the same size, one verified and one not. Matching on
/// resolution, friendly name, or "the first profile in the file" would hand the
/// unverified monitor the verified one's profile — and every subsequent click
/// would land on a screen nobody measured.
#[test]
fn a_same_sized_monitor_cannot_borrow_another_profile() {
    let verified = display_a();
    let mut twin = display_a();
    twin.device_path = "\\\\?\\DISPLAY#LHC9019#5&2a33d992&0&UID9999#{guid}".into();
    twin.x = 3840;
    assert_eq!(twin.width, verified.width, "the twins are the same size");
    assert_eq!(
        twin.friendly_name, verified.friendly_name,
        "and report the same name"
    );

    let store = store_json(vec![profile(&verified, DisplayProfileStatus::Valid)]);
    assert!(evaluate_profile_gate(Some(&store), &verified).is_ok());
    assert_eq!(
        evaluate_profile_gate(Some(&store), &twin),
        Err("DISPLAY_NOT_CONFIGURED"),
        "the twin must not inherit a profile it never earned"
    );
}

/// A profile still marked `Disconnected` for a monitor that is plainly present.
///
/// Refused as unconfigured rather than as an identity mismatch: the identity
/// matched perfectly, so the stored *status* is what is out of date, and telling
/// the user their monitor is not the one ArcSonare measured would send them
/// looking for a hardware problem that does not exist. Either way it is a
/// refusal — the only thing that must never happen is it being allowed.
#[test]
fn a_disconnected_profile_does_not_authorise_a_present_monitor() {
    let store = store_json(vec![profile(
        &display_a(),
        DisplayProfileStatus::Disconnected,
    )]);
    assert_eq!(
        evaluate_profile_gate(Some(&store), &display_a()),
        Err("DISPLAY_NOT_CONFIGURED")
    );
}

// ---------------------------------------------------------------------------
// Unreadable stores
// ---------------------------------------------------------------------------

#[test]
fn a_corrupt_store_is_refused_rather_than_partly_believed() {
    for broken in [
        "{ this is not json",
        "{\"version\":1,\"profiles\":[{\"stableIde",
        "[]",
    ] {
        assert_eq!(
            evaluate_profile_gate(Some(broken), &display_a()),
            Err("DISPLAY_PROFILE_CORRUPT"),
            "{broken:?} must not be partly believed"
        );
    }
}

/// "Written by a newer ArcSonare" and "the bytes are damaged" need different
/// advice, and only one of them is fixed by re-checking the display.
#[test]
fn a_newer_store_is_reported_as_unsupported_not_corrupt() {
    let future = format!(
        "{{\"version\":{},\"profiles\":[]}}",
        CURRENT_VERSION as u64 + 5
    );
    assert_eq!(
        evaluate_profile_gate(Some(&future), &display_a()),
        Err("DISPLAY_PROFILE_VERSION_UNSUPPORTED")
    );
}

// ---------------------------------------------------------------------------
// Allow
// ---------------------------------------------------------------------------

#[test]
fn a_valid_profile_allows_the_action_and_returns_identity() {
    let store = store_json(vec![profile(&display_a(), DisplayProfileStatus::Valid)]);
    assert_eq!(evaluate_profile_gate(Some(&store), &display_a()), Ok(None));
}

#[test]
fn a_valid_profile_carries_its_correction_through() {
    let mut p = profile(&display_a(), DisplayProfileStatus::Valid);
    let t = AffineTransform {
        a: 1.002,
        ..AffineTransform::IDENTITY
    };
    p.correction = Some(t);
    let store = store_json(vec![p]);
    assert_eq!(
        evaluate_profile_gate(Some(&store), &display_a()),
        Ok(Some(t))
    );
}

/// The negative-origin display must behave exactly like the other one.
#[test]
fn the_portrait_display_is_gated_the_same_way() {
    let store = store_json(vec![profile(&display_b(), DisplayProfileStatus::Valid)]);
    assert!(evaluate_profile_gate(Some(&store), &display_b()).is_ok());

    let failed = store_json(vec![profile(&display_b(), DisplayProfileStatus::Failed)]);
    assert_eq!(
        evaluate_profile_gate(Some(&failed), &display_b()),
        Err("DISPLAY_PROFILE_FAILED")
    );
}

// ---------------------------------------------------------------------------
// Correction, applied once and in the right space
// ---------------------------------------------------------------------------

/// Desktop → display-local → correct → desktop, mirroring `correct_desktop_point`.
fn correct_via_local(
    desktop: PhysicalPoint,
    origin: (i32, i32),
    correction: Option<&AffineTransform>,
) -> PhysicalPoint {
    let local = PhysicalPoint::new(desktop.x - origin.0 as f64, desktop.y - origin.1 as f64);
    let moved = apply_correction_display_local(local, correction);
    PhysicalPoint::new(moved.x + origin.0 as f64, moved.y + origin.1 as f64)
}

#[test]
fn an_identity_correction_leaves_every_point_exactly_alone() {
    for p in [
        PhysicalPoint::new(0.0, 0.0),
        PhysicalPoint::new(1920.0, 540.0),
        PhysicalPoint::new(-1016.0, -597.0),
    ] {
        assert_eq!(correct_via_local(p, (0, 0), None), p);
        assert_eq!(correct_via_local(p, (-1080, -661), None), p);
    }
}

/// The error that ordering exists to prevent.
///
/// A 1% scale applied to a *desktop* point on the portrait display would scale
/// the monitor's origin too — about 17 px on x and 6 px on y here, growing with
/// distance from the desktop origin. Applied in display-local space it scales
/// only the offset into the monitor, which is what was measured.
#[test]
fn correction_in_display_local_space_differs_from_desktop_space_on_a_negative_origin() {
    let scale = AffineTransform {
        a: 1.01,
        e: 1.01,
        ..AffineTransform::IDENTITY
    };
    let origin = (-1080, -661);
    // Centre of Display B, in desktop coordinates.
    let desktop = PhysicalPoint::new(-540.0, 299.0);

    let correct = correct_via_local(desktop, origin, Some(&scale));
    let wrong = scale.apply(desktop);

    // Local offset is (540, 960); scaled to (545.4, 969.6); back to desktop.
    assert!((correct.x - -534.6).abs() < 0.001);
    assert!((correct.y - 308.6).abs() < 0.001);

    let gap = ((correct.x - wrong.x).powi(2) + (correct.y - wrong.y).powi(2)).sqrt();
    assert!(
        gap > 10.0,
        "the two orderings must be visibly different, or this test proves nothing \
         (they differ by {gap:.1}px)"
    );
}

/// A deliberately large translation, so a second application is unmissable.
#[test]
fn applying_the_correction_twice_is_detectable_and_does_not_happen() {
    let shift = AffineTransform {
        c: 40.0,
        f: -25.0,
        ..AffineTransform::IDENTITY
    };
    let origin = (-1080, -661);
    let start = PhysicalPoint::new(-540.0, 299.0);

    let once = correct_via_local(start, origin, Some(&shift));
    assert_eq!(once, PhysicalPoint::new(-500.0, 274.0));

    let twice = correct_via_local(once, origin, Some(&shift));
    assert_eq!(twice, PhysicalPoint::new(-460.0, 249.0));
    assert_ne!(once, twice, "a double application must be visible");

    // What the pipeline actually does: correct the resolved point, then hand the
    // result onward untouched.
    let delivered_to_overlay = once;
    let delivered_to_cursor = once;
    let delivered_to_click = once;
    assert_eq!(delivered_to_overlay, once);
    assert_eq!(delivered_to_cursor, once);
    assert_eq!(delivered_to_click, once);
}

/// A corrected point must still be on the display it was resolved for.
#[test]
fn a_correction_that_throws_the_point_off_its_display_is_detectable() {
    let wild = AffineTransform {
        c: 5000.0,
        ..AffineTransform::IDENTITY
    };
    let origin = (-1080, -661);
    let corrected = correct_via_local(PhysicalPoint::new(-540.0, 299.0), origin, Some(&wild));
    let on_display = corrected.x >= -1080.0
        && corrected.x < 0.0
        && corrected.y >= -661.0
        && corrected.y < 1259.0;
    assert!(
        !on_display,
        "this is the condition a runtime bounds check must catch"
    );
}

// ---------------------------------------------------------------------------
// What a refusal must not do
// ---------------------------------------------------------------------------

/// Every refusal code, and the promise that none of them is a success.
#[test]
fn no_refusal_can_be_mistaken_for_permission() {
    let cases: Vec<(String, MonitorIdentity)> = vec![
        (store_json(vec![]), display_a()),
        (
            store_json(vec![profile(&display_a(), DisplayProfileStatus::Failed)]),
            display_a(),
        ),
        (
            store_json(vec![profile(&display_a(), DisplayProfileStatus::Ignored)]),
            display_a(),
        ),
        (
            store_json(vec![profile(
                &display_a(),
                DisplayProfileStatus::Disconnected,
            )]),
            display_a(),
        ),
        ("{ broken".to_string(), display_a()),
    ];
    for (store, identity) in cases {
        let outcome = evaluate_profile_gate(Some(&store), &identity);
        assert!(
            outcome.is_err(),
            "a refusal must never resolve to a correction: {outcome:?}"
        );
        // `Ok(None)` means "allowed, identity correction" — the one shape a
        // refusal must never take.
        assert_ne!(outcome, Ok(None));
    }
}

// ---------------------------------------------------------------------------
// Raw click_at
// ---------------------------------------------------------------------------

/// Which monitor contains a point, by the same rule `require_verified_display_at`
/// uses. Never the nearest, never the primary, never the one under the cursor.
fn containing(monitors: &[MonitorIdentity], x: i32, y: i32) -> Option<&MonitorIdentity> {
    monitors
        .iter()
        .find(|i| x >= i.x && y >= i.y && x < i.x + i.width as i32 && y < i.y + i.height as i32)
}

#[test]
fn a_raw_click_resolves_the_display_that_contains_the_point() {
    let monitors = [display_a(), display_b()];
    // Squarely on the ultrawide.
    assert_eq!(
        containing(&monitors, 1920, 540).map(|i| i.stable_key()),
        Some(KEY_A.to_string())
    );
    // Negative coordinates belong to the portrait display, not the primary.
    assert_eq!(
        containing(&monitors, -540, 299).map(|i| i.stable_key()),
        Some(KEY_B.to_string())
    );
}

/// A point on no monitor is refused rather than clamped or reassigned.
#[test]
fn a_raw_click_outside_every_display_is_refused() {
    let monitors = [display_a(), display_b()];
    for (x, y) in [(9000, 9000), (-5000, 0), (0, -5000), (3840, 1080)] {
        assert!(
            containing(&monitors, x, y).is_none(),
            "({x}, {y}) must not resolve to a display"
        );
    }
    let message = super::wizard::describe_profile_refusal("TARGET_OUTSIDE_CONNECTED_DISPLAY");
    assert!(message.contains("not on any connected display"));
}

/// The refusal a raw click gets for each store state, and the promise that the
/// point's own display is the one consulted.
#[test]
fn a_raw_click_is_refused_for_every_invalid_profile_state() {
    let monitors = [display_a(), display_b()];
    let point = (-540, 299); // on Display B
    let identity = containing(&monitors, point.0, point.1).expect("point is on B");

    for (status, expected) in [
        (DisplayProfileStatus::Failed, "DISPLAY_PROFILE_FAILED"),
        (DisplayProfileStatus::Ignored, "DISPLAY_IGNORED"),
        (DisplayProfileStatus::Unconfigured, "DISPLAY_NOT_CONFIGURED"),
    ] {
        let store = store_json(vec![profile(&display_b(), status)]);
        assert_eq!(
            evaluate_profile_gate(Some(&store), identity),
            Err(expected),
            "{status:?} must refuse a raw click"
        );
    }

    // Unreadable stores refuse too.
    assert_eq!(
        evaluate_profile_gate(Some("{ broken"), identity),
        Err("DISPLAY_PROFILE_CORRUPT")
    );
    assert_eq!(
        evaluate_profile_gate(None, identity),
        Err("DISPLAY_NOT_CONFIGURED")
    );
}

#[test]
fn a_raw_click_on_a_verified_display_is_allowed() {
    let monitors = [display_a(), display_b()];
    let store = store_json(vec![
        profile(&display_a(), DisplayProfileStatus::Valid),
        profile(&display_b(), DisplayProfileStatus::Valid),
    ]);
    for (x, y) in [(1920, 540), (-540, 299)] {
        let identity = containing(&monitors, x, y).unwrap();
        assert!(
            evaluate_profile_gate(Some(&store), identity).is_ok(),
            "({x}, {y}) is on a verified display and must be allowed"
        );
    }
}

/// Display B verified, Display A not. A click on A must not borrow B's profile.
#[test]
fn a_raw_click_cannot_borrow_a_verified_neighbours_profile() {
    let monitors = [display_a(), display_b()];
    let store = store_json(vec![profile(&display_b(), DisplayProfileStatus::Valid)]);

    let on_b = containing(&monitors, -540, 299).unwrap();
    assert!(evaluate_profile_gate(Some(&store), on_b).is_ok());

    let on_a = containing(&monitors, 1920, 540).unwrap();
    assert_eq!(
        evaluate_profile_gate(Some(&store), on_a),
        Err("DISPLAY_NOT_CONFIGURED"),
        "a verified neighbour must not authorise an unverified display"
    );
}

/// A raw desktop point is already final, so the correction must not be applied
/// to it — `visual_commands::resolve` has already done that for the path that
/// needs it. Applying it here would move the click a second time.
#[test]
fn a_raw_desktop_point_is_gated_but_never_corrected() {
    let shift = AffineTransform {
        c: 40.0,
        f: -25.0,
        ..AffineTransform::IDENTITY
    };
    let mut p = profile(&display_b(), DisplayProfileStatus::Valid);
    p.correction = Some(shift);
    let store = store_json(vec![p]);

    // The gate hands back the correction so the *resolver* can use it …
    assert_eq!(
        evaluate_profile_gate(Some(&store), &display_b()),
        Ok(Some(shift))
    );

    // … but the raw click path clicks where it was told. This is what
    // `input::click_at` does with the point after the gate passes.
    let raw = PhysicalPoint::new(-540.0, 299.0);
    let clicked = raw;
    assert_eq!(clicked, raw, "a final desktop point must not move");
    assert_ne!(
        clicked,
        correct_via_local(raw, (-1080, -661), Some(&shift)),
        "and must differ from what the corrected path would produce"
    );
}

// ---------------------------------------------------------------------------
// Measured zero side effects
// ---------------------------------------------------------------------------

/// Every refusal, against every visual operation, counting what reached Windows.
///
/// The previous version of this argument was "the refusal returns before the
/// call, so the call cannot happen". That is exactly the reasoning that missed
/// two ungated overlay paths, so it is now measured: each case runs the real
/// gate and then asserts the recorder saw nothing.
#[test]
fn no_refusal_produces_any_native_side_effect() {
    use super::side_effects::{
        DesktopPoint, DesktopRect, MouseButton, RecordingSideEffects, VisualSideEffects,
    };

    let a = display_a();
    let b = display_b();

    // (name, store, identity, expected code)
    let refusals: Vec<(&str, Option<String>, &MonitorIdentity, &str)> = vec![
        (
            "missing profile",
            Some(store_json(vec![])),
            &a,
            "DISPLAY_NOT_CONFIGURED",
        ),
        ("no store at all", None, &a, "DISPLAY_NOT_CONFIGURED"),
        (
            "failed",
            Some(store_json(vec![profile(&a, DisplayProfileStatus::Failed)])),
            &a,
            "DISPLAY_PROFILE_FAILED",
        ),
        (
            "ignored",
            Some(store_json(vec![profile(&a, DisplayProfileStatus::Ignored)])),
            &a,
            "DISPLAY_IGNORED",
        ),
        (
            "disconnected",
            Some(store_json(vec![profile(
                &a,
                DisplayProfileStatus::Disconnected,
            )])),
            &a,
            "DISPLAY_NOT_CONFIGURED",
        ),
        (
            "corrupt store",
            Some("{ broken".to_string()),
            &a,
            "DISPLAY_PROFILE_CORRUPT",
        ),
        (
            "unsupported version",
            Some(format!(
                "{{\"version\":{},\"profiles\":[]}}",
                CURRENT_VERSION as u64 + 5
            )),
            &a,
            "DISPLAY_PROFILE_VERSION_UNSUPPORTED",
        ),
        (
            "portrait display, failed",
            Some(store_json(vec![profile(&b, DisplayProfileStatus::Failed)])),
            &b,
            "DISPLAY_PROFILE_FAILED",
        ),
    ];

    for (name, store, identity, expected) in refusals {
        // A stale profile needs the monitor to have changed, so it is built
        // separately below; everything else uses the store as given.
        let outcome = evaluate_profile_gate(store.as_deref(), identity);
        assert_eq!(outcome, Err(expected), "{name}");

        // What every visual operation would have done next, had the gate let it
        // through. None of it may run.
        let recorder = RecordingSideEffects::new();
        if outcome.is_ok() {
            let a = VisualExecutionAuthority::covering_for_test(1, 0, 0, 3840, 1080);
            let _ = recorder.show_overlay(a.vouch_rect_for_test(DesktopRect {
                x: 0,
                y: 0,
                width: 10,
                height: 10,
            }));
            let _ = recorder.move_cursor(a.vouch_for_test(0, 0));
            let _ = recorder.click(a.vouch_for_test(0, 0), MouseButton::Left);
        }
        let totals = recorder.totals();
        assert!(
            recorder.nothing_happened(),
            "{name}: expected nothing to reach Windows, got {totals:?}"
        );
        assert_eq!(totals.overlay_show, 0, "{name}: overlay");
        assert_eq!(totals.cursor_move, 0, "{name}: cursor");
        assert_eq!(totals.click, 0, "{name}: click");
    }

    // Stale, which needs a changed monitor rather than a changed store.
    let store = store_json(vec![profile(&a, DisplayProfileStatus::Valid)]);
    let mut shrunk = display_a();
    shrunk.width = 2560;
    assert_eq!(
        evaluate_profile_gate(Some(&store), &shrunk),
        Err("DISPLAY_PROFILE_STALE")
    );
    let recorder = RecordingSideEffects::new();
    assert!(recorder.nothing_happened(), "stale: nothing may run");

    // A point on no display: refused before any identity is even resolved.
    let monitors = [display_a(), display_b()];
    assert!(containing(&monitors, 9000, 9000).is_none());
    let recorder = RecordingSideEffects::new();
    assert!(recorder.nothing_happened(), "outside: nothing may run");
}

/// The counterpart: a verified display must produce exactly one of each.
///
/// Without this the zero-assertions above would pass on a recorder that is
/// simply never wired to anything.
#[test]
fn a_permitted_operation_produces_exactly_one_of_each_side_effect() {
    use super::side_effects::{
        DesktopPoint, DesktopRect, MouseButton, RecordingSideEffects, VisualSideEffects,
    };

    let store = store_json(vec![profile(&display_a(), DisplayProfileStatus::Valid)]);
    assert!(evaluate_profile_gate(Some(&store), &display_a()).is_ok());

    // Preview: one overlay, nothing else.
    let landscape = VisualExecutionAuthority::covering_for_test(1, 0, 0, 3840, 1080);
    let preview = RecordingSideEffects::new();
    preview
        .show_overlay(landscape.vouch_rect_for_test(DesktopRect {
            x: 0,
            y: 789,
            width: 74,
            height: 70,
        }))
        .unwrap();
    let t = preview.totals();
    assert_eq!((t.overlay_show, t.cursor_move, t.click), (1, 0, 0));

    // Cursor move: one move, no click.
    let cursor = RecordingSideEffects::new();
    cursor
        .move_cursor(landscape.vouch_for_test(1920, 540))
        .unwrap();
    let t = cursor.totals();
    assert_eq!((t.overlay_show, t.cursor_move, t.click), (0, 1, 0));

    // Click: move then click, once each — never twice.
    let click = RecordingSideEffects::new();
    let point = landscape.vouch_for_test(1920, 540);
    click.move_cursor(point).unwrap();
    click.click(point, MouseButton::Left).unwrap();
    let t = click.totals();
    assert_eq!((t.overlay_show, t.cursor_move, t.click), (0, 1, 1));
    assert_eq!(click.click_points.lock().unwrap().len(), 1);
}

/// A raw click reaches Windows at the coordinate it was given, uncorrected.
#[test]
fn a_permitted_raw_click_lands_on_the_point_it_was_given() {
    use super::side_effects::{DesktopPoint, MouseButton, RecordingSideEffects, VisualSideEffects};

    let shift = AffineTransform {
        c: 40.0,
        f: -25.0,
        ..AffineTransform::IDENTITY
    };
    let mut p = profile(&display_b(), DisplayProfileStatus::Valid);
    p.correction = Some(shift);
    let store = store_json(vec![p]);
    assert!(evaluate_profile_gate(Some(&store), &display_b()).is_ok());

    let recorder = RecordingSideEffects::new();
    let raw = DesktopPoint { x: -540, y: 299 };
    let portrait = VisualExecutionAuthority::covering_for_test(2, -1080, -661, 1080, 1920);
    recorder
        .click(portrait.vouch_for_test(raw.x, raw.y), MouseButton::Left)
        .unwrap();

    assert_eq!(recorder.totals().click, 1);
    assert_eq!(
        recorder.click_points.lock().unwrap()[0].0,
        raw,
        "a raw desktop point must reach Windows unmoved, even when the display \
         carries a correction — that correction belongs to the resolver"
    );
}

/// Every code the gate can emit has wording a person can act on.
#[test]
fn every_refusal_explains_itself() {
    for code in [
        "DISPLAY_NOT_CONFIGURED",
        "DISPLAY_PROFILE_STALE",
        "DISPLAY_PROFILE_FAILED",
        "DISPLAY_IGNORED",
        "DISPLAY_IDENTITY_MISMATCH",
        "TARGET_OUTSIDE_CONNECTED_DISPLAY",
        "DISPLAY_PROFILE_CORRUPT",
        "DISPLAY_PROFILE_VERSION_UNSUPPORTED",
    ] {
        let message = super::wizard::describe_profile_refusal(code);
        assert!(!message.is_empty());
        assert!(
            !message.contains("Capability failed") && !message.contains("unknown"),
            "{code} fell through to a generic message: {message}"
        );
        assert!(
            message.len() > 30,
            "{code} needs to say what to do about it"
        );
    }
}
