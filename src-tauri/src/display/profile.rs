//! Remembered display mappings, and when they stop being trustworthy.
//!
//! A profile records that a monitor's geometry was checked against reality and
//! found correct. It is worth keeping only while the thing it describes has not
//! changed: rotating a screen, changing its resolution or changing its scaling
//! all invalidate the measurement that was taken, and a stale profile is not a
//! smaller problem than a missing one — it is a confident wrong answer.
//!
//! Profiles are filed under the stable hardware path from `identity`, never a
//! runtime display id. Unplugging a monitor and plugging it back in must find
//! its profile; restarting the process must not lose it.
//!
//! This module is deliberately free of Win32 so the decision logic — which is
//! where the mistakes are — can be tested without physical monitors.

use serde::{Deserialize, Serialize};

/// A single verification sample: where a target was put, where the cursor went.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSample {
    pub expected_x: i32,
    pub expected_y: i32,
    pub actual_x: i32,
    pub actual_y: i32,
}

impl ValidationSample {
    pub fn error_x(&self) -> i32 {
        self.actual_x - self.expected_x
    }
    pub fn error_y(&self) -> i32 {
        self.actual_y - self.expected_y
    }
    pub fn distance(&self) -> f64 {
        let dx = self.error_x() as f64;
        let dy = self.error_y() as f64;
        (dx * dx + dy * dy).sqrt()
    }
}

/// Pass thresholds, in physical pixels.
pub const MAX_AVERAGE_ERROR: f64 = 4.0;
pub const MAX_SINGLE_ERROR: f64 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProfileStatus {
    /// Measured and within tolerance.
    Verified,
    /// Measured and outside tolerance. Geometry is not to be trusted.
    Failed,
    /// The user chose to leave this monitor alone.
    Ignored,
}

/// What a monitor looked like when it was measured.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayProfile {
    /// The stable hardware path. Never a runtime display id.
    pub stable_key: String,
    pub friendly_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub rotation: u32,
    pub status: ProfileStatus,
    pub average_error: f64,
    pub max_error: f64,
    pub sample_count: usize,
    pub configured_at: String,
    pub validated_at: String,
}

/// Summarise a run of samples into the numbers a profile stores.
pub fn summarise(samples: &[ValidationSample]) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let total: f64 = samples.iter().map(|s| s.distance()).sum();
    let max = samples.iter().map(|s| s.distance()).fold(0.0_f64, f64::max);
    (total / samples.len() as f64, max)
}

/// Did a validation run meet the bar?
///
/// Both thresholds must hold. An average inside tolerance hides a single wild
/// miss, and a single wild miss is a click in the wrong place.
pub fn passes(samples: &[ValidationSample], wrong_display: usize, out_of_bounds: usize) -> bool {
    if samples.is_empty() || wrong_display > 0 || out_of_bounds > 0 {
        return false;
    }
    let (average, max) = summarise(samples);
    average <= MAX_AVERAGE_ERROR && max <= MAX_SINGLE_ERROR
}

/// A monitor as it is right now, for comparison against what was stored.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveDisplay {
    pub stable_key: String,
    pub friendly_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub rotation: u32,
}

/// Why a monitor needs the wizard, or that it does not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigurationNeed {
    /// Never configured.
    NeverConfigured,
    /// Configured, and nothing that matters has changed.
    UpToDate,
    ResolutionChanged,
    ScalingChanged,
    RotationChanged,
    /// Configured but the measurement failed; it must be redone.
    PreviouslyFailed,
    /// The user asked to skip this one.
    Ignored,
}

impl ConfigurationNeed {
    /// Should the wizard be shown for this monitor?
    pub fn needs_wizard(&self) -> bool {
        !matches!(self, Self::UpToDate | Self::Ignored)
    }
}

/// Scale factors are floating point; comparing them exactly reports a change
/// that did not happen.
fn same_scale(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.001
}

/// Decide whether a live monitor is covered by a stored profile.
///
/// Position is deliberately *not* a trigger. Dragging a monitor's position in
/// Windows changes where it is, and every consumer already reads live bounds —
/// re-running a nine-point test for that would train the user to click through
/// the wizard, which is how a real failure gets clicked through too.
pub fn configuration_need(
    profile: Option<&DisplayProfile>,
    live: &LiveDisplay,
) -> ConfigurationNeed {
    let Some(profile) = profile else {
        return ConfigurationNeed::NeverConfigured;
    };
    if profile.status == ProfileStatus::Ignored {
        return ConfigurationNeed::Ignored;
    }
    if profile.width != live.width || profile.height != live.height {
        return ConfigurationNeed::ResolutionChanged;
    }
    if !same_scale(profile.scale_factor, live.scale_factor) {
        return ConfigurationNeed::ScalingChanged;
    }
    if profile.rotation != live.rotation {
        return ConfigurationNeed::RotationChanged;
    }
    if profile.status == ProfileStatus::Failed {
        return ConfigurationNeed::PreviouslyFailed;
    }
    ConfigurationNeed::UpToDate
}

/// Which attached monitors still need the wizard.
///
/// Only the ones that need it: plugging in a second screen must not throw away
/// a verified profile for the first, and must not re-ask about it either.
pub fn monitors_needing_configuration<'a>(
    profiles: &[DisplayProfile],
    live: &'a [LiveDisplay],
) -> Vec<(&'a LiveDisplay, ConfigurationNeed)> {
    live.iter()
        .filter_map(|l| {
            let profile = profiles.iter().find(|p| p.stable_key == l.stable_key);
            let need = configuration_need(profile, l);
            need.needs_wizard().then_some((l, need))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(key: &str) -> LiveDisplay {
        LiveDisplay {
            stable_key: key.into(),
            friendly_name: "Display A".into(),
            x: 0,
            y: 0,
            width: 3840,
            height: 1080,
            scale_factor: 1.0,
            rotation: 0,
        }
    }

    fn verified_profile(key: &str) -> DisplayProfile {
        DisplayProfile {
            stable_key: key.into(),
            friendly_name: "Display A".into(),
            x: 0,
            y: 0,
            width: 3840,
            height: 1080,
            scale_factor: 1.0,
            rotation: 0,
            status: ProfileStatus::Verified,
            average_error: 1.2,
            max_error: 3.0,
            sample_count: 14,
            configured_at: "2026-07-31T00:00:00Z".into(),
            validated_at: "2026-07-31T00:00:00Z".into(),
        }
    }

    const KEY: &str = "\\\\?\\DISPLAY#GSM5B09#5&1d2&0&UID4353#{guid}";

    #[test]
    fn a_first_run_asks_for_configuration() {
        assert_eq!(
            configuration_need(None, &live(KEY)),
            ConfigurationNeed::NeverConfigured
        );
        assert!(ConfigurationNeed::NeverConfigured.needs_wizard());
    }

    #[test]
    fn a_valid_profile_is_left_alone() {
        let need = configuration_need(Some(&verified_profile(KEY)), &live(KEY));
        assert_eq!(need, ConfigurationNeed::UpToDate);
        assert!(!need.needs_wizard(), "the wizard must not reappear");
    }

    /// The reason profiles are not keyed on `xcap` ids: those change per process.
    #[test]
    fn a_profile_survives_the_runtime_display_id_changing() {
        // Nothing in either type carries a runtime id, so a profile stored under
        // one run's id cannot be found under another's. This is the guarantee.
        let profile = verified_profile(KEY);
        let after_restart = live(KEY);
        assert_eq!(
            configuration_need(Some(&profile), &after_restart),
            ConfigurationNeed::UpToDate
        );
        assert!(
            !profile.stable_key.chars().all(|c| c.is_ascii_digit()),
            "a stable key must not be an enumeration index"
        );
    }

    #[test]
    fn changing_the_resolution_invalidates_the_measurement() {
        let mut moved = live(KEY);
        moved.width = 2560;
        assert_eq!(
            configuration_need(Some(&verified_profile(KEY)), &moved),
            ConfigurationNeed::ResolutionChanged
        );
    }

    #[test]
    fn changing_the_scaling_invalidates_it_too() {
        let mut scaled = live(KEY);
        scaled.scale_factor = 1.25;
        assert_eq!(
            configuration_need(Some(&verified_profile(KEY)), &scaled),
            ConfigurationNeed::ScalingChanged
        );
    }

    #[test]
    fn rotating_a_monitor_invalidates_it() {
        let mut rotated = live(KEY);
        rotated.rotation = 90;
        assert_eq!(
            configuration_need(Some(&verified_profile(KEY)), &rotated),
            ConfigurationNeed::RotationChanged
        );
    }

    #[test]
    fn moving_a_monitor_does_not_re_ask() {
        // Everything downstream reads live bounds, so a move changes nothing
        // that the nine-point test measured.
        let mut moved = live(KEY);
        moved.x = -3840;
        assert_eq!(
            configuration_need(Some(&verified_profile(KEY)), &moved),
            ConfigurationNeed::UpToDate
        );
    }

    #[test]
    fn only_the_new_monitor_is_asked_about() {
        let profiles = vec![verified_profile(KEY)];
        let second = LiveDisplay {
            stable_key: "\\\\?\\DISPLAY#DEL4321#5&9ab&0&UID8193#{guid}".into(),
            friendly_name: "Display B".into(),
            x: 3840,
            ..live(KEY)
        };
        let attached = [live(KEY), second.clone()];
        let pending = monitors_needing_configuration(&profiles, &attached);
        assert_eq!(
            pending.len(),
            1,
            "the configured monitor must not be re-asked"
        );
        assert_eq!(pending[0].0.stable_key, second.stable_key);
        assert_eq!(pending[0].1, ConfigurationNeed::NeverConfigured);
    }

    #[test]
    fn an_ignored_monitor_stays_ignored() {
        let mut profile = verified_profile(KEY);
        profile.status = ProfileStatus::Ignored;
        let need = configuration_need(Some(&profile), &live(KEY));
        assert_eq!(need, ConfigurationNeed::Ignored);
        assert!(!need.needs_wizard());
    }

    #[test]
    fn a_failed_measurement_is_asked_about_again() {
        let mut profile = verified_profile(KEY);
        profile.status = ProfileStatus::Failed;
        assert_eq!(
            configuration_need(Some(&profile), &live(KEY)),
            ConfigurationNeed::PreviouslyFailed
        );
    }

    // -----------------------------------------------------------------------
    // Validation arithmetic
    // -----------------------------------------------------------------------

    fn sample(ex: i32, ey: i32, ax: i32, ay: i32) -> ValidationSample {
        ValidationSample {
            expected_x: ex,
            expected_y: ey,
            actual_x: ax,
            actual_y: ay,
        }
    }

    #[test]
    fn a_perfect_run_passes() {
        let samples: Vec<_> = (0..9).map(|i| sample(i * 100, 200, i * 100, 200)).collect();
        assert!(passes(&samples, 0, 0));
        assert_eq!(summarise(&samples), (0.0, 0.0));
    }

    #[test]
    fn one_wild_miss_fails_the_run_even_with_a_good_average() {
        let mut samples: Vec<_> = (0..8).map(|i| sample(i * 100, 200, i * 100, 200)).collect();
        samples.push(sample(900, 200, 930, 200)); // 30px out
        let (average, max) = summarise(&samples);
        assert!(average <= MAX_AVERAGE_ERROR, "the average still looks fine");
        assert!(max > MAX_SINGLE_ERROR);
        assert!(
            !passes(&samples, 0, 0),
            "a single wild miss must fail the run"
        );
    }

    #[test]
    fn landing_on_the_wrong_display_fails_regardless_of_error() {
        let samples = vec![sample(0, 0, 0, 0)];
        assert!(!passes(&samples, 1, 0));
        assert!(!passes(&samples, 0, 1));
    }

    #[test]
    fn a_run_with_no_samples_is_not_a_pass() {
        assert!(!passes(&[], 0, 0));
    }

    #[test]
    fn errors_are_reported_per_axis_and_as_a_distance() {
        let s = sample(100, 100, 103, 104);
        assert_eq!((s.error_x(), s.error_y()), (3, 4));
        assert!((s.distance() - 5.0).abs() < 1e-9);
    }
}
