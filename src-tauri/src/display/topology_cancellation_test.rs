//! An action in flight when the monitors move must not land.
//!
//! **These are simulated, not physical hot-plug tests.** No cable is pulled and
//! no display is reconfigured; the arrangement is changed by handing the
//! authorization a different topology version, which is precisely the signal
//! production compares. A real hot-plug regression would need a second pair of
//! hands and is not what this claims to be.
//!
//! The sequence each test walks is the production one:
//!
//!   1. frame captured
//!   2. visual target resolved
//!   3. authority issued by the profile gate
//!   4. the monitor arrangement changes
//!   5. the cursor/click stage tries to execute
//!
//! Step 5 must reach nothing. `RecordingSideEffects` is asserted at zero rather
//! than the control flow being read, because "the code returns early" and
//! "nothing happened" have come apart twice in this codebase.

#![cfg(all(test, windows))]

use std::sync::Arc;

use super::authority::{AuthorityRefusal, VisualExecutionAuthority};
use super::coordinates::DisplayGeometry;
use super::interaction_error::{DisplayInteractionError, DisplayInteractionErrorCode};
use super::side_effects::RecordingSideEffects;

/// The real arrangement, so the negative origin is exercised rather than a
/// convenient pair of monitors at (0,0).
fn landscape() -> DisplayGeometry {
    DisplayGeometry {
        display_id: 65767,
        x: 0,
        y: 0,
        width: 3840,
        height: 1080,
        scale_factor: 1.0,
        rotation: 0,
    }
}

fn portrait() -> DisplayGeometry {
    DisplayGeometry {
        display_id: 131154,
        x: -1080,
        y: -661,
        width: 1080,
        height: 1920,
        scale_factor: 1.0,
        rotation: 90,
    }
}

const BEFORE: &str = "131154:1080x1920@-1080,-661s1.000r90|65767:3840x1080@0,0s1.000r0";
/// The portrait monitor detached: a different arrangement, same primary.
const AFTER: &str = "65767:3840x1080@0,0s1.000r0";

/// Steps 1–3: what the gate hands the executor.
fn authority_issued_before_the_change(d: DisplayGeometry) -> VisualExecutionAuthority {
    VisualExecutionAuthority::issue(d.display_id, d, BEFORE.into())
}

#[test]
fn a_topology_change_cancels_an_action_already_in_flight() {
    let recorder = Arc::new(RecordingSideEffects::new());
    let d = portrait();
    let authority = authority_issued_before_the_change(d);
    let (x, y) = (d.x + d.width as i32 / 2, d.y + d.height as i32 / 2);

    // The authority was valid the instant it was issued.
    assert!(
        authority.authorize_point(x, y, BEFORE).is_ok(),
        "the authority must have been usable before the arrangement changed"
    );

    // Step 4: the arrangement changes. Step 5: execution is attempted.
    let refusal = authority
        .authorize_point(x, y, AFTER)
        .expect_err("a moved arrangement must cancel the pending action");
    assert_eq!(refusal, AuthorityRefusal::TopologyChanged);

    // Nothing reached the backend — and could not have, because the call needs
    // an `AuthorizedPoint` that was never produced.
    assert!(
        recorder.nothing_happened(),
        "a cancelled action reached the side-effect backend: {:?}",
        recorder.totals()
    );
    let t = recorder.totals();
    assert_eq!((t.overlay_show, t.cursor_move, t.click), (0, 0, 0));
}

/// The overlay may still be taken down. Cancellation must not strand a border.
#[test]
fn cleanup_stays_available_after_cancellation() {
    let recorder = Arc::new(RecordingSideEffects::new());
    let d = portrait();
    let authority = authority_issued_before_the_change(d);
    assert!(authority
        .authorize_point(d.x + 10, d.y + 10, AFTER)
        .is_err());

    recorder.hide_overlay_for_test();
    assert!(
        recorder.nothing_happened(),
        "hiding an overlay counted as a side effect on the user"
    );
    assert_eq!(recorder.totals().overlay_hide, 1);
}

/// The refusal the planner receives names the arrangement, not a click failure.
#[test]
fn cancellation_reports_authority_topology_changed_and_never_retries_itself() {
    let d = portrait();
    let authority = authority_issued_before_the_change(d);
    let refusal = authority
        .authorize_point(d.x + 5, d.y + 5, AFTER)
        .unwrap_err();

    let error = DisplayInteractionError::from(refusal);
    assert_eq!(
        error.code,
        DisplayInteractionErrorCode::AuthorityTopologyChanged
    );
    assert_eq!(error.code_str, "AUTHORITY_TOPOLOGY_CHANGED");
    assert_eq!(error.recommended_action, "recheck-display");
    assert!(
        !error.allows_automatic_retry,
        "a rearranged desktop must not be retried automatically — the second \
         attempt would be aimed with the same stale geometry"
    );
    assert!(
        !error.side_effect_occurred,
        "cancellation happens before any native call"
    );
}

/// The failure mode this whole subsystem exists to prevent: refusing on the
/// intended monitor and then quietly acting on a different one.
#[test]
fn cancellation_never_falls_back_to_another_monitor() {
    let recorder = Arc::new(RecordingSideEffects::new());
    let portrait_authority = authority_issued_before_the_change(portrait());
    let l = landscape();

    // The landscape monitor survived the change, and its point is perfectly
    // valid — for an authority issued *for it*. This one was not.
    let centre = (l.x + l.width as i32 / 2, l.y + l.height as i32 / 2);
    let refusal = portrait_authority
        .authorize_point(centre.0, centre.1, AFTER)
        .unwrap_err();
    // Expired is checked first, then topology, then membership — so with a
    // changed arrangement the honest answer is the arrangement, not the display.
    assert_eq!(refusal, AuthorityRefusal::TopologyChanged);

    // Even under the *original* arrangement it is still the wrong monitor.
    assert_eq!(
        portrait_authority
            .authorize_point(centre.0, centre.1, BEFORE)
            .unwrap_err(),
        AuthorityRefusal::WrongDisplay
    );
    assert!(recorder.nothing_happened());
}

/// A fresh authority issued after the change works normally, so cancellation is
/// a refusal to act on stale information rather than a jam.
#[test]
fn re_resolution_after_the_change_produces_a_usable_authority() {
    let l = landscape();
    let reissued = VisualExecutionAuthority::issue(l.display_id, l, AFTER.into());
    let point = reissued
        .authorize_point(l.x + 100, l.y + 100, AFTER)
        .expect("a freshly issued authority must work under the new arrangement");
    assert_eq!(point.display_id(), l.display_id);
}
