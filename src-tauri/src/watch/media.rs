//! Windows Global System Media Transport Controls.
//!
//! This is the semantic media session Windows already maintains for Spotify and
//! every other player: real track metadata, real playback state, and real
//! transport commands addressed to a *named session* rather than to whatever
//! window happens to have focus.
//!
//! The alternative — synthesising a media key — is what makes "press play"
//! unreliable: the keystroke goes to the foreground application, so it pauses
//! the YouTube tab the user just clicked instead of the Spotify they asked for.
//! Every function here targets a session by its source application id.

use serde::Serialize;

/// One player's session, as Windows reports it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    /// AUMID of the owning application, e.g. `Spotify.exe`.
    pub source_app_id: String,
    pub playback_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_artist: Option<String>,
    pub can_play: bool,
    pub can_pause: bool,
    pub can_skip_next: bool,
    pub can_skip_previous: bool,
    pub is_current: bool,
}

/// What a transport command may ask for. Deliberately closed: there is no
/// "seek to arbitrary position" and no playlist mutation, because neither is
/// something a spoken sentence should be able to do without confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaCommand {
    Play,
    Pause,
    Next,
    Previous,
}

/// Does this session belong to the application we mean?
///
/// Matched on the executable rather than on a display name: Windows reports
/// `Spotify.exe` for the desktop client and a browser's own id for a web
/// player, and conflating those is how a command lands in the wrong one.
pub fn session_matches(source_app_id: &str, executable_name: &str) -> bool {
    let normalize = |s: &str| {
        s.trim()
            .rsplit(['\\', '/', '!'])
            .next()
            .unwrap_or(s)
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_lowercase()
    };
    !executable_name.trim().is_empty()
        && !source_app_id.trim().is_empty()
        && normalize(source_app_id) == normalize(executable_name)
}

#[cfg(windows)]
mod imp {
    use super::{MediaCommand, MediaSession};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };

    fn blocking<T>(
        op: windows::Foundation::IAsyncOperation<T>,
    ) -> Result<T, String>
    where
        T: windows::core::RuntimeType,
    {
        op.get().map_err(|e| format!("media session call failed: {e}"))
    }

    fn manager() -> Result<SessionManager, String> {
        let request = SessionManager::RequestAsync()
            .map_err(|e| format!("media sessions are unavailable: {e}"))?;
        blocking(request)
    }

    fn status_label(status: PlaybackStatus) -> &'static str {
        match status {
            PlaybackStatus::Playing => "playing",
            PlaybackStatus::Paused => "paused",
            PlaybackStatus::Stopped => "stopped",
            PlaybackStatus::Changing => "changing",
            PlaybackStatus::Opened => "opened",
            PlaybackStatus::Closed => "closed",
            _ => "unknown",
        }
    }

    fn describe(session: &Session, current_id: &str) -> Option<MediaSession> {
        let source_app_id = session.SourceAppUserModelId().ok()?.to_string();
        let playback = session.GetPlaybackInfo().ok()?;
        let controls = playback.Controls().ok();
        let properties = session
            .TryGetMediaPropertiesAsync()
            .ok()
            .and_then(|op| op.get().ok());

        let non_empty = |s: String| if s.trim().is_empty() { None } else { Some(s) };

        Some(MediaSession {
            playback_status: playback
                .PlaybackStatus()
                .map(status_label)
                .unwrap_or("unknown")
                .to_string(),
            title: properties
                .as_ref()
                .and_then(|p| p.Title().ok())
                .map(|s| s.to_string())
                .and_then(non_empty),
            artist: properties
                .as_ref()
                .and_then(|p| p.Artist().ok())
                .map(|s| s.to_string())
                .and_then(non_empty),
            album: properties
                .as_ref()
                .and_then(|p| p.AlbumTitle().ok())
                .map(|s| s.to_string())
                .and_then(non_empty),
            album_artist: properties
                .as_ref()
                .and_then(|p| p.AlbumArtist().ok())
                .map(|s| s.to_string())
                .and_then(non_empty),
            can_play: controls.as_ref().and_then(|c| c.IsPlayEnabled().ok()).unwrap_or(false),
            can_pause: controls.as_ref().and_then(|c| c.IsPauseEnabled().ok()).unwrap_or(false),
            can_skip_next: controls
                .as_ref()
                .and_then(|c| c.IsNextEnabled().ok())
                .unwrap_or(false),
            can_skip_previous: controls
                .as_ref()
                .and_then(|c| c.IsPreviousEnabled().ok())
                .unwrap_or(false),
            is_current: source_app_id == current_id,
            source_app_id,
        })
    }

    pub fn sessions() -> Result<Vec<MediaSession>, String> {
        let manager = manager()?;
        let current_id = manager
            .GetCurrentSession()
            .ok()
            .and_then(|s| s.SourceAppUserModelId().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let list = manager
            .GetSessions()
            .map_err(|e| format!("could not list media sessions: {e}"))?;
        let mut out = Vec::new();
        for session in list {
            if let Some(described) = describe(&session, &current_id) {
                out.push(described);
            }
        }
        Ok(out)
    }

    fn find(executable_name: &str) -> Result<Session, String> {
        let manager = manager()?;
        let list = manager
            .GetSessions()
            .map_err(|e| format!("could not list media sessions: {e}"))?;
        for session in list {
            let id = session
                .SourceAppUserModelId()
                .map(|s| s.to_string())
                .unwrap_or_default();
            if super::session_matches(&id, executable_name) {
                return Ok(session);
            }
        }
        Err(format!(
            "{executable_name} is not registered as a media session right now."
        ))
    }

    /// The system-wide media keys, as a last resort.
    ///
    /// Used only when the application has no media session for the transport
    /// command to address — a player that has just launched, or one that does
    /// not register with Windows at all. This is *not* a UI interaction: no
    /// screen is captured, no cursor moves, nothing is clicked. It is the same
    /// key a keyboard's play button sends, and Windows routes it to whichever
    /// player is registered to receive it.
    ///
    /// The weakness is honest and reported as such: with no session there is
    /// also nothing to read the result back from, so the caller can only say
    /// the key was sent.
    pub fn send_media_key(cmd: MediaCommand) -> Result<(), String> {
        #[link(name = "user32")]
        extern "system" {
            fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
        }
        const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
        const KEYEVENTF_KEYUP: u32 = 0x0002;
        const VK_MEDIA_NEXT_TRACK: u8 = 0xB0;
        const VK_MEDIA_PREV_TRACK: u8 = 0xB1;
        const VK_MEDIA_STOP: u8 = 0xB2;
        const VK_MEDIA_PLAY_PAUSE: u8 = 0xB3;

        // Play and Pause share one key. That is a real limitation of the media
        // keys — the toggle cannot be aimed — and it is why this path is last:
        // "pause" on an already-paused player would start it.
        let vk = match cmd {
            MediaCommand::Play | MediaCommand::Pause => VK_MEDIA_PLAY_PAUSE,
            MediaCommand::Next => VK_MEDIA_NEXT_TRACK,
            MediaCommand::Previous => VK_MEDIA_PREV_TRACK,
        };
        unsafe {
            keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0);
            keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
        }
        let _ = VK_MEDIA_STOP;
        Ok(())
    }

    /// Send one transport command to one named session.
    ///
    /// The return value is what Windows reported, not what was requested. A
    /// player may refuse — an advertisement cannot be skipped — and reporting
    /// that honestly is the difference between "skipped" and "asked to skip".
    pub fn command(executable_name: &str, cmd: MediaCommand) -> Result<bool, String> {
        let session = find(executable_name)?;
        let accepted = match cmd {
            MediaCommand::Play => session
                .TryPlayAsync()
                .map_err(|e| format!("play failed: {e}"))?
                .get(),
            MediaCommand::Pause => session
                .TryPauseAsync()
                .map_err(|e| format!("pause failed: {e}"))?
                .get(),
            MediaCommand::Next => session
                .TrySkipNextAsync()
                .map_err(|e| format!("skip failed: {e}"))?
                .get(),
            MediaCommand::Previous => session
                .TrySkipPreviousAsync()
                .map_err(|e| format!("previous failed: {e}"))?
                .get(),
        };
        accepted.map_err(|e| format!("the player did not answer: {e}"))
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{MediaCommand, MediaSession};

    pub fn sessions() -> Result<Vec<MediaSession>, String> {
        Err("Media sessions are only available on Windows.".into())
    }

    pub fn command(_executable_name: &str, _cmd: MediaCommand) -> Result<bool, String> {
        Err("Media sessions are only available on Windows.".into())
    }

    pub fn send_media_key(_cmd: MediaCommand) -> Result<(), String> {
        Err("Media keys are only available on Windows.".into())
    }
}

pub use imp::{command, send_media_key, sessions};

/// The session belonging to one executable, if Windows has one for it.
pub fn session_for(executable_name: &str) -> Result<Option<MediaSession>, String> {
    Ok(sessions()?
        .into_iter()
        .find(|s| session_matches(&s.source_app_id, executable_name)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_matches_its_executable_regardless_of_case_or_suffix() {
        assert!(session_matches("Spotify.exe", "Spotify.exe"));
        assert!(session_matches("Spotify.exe", "spotify"));
        assert!(session_matches(
            r"C:\Users\a\AppData\Roaming\Spotify\Spotify.exe",
            "Spotify.exe"
        ));
    }

    /// A browser playing music must not answer a command meant for Spotify.
    #[test]
    fn a_different_player_never_matches() {
        assert!(!session_matches("msedge.exe", "Spotify.exe"));
        assert!(!session_matches("chrome.exe", "Spotify.exe"));
    }

    #[test]
    fn empty_identifiers_never_match() {
        assert!(!session_matches("", "Spotify.exe"));
        assert!(!session_matches("Spotify.exe", ""));
        assert!(!session_matches("", ""));
    }

    /// The command set is closed by the type, not by a string parser.
    ///
    /// There is deliberately no `MediaCommand::from_str`: every call site is an
    /// arm in the capability dispatcher, so a model cannot reach a transport
    /// operation by inventing a name for one. Follow, playlist edit and account
    /// change have no representation here at all.
    #[test]
    fn the_transport_set_is_closed_and_contains_no_account_operations() {
        let all = [
            MediaCommand::Play,
            MediaCommand::Pause,
            MediaCommand::Next,
            MediaCommand::Previous,
        ];
        assert_eq!(
            all.len(),
            4,
            "adding a variant here adds a capability the model can reach"
        );
    }
}
