//! What "this" refers to.
//!
//! "What is this?" is four questions the system has to answer together: which
//! words, which window, which frame, which drawing. Each of those lived in a
//! different place — the transcript in the overlay's heap, the foreground
//! window nowhere at all, the frame wherever the last capture happened to leave
//! it, the annotation not at all — and nothing joined them, so the answer could
//! be assembled from parts belonging to different moments.
//!
//! An interaction session is that join. One correlation id, one bounded
//! lifetime, owned in Rust so the overlay and the main window are looking at
//! the same interaction rather than two copies of one.
//!
//! Bounded is the important word. The session starts when the user starts, ends
//! when they stop or cancel, and takes the screen-context refreshing down with
//! it. There is no "always on" state here, and `end` is called from the overlay
//! closing, Escape, and completion alike.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// A session that outlives this has been abandoned. Long enough for a slow
/// model turn plus a download starting, short enough that yesterday's circle
/// cannot name today's button.
const SESSION_TTL_MS: u64 = 300_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OverlayInteractionState {
    Listening,
    CapturingContext,
    Processing,
    Executing,
    Speaking,
    Completed,
    Cancelled,
}

impl OverlayInteractionState {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled)
    }

    /// The overlay copy for this state.
    ///
    /// Here rather than in the overlay component so both windows say the same
    /// thing, and so a state without a sentence is a compile error rather than
    /// a blank capsule.
    pub fn label(self) -> &'static str {
        match self {
            Self::Listening => "Listening…",
            Self::CapturingContext => "Screen context captured",
            Self::Processing => "Understanding the selected area…",
            Self::Executing => "Working…",
            Self::Speaking => "Speaking…",
            Self::Completed => "Done",
            Self::Cancelled => "Cancelled",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInteractionSession {
    pub correlation_id: String,
    pub conversation_id: String,
    pub started_at_ms: u64,
    #[serde(default)]
    pub transcript: Option<String>,
    #[serde(default)]
    pub latest_frame_id: Option<String>,
    #[serde(default)]
    pub annotation_id: Option<String>,
    #[serde(default)]
    pub foreground_hwnd: Option<isize>,
    pub state: OverlayInteractionState,
    /// Last state change, so an abandoned session can be told from a slow one.
    pub updated_at_ms: u64,
}

impl OverlayInteractionSession {
    fn expired(&self, now_ms: u64) -> bool {
        now_ms.saturating_sub(self.started_at_ms) > SESSION_TTL_MS
    }

    /// Whether this session may still be used as the referent for a request.
    pub fn usable(&self, now_ms: u64) -> bool {
        !self.state.is_terminal() && !self.expired(now_ms)
    }
}

#[derive(Default)]
pub struct InteractionSessionStore(Mutex<Option<OverlayInteractionSession>>);

fn new_correlation_id(now_ms: u64) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!("corr-{now_ms}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

impl InteractionSessionStore {
    /// Start listening. Replaces any previous session outright.
    ///
    /// Replacing rather than refusing is deliberate: a user pressing the
    /// shortcut again means "start over", and an old session left alive would
    /// let a previous circle answer the new sentence.
    pub fn begin(&self, conversation_id: &str, now_ms: u64) -> OverlayInteractionSession {
        let session = OverlayInteractionSession {
            correlation_id: new_correlation_id(now_ms),
            conversation_id: conversation_id.to_string(),
            started_at_ms: now_ms,
            transcript: None,
            latest_frame_id: None,
            annotation_id: None,
            foreground_hwnd: None,
            state: OverlayInteractionState::Listening,
            updated_at_ms: now_ms,
        };
        *self.0.lock().unwrap() = Some(session.clone());
        session
    }

    pub fn current(&self, now_ms: u64) -> Option<OverlayInteractionSession> {
        let mut guard = self.0.lock().unwrap();
        let session = guard.as_ref()?;
        if session.expired(now_ms) {
            *guard = None;
            return None;
        }
        Some(session.clone())
    }

    pub fn set_state(
        &self,
        state: OverlayInteractionState,
        now_ms: u64,
    ) -> Option<OverlayInteractionSession> {
        let mut guard = self.0.lock().unwrap();
        let session = guard.as_mut()?;
        session.state = state;
        session.updated_at_ms = now_ms;
        Some(session.clone())
    }

    pub fn set_transcript(&self, transcript: &str, now_ms: u64) -> Option<OverlayInteractionSession> {
        let mut guard = self.0.lock().unwrap();
        let session = guard.as_mut()?;
        session.transcript = Some(transcript.to_string());
        session.updated_at_ms = now_ms;
        Some(session.clone())
    }

    /// Bind the frame that was just captured to this interaction.
    pub fn set_frame(
        &self,
        frame_id: &str,
        foreground_hwnd: Option<isize>,
        now_ms: u64,
    ) -> Option<OverlayInteractionSession> {
        let mut guard = self.0.lock().unwrap();
        let session = guard.as_mut()?;
        session.latest_frame_id = Some(frame_id.to_string());
        session.foreground_hwnd = foreground_hwnd;
        session.updated_at_ms = now_ms;
        Some(session.clone())
    }

    /// Bind the drawing the user just completed.
    pub fn set_annotation(
        &self,
        annotation_id: &str,
        now_ms: u64,
    ) -> Option<OverlayInteractionSession> {
        let mut guard = self.0.lock().unwrap();
        let session = guard.as_mut()?;
        session.annotation_id = Some(annotation_id.to_string());
        session.updated_at_ms = now_ms;
        Some(session.clone())
    }

    /// End the interaction — completed, cancelled, or the overlay closed.
    ///
    /// Escape and the close button both land here, and neither touches anything
    /// beyond this session: the main window stays exactly where it was.
    pub fn end(&self, cancelled: bool, now_ms: u64) -> Option<OverlayInteractionSession> {
        let mut guard = self.0.lock().unwrap();
        let session = guard.as_mut()?;
        session.state = if cancelled {
            OverlayInteractionState::Cancelled
        } else {
            OverlayInteractionState::Completed
        };
        session.updated_at_ms = now_ms;
        let ended = session.clone();
        *guard = None;
        Some(ended)
    }

    pub fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_binds_the_words_the_window_the_frame_and_the_drawing() {
        let store = InteractionSessionStore::default();
        let started = store.begin("conv-1", 1_000);
        assert_eq!(started.state, OverlayInteractionState::Listening);

        store.set_annotation("annot-1", 1_100);
        store.set_frame("frame-9", Some(0x1234), 1_120);
        store.set_transcript("what is this?", 1_400);
        store.set_state(OverlayInteractionState::Processing, 1_410);

        let now = store.current(1_500).unwrap();
        // One correlation id ties all four together, which is the whole point.
        assert_eq!(now.correlation_id, started.correlation_id);
        assert_eq!(now.transcript.as_deref(), Some("what is this?"));
        assert_eq!(now.latest_frame_id.as_deref(), Some("frame-9"));
        assert_eq!(now.annotation_id.as_deref(), Some("annot-1"));
        assert_eq!(now.foreground_hwnd, Some(0x1234));
        assert_eq!(now.state, OverlayInteractionState::Processing);
    }

    /// Pressing the shortcut again is "start over", not "continue".
    #[test]
    fn starting_again_does_not_inherit_the_previous_drawing() {
        let store = InteractionSessionStore::default();
        let first = store.begin("conv-1", 1_000);
        store.set_annotation("annot-old", 1_050);

        let second = store.begin("conv-1", 5_000);
        assert_ne!(second.correlation_id, first.correlation_id);
        assert_eq!(
            store.current(5_010).unwrap().annotation_id,
            None,
            "a circle drawn for the last question must not answer this one",
        );
    }

    #[test]
    fn the_state_machine_runs_listening_to_completed() {
        let store = InteractionSessionStore::default();
        store.begin("conv-1", 0);
        for state in [
            OverlayInteractionState::CapturingContext,
            OverlayInteractionState::Processing,
            OverlayInteractionState::Executing,
            OverlayInteractionState::Speaking,
        ] {
            let s = store.set_state(state, 10).unwrap();
            assert_eq!(s.state, state);
            assert!(!s.state.is_terminal());
        }
        let done = store.end(false, 20).unwrap();
        assert_eq!(done.state, OverlayInteractionState::Completed);
        assert!(store.current(30).is_none(), "a finished session is not current");
    }

    /// Escape cancels the interaction. It does not, and cannot, reach anything
    /// else — this store owns one session and nothing more.
    #[test]
    fn cancelling_ends_only_the_interaction() {
        let store = InteractionSessionStore::default();
        store.begin("conv-1", 0);
        let cancelled = store.end(true, 5).unwrap();
        assert_eq!(cancelled.state, OverlayInteractionState::Cancelled);
        assert!(store.current(6).is_none());
        // And a new one starts cleanly straight afterwards.
        assert_eq!(
            store.begin("conv-1", 7).state,
            OverlayInteractionState::Listening,
        );
    }

    #[test]
    fn an_abandoned_session_expires() {
        let store = InteractionSessionStore::default();
        store.begin("conv-1", 1_000);
        assert!(store.current(1_000 + SESSION_TTL_MS).is_some());
        assert!(store.current(1_001 + SESSION_TTL_MS).is_none());
    }

    #[test]
    fn a_terminal_session_is_not_a_usable_referent() {
        let store = InteractionSessionStore::default();
        let s = store.begin("conv-1", 0);
        assert!(s.usable(10));
        let ended = store.end(false, 20).unwrap();
        assert!(!ended.usable(21));
    }

    /// Every state has copy, so the overlay cannot render an empty capsule.
    #[test]
    fn every_state_has_something_to_say() {
        for state in [
            OverlayInteractionState::Listening,
            OverlayInteractionState::CapturingContext,
            OverlayInteractionState::Processing,
            OverlayInteractionState::Executing,
            OverlayInteractionState::Speaking,
            OverlayInteractionState::Completed,
            OverlayInteractionState::Cancelled,
        ] {
            assert!(!state.label().is_empty(), "{state:?} has no label");
        }
    }

    #[test]
    fn updating_a_session_that_never_started_does_nothing() {
        let store = InteractionSessionStore::default();
        assert!(store.set_transcript("hello", 1).is_none());
        assert!(store.set_frame("frame-1", None, 1).is_none());
        assert!(store.set_annotation("annot-1", 1).is_none());
        assert!(store.end(false, 1).is_none());
    }
}
