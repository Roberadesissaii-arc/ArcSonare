//! Whose turn it is to talk.
//!
//! ArcSonare speaks through the speakers, the microphone hears it, the
//! recogniser transcribes it, and the assistant answers itself. Left alone that
//! is a loop, and it costs the user a conversation they never had.
//!
//! The state lives here rather than in the webview because there is more than
//! one webview: `sonare-overlay` is a separate WebView2 instance with its own
//! JavaScript heap, so a module-level `speaking` flag in TypeScript is two
//! different flags. The overlay's recogniser would happily transcribe speech the
//! main window is producing. One authoritative owner, in the process both
//! windows share, is the only arrangement that cannot drift.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceSessionState {
    Idle,
    Listening,
    UserSpeaking,
    Processing,
    Speaking,
    /// The tail after playback: the room is still ringing and the recogniser is
    /// still holding buffered audio of ArcSonare's own voice.
    Cooldown,
    Interrupted,
    Error,
}

impl VoiceSessionState {
    /// May a transcript arriving now become a user request?
    ///
    /// The two closed states are the whole point. Everything else is either the
    /// user's turn or a state where a transcript is meaningless anyway.
    pub fn accepts_transcripts(&self) -> bool {
        !matches!(self, Self::Speaking | Self::Cooldown)
    }
}

/// How long after playback ends before the recogniser is trusted again.
///
/// Long enough for the speaker tail and whatever the recogniser had buffered
/// mid-utterance; short enough that a reply does not feel gated. Configurable
/// because rooms and audio stacks differ.
pub const DEFAULT_COOLDOWN_MS: u64 = 600;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPlayback {
    pub playback_id: String,
    /// Hash rather than the text: the state is queried from diagnostics, and
    /// what ArcSonare said is still the user's conversation.
    pub text_hash: String,
    pub started_at_ms: u64,
    pub finished_at_ms: Option<u64>,
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub state: VoiceSessionState,
    pub accepts_transcripts: bool,
    pub cooldown_ms: u64,
    pub cooldown_remaining_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playback: Option<SpeechPlayback>,
    pub self_speech_suppressed: u32,
    pub duplicate_suppressed: u32,
}

struct Inner {
    state: VoiceSessionState,
    cooldown_ms: u64,
    /// When cooldown started. `None` outside cooldown.
    cooldown_started_ms: Option<u64>,
    playback: Option<SpeechPlayback>,
    /// Normalised text of what ArcSonare recently said, for the backup check.
    recent_spoken: Vec<(u64, String)>,
    last_accepted: Option<(u64, String)>,
    self_speech_suppressed: u32,
    duplicate_suppressed: u32,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            state: VoiceSessionState::Idle,
            cooldown_ms: DEFAULT_COOLDOWN_MS,
            cooldown_started_ms: None,
            playback: None,
            recent_spoken: Vec::new(),
            last_accepted: None,
            self_speech_suppressed: 0,
            duplicate_suppressed: 0,
        }
    }
}

#[derive(Default)]
pub struct VoiceSession(Mutex<Inner>);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Strip everything that differs between "what was said" and "what was heard".
///
/// A recogniser drops punctuation, changes case, and varies whitespace. Two
/// renderings of the same sentence have to compare equal or the backup check
/// never fires.
pub fn normalize(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn hash_text(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in normalize(text).as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Word-overlap similarity, 0..1.
///
/// Not an edit distance: a recogniser mangles individual words but rarely
/// invents whole ones, so agreement on the set of words is the signal that
/// survives a noisy transcription of ArcSonare's own voice.
pub fn similarity(a: &str, b: &str) -> f32 {
    let (a, b) = (normalize(a), normalize(b));
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    let aw: Vec<&str> = a.split(' ').collect();
    let bw: Vec<&str> = b.split(' ').collect();
    let mut shared = 0usize;
    let mut remaining = bw.clone();
    for word in &aw {
        if let Some(pos) = remaining.iter().position(|w| w == word) {
            remaining.remove(pos);
            shared += 1;
        }
    }
    shared as f32 / aw.len().max(bw.len()) as f32
}

/// Above this, a transcript is treated as ArcSonare hearing itself.
const SELF_SPEECH_SIMILARITY: f32 = 0.6;
/// How long after speaking a phrase it still counts as possibly-echoed.
const ECHO_WINDOW_MS: u64 = 6_000;

/// Why a transcript was not turned into a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TranscriptDisposition {
    Accepted,
    /// ArcSonare was talking. The primary defence.
    RejectedSpeaking,
    /// The tail right after it stopped.
    RejectedCooldown,
    /// The backup: it sounds like what ArcSonare just said.
    SelfSpeechSuppressed,
    /// The recogniser emitted the same final transcript twice.
    DuplicateSuppressed,
    RejectedEmpty,
}

impl VoiceSession {
    pub fn status(&self) -> VoiceStatus {
        let mut inner = self.0.lock().unwrap();
        Self::expire_cooldown(&mut inner);
        let remaining = inner
            .cooldown_started_ms
            .map(|started| inner.cooldown_ms.saturating_sub(now_ms() - started))
            .unwrap_or(0);
        VoiceStatus {
            state: inner.state,
            accepts_transcripts: inner.state.accepts_transcripts(),
            cooldown_ms: inner.cooldown_ms,
            cooldown_remaining_ms: remaining,
            playback: inner.playback.clone(),
            self_speech_suppressed: inner.self_speech_suppressed,
            duplicate_suppressed: inner.duplicate_suppressed,
        }
    }

    /// Cooldown is checked lazily rather than by a timer.
    ///
    /// A timer would need a thread per playback and could fire after the state
    /// moved on. Reading the clock when someone asks cannot get out of step.
    fn expire_cooldown(inner: &mut Inner) {
        if inner.state != VoiceSessionState::Cooldown {
            return;
        }
        if let Some(started) = inner.cooldown_started_ms {
            if now_ms().saturating_sub(started) >= inner.cooldown_ms {
                inner.state = VoiceSessionState::Listening;
                inner.cooldown_started_ms = None;
            }
        }
    }

    pub fn set_state(&self, state: VoiceSessionState) {
        let mut inner = self.0.lock().unwrap();
        inner.state = state;
        if state != VoiceSessionState::Cooldown {
            inner.cooldown_started_ms = None;
        }
    }

    pub fn set_cooldown_ms(&self, ms: u64) {
        self.0.lock().unwrap().cooldown_ms = ms.clamp(0, 5_000);
    }

    /// ArcSonare is about to speak. Recognition closes here, not when the audio
    /// is heard — the gap between the two is exactly where the echo gets in.
    pub fn begin_playback(&self, playback_id: &str, text: &str) {
        let mut inner = self.0.lock().unwrap();
        let now = now_ms();
        inner.state = VoiceSessionState::Speaking;
        inner.cooldown_started_ms = None;
        inner.playback = Some(SpeechPlayback {
            playback_id: playback_id.into(),
            text_hash: hash_text(text),
            started_at_ms: now,
            finished_at_ms: None,
            state: "playing",
        });
        inner.recent_spoken.push((now, normalize(text)));
        inner
            .recent_spoken
            .retain(|(at, _)| now - *at < ECHO_WINDOW_MS);
    }

    /// Playback finished, failed or was cancelled. Cooldown starts either way:
    /// a cancelled utterance has already been partly heard by the microphone.
    pub fn end_playback(&self, playback_id: &str, outcome: &str) {
        let mut inner = self.0.lock().unwrap();
        let now = now_ms();
        if let Some(p) = inner.playback.as_mut() {
            if p.playback_id == playback_id {
                p.finished_at_ms = Some(now);
                p.state = match outcome {
                    "cancelled" => "cancelled",
                    "failed" => "failed",
                    _ => "completed",
                };
            }
        }
        // Even on failure the session must leave `speaking`, or the recogniser
        // stays shut for the rest of the conversation.
        inner.state = VoiceSessionState::Cooldown;
        inner.cooldown_started_ms = Some(now);
    }

    /// Should this transcript become a user request?
    pub fn consider_transcript(&self, text: &str) -> TranscriptDisposition {
        let mut inner = self.0.lock().unwrap();
        Self::expire_cooldown(&mut inner);
        let normalized = normalize(text);
        if normalized.is_empty() {
            return TranscriptDisposition::RejectedEmpty;
        }
        match inner.state {
            VoiceSessionState::Speaking => {
                inner.self_speech_suppressed += 1;
                return TranscriptDisposition::RejectedSpeaking;
            }
            VoiceSessionState::Cooldown => {
                inner.self_speech_suppressed += 1;
                return TranscriptDisposition::RejectedCooldown;
            }
            _ => {}
        }

        // Backup only. Ambient speech can legitimately repeat what ArcSonare
        // just said, so this must never be the primary defence — but a
        // recogniser that delivers a buffered utterance late gets caught here.
        let now = now_ms();
        inner
            .recent_spoken
            .retain(|(at, _)| now - *at < ECHO_WINDOW_MS);
        let echoed = inner
            .recent_spoken
            .iter()
            .any(|(_, spoken)| similarity(spoken, &normalized) >= SELF_SPEECH_SIMILARITY);
        if echoed {
            inner.self_speech_suppressed += 1;
            return TranscriptDisposition::SelfSpeechSuppressed;
        }

        // A recogniser that emits the same final transcript twice must not
        // produce two requests.
        if let Some((at, last)) = &inner.last_accepted {
            if last == &normalized && now - at < 4_000 {
                inner.duplicate_suppressed += 1;
                return TranscriptDisposition::DuplicateSuppressed;
            }
        }
        inner.last_accepted = Some((now, normalized));
        inner.state = VoiceSessionState::Processing;
        TranscriptDisposition::Accepted
    }

    pub fn reset(&self) {
        *self.0.lock().unwrap() = Inner::default();
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — one authoritative owner for every surface.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn voice_status(session: tauri::State<VoiceSession>) -> VoiceStatus {
    session.status()
}

#[tauri::command]
pub fn voice_set_state(session: tauri::State<VoiceSession>, state: VoiceSessionState) {
    session.set_state(state);
}

#[tauri::command]
pub fn voice_begin_playback(
    session: tauri::State<VoiceSession>,
    playback_id: String,
    text: String,
) {
    session.begin_playback(&playback_id, &text);
}

#[tauri::command]
pub fn voice_end_playback(
    session: tauri::State<VoiceSession>,
    playback_id: String,
    outcome: String,
) {
    session.end_playback(&playback_id, &outcome);
}

#[tauri::command]
pub fn voice_consider_transcript(
    session: tauri::State<VoiceSession>,
    text: String,
) -> TranscriptDisposition {
    session.consider_transcript(&text)
}

#[tauri::command]
pub fn voice_set_cooldown_ms(session: tauri::State<VoiceSession>, ms: u64) {
    session.set_cooldown_ms(ms);
}

#[tauri::command]
pub fn voice_reset(session: tauri::State<VoiceSession>) {
    session.reset();
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str = "ArcSonare voice test. Please do not repeat this sentence.";

    #[test]
    fn a_transcript_arriving_while_arcsonare_talks_is_not_a_user_request() {
        // The loop this whole module exists for.
        let s = VoiceSession::default();
        s.set_state(VoiceSessionState::Listening);
        s.begin_playback("p1", PHRASE);
        assert_eq!(
            s.consider_transcript(PHRASE),
            TranscriptDisposition::RejectedSpeaking
        );
        assert_eq!(
            s.consider_transcript("something else entirely"),
            TranscriptDisposition::RejectedSpeaking,
            "while speaking, nothing is accepted — not even genuine speech"
        );
    }

    #[test]
    fn the_echo_tail_right_after_playback_is_also_rejected() {
        let s = VoiceSession::default();
        s.begin_playback("p1", PHRASE);
        s.end_playback("p1", "completed");
        assert_eq!(
            s.consider_transcript(PHRASE),
            TranscriptDisposition::RejectedCooldown
        );
        assert_eq!(s.status().state, VoiceSessionState::Cooldown);
    }

    #[test]
    fn listening_resumes_once_the_cooldown_elapses() {
        let s = VoiceSession::default();
        s.set_cooldown_ms(0);
        s.begin_playback("p1", PHRASE);
        s.end_playback("p1", "completed");
        assert_eq!(s.status().state, VoiceSessionState::Listening);
        assert_eq!(
            s.consider_transcript("open my downloads folder"),
            TranscriptDisposition::Accepted,
            "a real request after the tail must get through"
        );
    }

    #[test]
    fn a_late_echo_of_what_was_just_said_is_still_caught() {
        // The backup: the recogniser delivered a buffered utterance after the
        // cooldown had already expired.
        let s = VoiceSession::default();
        s.set_cooldown_ms(0);
        s.begin_playback("p1", PHRASE);
        s.end_playback("p1", "completed");
        assert_eq!(
            s.consider_transcript("arcsonare voice test please do not repeat this sentence"),
            TranscriptDisposition::SelfSpeechSuppressed
        );
        assert_eq!(s.status().self_speech_suppressed, 1);
    }

    #[test]
    fn a_partial_mishearing_of_arcsonares_own_speech_is_caught() {
        let s = VoiceSession::default();
        s.set_cooldown_ms(0);
        s.begin_playback("p1", PHRASE);
        s.end_playback("p1", "completed");
        // What a microphone across the room actually returns.
        assert_eq!(
            s.consider_transcript("arc sonare voice test please do not repeat this"),
            TranscriptDisposition::SelfSpeechSuppressed
        );
    }

    #[test]
    fn genuinely_different_speech_after_playback_is_accepted() {
        let s = VoiceSession::default();
        s.set_cooldown_ms(0);
        s.begin_playback("p1", PHRASE);
        s.end_playback("p1", "completed");
        assert_eq!(
            s.consider_transcript("what time is it"),
            TranscriptDisposition::Accepted
        );
    }

    #[test]
    fn the_same_transcript_twice_makes_one_request() {
        let s = VoiceSession::default();
        s.set_state(VoiceSessionState::Listening);
        assert_eq!(
            s.consider_transcript("open my downloads"),
            TranscriptDisposition::Accepted
        );
        s.set_state(VoiceSessionState::Listening);
        assert_eq!(
            s.consider_transcript("open my downloads"),
            TranscriptDisposition::DuplicateSuppressed
        );
        assert_eq!(s.status().duplicate_suppressed, 1);
    }

    #[test]
    fn failed_playback_still_reopens_the_microphone() {
        // Otherwise one TTS error ends the conversation silently.
        let s = VoiceSession::default();
        s.set_cooldown_ms(0);
        s.begin_playback("p1", PHRASE);
        s.end_playback("p1", "failed");
        assert_eq!(s.status().state, VoiceSessionState::Listening);
        assert_eq!(s.status().playback.unwrap().state, "failed");
    }

    #[test]
    fn cancelled_playback_still_serves_its_cooldown() {
        // Part of it was already heard by the microphone.
        let s = VoiceSession::default();
        s.begin_playback("p1", PHRASE);
        s.end_playback("p1", "cancelled");
        assert_eq!(s.status().state, VoiceSessionState::Cooldown);
        assert!(!s.status().accepts_transcripts);
    }

    #[test]
    fn an_empty_transcript_is_not_a_request() {
        let s = VoiceSession::default();
        s.set_state(VoiceSessionState::Listening);
        assert_eq!(
            s.consider_transcript("   ...  "),
            TranscriptDisposition::RejectedEmpty
        );
    }

    #[test]
    fn normalisation_makes_heard_and_spoken_comparable() {
        assert_eq!(
            normalize("ArcSonare voice test. Please, don't repeat!"),
            "arcsonare voice test please don t repeat"
        );
        assert!(similarity("hello there world", "Hello there, world!") > 0.99);
        assert!(similarity("hello there world", "what time is it") < 0.2);
    }

    #[test]
    fn only_speaking_and_cooldown_close_the_microphone() {
        for open in [
            VoiceSessionState::Idle,
            VoiceSessionState::Listening,
            VoiceSessionState::UserSpeaking,
            VoiceSessionState::Processing,
            VoiceSessionState::Interrupted,
            VoiceSessionState::Error,
        ] {
            assert!(open.accepts_transcripts(), "{open:?}");
        }
        assert!(!VoiceSessionState::Speaking.accepts_transcripts());
        assert!(!VoiceSessionState::Cooldown.accepts_transcripts());
    }

    #[test]
    fn the_state_is_shared_rather_than_per_surface() {
        // One session object; the overlay and the main window both ask it. A
        // module-level flag in either webview would be invisible to the other.
        let s = VoiceSession::default();
        s.begin_playback("p1", PHRASE);
        let from_overlay = s.status();
        let from_main = s.status();
        assert_eq!(from_overlay.state, VoiceSessionState::Speaking);
        assert_eq!(from_main.state, VoiceSessionState::Speaking);
        assert!(!from_overlay.accepts_transcripts);
    }
}
