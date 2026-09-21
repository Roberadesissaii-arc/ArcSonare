//! Proving the click did something.
//!
//! Injecting input and observing that the call returned `Ok` proves the input
//! was injected. It does not prove the button was enabled, that it was the
//! button rather than the panel behind it, that another window did not take the
//! click, or that the application did anything with it. Reporting that as
//! success is how ArcSonare tells the user it did something it did not do.
//!
//! So an executable visual action names, in advance, what should be true
//! afterwards — and the verifier is a fixed set of cases, not something the
//! model gets to invent.

#![cfg(windows)]

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use super::frame::CapturedFrame;
use super::freshness::{self, PhysicalRect};
use super::topology::DisplayTopology;

/// What should be true after the action. Chosen by ArcSonare, not the model.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum VisualExpectedOutcome {
    /// Preview-only actions: outlining something changes nothing to check.
    None,
    /// The pixels around the target should look different afterwards.
    #[serde(rename_all = "camelCase")]
    RegionChanged {
        #[serde(default)]
        minimum_difference: Option<f32>,
    },
    /// A window matching this should exist afterwards and not before.
    #[serde(rename_all = "camelCase")]
    WindowAppeared {
        #[serde(default)]
        title_pattern: Option<String>,
        #[serde(default)]
        process_name: Option<String>,
    },
    /// A window matching this should be gone afterwards.
    #[serde(rename_all = "camelCase")]
    WindowDisappeared {
        #[serde(default)]
        title_pattern: Option<String>,
    },
    /// ArcSonare's own test target: the click counter should move by exactly
    /// this much. The only verifier that can be certain rather than confident.
    #[serde(rename_all = "camelCase")]
    TestTargetClicked { expected_increment: u32 },
}

impl VisualExpectedOutcome {
    pub fn is_none(&self) -> bool {
        matches!(self, Self::None)
    }

    pub fn verifier_id(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::RegionChanged { .. } => "region-changed",
            Self::WindowAppeared { .. } => "window-appeared",
            Self::WindowDisappeared { .. } => "window-disappeared",
            Self::TestTargetClicked { .. } => "test-target-clicked",
        }
    }
}

/// What a verifier saw before the action, so it has something to compare to.
pub struct PreActionSnapshot {
    pub region: Option<xcap::image::RgbaImage>,
    pub window_titles: Vec<String>,
    pub test_target_clicks: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationOutcome {
    pub verifier_id: &'static str,
    pub verified: bool,
    /// True when no verifier could run — distinct from running and failing.
    pub unavailable: bool,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurements: Option<serde_json::Value>,
}

impl VerificationOutcome {
    fn ok(verifier_id: &'static str, detail: impl Into<String>) -> Self {
        Self {
            verifier_id,
            verified: true,
            unavailable: false,
            detail: detail.into(),
            measurements: None,
        }
    }

    fn failed(verifier_id: &'static str, detail: impl Into<String>) -> Self {
        Self {
            verifier_id,
            verified: false,
            unavailable: false,
            detail: detail.into(),
            measurements: None,
        }
    }

    fn unavailable(verifier_id: &'static str, detail: impl Into<String>) -> Self {
        Self {
            verifier_id,
            verified: false,
            unavailable: true,
            detail: detail.into(),
            measurements: None,
        }
    }

    fn with(mut self, measurements: serde_json::Value) -> Self {
        self.measurements = Some(measurements);
        self
    }
}

fn visible_window_titles() -> Vec<String> {
    let own = std::process::id();
    xcap::Window::all()
        .map(|ws| {
            ws.into_iter()
                .filter(|w| w.pid().unwrap_or(0) != own)
                .filter(|w| !w.is_minimized().unwrap_or(false))
                .filter_map(|w| w.title().ok())
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn matches_pattern(title: &str, pattern: &str) -> bool {
    // Substring, case-insensitive. Deliberately not a regex: a pattern from a
    // plan should not be able to cost an unbounded amount of CPU.
    title.to_lowercase().contains(&pattern.to_lowercase())
}

/// Read everything the chosen verifier will need to compare against.
pub fn snapshot_before<R: Runtime>(
    app: &AppHandle<R>,
    topology: &DisplayTopology,
    outcome: &VisualExpectedOutcome,
    region: PhysicalRect,
) -> PreActionSnapshot {
    let _ = app;
    let mut snapshot = PreActionSnapshot {
        region: None,
        window_titles: Vec::new(),
        test_target_clicks: 0,
    };
    match outcome {
        VisualExpectedOutcome::RegionChanged { .. } => {
            snapshot.region = super::production_capture::capture_region(
                topology,
                region.x,
                region.y,
                region.width,
                region.height,
            )
            .ok()
            .map(|c| c.image);
        }
        VisualExpectedOutcome::WindowAppeared { .. }
        | VisualExpectedOutcome::WindowDisappeared { .. } => {
            snapshot.window_titles = visible_window_titles();
        }
        VisualExpectedOutcome::TestTargetClicked { .. } => {
            snapshot.test_target_clicks = crate::visual_test_target::state().clicks;
        }
        VisualExpectedOutcome::None => {}
    }
    snapshot
}

/// How long to wait for the application to react before giving up.
///
/// A click is not instant from the app's point of view: a button repaints,
/// a dialog animates in. Checking immediately would report failure for actions
/// that simply had not finished yet.
const SETTLE_MS: u64 = 120;
const MAX_WAIT_MS: u64 = 1_200;

/// Run the verifier the action asked for.
pub fn verify_after<R: Runtime>(
    app: &AppHandle<R>,
    topology: &DisplayTopology,
    outcome: &VisualExpectedOutcome,
    region: PhysicalRect,
    before: &PreActionSnapshot,
) -> VerificationOutcome {
    let _ = app;
    match outcome {
        VisualExpectedOutcome::None => {
            VerificationOutcome::unavailable("none", "this action asked for no verification")
        }

        VisualExpectedOutcome::TestTargetClicked { expected_increment } => {
            // Poll rather than sleep once: the window's message loop is on its
            // own thread and the click may not have been dispatched yet.
            let target = before.test_target_clicks + expected_increment;
            let mut seen = before.test_target_clicks;
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_millis(MAX_WAIT_MS);
            while std::time::Instant::now() < deadline {
                seen = crate::visual_test_target::state().clicks;
                if seen >= target {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            // Wait a little past the target so an extra click still shows up:
            // "clicked twice" must not be reported as success.
            std::thread::sleep(std::time::Duration::from_millis(SETTLE_MS));
            seen = crate::visual_test_target::state().clicks;
            let actual = seen.saturating_sub(before.test_target_clicks);
            let measurements = serde_json::json!({
                "before": before.test_target_clicks,
                "after": seen,
                "increment": actual,
                "expected_increment": expected_increment,
            });
            if actual == *expected_increment {
                VerificationOutcome::ok(
                    "test-target-clicked",
                    format!("the test target received exactly {actual} click(s)"),
                )
                .with(measurements)
            } else {
                VerificationOutcome::failed(
                    "test-target-clicked",
                    format!(
                        "the test target received {actual} click(s), expected {expected_increment}"
                    ),
                )
                .with(measurements)
            }
        }

        VisualExpectedOutcome::RegionChanged { minimum_difference } => {
            let Some(before_img) = &before.region else {
                return VerificationOutcome::unavailable(
                    "region-changed",
                    "the target region could not be photographed before the action",
                );
            };
            std::thread::sleep(std::time::Duration::from_millis(SETTLE_MS));
            let after = match super::production_capture::capture_region(
                topology,
                region.x,
                region.y,
                region.width,
                region.height,
            ) {
                Ok(c) => c.image,
                Err(e) => {
                    return VerificationOutcome::unavailable(
                        "region-changed",
                        format!("could not photograph the region afterwards: {e}"),
                    )
                }
            };
            let score = freshness::similarity(before_img, &after);
            let difference = 1.0 - score;
            let required = minimum_difference.unwrap_or(0.02);
            let measurements = serde_json::json!({
                "difference": difference,
                "required_difference": required,
            });
            if difference >= required {
                VerificationOutcome::ok(
                    "region-changed",
                    format!("the target area changed after the click ({difference:.3})"),
                )
                .with(measurements)
            } else {
                // Genuinely ambiguous, and said as such: plenty of real actions
                // change nothing where they were clicked.
                VerificationOutcome::failed(
                    "region-changed",
                    format!(
                        "nothing visibly changed where the click landed ({difference:.3} < {required:.3})"
                    ),
                )
                .with(measurements)
            }
        }

        VisualExpectedOutcome::WindowAppeared {
            title_pattern,
            process_name,
        } => {
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_millis(MAX_WAIT_MS);
            loop {
                let now = visible_window_titles();
                let fresh: Vec<&String> = now
                    .iter()
                    .filter(|t| !before.window_titles.contains(t))
                    .collect();
                let matched = fresh.iter().find(|t| {
                    title_pattern
                        .as_deref()
                        .map(|p| matches_pattern(t, p))
                        .unwrap_or(true)
                });
                if let Some(t) = matched {
                    return VerificationOutcome::ok(
                        "window-appeared",
                        format!("a new window appeared: \"{t}\""),
                    );
                }
                if std::time::Instant::now() >= deadline {
                    let _ = process_name;
                    return VerificationOutcome::failed(
                        "window-appeared",
                        match title_pattern {
                            Some(p) => format!("no new window matching \"{p}\" appeared"),
                            None => "no new window appeared".to_string(),
                        },
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(60));
            }
        }

        VisualExpectedOutcome::WindowDisappeared { title_pattern } => {
            let Some(pattern) = title_pattern.as_deref() else {
                return VerificationOutcome::unavailable(
                    "window-disappeared",
                    "no window was named to watch for",
                );
            };
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_millis(MAX_WAIT_MS);
            loop {
                let gone = !visible_window_titles()
                    .iter()
                    .any(|t| matches_pattern(t, pattern));
                if gone {
                    return VerificationOutcome::ok(
                        "window-disappeared",
                        format!("no window matching \"{pattern}\" remains"),
                    );
                }
                if std::time::Instant::now() >= deadline {
                    return VerificationOutcome::failed(
                        "window-disappeared",
                        format!("a window matching \"{pattern}\" is still open"),
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(60));
            }
        }
    }
}

/// Which window owns a desktop point, for the obscured-target check.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowIdentity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// The topmost non-ArcSonare-overlay window containing a point.
///
/// Best-effort by design: full-desktop targets, games, canvas apps and remote
/// sessions expose nothing useful here, and a missing answer must not block an
/// action that would otherwise be fine.
pub fn window_at(x: i32, y: i32) -> Option<WindowIdentity> {
    let own = std::process::id();
    let mut candidates: Vec<xcap::Window> = xcap::Window::all()
        .ok()?
        .into_iter()
        .filter(|w| w.pid().unwrap_or(0) != own)
        .filter(|w| !w.is_minimized().unwrap_or(false))
        .filter(|w| {
            let (wx, wy) = (w.x().unwrap_or(0), w.y().unwrap_or(0));
            let (ww, wh) = (
                w.width().unwrap_or(0) as i32,
                w.height().unwrap_or(0) as i32,
            );
            x >= wx && y >= wy && x < wx + ww && y < wy + wh
        })
        .collect();
    candidates.sort_by_key(|w| -(w.z().unwrap_or(i32::MIN)));
    let top = candidates.first()?;
    Some(WindowIdentity {
        process_id: top.pid().ok(),
        process_name: top.app_name().ok(),
        title: top.title().ok(),
    })
}

/// Do two readings of "what is under the target" describe the same window?
///
/// Compares title and process rather than the handle, because a window that
/// repaints or is recreated is still the same thing to the user, and a handle
/// change alone is not evidence that the target moved.
pub fn same_window(a: &WindowIdentity, b: &WindowIdentity) -> bool {
    if a.process_id.is_some() && a.process_id != b.process_id {
        return false;
    }
    match (&a.title, &b.title) {
        (Some(x), Some(y)) => x == y,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_actions_ask_for_no_verifier() {
        assert!(VisualExpectedOutcome::None.is_none());
        assert_eq!(VisualExpectedOutcome::None.verifier_id(), "none");
    }

    #[test]
    fn a_click_on_the_test_target_names_the_counter_verifier() {
        let o = VisualExpectedOutcome::TestTargetClicked {
            expected_increment: 1,
        };
        assert!(!o.is_none());
        assert_eq!(o.verifier_id(), "test-target-clicked");
    }

    #[test]
    fn a_title_pattern_matches_case_insensitively_and_partially() {
        assert!(matches_pattern("Untitled - Notepad", "notepad"));
        assert!(matches_pattern("Save changes?", "Save"));
        assert!(!matches_pattern("Untitled - Notepad", "calculator"));
    }

    #[test]
    fn window_identity_ignores_a_missing_title_rather_than_failing_the_check() {
        // Games and canvas apps often report nothing useful. Treating "I can't
        // tell" as "it changed" would block actions that are perfectly fine.
        let a = WindowIdentity {
            process_id: Some(10),
            process_name: Some("game.exe".into()),
            title: None,
        };
        let b = WindowIdentity {
            process_id: Some(10),
            process_name: Some("game.exe".into()),
            title: None,
        };
        assert!(same_window(&a, &b));
    }

    #[test]
    fn a_different_process_under_the_target_is_a_different_window() {
        let a = WindowIdentity {
            process_id: Some(10),
            process_name: Some("spotify.exe".into()),
            title: Some("Spotify".into()),
        };
        let b = WindowIdentity {
            process_id: Some(11),
            process_name: Some("explorer.exe".into()),
            title: Some("Downloads".into()),
        };
        assert!(!same_window(&a, &b), "a dialog opened over the target");
    }

    #[test]
    fn a_retitled_window_of_the_same_process_is_treated_as_moved_on() {
        // The tab changed under the target: the coordinate is no longer the
        // thing the model matched, even though the app is the same.
        let a = WindowIdentity {
            process_id: Some(10),
            process_name: Some("chrome.exe".into()),
            title: Some("Inbox - Gmail".into()),
        };
        let b = WindowIdentity {
            process_id: Some(10),
            process_name: Some("chrome.exe".into()),
            title: Some("Settings".into()),
        };
        assert!(!same_window(&a, &b));
    }

    #[test]
    fn expected_outcomes_round_trip_through_the_wire_format() {
        // The frontend names these; a rename on either side must fail here
        // rather than at the moment a click is about to happen.
        let json = r#"{"kind":"test-target-clicked","expectedIncrement":1}"#;
        let parsed: VisualExpectedOutcome = serde_json::from_str(json).unwrap();
        assert!(matches!(
            parsed,
            VisualExpectedOutcome::TestTargetClicked {
                expected_increment: 1
            }
        ));

        let region: VisualExpectedOutcome =
            serde_json::from_str(r#"{"kind":"region-changed"}"#).unwrap();
        assert_eq!(region.verifier_id(), "region-changed");

        let none: VisualExpectedOutcome = serde_json::from_str(r#"{"kind":"none"}"#).unwrap();
        assert!(none.is_none());
    }

    #[test]
    fn an_unknown_verifier_name_is_rejected() {
        // The model must not be able to name arbitrary verifier code.
        assert!(serde_json::from_str::<VisualExpectedOutcome>(
            r#"{"kind":"run-arbitrary-thing","verifierId":"x"}"#
        )
        .is_err());
    }
}
