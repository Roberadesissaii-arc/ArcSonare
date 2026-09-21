//! Choosing *how* to do something, before doing it.
//!
//! ArcSonare grew a working eye-and-hand — screenshot, locate, move, click — and
//! then reached for it constantly, because it was there. Opening a folder became
//! "find the icon and double-click it", which is slower, hijacks the user's
//! cursor, and fails whenever the icon is covered by a window.
//!
//! The rule this encodes: use the least visual, least disruptive, most
//! deterministic method that can complete the request. Vision is the fallback
//! for interfaces that expose nothing else, not the default.

use serde::{Deserialize, Serialize};

/// How an action will actually be carried out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionStrategy {
    /// Shell, known folders, protocol handlers — no UI involved.
    NativeOs,
    /// An existing ArcSonare capability that works without the screen.
    InternalCapability,
    /// An app-specific API, URI scheme or CLI.
    ApplicationAdapter,
    /// Windows accessibility tree: invoke the control directly.
    UiAutomation,
    /// Browser DOM or devtools protocol.
    BrowserAutomation,
    /// A deterministic shortcut sent to a verified-focused window.
    KeyboardAutomation,
    /// Screenshot, locate, and move the cursor. The last resort.
    VisualInteraction,
    /// Ask the user rather than guess.
    UserConfirmation,
    Unsupported,
}

impl ExecutionStrategy {
    /// Does this take over the user's mouse?
    pub fn moves_cursor(&self) -> bool {
        matches!(self, Self::VisualInteraction)
    }

    /// Does this need a screenshot before it can act?
    pub fn needs_screen_capture(&self) -> bool {
        matches!(self, Self::VisualInteraction)
    }

    /// Lower is less disruptive. Used to order candidates.
    pub fn invasiveness(&self) -> u8 {
        match self {
            Self::NativeOs | Self::InternalCapability => 0,
            Self::ApplicationAdapter => 1,
            Self::UiAutomation => 2,
            Self::BrowserAutomation => 3,
            Self::KeyboardAutomation => 4,
            Self::VisualInteraction => 5,
            Self::UserConfirmation => 6,
            Self::Unsupported => 7,
        }
    }
}

/// What the user actually wants done.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActionIntent {
    OpenFolder,
    OpenFile,
    LaunchApplication,
    FocusApplication,
    CloseApplication,
    CreateFolder,
    OpenUrl,
    OpenSystemSettings,
    MediaControl,
    /// "Show me where X is" — draw attention, change nothing.
    HighlightTarget,
    /// "Show me where X is" where X is a Desktop icon.
    ///
    /// Separate from `HighlightTarget` because the answer is a lookup, not a
    /// recognition problem: Windows reports every Desktop icon's rectangle
    /// exactly. Routing it as a visual request is what produced a border around
    /// four unrelated icons — the geometry was right and the answer was not.
    HighlightDesktopItem,
    /// "Click X" where X is a visible control.
    ClickTarget,
    SelectListItem,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RiskLevel {
    Low,
    Moderate,
    High,
    Destructive,
}

/// What the planner decided, and why.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub intent: ActionIntent,
    pub primary_strategy: ExecutionStrategy,
    /// Tried in order if the primary reports it cannot proceed.
    pub fallback_strategies: Vec<ExecutionStrategy>,
    pub risk_level: RiskLevel,
    pub requires_screen_capture: bool,
    pub requires_cursor: bool,
    /// Machine-readable justification, for diagnostics.
    pub rationale_code: &'static str,
}

/// What structured routes happen to be usable right now.
///
/// The planner asks rather than assumes: an adapter that is not connected must
/// not win the plan, or the action silently does nothing.
#[derive(Debug, Clone, Copy, Default)]
pub struct AvailableCapabilities {
    pub native_filesystem: bool,
    pub application_registry: bool,
    pub application_adapter: bool,
    pub ui_automation: bool,
    pub browser_automation: bool,
    pub media_keys: bool,
    /// The shell's Desktop icon list can be read. When true, "show me the X
    /// folder" is answered by asking Windows rather than by looking at pixels.
    pub desktop_items: bool,
    /// Production visual interaction. False until the capture-ownership
    /// migration lands — see VisualMigrationState.
    pub visual_interaction: bool,
}

/// Everything production visual interaction needs before it may be used.
///
/// This is the migration gate. The old visual path reconstructs the capture
/// origin by matching image dimensions against the monitor list, and falls back
/// to whichever monitor the mouse is on — both of which put clicks on the wrong
/// screen. Connecting the planner to that path would route *more* traffic into
/// a known-broken executor, so the capability stays off until every one of
/// these is true.
#[derive(Debug, Clone, Copy)]
pub struct VisualMigrationState {
    /// Production capture selects the display before calling xcap.
    pub capture_binds_display: bool,
    /// Production capture registers a CapturedFrame before returning.
    pub frame_registered_at_capture: bool,
    /// The capture response carries frame_id / display_id / topology_version.
    pub ownership_returned_to_frontend: bool,
    /// capture_origin() is gone from the interaction path.
    pub origin_guessing_removed: bool,
    /// The cursor's monitor no longer decides target ownership.
    pub cursor_monitor_fallback_removed: bool,
    /// Overlay, cursor and click all go through resolve_visual_target().
    pub resolver_wired: bool,
}

impl VisualMigrationState {
    /// Where the repository actually stands right now.
    ///
    /// Kept as explicit flags rather than one boolean so the report says which
    /// step is outstanding instead of just "not ready". Each one is set only
    /// when the production code path is genuinely in place — the named tests
    /// beside each flag are what make it true, and flipping one without them is
    /// how a gate becomes decoration.
    pub const fn current() -> Self {
        Self {
            // display::production_capture::capture_display resolves the display
            // from the topology and matches the xcap monitor by identity before
            // reading a pixel. Proven live by `screenshot_live`.
            capture_binds_display: true,
            // capabilities::screenshots::finish_capture registers the frame in
            // the shared VisualRuntime before it returns.
            frame_registered_at_capture: true,
            // The capture result carries frame_id / display_id /
            // topology_version; frontendExecutors refuses a capture without
            // them rather than substituting a guess.
            ownership_returned_to_frontend: true,
            // capture_origin() and its dimension-matching are deleted, not
            // bypassed. `check-planner-routing.mts` guards the TypeScript side.
            origin_guessing_removed: true,
            // input.mouse_monitor_bounds is gone from Rust and from the
            // capability registry; the cursor is read only to verify a move.
            cursor_monitor_fallback_removed: true,
            // Overlay, cursor and click all enter through
            // display::visual_commands, which starts from a frame id.
            resolver_wired: true,
        }
    }

    pub const fn is_complete(&self) -> bool {
        self.capture_binds_display
            && self.frame_registered_at_capture
            && self.ownership_returned_to_frontend
            && self.origin_guessing_removed
            && self.cursor_monitor_fallback_removed
            && self.resolver_wired
    }

    /// The first unfinished step, for diagnostics and the not-ready message.
    pub fn blocking_step(&self) -> Option<&'static str> {
        if !self.capture_binds_display {
            Some("production capture does not select its display first")
        } else if !self.frame_registered_at_capture {
            Some("production capture does not register a frame")
        } else if !self.ownership_returned_to_frontend {
            Some("capture response carries no frame ownership")
        } else if !self.origin_guessing_removed {
            Some("capture_origin() is still in the interaction path")
        } else if !self.cursor_monitor_fallback_removed {
            Some("the cursor's monitor can still decide ownership")
        } else if !self.resolver_wired {
            Some("overlay and click do not use resolve_visual_target()")
        } else {
            None
        }
    }
}

impl AvailableCapabilities {
    /// What ArcSonare can actually do right now.
    ///
    /// A capability is true only when an executor exists AND is trustworthy.
    /// Advertising one that silently does nothing is worse than admitting the
    /// gap: the planner would pick it and the request would vanish.
    pub fn current() -> Self {
        Self::with_visual_state(VisualMigrationState::current())
    }

    pub fn with_visual_state(visual: VisualMigrationState) -> Self {
        Self {
            // These have real, working executors in the capability engine.
            native_filesystem: true,
            application_registry: true,
            media_keys: true,
            // The shell list-view reader is implemented and proven live against
            // the real Desktop (`desktop_items_live`).
            desktop_items: cfg!(windows),
            // No adapter, accessibility tree or browser bridge is built yet.
            application_adapter: false,
            ui_automation: false,
            browser_automation: false,
            // Gated on the ownership migration, not on whether code exists.
            visual_interaction: visual.is_complete(),
        }
    }
}

/// Pick a strategy for an intent, given what is actually available.
pub fn plan(intent: ActionIntent, caps: &AvailableCapabilities) -> ExecutionPlan {
    let (primary, fallbacks, risk, rationale) = match intent {
        // A path is a path. Nothing here needs the screen.
        ActionIntent::OpenFolder | ActionIntent::OpenFile if caps.native_filesystem => (
            ExecutionStrategy::NativeOs,
            vec![],
            RiskLevel::Low,
            "NATIVE_CAPABILITY_AVAILABLE",
        ),
        ActionIntent::CreateFolder if caps.native_filesystem => (
            ExecutionStrategy::InternalCapability,
            vec![],
            RiskLevel::Low,
            "NATIVE_CAPABILITY_AVAILABLE",
        ),
        // Launching by index beats hunting for a desktop icon that may be
        // behind a window.
        ActionIntent::LaunchApplication | ActionIntent::FocusApplication
            if caps.application_registry =>
        {
            (
                ExecutionStrategy::NativeOs,
                vec![ExecutionStrategy::VisualInteraction],
                RiskLevel::Low,
                "NATIVE_CAPABILITY_AVAILABLE",
            )
        }
        ActionIntent::CloseApplication => (
            ExecutionStrategy::NativeOs,
            vec![
                ExecutionStrategy::UiAutomation,
                ExecutionStrategy::VisualInteraction,
            ],
            RiskLevel::Moderate,
            "NATIVE_CAPABILITY_AVAILABLE",
        ),
        // Settings pages have URIs; clicking the taskbar is never necessary.
        ActionIntent::OpenUrl | ActionIntent::OpenSystemSettings => (
            ExecutionStrategy::NativeOs,
            vec![],
            RiskLevel::Low,
            "NATIVE_CAPABILITY_AVAILABLE",
        ),
        ActionIntent::MediaControl => {
            let mut chain = vec![];
            if caps.application_adapter {
                chain.push(ExecutionStrategy::ApplicationAdapter);
            }
            if caps.media_keys {
                chain.push(ExecutionStrategy::KeyboardAutomation);
            }
            chain.push(ExecutionStrategy::VisualInteraction);
            let primary = chain.remove(0);
            (
                primary,
                chain,
                RiskLevel::Low,
                "STRUCTURED_ACTION_AVAILABLE",
            )
        }
        // A Desktop icon has a known rectangle. Ask the shell for it rather than
        // photographing the screen and asking a model to recognise it: the
        // lookup cannot misidentify anything, and it needs no capture at all.
        // Vision stays as a fallback for when the shell list is unreadable.
        ActionIntent::HighlightDesktopItem if caps.desktop_items => (
            ExecutionStrategy::InternalCapability,
            vec![ExecutionStrategy::VisualInteraction],
            RiskLevel::Low,
            "STRUCTURED_DESKTOP_LOOKUP_AVAILABLE",
        ),
        // No shell list on this machine — fall back to the visual route, which
        // is now guarded against boxes that cannot be a single icon.
        ActionIntent::HighlightDesktopItem => (
            ExecutionStrategy::VisualInteraction,
            vec![],
            RiskLevel::Low,
            "STRUCTURED_DESKTOP_LOOKUP_UNAVAILABLE",
        ),
        // "Show me" is a request to point, not to act. Vision is correct here,
        // and it must not click.
        ActionIntent::HighlightTarget => (
            ExecutionStrategy::VisualInteraction,
            vec![],
            RiskLevel::Low,
            if caps.visual_interaction {
                "USER_REQUESTED_HIGHLIGHT"
            } else {
                // The plan still names the right strategy; the executor turns
                // this into a typed not-ready result rather than clicking.
                "VISUAL_INTERACTION_NOT_READY"
            },
        ),
        ActionIntent::SelectListItem | ActionIntent::ClickTarget => {
            let mut chain = vec![];
            if caps.ui_automation {
                chain.push(ExecutionStrategy::UiAutomation);
            }
            if caps.browser_automation {
                chain.push(ExecutionStrategy::BrowserAutomation);
            }
            chain.push(ExecutionStrategy::VisualInteraction);
            let primary = chain.remove(0);
            let rationale = if primary != ExecutionStrategy::VisualInteraction {
                "STRUCTURED_ACTION_AVAILABLE"
            } else if caps.visual_interaction {
                "VISUAL_FALLBACK_REQUIRED"
            } else {
                "VISUAL_INTERACTION_NOT_READY"
            };
            (primary, chain, RiskLevel::Moderate, rationale)
        }
        _ => (
            ExecutionStrategy::Unsupported,
            vec![],
            RiskLevel::Low,
            "STRUCTURED_ACTION_UNAVAILABLE",
        ),
    };

    // Pointing at something and pressing it are different acts. Highlighting
    // draws an overlay on the screen and leaves the mouse where the user left
    // it — reporting otherwise would make "show me" look as invasive as
    // "click", and would justify moving a cursor that has no business moving.
    let requires_cursor = primary.moves_cursor()
        && !matches!(
            intent,
            ActionIntent::HighlightTarget | ActionIntent::HighlightDesktopItem
        );

    ExecutionPlan {
        intent,
        primary_strategy: primary,
        fallback_strategies: fallbacks,
        risk_level: risk,
        requires_screen_capture: primary.needs_screen_capture(),
        requires_cursor,
        rationale_code: rationale,
    }
}

/// Why an attempt stopped. Decides whether a fallback may run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttemptStatus {
    Succeeded,
    Unsupported,
    Unavailable,
    TargetNotFound,
    VerificationFailed,
    PermissionDenied,
    Unsafe,
    Failed,
    /// The display this action needed may not be acted on.
    ///
    /// Separate from `Unavailable` because `Unavailable` *allows fallback*, and
    /// the fallback for a Desktop highlight is the vision route — aimed at the
    /// same monitor the gate just refused. A profile refusal is a decision about
    /// the display, so no other strategy on that display can be more entitled
    /// than the one that was refused.
    DisplayRefused,
}

impl AttemptStatus {
    /// May the next strategy be tried?
    ///
    /// The dangerous cases are the ones that might have *partly* worked. Trying
    /// again after a verification failure risks launching a second instance or
    /// sending a second message.
    pub fn allows_fallback(&self) -> bool {
        matches!(
            self,
            Self::Unsupported | Self::Unavailable | Self::TargetNotFound
        )
    }

    /// Did this attempt refuse before anything could reach the screen?
    ///
    /// Every typed display refusal answers yes, which is what lets the caller
    /// state plainly that no cursor moved and no click was sent.
    pub fn failed_before_side_effect(&self) -> bool {
        matches!(
            self,
            Self::DisplayRefused
                | Self::Unsupported
                | Self::Unavailable
                | Self::TargetNotFound
                | Self::PermissionDenied
                | Self::Unsafe
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> AvailableCapabilities {
        AvailableCapabilities::current()
    }

    #[test]
    fn opening_a_folder_never_touches_the_screen_or_cursor() {
        // "Open the ArcSonare folder on my desktop."
        let p = plan(ActionIntent::OpenFolder, &today());
        assert_eq!(p.primary_strategy, ExecutionStrategy::NativeOs);
        assert!(!p.requires_screen_capture, "no screenshot should be taken");
        assert!(!p.requires_cursor, "the cursor must not move");
    }

    #[test]
    fn launching_an_app_does_not_hunt_for_a_desktop_icon() {
        // "Open Spotify."
        let p = plan(ActionIntent::LaunchApplication, &today());
        assert_eq!(p.primary_strategy, ExecutionStrategy::NativeOs);
        assert!(!p.requires_cursor);
    }

    #[test]
    fn opening_a_url_or_settings_page_stays_native() {
        for intent in [ActionIntent::OpenUrl, ActionIntent::OpenSystemSettings] {
            let p = plan(intent, &today());
            assert_eq!(p.primary_strategy, ExecutionStrategy::NativeOs);
            assert!(!p.requires_cursor, "{intent:?} must not move the cursor");
        }
    }

    #[test]
    fn creating_a_folder_uses_a_capability_not_the_mouse() {
        let p = plan(ActionIntent::CreateFolder, &today());
        assert_eq!(p.primary_strategy, ExecutionStrategy::InternalCapability);
        assert!(!p.requires_screen_capture);
    }

    /// A migration state with nothing done, for testing the gate itself.
    fn nothing_migrated() -> VisualMigrationState {
        VisualMigrationState {
            capture_binds_display: false,
            frame_registered_at_capture: false,
            ownership_returned_to_frontend: false,
            origin_guessing_removed: false,
            cursor_monitor_fallback_removed: false,
            resolver_wired: false,
        }
    }

    #[test]
    fn show_me_uses_vision_but_only_to_highlight() {
        // "Show me the ArcSonare folder" — the one case where vision IS right.
        let p = plan(ActionIntent::HighlightTarget, &today());
        assert_eq!(p.primary_strategy, ExecutionStrategy::VisualInteraction);
        assert!(p.requires_screen_capture);
        assert_eq!(p.rationale_code, "USER_REQUESTED_HIGHLIGHT");
        assert!(!p.requires_cursor, "pointing is not clicking");

        // If any prerequisite regressed, the same request must stop naming
        // itself ready — this is the assertion that catches a half-revert.
        let stalled = AvailableCapabilities::with_visual_state(nothing_migrated());
        assert_eq!(
            plan(ActionIntent::HighlightTarget, &stalled).rationale_code,
            "VISUAL_INTERACTION_NOT_READY"
        );
    }

    #[test]
    fn open_and_show_me_route_differently_for_the_same_object() {
        // The distinction the whole router exists for.
        let open = plan(ActionIntent::OpenFolder, &today());
        let show = plan(ActionIntent::HighlightTarget, &today());
        assert_ne!(open.primary_strategy, show.primary_strategy);
        assert!(!open.requires_cursor && show.requires_screen_capture);
    }

    #[test]
    fn clicking_a_control_prefers_accessibility_when_it_exists() {
        let mut caps = today();
        caps.ui_automation = true;
        let p = plan(ActionIntent::ClickTarget, &caps);
        assert_eq!(p.primary_strategy, ExecutionStrategy::UiAutomation);
        assert!(!p.requires_cursor, "invoke directly rather than clicking");
        assert!(p
            .fallback_strategies
            .contains(&ExecutionStrategy::VisualInteraction));
    }

    #[test]
    fn clicking_falls_back_to_vision_when_nothing_structured_exists() {
        // A custom-rendered app exposing no accessibility tree.
        let p = plan(ActionIntent::ClickTarget, &today());
        assert_eq!(p.primary_strategy, ExecutionStrategy::VisualInteraction);
        assert_eq!(p.rationale_code, "VISUAL_FALLBACK_REQUIRED");
        // Vision is a fallback, not a preference: it is chosen here only
        // because nothing structured exists to choose instead.
        assert!(p.requires_screen_capture && p.requires_cursor);
    }

    #[test]
    fn pausing_music_prefers_an_adapter_then_media_keys_before_vision() {
        let mut caps = today();
        caps.application_adapter = true;
        let p = plan(ActionIntent::MediaControl, &caps);
        assert_eq!(p.primary_strategy, ExecutionStrategy::ApplicationAdapter);
        assert_eq!(
            p.fallback_strategies.first(),
            Some(&ExecutionStrategy::KeyboardAutomation)
        );

        // Without the adapter, media keys still beat clicking.
        let p2 = plan(ActionIntent::MediaControl, &today());
        assert_eq!(p2.primary_strategy, ExecutionStrategy::KeyboardAutomation);
        assert!(!p2.requires_cursor);
    }

    #[test]
    fn selecting_the_third_song_degrades_in_the_documented_order() {
        let mut caps = today();
        caps.ui_automation = true;
        let p = plan(ActionIntent::SelectListItem, &caps);
        assert_eq!(p.primary_strategy, ExecutionStrategy::UiAutomation);
        assert_eq!(
            p.fallback_strategies.last(),
            Some(&ExecutionStrategy::VisualInteraction)
        );
    }

    #[test]
    fn closing_an_app_asks_the_window_before_clicking_its_close_button() {
        let p = plan(ActionIntent::CloseApplication, &today());
        assert_eq!(p.primary_strategy, ExecutionStrategy::NativeOs);
        assert!(!p.requires_cursor);
        assert_eq!(p.risk_level, RiskLevel::Moderate);
    }

    #[test]
    fn the_ownership_migration_is_recorded_as_complete() {
        // Each flag corresponds to production code that now exists; the comment
        // beside it in `current()` names the code and the test that proves it.
        // If any of those are reverted, this is the assertion that fails first.
        let state = VisualMigrationState::current();
        assert!(
            state.is_complete(),
            "outstanding: {:?}",
            state.blocking_step()
        );
        assert_eq!(state.blocking_step(), None);
        assert!(today().visual_interaction);
    }

    #[test]
    fn five_of_six_prerequisites_still_leaves_visual_interaction_disabled() {
        // Every single flag is load-bearing, so drop each one in turn rather
        // than only the last: a gate that opens when one specific step is
        // missing is a gate that never had to be satisfied.
        let complete = VisualMigrationState::current();
        let drops: [fn(&mut VisualMigrationState); 6] = [
            |s| s.capture_binds_display = false,
            |s| s.frame_registered_at_capture = false,
            |s| s.ownership_returned_to_frontend = false,
            |s| s.origin_guessing_removed = false,
            |s| s.cursor_monitor_fallback_removed = false,
            |s| s.resolver_wired = false,
        ];
        for (i, drop) in drops.iter().enumerate() {
            let mut state = complete;
            drop(&mut state);
            assert!(!state.is_complete(), "step {i} was not load-bearing");
            assert!(
                state.blocking_step().is_some(),
                "step {i} must be named, not merely refused"
            );
            assert!(
                !AvailableCapabilities::with_visual_state(state).visual_interaction,
                "visual interaction opened with step {i} outstanding"
            );
        }
    }

    #[test]
    fn the_gate_opens_only_when_every_step_is_done() {
        let mut state = nothing_migrated();
        assert!(!AvailableCapabilities::with_visual_state(state).visual_interaction);
        state.capture_binds_display = true;
        state.frame_registered_at_capture = true;
        state.ownership_returned_to_frontend = true;
        state.origin_guessing_removed = true;
        state.cursor_monitor_fallback_removed = true;
        // One step left: still closed.
        assert!(!AvailableCapabilities::with_visual_state(state).visual_interaction);
        state.resolver_wired = true;
        assert!(AvailableCapabilities::with_visual_state(state).visual_interaction);
    }

    #[test]
    fn a_partly_completed_attempt_must_not_trigger_a_second_strategy() {
        // Launching succeeded but verification lagged: retrying visually would
        // open Spotify twice.
        assert!(!AttemptStatus::VerificationFailed.allows_fallback());
        assert!(!AttemptStatus::Failed.allows_fallback());
        // Safety and permission refusals are decisions, not obstacles.
        assert!(!AttemptStatus::Unsafe.allows_fallback());
        assert!(!AttemptStatus::PermissionDenied.allows_fallback());
        // These are genuinely "this route cannot do it" — move on.
        assert!(AttemptStatus::Unsupported.allows_fallback());
        assert!(AttemptStatus::Unavailable.allows_fallback());
        assert!(AttemptStatus::TargetNotFound.allows_fallback());
    }

    #[test]
    fn every_fallback_chain_is_ordered_least_invasive_first() {
        let mut caps = today();
        caps.ui_automation = true;
        caps.browser_automation = true;
        for intent in [
            ActionIntent::ClickTarget,
            ActionIntent::SelectListItem,
            ActionIntent::MediaControl,
        ] {
            let p = plan(intent, &caps);
            let mut seen = p.primary_strategy.invasiveness();
            for f in &p.fallback_strategies {
                assert!(
                    f.invasiveness() >= seen,
                    "{intent:?} falls back to something less invasive: {f:?}"
                );
                seen = f.invasiveness();
            }
        }
    }

    #[test]
    fn no_native_intent_ever_requests_the_cursor() {
        for intent in [
            ActionIntent::OpenFolder,
            ActionIntent::OpenFile,
            ActionIntent::CreateFolder,
            ActionIntent::LaunchApplication,
            ActionIntent::FocusApplication,
            ActionIntent::OpenUrl,
            ActionIntent::OpenSystemSettings,
        ] {
            let p = plan(intent, &today());
            assert!(!p.requires_cursor, "{intent:?} asked for the cursor");
            assert!(
                !p.requires_screen_capture,
                "{intent:?} asked for a screenshot"
            );
        }
    }
}
