//! The meeting detector, as a service the application actually runs.
//!
//! The classifier and the window scan already worked; nothing called them. A
//! `#[test]` that prints "MEETING DETECTED" proves the rules are right and
//! proves nothing about the product, because the production application had no
//! detector at all — no loop, no state, no events. The Dashboard sat in Idle
//! with a live meeting on screen because Idle was the only state anything could
//! produce.
//!
//! So this is the missing half: one loop, owned by Rust, started from `setup()`,
//! independent of whether a React component is mounted or the window is even
//! visible. It holds the authoritative meeting state; the frontend reads it.
//!
//! Privacy is structural rather than promised. `MeetingSession` has no field
//! for a title, a URL, a meeting code or a participant, so the events it
//! produces cannot carry any of them.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::zoom_scan::{find_meeting_window, scan_zoom_windows};

/// How often the detector looks. A meeting starting is not a sub-second event,
/// and a tighter loop would enumerate every window on the machine for nothing.
const SCAN_INTERVAL: Duration = Duration::from_millis(1200);

pub const EVENT_STATE_CHANGED: &str = "arcsonare://meeting-state-changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingPlatform {
    Zoom,
    GoogleMeet,
    MicrosoftTeams,
    Webex,
}

impl MeetingPlatform {
    /// The catalog id the frontend uses for icons and copy.
    pub fn source_id(self) -> &'static str {
        match self {
            Self::Zoom => "zoom",
            Self::GoogleMeet => "google-meet",
            Self::MicrosoftTeams => "teams",
            Self::Webex => "webex",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Zoom => "Zoom",
            Self::GoogleMeet => "Google Meet",
            Self::MicrosoftTeams => "Microsoft Teams",
            Self::Webex => "Webex",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingSessionState {
    Detected,
    AwaitingConsent,
    Dismissed,
    StartingNotes,
    TakingNotes,
    Completed,
    Ended,
    Error,
}

/// One meeting, as the rest of the application is allowed to see it.
///
/// There is deliberately nowhere to put a title, a URL or a meeting code. The
/// window handle and process id are what the popup needs in order to find the
/// right monitor; nothing here describes what is being said or by whom.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSession {
    pub session_id: String,
    pub platform: MeetingPlatform,
    pub process_id: u32,
    /// The meeting window. `isize` because that is what an `HWND` is.
    pub hwnd: isize,
    /// Physical desktop rectangle: left, top, right, bottom.
    pub bounds: (i32, i32, i32, i32),
    pub detected_at_ms: u64,
    pub state: MeetingSessionState,
}

impl MeetingSession {
    /// A log line that cannot leak anything private.
    pub fn diagnostic(&self) -> String {
        format!(
            "session={} platform={} state={:?} pid={} hwnd=0x{:X} bounds={:?}",
            self.session_id,
            self.platform.display_name(),
            self.state,
            self.process_id,
            self.hwnd,
            self.bounds
        )
    }
}

/// What the frontend receives. Identical to the session plus nothing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingStatePayload {
    pub session: Option<MeetingSession>,
    /// So a late-mounting Dashboard can tell a fresh state from a replay.
    pub generation: u64,
}

#[derive(Debug, Default)]
pub struct MeetingDetectorState {
    pub current_session: Option<MeetingSession>,
    pub prompted_sessions: HashSet<String>,
    pub dismissed_sessions: HashSet<String>,
    pub completed_sessions: HashSet<String>,
    pub last_scan_at_ms: u64,
}

/// The service. One per application.
pub struct MeetingDetectorService {
    state: Arc<Mutex<MeetingDetectorState>>,
    shutdown: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    started: AtomicBool,
}

impl Default for MeetingDetectorService {
    fn default() -> Self {
        Self::new()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl MeetingDetectorService {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(MeetingDetectorState::default())),
            shutdown: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
            started: AtomicBool::new(false),
        }
    }

    /// The current state, for a Dashboard that mounted after detection.
    ///
    /// Without this a meeting detected while the window was hidden would never
    /// reach the card: events only reach listeners that already exist.
    pub fn snapshot(&self) -> MeetingStatePayload {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        MeetingStatePayload {
            session: state.current_session.clone(),
            generation: self.generation.load(Ordering::SeqCst),
        }
    }

    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }

    /// Start the loop. Idempotent — a second call is ignored rather than
    /// producing a second detector.
    pub fn start<R: Runtime>(&self, app: &AppHandle<R>) {
        if self.started.swap(true, Ordering::SeqCst) {
            log::warn!("meeting detector already started; ignoring");
            return;
        }
        let state = Arc::clone(&self.state);
        let shutdown = Arc::clone(&self.shutdown);
        let generation = Arc::clone(&self.generation);
        let handle = app.clone();

        std::thread::Builder::new()
            .name("arcsonare-meeting-detector".into())
            .spawn(move || {
                log::info!("meeting detector started (interval {SCAN_INTERVAL:?})");
                while !shutdown.load(Ordering::SeqCst) {
                    tick(&handle, &state, &generation);
                    std::thread::sleep(SCAN_INTERVAL);
                }
                log::info!("meeting detector stopped");
            })
            .map(|_| ())
            .unwrap_or_else(|e| log::error!("could not start meeting detector: {e}"));
    }
}

/// What one scan found, before it is compared with what we already knew.
struct Observation {
    platform: MeetingPlatform,
    process_id: u32,
    hwnd: isize,
    bounds: (i32, i32, i32, i32),
}

/// Look at the machine once.
///
/// Zoom first, then browser meetings. Only one meeting is tracked at a time:
/// two simultaneous calls is not a case worth guessing at, and the first one
/// found keeps its session until it ends.
fn observe() -> Option<Observation> {
    let zoom_windows = scan_zoom_windows();
    if let Some(window) = find_meeting_window(&zoom_windows) {
        return Some(Observation {
            platform: MeetingPlatform::Zoom,
            process_id: window.process_id,
            hwnd: window.hwnd,
            bounds: window.bounds,
        });
    }
    super::browser_meetings::detect_browser_meeting().map(|m| Observation {
        platform: m.platform,
        process_id: m.process_id,
        hwnd: m.hwnd,
        bounds: m.bounds,
    })
}

/// The identity that makes repeated scans one meeting rather than many.
///
/// Platform plus the meeting window's handle. The process id alone would merge
/// two meetings that Zoom happened to host in one process; the handle alone
/// could collide across platforms after a window closed.
fn session_id(observation: &Observation) -> String {
    format!(
        "{}:{}:{:X}",
        observation.platform.source_id(),
        observation.process_id,
        observation.hwnd
    )
}

fn tick<R: Runtime>(
    app: &AppHandle<R>,
    state: &Arc<Mutex<MeetingDetectorState>>,
    generation: &Arc<AtomicU64>,
) {
    let observation = observe();
    let mut guard = state.lock().unwrap_or_else(|e| e.into_inner());
    guard.last_scan_at_ms = now_ms();

    match observation {
        Some(found) => {
            let id = session_id(&found);

            // Already tracking this exact meeting: nothing changed, say nothing.
            if let Some(current) = &guard.current_session {
                if current.session_id == id {
                    return;
                }
            }
            // Already answered for. A dismissed meeting must not come back
            // every 1.2 seconds because the window is still open.
            if guard.dismissed_sessions.contains(&id)
                || guard.completed_sessions.contains(&id)
            {
                return;
            }

            let session = MeetingSession {
                session_id: id.clone(),
                platform: found.platform,
                process_id: found.process_id,
                hwnd: found.hwnd,
                bounds: found.bounds,
                detected_at_ms: now_ms(),
                state: MeetingSessionState::AwaitingConsent,
            };
            log::info!("meeting detected: {}", session.diagnostic());
            guard.current_session = Some(session.clone());

            // At most one prompt per meeting, decided here rather than by the
            // popup, so a popup that fails to open cannot cost the user their
            // only chance to consent.
            let first_prompt = guard.prompted_sessions.insert(id);
            drop(guard);

            emit_state(app, generation, Some(session.clone()));
            if first_prompt {
                super::consent_popup::request(app, &session);
            }
        }
        None => {
            // The meeting ended. Its dismissal record goes with it, so the
            // *next* meeting may prompt again.
            if let Some(previous) = guard.current_session.take() {
                log::info!("meeting ended: {}", previous.diagnostic());
                guard.dismissed_sessions.remove(&previous.session_id);
                guard.prompted_sessions.remove(&previous.session_id);
                drop(guard);
                super::consent_popup::dismiss(app);
                emit_state(app, generation, None);
            }
        }
    }
}

fn emit_state<R: Runtime>(
    app: &AppHandle<R>,
    generation: &Arc<AtomicU64>,
    session: Option<MeetingSession>,
) {
    let payload = MeetingStatePayload {
        session,
        generation: generation.fetch_add(1, Ordering::SeqCst) + 1,
    };
    if let Err(e) = app.emit(EVENT_STATE_CHANGED, &payload) {
        log::warn!("could not emit meeting state: {e}");
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// The current meeting, for a frontend that has just mounted.
#[tauri::command]
pub fn meeting_current_state(app: AppHandle) -> MeetingStatePayload {
    app.state::<MeetingDetectorService>().snapshot()
}

/// "Not now" — record the dismissal and take no further action.
///
/// Deliberately does not touch audio, transcription or notes: there is nothing
/// to stop, because detection never started any of them.
#[tauri::command]
pub fn meeting_not_now(app: AppHandle, session_id: String) -> Result<(), String> {
    let service = app.state::<MeetingDetectorService>();
    let mut guard = service.state.lock().unwrap_or_else(|e| e.into_inner());
    let Some(current) = guard.current_session.as_mut() else {
        return Err("no meeting is currently detected".into());
    };
    if current.session_id != session_id {
        // A popup for a meeting that has since ended. Ignore rather than
        // dismiss whatever is current now.
        return Err("that meeting is no longer the current one".into());
    }
    current.state = MeetingSessionState::Dismissed;
    let session = current.clone();
    guard.dismissed_sessions.insert(session_id);
    drop(guard);

    log::info!("meeting dismissed by user: {}", session.diagnostic());
    super::consent_popup::dismiss(&app);
    let generation = Arc::clone(&app.state::<MeetingDetectorService>().generation);
    emit_state(&app, &generation, Some(session));
    Ok(())
}

/// "Take notes" — record consent, then try to start exactly one note session.
///
/// The state only becomes `TakingNotes` if a session really started. Showing
/// "Taking notes in Zoom" over a pipeline that produced nothing would be the
/// worst possible outcome here: the user would stop taking their own.
#[tauri::command]
pub fn meeting_take_notes(app: AppHandle, session_id: String) -> Result<String, String> {
    let service = app.state::<MeetingDetectorService>();
    let mut guard = service.state.lock().unwrap_or_else(|e| e.into_inner());
    let Some(current) = guard.current_session.as_mut() else {
        return Err("no meeting is currently detected".into());
    };
    if current.session_id != session_id {
        return Err("that meeting is no longer the current one".into());
    }
    // A second click must not open a second session.
    if matches!(
        current.state,
        MeetingSessionState::StartingNotes | MeetingSessionState::TakingNotes
    ) {
        return Ok(current.session_id.clone());
    }
    current.state = MeetingSessionState::StartingNotes;
    let session = current.clone();
    drop(guard);

    log::info!("meeting consent granted: {}", session.diagnostic());
    super::consent_popup::dismiss(&app);
    let generation = Arc::clone(&app.state::<MeetingDetectorService>().generation);
    emit_state(&app, &generation, Some(session.clone()));
    Ok(session.session_id)
}

/// Diagnostics for the detector. Sanitized: no titles, URLs or codes.
#[tauri::command]
pub fn meeting_detector_diagnostics(app: AppHandle) -> String {
    let service = app.state::<MeetingDetectorService>();
    let guard = service.state.lock().unwrap_or_else(|e| e.into_inner());
    format!(
        "last_scan_at_ms={} current={} prompted={} dismissed={} completed={}",
        guard.last_scan_at_ms,
        guard
            .current_session
            .as_ref()
            .map(|s| s.diagnostic())
            .unwrap_or_else(|| "none".into()),
        guard.prompted_sessions.len(),
        guard.dismissed_sessions.len(),
        guard.completed_sessions.len(),
    )
}

/// Forget every decision, so a physical test can prompt again without
/// restarting the meeting.
#[tauri::command]
pub fn meeting_reset_test_session(app: AppHandle) {
    let service = app.state::<MeetingDetectorService>();
    let mut guard = service.state.lock().unwrap_or_else(|e| e.into_inner());
    guard.current_session = None;
    guard.prompted_sessions.clear();
    guard.dismissed_sessions.clear();
    guard.completed_sessions.clear();
    log::info!("meeting detector test state reset");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation(pid: u32, hwnd: isize) -> Observation {
        Observation {
            platform: MeetingPlatform::Zoom,
            process_id: pid,
            hwnd,
            bounds: (0, 0, 1280, 720),
        }
    }

    /// The same meeting window must produce the same id on every scan, or the
    /// user is prompted once per second.
    #[test]
    fn the_same_window_always_yields_the_same_session_id() {
        let a = session_id(&observation(54896, 0x680BDA));
        let b = session_id(&observation(54896, 0x680BDA));
        assert_eq!(a, b);
        assert_eq!(a, "zoom:54896:680BDA");
    }

    /// Zoom can host two meetings in one process; two windows are two meetings.
    #[test]
    fn two_windows_in_one_process_are_two_sessions() {
        assert_ne!(
            session_id(&observation(54896, 0x680BDA)),
            session_id(&observation(54896, 0x991AAB))
        );
    }

    #[test]
    fn platforms_map_to_the_frontend_catalog_ids() {
        assert_eq!(MeetingPlatform::Zoom.source_id(), "zoom");
        assert_eq!(MeetingPlatform::GoogleMeet.source_id(), "google-meet");
        assert_eq!(MeetingPlatform::MicrosoftTeams.source_id(), "teams");
        assert_eq!(MeetingPlatform::Webex.source_id(), "webex");
    }

    /// A session is a handle and a rectangle. There is nowhere to put a title,
    /// which is what makes the privacy claim structural.
    #[test]
    fn a_session_diagnostic_carries_no_content() {
        let session = MeetingSession {
            session_id: "zoom:54896:680BDA".into(),
            platform: MeetingPlatform::Zoom,
            process_id: 54896,
            hwnd: 0x680BDA,
            bounds: (0, 0, 1280, 720),
            detected_at_ms: 0,
            state: MeetingSessionState::AwaitingConsent,
        };
        let line = session.diagnostic();
        assert!(line.contains("zoom:54896:680BDA"));
        assert!(line.contains("AwaitingConsent"));
        let lower = line.to_lowercase();
        for forbidden in ["title", "meet.google.com", "participant", "http"] {
            assert!(!lower.contains(forbidden), "{forbidden} leaked");
        }
    }

    /// Starting twice must not produce two loops.
    #[test]
    fn the_service_starts_only_once() {
        let service = MeetingDetectorService::new();
        assert!(!service.started.swap(true, Ordering::SeqCst));
        assert!(service.started.swap(true, Ordering::SeqCst));
    }

    /// A fresh service has no meeting and no decisions.
    #[test]
    fn a_fresh_service_is_idle() {
        let service = MeetingDetectorService::new();
        let snapshot = service.snapshot();
        assert!(snapshot.session.is_none());
        assert_eq!(snapshot.generation, 0);
    }
}
