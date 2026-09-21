//! One authority for "what is on screen right now".
//!
//! Before this, every surface that wanted a screenshot took one. The chat
//! composer, the visual planner, the vision service and the overlay each
//! captured independently, each held whatever they got, and none of them knew
//! when another had moved on. So "what is this?" could be answered from a frame
//! taken before the user switched windows — the reported failure — and there
//! was no single place to fix it, because there was no single place that knew.
//!
//! What this owns is the *decision*: which frame is current, and whether it is
//! still allowed to be used. It deliberately does not own the pixels. Frames
//! keep living in `FrameRegistry`, which already binds them to a display and a
//! topology version; duplicating that here would create a second answer to a
//! question that already has one.
//!
//! Two rules make it correct rather than merely centralised:
//!
//!   1. Freshness is not only age. A frame two hundred milliseconds old is
//!      stale if the foreground window changed, if the topology changed, or if
//!      the window it was taken from has moved. Age was the only check before,
//!      and it is the one that misses every interesting case.
//!
//!   2. Nothing is captured on a timer without a reason. While an interaction
//!      is live the service permits at most one refresh per second; when the
//!      interaction ends, refreshing stops. There is no standing recording, and
//!      `recent` is bounded so there cannot become one by accident.
//!
//! Win32 is not called from here. The service is told what the world looks
//! like — foreground window, topology version, window bounds — so the policy is
//! testable on any platform and the platform code stays at the edge.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// How long a frame may be used for a visual action before it must be retaken.
///
/// Shorter than `FrameRegistry`'s 30s actionable window on purpose: that one
/// bounds when a frame is *resolvable*, this one bounds when it is *current*.
/// A frame can be perfectly resolvable and still describe a screen the user has
/// moved on from.
pub const DEFAULT_MAX_AGE_MS: u64 = 1_500;

/// The floor on background refreshes while an interaction is live.
///
/// One frame per second, and only while the user is actually interacting. This
/// is the number in the brief, written where it is enforced rather than in a
/// comment somewhere hopeful.
pub const ACTIVE_REFRESH_INTERVAL_MS: u64 = 1_000;

/// How many recent snapshots are kept.
///
/// Bounded so "keep a little history" cannot drift into "retain a screen
/// recording". Metadata only — the images belong to the frame registry and
/// expire on its own schedule.
const RECENT_LIMIT: usize = 8;

/// A rectangle in physical desktop pixels.
///
/// Desktop, not client, and signed — a monitor left of the primary has a
/// negative origin, and the bug that produces is silent everywhere that assumes
/// otherwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl CaptureRegion {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x
            && y >= self.y
            && x < self.x.saturating_add(self.width as i32)
            && y < self.y.saturating_add(self.height as i32)
    }

    /// Clamp another rectangle into this one, or `None` if they do not overlap.
    pub fn clamp(&self, other: &CaptureRegion) -> Option<CaptureRegion> {
        let left = self.x.max(other.x);
        let top = self.y.max(other.y);
        let right = (self.x + self.width as i32).min(other.x + other.width as i32);
        let bottom = (self.y + self.height as i32).min(other.y + other.height as i32);
        if right <= left || bottom <= top {
            return None;
        }
        Some(CaptureRegion {
            x: left,
            y: top,
            width: (right - left) as u32,
            height: (bottom - top) as u32,
        })
    }

    /// Grow by a fraction of each side, then clamp back inside `bounds`.
    ///
    /// Used for annotation context padding: a circle drawn tightly round a logo
    /// crops to a logo with no page around it, which is not enough to identify
    /// anything.
    pub fn padded(&self, fraction: f32, bounds: &CaptureRegion) -> CaptureRegion {
        let pad_x = ((self.width as f32) * fraction).round() as i32;
        let pad_y = ((self.height as f32) * fraction).round() as i32;
        let grown = CaptureRegion {
            x: self.x - pad_x,
            y: self.y - pad_y,
            width: self.width.saturating_add((pad_x * 2).max(0) as u32),
            height: self.height.saturating_add((pad_y * 2).max(0) as u32),
        };
        bounds.clamp(&grown).unwrap_or(*self)
    }
}

/// What was photographed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CaptureSource {
    /// A whole monitor.
    Display { display_id: u32 },
    /// One application window, which is what an annotation over a browser wants
    /// — capturing the desktop instead drags in the other monitor and the
    /// ArcSonare overlay along with it.
    Window {
        hwnd: isize,
        #[serde(default)]
        title: String,
    },
    /// A sub-rectangle of a display.
    Region { display_id: u32 },
}

impl CaptureSource {
    fn window_hwnd(&self) -> Option<isize> {
        match self {
            Self::Window { hwnd, .. } => Some(*hwnd),
            _ => None,
        }
    }
}

/// Everything known about the current screen, recorded at capture time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenContextSnapshot {
    /// The frame in `FrameRegistry` this describes. The pixels live there.
    pub frame_id: String,
    pub captured_at_ms: u64,
    pub source: CaptureSource,
    pub capture_region: CaptureRegion,
    /// The window that had focus when this was taken. The single most useful
    /// staleness signal, and the one nothing checked before.
    pub foreground_hwnd: Option<isize>,
    pub display_id: u32,
    pub topology_version: String,
    /// Bounds of the source window when captured, so a move can be detected.
    #[serde(default)]
    pub window_bounds: Option<CaptureRegion>,
    /// Binds this frame to the spoken request and the drawn annotation that
    /// belong with it.
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub annotation_id: Option<String>,
}

/// What the world looks like at the moment a frame is about to be used.
///
/// Passed in rather than read here: the policy is what needs testing, and a
/// policy that calls `GetForegroundWindow` cannot be tested at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldState {
    pub now_ms: u64,
    pub foreground_hwnd: Option<isize>,
    pub topology_version: String,
    /// Current bounds of the snapshot's source window, when it has one.
    pub window_bounds: Option<CaptureRegion>,
    /// `false` when the source window no longer exists.
    pub window_exists: bool,
}

/// Why a frame may not be acted on.
///
/// Each is a different sentence and a different recovery. "It aged out" is a
/// recapture; "you switched windows" may need the target re-resolved; "the
/// window is gone" cannot be recovered at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Staleness {
    Fresh,
    TooOld,
    ForegroundChanged,
    TopologyChanged,
    WindowMoved,
    WindowGone,
}

impl Staleness {
    pub fn is_fresh(self) -> bool {
        matches!(self, Self::Fresh)
    }

    /// What the user is told, when they need telling.
    pub fn message(self) -> &'static str {
        match self {
            Self::Fresh => "",
            Self::TooOld => "That view of the screen is out of date, so I took a fresh one.",
            Self::ForegroundChanged => {
                "The window in front changed, so I looked at the screen again."
            }
            Self::TopologyChanged => {
                "Your displays changed, so I re-checked the screen before acting."
            }
            Self::WindowMoved => {
                "That window moved after I looked, so I re-checked it before acting."
            }
            Self::WindowGone => "That window has closed, so I can't act on it.",
        }
    }

    /// Whether a recapture can recover this. `WindowGone` cannot.
    pub fn recoverable(self) -> bool {
        !matches!(self, Self::WindowGone)
    }
}

/// Why a capture is being taken. Kept so the trace can say what prompted it,
/// and so the once-a-second cap can apply to background refreshes *only*.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureTrigger {
    /// The user started asking something visual.
    VisualRequestStarted,
    /// They finished saying it.
    VisualRequestCompleted,
    /// A drawing gesture completed. Never deferred — the thing being pointed at
    /// is on screen *now*.
    AnnotationCompleted,
    ForegroundWindowChanged,
    BrowserNavigationCompleted,
    /// About to click, type or scroll somewhere.
    BeforeVisualAction,
    /// The frame we have is no longer usable.
    FrameStale,
    TargetWindowMoved,
    /// A download or installer opened or closed a window.
    InstallerStepChanged,
    /// The low-frequency tick while an interaction is live. The only trigger
    /// the once-a-second floor applies to.
    ActiveRefresh,
}

impl CaptureTrigger {
    /// Whether this trigger captures immediately regardless of the refresh cap.
    ///
    /// Everything except `ActiveRefresh`. A rate limit that could delay the
    /// frame behind a completed circle would defeat the entire point of drawing
    /// one.
    pub fn is_immediate(self) -> bool {
        !matches!(self, Self::ActiveRefresh)
    }
}

/// The service.
#[derive(Default)]
pub struct ScreenContextService(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    latest: Option<ScreenContextSnapshot>,
    /// Newest last. Bounded to `RECENT_LIMIT`.
    recent: Vec<ScreenContextSnapshot>,
    /// `true` between the start and the end of an interaction session. Refreshes
    /// happen only inside one.
    interaction_active: bool,
    last_refresh_ms: u64,
}

impl ScreenContextService {
    /// Record a capture that has just been taken and registered.
    pub fn record(&self, snapshot: ScreenContextSnapshot) {
        let mut inner = self.0.lock().unwrap();
        inner.last_refresh_ms = snapshot.captured_at_ms;
        if let Some(previous) = inner.latest.replace(snapshot) {
            inner.recent.push(previous);
            let overflow = inner.recent.len().saturating_sub(RECENT_LIMIT);
            if overflow > 0 {
                inner.recent.drain(0..overflow);
            }
        }
    }

    pub fn latest(&self) -> Option<ScreenContextSnapshot> {
        self.0.lock().unwrap().latest.clone()
    }

    /// The latest snapshot, but only if it is still safe to act on.
    ///
    /// Callers that would otherwise reach for `latest()` and act should reach
    /// for this instead — the difference between them is the reported bug.
    pub fn latest_if_fresh(
        &self,
        world: &WorldState,
        max_age_ms: u64,
    ) -> Result<ScreenContextSnapshot, Staleness> {
        let snapshot = self.latest().ok_or(Staleness::TooOld)?;
        match evaluate(&snapshot, world, max_age_ms) {
            Staleness::Fresh => Ok(snapshot),
            other => Err(other),
        }
    }

    /// Attach the request and drawing this frame belongs to.
    pub fn correlate(&self, correlation_id: &str, annotation_id: Option<&str>) {
        let mut inner = self.0.lock().unwrap();
        if let Some(latest) = inner.latest.as_mut() {
            latest.correlation_id = Some(correlation_id.to_string());
            if let Some(a) = annotation_id {
                latest.annotation_id = Some(a.to_string());
            }
        }
    }

    /// Begin an interaction. Refreshing is permitted only between this and
    /// `end_interaction`, which is what stops a permanent capture loop.
    pub fn begin_interaction(&self, now_ms: u64) {
        let mut inner = self.0.lock().unwrap();
        inner.interaction_active = true;
        // Zero rather than `now`, so the first refresh after a session starts is
        // not delayed by up to a second for no reason.
        inner.last_refresh_ms = 0;
        let _ = now_ms;
    }

    pub fn end_interaction(&self) {
        let mut inner = self.0.lock().unwrap();
        inner.interaction_active = false;
        inner.recent.clear();
    }

    pub fn interaction_active(&self) -> bool {
        self.0.lock().unwrap().interaction_active
    }

    /// Whether a capture should be taken now, for this reason.
    ///
    /// Immediate triggers always pass. `ActiveRefresh` passes only inside a live
    /// interaction and only once per `ACTIVE_REFRESH_INTERVAL_MS`.
    pub fn should_capture(&self, trigger: CaptureTrigger, now_ms: u64) -> bool {
        if trigger.is_immediate() {
            return true;
        }
        let inner = self.0.lock().unwrap();
        if !inner.interaction_active {
            return false;
        }
        now_ms.saturating_sub(inner.last_refresh_ms) >= ACTIVE_REFRESH_INTERVAL_MS
    }

    /// How many snapshots are being held. Asserted in tests so "bounded" is a
    /// fact rather than an intention.
    pub fn retained(&self) -> usize {
        let inner = self.0.lock().unwrap();
        inner.recent.len() + usize::from(inner.latest.is_some())
    }

    pub fn clear(&self) {
        let mut inner = self.0.lock().unwrap();
        inner.latest = None;
        inner.recent.clear();
        inner.interaction_active = false;
        inner.last_refresh_ms = 0;
    }
}

/// The freshness rule, as one function.
///
/// Ordered most-fatal first, so the reason reported is the one that matters:
/// a window that has closed is not "too old", and saying so would send the
/// caller into a recapture loop that can never succeed.
pub fn evaluate(
    snapshot: &ScreenContextSnapshot,
    world: &WorldState,
    max_age_ms: u64,
) -> Staleness {
    if snapshot.source.window_hwnd().is_some() && !world.window_exists {
        return Staleness::WindowGone;
    }
    if snapshot.topology_version != world.topology_version {
        return Staleness::TopologyChanged;
    }
    // Compared only when the snapshot recorded one. A frame taken before
    // anything had focus is not thereby bound to "nothing has focus".
    if let (Some(captured), Some(current)) = (snapshot.foreground_hwnd, world.foreground_hwnd) {
        if captured != current {
            return Staleness::ForegroundChanged;
        }
    }
    if let (Some(then), Some(now)) = (snapshot.window_bounds, world.window_bounds) {
        if then != now {
            return Staleness::WindowMoved;
        }
    }
    if world.now_ms.saturating_sub(snapshot.captured_at_ms) > max_age_ms {
        return Staleness::TooOld;
    }
    Staleness::Fresh
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(x: i32, y: i32, w: u32, h: u32) -> CaptureRegion {
        CaptureRegion {
            x,
            y,
            width: w,
            height: h,
        }
    }

    fn snapshot(at: u64) -> ScreenContextSnapshot {
        ScreenContextSnapshot {
            frame_id: "frame-1".into(),
            captured_at_ms: at,
            source: CaptureSource::Window {
                hwnd: 0x1234,
                title: "LightBurn — Chrome".into(),
            },
            capture_region: region(0, 0, 1920, 1080),
            foreground_hwnd: Some(0x1234),
            display_id: 1,
            topology_version: "topo-A".into(),
            window_bounds: Some(region(100, 100, 1200, 800)),
            correlation_id: None,
            annotation_id: None,
        }
    }

    fn world(now: u64) -> WorldState {
        WorldState {
            now_ms: now,
            foreground_hwnd: Some(0x1234),
            topology_version: "topo-A".into(),
            window_bounds: Some(region(100, 100, 1200, 800)),
            window_exists: true,
        }
    }

    #[test]
    fn an_unchanged_screen_is_fresh() {
        assert_eq!(
            evaluate(&snapshot(1_000), &world(1_200), DEFAULT_MAX_AGE_MS),
            Staleness::Fresh,
        );
    }

    #[test]
    fn an_old_frame_is_rejected() {
        assert_eq!(
            evaluate(&snapshot(1_000), &world(9_000), DEFAULT_MAX_AGE_MS),
            Staleness::TooOld,
        );
    }

    /// The reported failure: the user opened another window and asked "what is
    /// this?", and the answer came from the previous one. Age alone would have
    /// called this frame perfectly fresh.
    #[test]
    fn switching_windows_invalidates_a_young_frame() {
        let mut w = world(1_050);
        w.foreground_hwnd = Some(0x9999);
        assert_eq!(
            evaluate(&snapshot(1_000), &w, DEFAULT_MAX_AGE_MS),
            Staleness::ForegroundChanged,
            "50ms old and still unusable, because the screen is not the same screen",
        );
    }

    #[test]
    fn moving_the_window_invalidates_the_frame() {
        let mut w = world(1_050);
        w.window_bounds = Some(region(400, 100, 1200, 800));
        assert_eq!(
            evaluate(&snapshot(1_000), &w, DEFAULT_MAX_AGE_MS),
            Staleness::WindowMoved,
        );
    }

    #[test]
    fn a_display_change_invalidates_the_frame() {
        let mut w = world(1_050);
        w.topology_version = "topo-B".into();
        assert_eq!(
            evaluate(&snapshot(1_000), &w, DEFAULT_MAX_AGE_MS),
            Staleness::TopologyChanged,
        );
    }

    /// A closed window is not a stale frame — recapturing cannot fix it, and
    /// reporting it as staleness would loop.
    #[test]
    fn a_closed_window_is_unrecoverable() {
        let mut w = world(1_050);
        w.window_exists = false;
        let verdict = evaluate(&snapshot(1_000), &w, DEFAULT_MAX_AGE_MS);
        assert_eq!(verdict, Staleness::WindowGone);
        assert!(!verdict.recoverable());
    }

    #[test]
    fn a_closed_window_outranks_every_other_reason() {
        // Everything is wrong at once. The unrecoverable one must be reported.
        let w = WorldState {
            now_ms: 999_999,
            foreground_hwnd: Some(0x9999),
            topology_version: "topo-Z".into(),
            window_bounds: Some(region(0, 0, 10, 10)),
            window_exists: false,
        };
        assert_eq!(evaluate(&snapshot(1_000), &w, DEFAULT_MAX_AGE_MS), Staleness::WindowGone);
    }

    #[test]
    fn latest_if_fresh_refuses_a_stale_frame() {
        let service = ScreenContextService::default();
        service.record(snapshot(1_000));
        let mut w = world(1_050);
        w.foreground_hwnd = Some(0x9999);
        assert_eq!(
            service.latest_if_fresh(&w, DEFAULT_MAX_AGE_MS),
            Err(Staleness::ForegroundChanged),
        );
        assert!(service.latest_if_fresh(&world(1_050), DEFAULT_MAX_AGE_MS).is_ok());
    }

    #[test]
    fn the_newest_capture_is_the_one_returned() {
        let service = ScreenContextService::default();
        service.record(snapshot(1_000));
        let mut newer = snapshot(2_000);
        newer.frame_id = "frame-2".into();
        service.record(newer);
        assert_eq!(service.latest().unwrap().frame_id, "frame-2");
    }

    // --- capture policy ---------------------------------------------------

    #[test]
    fn a_completed_annotation_captures_immediately() {
        let service = ScreenContextService::default();
        // Not even in a session, and with a refresh a millisecond ago.
        service.record(snapshot(1_000));
        assert!(service.should_capture(CaptureTrigger::AnnotationCompleted, 1_001));
    }

    #[test]
    fn every_immediate_trigger_bypasses_the_rate_limit() {
        let service = ScreenContextService::default();
        service.begin_interaction(0);
        service.record(snapshot(1_000));
        for trigger in [
            CaptureTrigger::VisualRequestStarted,
            CaptureTrigger::VisualRequestCompleted,
            CaptureTrigger::AnnotationCompleted,
            CaptureTrigger::ForegroundWindowChanged,
            CaptureTrigger::BrowserNavigationCompleted,
            CaptureTrigger::BeforeVisualAction,
            CaptureTrigger::FrameStale,
            CaptureTrigger::TargetWindowMoved,
            CaptureTrigger::InstallerStepChanged,
        ] {
            assert!(
                service.should_capture(trigger, 1_001),
                "{trigger:?} must not wait for the refresh window",
            );
        }
    }

    #[test]
    fn background_refresh_is_capped_at_one_per_second() {
        let service = ScreenContextService::default();
        service.begin_interaction(0);
        service.record(snapshot(1_000));
        assert!(
            !service.should_capture(CaptureTrigger::ActiveRefresh, 1_500),
            "half a second is too soon",
        );
        assert!(service.should_capture(CaptureTrigger::ActiveRefresh, 2_000));
    }

    /// No interaction, no refreshing. This is what makes it a context service
    /// rather than a screen recorder.
    #[test]
    fn nothing_refreshes_outside_an_interaction() {
        let service = ScreenContextService::default();
        service.record(snapshot(1_000));
        assert!(!service.should_capture(CaptureTrigger::ActiveRefresh, 99_000));
    }

    #[test]
    fn ending_an_interaction_stops_refreshing_and_drops_history() {
        let service = ScreenContextService::default();
        service.begin_interaction(0);
        for i in 0..5 {
            let mut s = snapshot(1_000 + i * 1_000);
            s.frame_id = format!("frame-{i}");
            service.record(s);
        }
        service.end_interaction();
        assert!(!service.should_capture(CaptureTrigger::ActiveRefresh, 99_000));
        assert_eq!(service.retained(), 1, "only the latest survives");
    }

    /// "Bounded recent metadata", as an assertion. Twenty minutes of once-a-
    /// second refreshes must not accumulate twelve hundred snapshots.
    #[test]
    fn retention_is_bounded() {
        let service = ScreenContextService::default();
        service.begin_interaction(0);
        for i in 0..500 {
            let mut s = snapshot(1_000 + i);
            s.frame_id = format!("frame-{i}");
            service.record(s);
        }
        assert_eq!(service.retained(), RECENT_LIMIT + 1);
    }

    #[test]
    fn correlation_binds_the_frame_to_the_request_and_the_drawing() {
        let service = ScreenContextService::default();
        service.record(snapshot(1_000));
        service.correlate("corr-1", Some("annot-1"));
        let latest = service.latest().unwrap();
        assert_eq!(latest.correlation_id.as_deref(), Some("corr-1"));
        assert_eq!(latest.annotation_id.as_deref(), Some("annot-1"));
    }

    // --- geometry ---------------------------------------------------------

    #[test]
    fn padding_grows_the_crop_and_stays_inside_the_capture() {
        let bounds = region(0, 0, 1000, 800);
        let tight = region(500, 400, 100, 50);
        let padded = tight.padded(0.2, &bounds);
        assert!(padded.width > tight.width && padded.height > tight.height);
        assert!(bounds.clamp(&padded).unwrap() == padded, "padding stayed inside");
    }

    /// A circle drawn at the very edge of a window pads towards the inside
    /// rather than producing a rectangle partly outside the image.
    #[test]
    fn padding_at_the_edge_does_not_escape_the_capture() {
        let bounds = region(0, 0, 1000, 800);
        let edge = region(0, 0, 100, 50);
        let padded = edge.padded(0.5, &bounds);
        assert!(padded.x >= 0 && padded.y >= 0);
        assert!(padded.x + padded.width as i32 <= 1000);
    }

    /// Negative-origin monitors are the case that breaks naive clamping.
    #[test]
    fn a_monitor_left_of_the_primary_clamps_correctly() {
        let bounds = region(-1920, 0, 1920, 1080);
        let inner = region(-1900, 40, 200, 100);
        let padded = inner.padded(0.15, &bounds);
        assert!(padded.x >= -1920, "padding must not leave the monitor");
        assert!(padded.x + padded.width as i32 <= 0);
        assert!(bounds.contains(padded.x, padded.y));
    }

    #[test]
    fn non_overlapping_rectangles_do_not_clamp() {
        let a = region(0, 0, 100, 100);
        let b = region(500, 500, 100, 100);
        assert!(a.clamp(&b).is_none());
    }
}
