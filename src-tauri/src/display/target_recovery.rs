//! Why a target went stale, and whether that is worth telling the user.
//!
//! The freshness check already compares a region around the target rather than
//! the whole screen. What it did not do was distinguish outcomes: every failure
//! became `SCREEN_CHANGED_BEFORE_ACTION` with one sentence — "The screen
//! changed after I looked at it" — whether the window had moved two pixels, an
//! animation had played, the ArcSonare overlay itself was in the compared
//! region, or the target had genuinely gone.
//!
//! Two things follow from that. Users were told a request failed when nothing
//! was wrong except that the assistant had not looked again. And when something
//! *was* wrong, the message did not say what.
//!
//! So: classify the outcome, recover automatically where recovery is obviously
//! right, and only ask when the answer actually depends on the user.
//!
//! Recovery is bounded at two attempts. Unbounded re-resolution against a
//! screen that keeps changing is a loop the user cannot see, and a third
//! identical failure is information — something is moving that should not be.

#![cfg(windows)]

use serde::Serialize;

/// How many times a target may be re-resolved before the user is asked.
pub const MAX_AUTOMATIC_ATTEMPTS: u32 = 2;

/// What the comparison found. Distinct variants because they are distinct
/// sentences — and because two of them are not failures at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetOutcome {
    /// The region is unchanged. Proceed.
    Fresh,
    /// The region changed but the target was found again at a new position.
    /// Not a failure and not announced as one.
    Recovered,
    /// Changed by something that cannot have moved the target: the cursor, a
    /// blinking caret, our own overlay. Proceed.
    IgnorableChange,
    /// Re-resolution found nothing that matches.
    TargetGone,
    /// Re-resolution found more than one equally good match. Only the user can
    /// say which.
    Ambiguous,
    /// The window that owned the target is no longer there.
    SourceWindowClosed,
    /// Monitors were added, removed, or rearranged. Coordinates from before are
    /// meaningless, not merely stale.
    TopologyChanged,
    /// The check itself could not run. Not the same as "it changed", and must
    /// not be reported as one.
    CouldNotCheck,
}

impl TargetOutcome {
    /// Whether execution may continue without asking.
    pub fn proceeds(self) -> bool {
        matches!(self, Self::Fresh | Self::Recovered | Self::IgnorableChange)
    }

    /// Whether the user has to answer something.
    pub fn needs_user(self) -> bool {
        !self.proceeds()
    }

    /// One accurate sentence. Deliberately never "the screen moved".
    pub fn message(self, label: Option<&str>) -> String {
        let it = label.unwrap_or("that");
        match self {
            Self::Fresh => String::new(),
            // Recovery is not news. Saying "I refreshed the target" every time
            // a window moved would make normal operation look unreliable.
            Self::Recovered | Self::IgnorableChange => String::new(),
            Self::TargetGone => format!("I can't see {it} on screen any more."),
            Self::Ambiguous => {
                format!("I found more than one match for {it}. Which one do you mean?")
            }
            Self::SourceWindowClosed => {
                format!("The window {it} was in has closed.")
            }
            Self::TopologyChanged => {
                "The display layout changed, so I need to look again.".into()
            }
            Self::CouldNotCheck => {
                format!("I couldn't confirm {it} is still where I saw it.")
            }
        }
    }

    /// Stable code for the frontend and the trace.
    pub fn code(self) -> &'static str {
        match self {
            Self::Fresh => "TARGET_FRESH",
            Self::Recovered => "TARGET_RECOVERED",
            Self::IgnorableChange => "TARGET_UNCHANGED_ENOUGH",
            Self::TargetGone => "TARGET_GONE",
            Self::Ambiguous => "TARGET_AMBIGUOUS",
            Self::SourceWindowClosed => "SOURCE_WINDOW_CLOSED",
            Self::TopologyChanged => "DISPLAY_TOPOLOGY_CHANGED",
            Self::CouldNotCheck => "TARGET_CHECK_UNAVAILABLE",
        }
    }
}

/// Enough of a target to recognise it again after it moves.
///
/// Position is the least durable part, which is why it is not the identity. A
/// button that moved 40px down is the same button; a different button at the
/// old coordinates is not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetIdentity {
    /// The window that owned it, if a window was involved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u32>,
    /// EDID-derived monitor key, never an xcap index.
    pub monitor_key: String,
    /// UI Automation / accessibility id when the control was resolved
    /// semantically rather than visually. The strongest identity available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control_id: Option<String>,
    /// What the user called it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Which capture this came from, so a target from an older generation is
    /// visibly older rather than silently equivalent.
    pub capture_generation: u64,
}

impl TargetIdentity {
    /// Is this the same thing, allowing for it having moved?
    ///
    /// A semantic control id settles it outright. Failing that, same window and
    /// same label is the strongest claim available; the caller supplies visual
    /// confirmation separately.
    pub fn same_as(&self, other: &Self) -> bool {
        if self.monitor_key != other.monitor_key {
            return false;
        }
        if let (Some(a), Some(b)) = (self.control_id.as_deref(), other.control_id.as_deref()) {
            return a == b;
        }
        if self.window_id != other.window_id {
            return false;
        }
        match (self.label.as_deref(), other.label.as_deref()) {
            (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
            // No label either side: same window on the same monitor is as much
            // as can be claimed, and the caller's visual check decides.
            (None, None) => true,
            _ => false,
        }
    }
}

/// What changed in the compared region, before deciding what it means.
#[derive(Debug, Clone, Copy)]
pub struct RegionChange {
    pub similarity: f32,
    pub threshold: f32,
    /// The region overlapped an ArcSonare overlay. Our own highlight is not
    /// evidence that the user's screen changed — and drawing one immediately
    /// before checking is exactly what the annotation flow does.
    pub overlay_present: bool,
    /// The mouse pointer is inside the region. A cursor is not a UI change.
    pub cursor_inside: bool,
}

/// One re-resolution attempt's result, as the caller reports it.
#[derive(Debug, Clone)]
pub enum Resolution {
    Found(TargetIdentity),
    /// Several candidates matched equally well.
    Multiple(usize),
    None,
    WindowClosed,
}

/// Decide what to do about a region that no longer matches.
///
/// Takes the change and a re-resolution callback rather than doing the
/// capturing itself, so the decision can be tested without a screen.
pub fn classify(
    original: &TargetIdentity,
    change: RegionChange,
    topology_changed: bool,
    mut re_resolve: impl FnMut(u32) -> Resolution,
) -> (TargetOutcome, Option<TargetIdentity>) {
    // Coordinates from before a topology change do not mean anything, however
    // similar the pixels look. Checked first for that reason.
    if topology_changed {
        return (TargetOutcome::TopologyChanged, None);
    }

    if change.similarity >= 1.0 - change.threshold {
        return (TargetOutcome::Fresh, None);
    }

    // Our own overlay, or the pointer, inside the compared region. Neither can
    // have moved the target, and treating them as staleness meant the second
    // annotation of a request always failed — the first one's highlight was
    // still on screen.
    if change.overlay_present || change.cursor_inside {
        return (TargetOutcome::IgnorableChange, None);
    }

    for attempt in 1..=MAX_AUTOMATIC_ATTEMPTS {
        match re_resolve(attempt) {
            Resolution::Found(found) => {
                if found.same_as(original) {
                    return (TargetOutcome::Recovered, Some(found));
                }
                // Something is there, but it is not what was approved. Falling
                // through to another attempt rather than acting on it.
            }
            Resolution::Multiple(_) => return (TargetOutcome::Ambiguous, None),
            Resolution::WindowClosed => return (TargetOutcome::SourceWindowClosed, None),
            Resolution::None => {}
        }
    }

    (TargetOutcome::TargetGone, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> TargetIdentity {
        TargetIdentity {
            window_id: Some(42),
            process_id: Some(1234),
            monitor_key: "EDID-LHC9019".into(),
            control_id: None,
            label: Some("Next".into()),
            capture_generation: 7,
        }
    }

    fn changed(similarity: f32) -> RegionChange {
        RegionChange {
            similarity,
            threshold: 0.12,
            overlay_present: false,
            cursor_inside: false,
        }
    }

    #[test]
    fn an_unchanged_region_proceeds_silently() {
        let (outcome, _) = classify(&identity(), changed(0.99), false, |_| Resolution::None);
        assert_eq!(outcome, TargetOutcome::Fresh);
        assert!(outcome.proceeds());
        assert_eq!(outcome.message(Some("Next")), "");
    }

    /// The reported failure. A window moved, the target is still there, and the
    /// user hears nothing about it.
    #[test]
    fn a_moved_window_is_recovered_without_asking() {
        let mut moved = identity();
        moved.capture_generation = 8;
        let (outcome, found) = classify(&identity(), changed(0.4), false, |_| {
            Resolution::Found(moved.clone())
        });
        assert_eq!(outcome, TargetOutcome::Recovered);
        assert!(outcome.proceeds(), "recovery must not stop the request");
        assert!(!outcome.needs_user(), "recovery must not ask permission");
        assert_eq!(
            outcome.message(Some("Next")),
            "",
            "successful recovery is not announced as a failure"
        );
        assert_eq!(found.unwrap().capture_generation, 8);
    }

    /// Our own highlight inside the compared region. This is what made the
    /// second annotation of a request fail every time.
    #[test]
    fn our_own_overlay_is_not_a_changed_screen() {
        let mut change = changed(0.2);
        change.overlay_present = true;
        let (outcome, _) = classify(&identity(), change, false, |_| {
            panic!("must not even attempt re-resolution")
        });
        assert_eq!(outcome, TargetOutcome::IgnorableChange);
        assert!(outcome.proceeds());
    }

    #[test]
    fn a_cursor_in_the_region_is_not_a_changed_screen() {
        let mut change = changed(0.2);
        change.cursor_inside = true;
        let (outcome, _) = classify(&identity(), change, false, |_| Resolution::None);
        assert_eq!(outcome, TargetOutcome::IgnorableChange);
    }

    #[test]
    fn recovery_is_attempted_at_most_twice() {
        let mut attempts = 0;
        let (outcome, _) = classify(&identity(), changed(0.1), false, |n| {
            attempts = n;
            Resolution::None
        });
        assert_eq!(attempts, MAX_AUTOMATIC_ATTEMPTS);
        assert_eq!(outcome, TargetOutcome::TargetGone);
    }

    #[test]
    fn each_failure_says_something_different() {
        let cases = [
            (TargetOutcome::TargetGone, "can't see"),
            (TargetOutcome::Ambiguous, "more than one"),
            (TargetOutcome::SourceWindowClosed, "has closed"),
            (TargetOutcome::TopologyChanged, "display layout"),
            (TargetOutcome::CouldNotCheck, "couldn't confirm"),
        ];
        for (outcome, fragment) in cases {
            let message = outcome.message(Some("the Next button"));
            assert!(
                message.to_lowercase().contains(fragment),
                "{:?} said {message:?}",
                outcome
            );
            assert!(
                !message.to_lowercase().contains("the screen moved"),
                "{:?} fell back to the generic message",
                outcome
            );
            assert!(outcome.needs_user());
        }
        // And every outcome has its own code, so the trace can distinguish them.
        let codes: Vec<&str> = [
            TargetOutcome::Fresh,
            TargetOutcome::Recovered,
            TargetOutcome::IgnorableChange,
            TargetOutcome::TargetGone,
            TargetOutcome::Ambiguous,
            TargetOutcome::SourceWindowClosed,
            TargetOutcome::TopologyChanged,
            TargetOutcome::CouldNotCheck,
        ]
        .iter()
        .map(|o| o.code())
        .collect();
        let unique: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(unique.len(), codes.len(), "two outcomes share a code");
    }

    #[test]
    fn two_matches_ask_which_one() {
        let (outcome, _) = classify(&identity(), changed(0.3), false, |_| Resolution::Multiple(2));
        assert_eq!(outcome, TargetOutcome::Ambiguous);
        assert!(outcome.needs_user());
    }

    #[test]
    fn a_closed_window_is_reported_as_a_closed_window() {
        let (outcome, _) = classify(&identity(), changed(0.3), false, |_| Resolution::WindowClosed);
        assert_eq!(outcome, TargetOutcome::SourceWindowClosed);
    }

    /// Coordinates from before a monitor rearrangement are meaningless even if
    /// the pixels happen to match, so this is checked before similarity.
    #[test]
    fn a_topology_change_wins_over_a_matching_region() {
        let (outcome, _) = classify(&identity(), changed(1.0), true, |_| Resolution::None);
        assert_eq!(outcome, TargetOutcome::TopologyChanged);
    }

    /// A different control at the same place is not the approved target.
    #[test]
    fn something_else_in_the_same_place_is_not_recovery() {
        let mut impostor = identity();
        impostor.label = Some("Previous".into());
        let (outcome, found) = classify(&identity(), changed(0.3), false, |_| {
            Resolution::Found(impostor.clone())
        });
        assert_eq!(outcome, TargetOutcome::TargetGone);
        assert!(found.is_none());
    }

    #[test]
    fn a_semantic_control_id_settles_identity_by_itself() {
        let mut original = identity();
        original.control_id = Some("SpotifyNextButton".into());
        let mut moved = original.clone();
        moved.label = Some("completely different label".into());
        moved.window_id = Some(99);
        assert!(
            moved.same_as(&original),
            "a matching automation id is the strongest evidence available"
        );
    }

    #[test]
    fn a_target_on_another_monitor_is_never_the_same_target() {
        let mut elsewhere = identity();
        elsewhere.monitor_key = "EDID-GSM5BB1".into();
        assert!(!elsewhere.same_as(&identity()));
    }
}
