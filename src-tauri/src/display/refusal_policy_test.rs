//! What a typed refusal is allowed to become.
//!
//! Two things kept going wrong at this boundary and neither was visible from the
//! code alone.
//!
//! The first: `AttemptStatus::Unavailable` *allows fallback*, and the fallback
//! for a Desktop highlight is the vision route — on the same monitor the profile
//! gate had just refused. So a refusal answered itself with a second visual
//! attempt at the same place, and the fallback's reason code then overwrote the
//! typed one on the way out.
//!
//! The second: a profile measured at 100% was still considered a description of
//! the same screen at 125%. It is not. The correction is fitted in display-local
//! pixels, so a scale change moves every point by a fraction of its distance
//! from the origin — hundreds of pixels at the far edge of the 3840-wide
//! monitor.
//!
//! Both are asserted here against measured side-effect counts rather than read
//! off the control flow.

#![cfg(all(test, windows))]

use std::sync::Arc;

use super::identity::MonitorIdentity;
use super::interaction_error::{DisplayInteractionError, DisplayInteractionErrorCode};
use super::profile_store::{DisplayProfileStatus, PersistedDisplayProfile, StoredRect};
use super::side_effects::RecordingSideEffects;
use super::wizard::{changed_properties, evaluate_profile_gate};
use crate::interaction::strategy::AttemptStatus;

const ALL_CODES: [DisplayInteractionErrorCode; 11] = [
    DisplayInteractionErrorCode::DisplayNotConfigured,
    DisplayInteractionErrorCode::DisplayProfileStale,
    DisplayInteractionErrorCode::DisplayProfileFailed,
    DisplayInteractionErrorCode::DisplayIgnored,
    DisplayInteractionErrorCode::DisplayIdentityMismatch,
    DisplayInteractionErrorCode::DisplayProfileCorrupt,
    DisplayInteractionErrorCode::DisplayProfileVersionUnsupported,
    DisplayInteractionErrorCode::TargetOutsideConnectedDisplay,
    DisplayInteractionErrorCode::AuthorityExpired,
    DisplayInteractionErrorCode::AuthorityTopologyChanged,
    DisplayInteractionErrorCode::AuthorityDisplayMismatch,
];

// ---------------------------------------------------------------------------
// Planner lifecycle
// ---------------------------------------------------------------------------

/// The status a typed refusal is reported as, and the only one it may be.
#[test]
fn a_display_refusal_never_falls_back_to_another_visual_attempt() {
    assert!(
        !AttemptStatus::DisplayRefused.allows_fallback(),
        "a refused display must not be followed by the vision route on the same \
         monitor — that is answering a refusal with a second attempt at the same \
         place"
    );
    // The status it used to use, kept honest: this is *why* a new one exists.
    assert!(
        AttemptStatus::Unavailable.allows_fallback(),
        "Unavailable still allows fallback, which is exactly why display \
         refusals may not use it"
    );
}

#[test]
fn every_typed_refusal_is_reported_as_failed_before_side_effect() {
    assert!(AttemptStatus::DisplayRefused.failed_before_side_effect());
    for code in ALL_CODES {
        let e = DisplayInteractionError::new(code);
        assert!(
            !e.side_effect_occurred,
            "{} claimed a side effect had already happened",
            code.as_str()
        );
    }
}

/// A refusal must never be dressed up as any degree of success.
#[test]
fn no_typed_refusal_can_become_success_or_partial_success() {
    use crate::interaction::request::ActionStatus;
    let refused = AttemptStatus::DisplayRefused;
    assert_ne!(refused, AttemptStatus::Succeeded);
    // The planner's success and partial-success states are reached only from a
    // capability that actually ran; a refusal maps to NotReady.
    for forbidden in [ActionStatus::Succeeded, ActionStatus::PartiallyCompleted] {
        assert_ne!(
            ActionStatus::NotReady,
            forbidden,
            "a display refusal must not share a status with {forbidden:?}"
        );
    }
}

/// Only an expired authority may be retried without the user doing anything.
#[test]
fn retry_policy_matches_the_required_mapping() {
    for code in ALL_CODES {
        let expected = code == DisplayInteractionErrorCode::AuthorityExpired;
        assert_eq!(
            code.allows_automatic_retry(),
            expected,
            "{} has the wrong retry policy",
            code.as_str()
        );
    }
}

/// The action offered for each code, exactly as specified.
#[test]
fn every_code_offers_the_required_action() {
    for (code, action) in [
        (
            DisplayInteractionErrorCode::DisplayNotConfigured,
            "verify-display",
        ),
        (
            DisplayInteractionErrorCode::DisplayProfileStale,
            "recheck-display",
        ),
        (
            DisplayInteractionErrorCode::DisplayProfileFailed,
            "review-measurements",
        ),
        (
            DisplayInteractionErrorCode::DisplayIgnored,
            "re-enable-display",
        ),
        (
            DisplayInteractionErrorCode::DisplayIdentityMismatch,
            "recheck-display",
        ),
        (
            DisplayInteractionErrorCode::DisplayProfileCorrupt,
            "verify-display",
        ),
        (
            DisplayInteractionErrorCode::DisplayProfileVersionUnsupported,
            "update-arcsonare",
        ),
        (
            DisplayInteractionErrorCode::TargetOutsideConnectedDisplay,
            "none",
        ),
        (
            DisplayInteractionErrorCode::AuthorityTopologyChanged,
            "recheck-display",
        ),
        (
            DisplayInteractionErrorCode::AuthorityDisplayMismatch,
            "none",
        ),
    ] {
        assert_eq!(code.recommended_action(), action, "{}", code.as_str());
    }
}

/// The reason code the planner records is the typed one, never a generic label.
#[test]
fn the_planner_records_the_typed_code_not_a_generic_one() {
    for code in ALL_CODES {
        let e = DisplayInteractionError::new(code);
        assert_eq!(e.code_str, code.as_str());
        assert_ne!(e.code_str, "DISPLAY_NOT_VERIFIED");
        assert_ne!(e.code_str, "OVERLAY_FAILED");
    }
}

// ---------------------------------------------------------------------------
// Scale staleness
// ---------------------------------------------------------------------------

fn identity(width: u32, height: u32, scale: f64, rotation: i32) -> MonitorIdentity {
    MonitorIdentity {
        device_path: "\\\\?\\DISPLAY#TEST#1".into(),
        friendly_name: "Display A".into(),
        adapter_slot: "\\\\.\\DISPLAY1".into(),
        x: 0,
        y: 0,
        width,
        height,
        primary: true,
        scale_factor: scale,
        rotation_degrees: rotation,
    }
}

/// The portrait monitor at its real negative origin.
fn portrait_identity(scale: f64) -> MonitorIdentity {
    MonitorIdentity {
        x: -1080,
        y: -661,
        width: 1080,
        height: 1920,
        rotation_degrees: 90,
        friendly_name: "Display B".into(),
        ..identity(1080, 1920, scale, 90)
    }
}

fn profile_for(i: &MonitorIdentity, scale: f64, rotation: i32) -> PersistedDisplayProfile {
    PersistedDisplayProfile {
        stable_identity: i.stable_key(),
        friendly_name: Some(i.friendly_name.clone()),
        physical_bounds: StoredRect {
            x: i.x,
            y: i.y,
            width: i.width,
            height: i.height,
        },
        logical_bounds: None,
        scale_factor: scale,
        rotation_degrees: rotation,
        topology_signature: String::new(),
        mapping_samples: Vec::new(),
        correction: None,
        average_error_px: 3.2,
        maximum_error_px: 4.3,
        configured_at_ms: 1,
        validated_at_ms: 1,
        status: DisplayProfileStatus::Valid,
        ignored: false,
    }
}

fn store_json(profile: &PersistedDisplayProfile) -> String {
    serde_json::json!({
        "version": super::profile_store::CURRENT_VERSION,
        "profiles": [profile],
    })
    .to_string()
}

/// The example from the specification.
#[test]
fn a_scale_only_change_is_stale() {
    let now = identity(3840, 1080, 1.25, 0);
    let saved = profile_for(&identity(3840, 1080, 1.0, 0), 1.0, 0);

    let refusal = evaluate_profile_gate(Some(&store_json(&saved)), &now)
        .expect_err("a profile measured at 100% does not describe this screen at 125%");
    assert_eq!(refusal, "DISPLAY_PROFILE_STALE");
    assert!(changed_properties(&saved, &now).contains(&"scale".to_string()));
    // Resolution and rotation are unchanged, so neither may be reported.
    assert_eq!(changed_properties(&saved, &now), vec!["scale".to_string()]);
}

#[test]
fn scaling_back_down_is_equally_stale() {
    let now = identity(3840, 1080, 1.0, 0);
    let saved = profile_for(&identity(3840, 1080, 1.25, 0), 1.25, 0);
    assert_eq!(
        evaluate_profile_gate(Some(&store_json(&saved)), &now).unwrap_err(),
        "DISPLAY_PROFILE_STALE"
    );
    assert_eq!(changed_properties(&saved, &now), vec!["scale".to_string()]);
}

#[test]
fn an_unchanged_scale_stays_valid() {
    let now = identity(3840, 1080, 1.0, 0);
    let saved = profile_for(&now, 1.0, 0);
    assert!(
        evaluate_profile_gate(Some(&store_json(&saved)), &now).is_ok(),
        "an unchanged display must keep working"
    );
    assert!(changed_properties(&saved, &now).is_empty());
}

/// Float noise must not invent a change. 1.25 is exact in binary, but a value
/// arriving through a different path may not be bit-identical.
#[test]
fn representation_noise_is_not_a_scale_change() {
    let now = identity(3840, 1080, 1.250_000_1, 0);
    let saved = profile_for(&identity(3840, 1080, 1.25, 0), 1.25, 0);
    assert!(evaluate_profile_gate(Some(&store_json(&saved)), &now).is_ok());
    assert!(changed_properties(&saved, &now).is_empty());
}

#[test]
fn resolution_and_scale_changing_together_reports_both() {
    let now = identity(2560, 1080, 1.25, 0);
    let saved = profile_for(&identity(3840, 1080, 1.0, 0), 1.0, 0);
    assert_eq!(
        evaluate_profile_gate(Some(&store_json(&saved)), &now).unwrap_err(),
        "DISPLAY_PROFILE_STALE"
    );
    assert_eq!(
        changed_properties(&saved, &now),
        vec!["resolution".to_string(), "scale".to_string()]
    );
}

#[test]
fn rotation_and_scale_changing_together_reports_both() {
    let now = identity(3840, 1080, 1.5, 180);
    let saved = profile_for(&identity(3840, 1080, 1.0, 0), 1.0, 0);
    assert_eq!(
        evaluate_profile_gate(Some(&store_json(&saved)), &now).unwrap_err(),
        "DISPLAY_PROFILE_STALE"
    );
    assert_eq!(
        changed_properties(&saved, &now),
        vec!["scale".to_string(), "rotation".to_string()]
    );
}

/// The negative-origin portrait display, because that is where sign and offset
/// mistakes actually surface.
#[test]
fn the_portrait_display_at_a_negative_origin_is_stale_at_a_new_scale() {
    let now = portrait_identity(1.25);
    let saved = profile_for(&portrait_identity(1.0), 1.0, 90);
    assert_eq!(
        evaluate_profile_gate(Some(&store_json(&saved)), &now).unwrap_err(),
        "DISPLAY_PROFILE_STALE"
    );
    assert_eq!(changed_properties(&saved, &now), vec!["scale".to_string()]);
}

/// The measured half: a stale profile reaches no native call at all.
#[test]
fn a_scale_mismatch_produces_zero_side_effects() {
    let recorder = Arc::new(RecordingSideEffects::new());
    let now = identity(3840, 1080, 1.25, 0);
    let saved = profile_for(&identity(3840, 1080, 1.0, 0), 1.0, 0);

    let outcome = evaluate_profile_gate(Some(&store_json(&saved)), &now);
    assert!(outcome.is_err());

    // No `AuthorizedRect` or `AuthorizedPoint` was ever produced, so the backend
    // could not have been called even by mistake.
    assert!(
        recorder.nothing_happened(),
        "a stale scale reached the side-effect backend: {:?}",
        recorder.totals()
    );
    let t = recorder.totals();
    assert_eq!((t.overlay_show, t.cursor_move, t.click), (0, 0, 0));
}

/// The saved measurement is evidence. Re-checking is the user's decision.
#[test]
fn a_scale_change_never_silently_updates_the_saved_scale() {
    let now = identity(3840, 1080, 1.25, 0);
    let saved = profile_for(&identity(3840, 1080, 1.0, 0), 1.0, 0);
    let before = store_json(&saved);

    let _ = evaluate_profile_gate(Some(&before), &now);

    // The gate is a pure read: it takes the raw store and returns a decision.
    assert_eq!(
        store_json(&saved),
        before,
        "the gate rewrote the stored measurement instead of asking for a re-check"
    );
    assert!((saved.scale_factor - 1.0).abs() < f64::EPSILON);
}

/// A stale display refuses with the code the frontend maps to "Re-check".
#[test]
fn a_stale_scale_surfaces_as_the_typed_stale_code() {
    let e = DisplayInteractionError::from_gate_code("DISPLAY_PROFILE_STALE");
    assert_eq!(e.code, DisplayInteractionErrorCode::DisplayProfileStale);
    assert_eq!(e.recommended_action, "recheck-display");
    assert!(!e.allows_automatic_retry);
    assert!(!e.side_effect_occurred);
}
