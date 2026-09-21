//! The canonical watched-application model.
//!
//! Every type here exists because the previous representation — a
//! `Set<string>` of catalog ids — could not express something the product
//! needs to say. A catalog id cannot name *which* VS Code workspace, cannot
//! survive the application closing, cannot record what the user consented to
//! ArcSonare reading, and cannot tell the model which actions are real.

use serde::{Deserialize, Serialize};

/// What a watch is doing right now.
///
/// `AppClosed` is the state the old store could not represent: it deleted the
/// entry instead, so quitting Spotify silently un-watched it and the next
/// "press play" had no context to resolve against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WatchState {
    Watching,
    Paused,
    AppClosed,
    PermissionRequired,
    AdapterUnavailable,
    AdapterError,
    Disconnected,
    Stale,
}

impl WatchState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Watching => "watching",
            Self::Paused => "paused",
            Self::AppClosed => "app-closed",
            Self::PermissionRequired => "permission-required",
            Self::AdapterUnavailable => "adapter-unavailable",
            Self::AdapterError => "adapter-error",
            Self::Disconnected => "disconnected",
            Self::Stale => "stale",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw {
            "paused" => Self::Paused,
            "app-closed" => Self::AppClosed,
            "permission-required" => Self::PermissionRequired,
            "adapter-unavailable" => Self::AdapterUnavailable,
            "adapter-error" => Self::AdapterError,
            "disconnected" => Self::Disconnected,
            "stale" => Self::Stale,
            _ => Self::Watching,
        }
    }

    /// Whether this state can supply live context and actions to the model.
    ///
    /// Used to decide what reaches a prompt. A paused or closed watch stays in
    /// the list — the user chose it — but must not contribute capabilities, or
    /// "press play" would resolve to an application that is not running.
    pub fn is_live(self) -> bool {
        matches!(self, Self::Watching | Self::Stale)
    }
}

/// A running instance of an application, addressed by real OS identity.
///
/// `instance_key` is the stable part: the OS pid is reused after a reboot and
/// the HWND changes when a window is recreated, so neither alone can be the
/// thing a preference points at. The key is derived in `instances.rs` from the
/// most durable identity the application actually exposes — a workspace folder
/// for VS Code, the executable plus window ordinal otherwise.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningAppInstance {
    pub id: String,
    pub instance_key: String,
    pub app_catalog_id: String,
    pub process_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    pub executable_name: String,
    /// Opaque window id (`w<hex>`). Raw HWND values are never modelled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    /// Raw title. Redaction happens at the presentation boundary, not here —
    /// the store must keep the truth so a consent change can reveal it later
    /// without re-reading the window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_bounds: Option<WindowBounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor_id: Option<String>,
    /// VS Code workspace folder, browser profile, Discord window role — the
    /// thing that makes two instances of one application different to a person.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_process_id: Option<u32>,
    pub state: InstanceState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstanceState {
    Running,
    Minimized,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// What ArcSonare is allowed to read from one watched application.
///
/// Defaults are deliberately closed for anything that can carry a person's
/// words, code or secrets. A window title is not innocuous — "Re: severance
/// agreement - Outlook" is the whole message — so titles are redactable
/// per-application rather than assumed safe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyPolicy {
    /// Which application it is. Implied by choosing to Watch it.
    pub app_identity: bool,
    pub window_title: bool,
    /// Names/roles of visible controls (buttons, tabs) — not their contents.
    pub visible_controls: bool,
    pub visible_text: bool,
    pub document_identity: bool,
    pub notifications: bool,
    pub message_content: bool,
    pub terminal_output: bool,
    pub source_code: bool,
    pub screenshots: bool,
    /// Whether anything read here may be sent to a cloud model at all.
    pub share_with_model_provider: bool,
    pub redact_paths: bool,
}

impl Default for PrivacyPolicy {
    fn default() -> Self {
        Self {
            app_identity: true,
            window_title: true,
            visible_controls: true,
            visible_text: false,
            document_identity: false,
            notifications: false,
            message_content: false,
            terminal_output: false,
            source_code: false,
            screenshots: false,
            share_with_model_provider: true,
            redact_paths: false,
        }
    }
}

impl PrivacyPolicy {
    /// Defaults for applications whose window titles are usually the content.
    ///
    /// A messaging client's title is the conversation partner; a mail client's
    /// is the subject line. Watching one must not publish that to a provider
    /// as a side effect of being watched.
    pub fn sensitive_default() -> Self {
        Self {
            window_title: false,
            redact_paths: true,
            ..Self::default()
        }
    }

    /// Whether a catalog application should start from the closed defaults.
    pub fn is_sensitive_app(app_catalog_id: &str) -> bool {
        matches!(
            app_catalog_id,
            "discord" | "slack" | "outlook" | "teams" | "whatsapp" | "telegram" | "signal"
        )
    }

    pub fn for_app(app_catalog_id: &str) -> Self {
        if Self::is_sensitive_app(app_catalog_id) {
            Self::sensitive_default()
        } else {
            Self::default()
        }
    }

    /// Apply the policy to a title before anything outside the store sees it.
    pub fn redact_title(&self, title: Option<&str>) -> Option<String> {
        let title = title?;
        if !self.window_title {
            return Some("[title hidden by privacy settings]".to_string());
        }
        if self.redact_paths {
            Some(redact_paths(title))
        } else {
            Some(title.to_string())
        }
    }
}

/// Replace anything that looks like a Windows path or an email address.
pub fn redact_paths(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for token in text.split_inclusive(char::is_whitespace) {
        let trimmed = token.trim();
        let looks_like_path = trimmed.len() > 3
            && (trimmed.contains(":\\")
                || trimmed.starts_with("\\\\")
                || (trimmed.contains('/') && trimmed.contains('.')));
        let looks_like_email = trimmed.contains('@') && trimmed.contains('.');
        if looks_like_path || looks_like_email {
            out.push_str("[redacted]");
            if token.ends_with(char::is_whitespace) {
                out.push(' ');
            }
        } else {
            out.push_str(token);
        }
    }
    out
}

/// A watched application as the user chose it, independent of what is running.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedApplication {
    pub id: String,
    pub app_catalog_id: String,
    pub display_name: String,
    pub state: WatchState,
    /// The instance the user pinned, if any. Survives the app closing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_instance_key: Option<String>,
    pub privacy_policy: PrivacyPolicy,
    pub enabled_context_providers: Vec<String>,
    pub enabled_action_providers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_id: Option<String>,
    pub adapter_health: AdapterHealth,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<String>,
    /// Live instances, filled in by the discovery pass. Never persisted as the
    /// authority — the OS is.
    #[serde(default)]
    pub instances: Vec<RunningAppInstance>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AdapterHealth {
    Unknown,
    Healthy,
    Degraded,
    Unavailable,
    Error,
}

impl AdapterHealth {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Unavailable => "unavailable",
            Self::Error => "error",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw {
            "healthy" => Self::Healthy,
            "degraded" => Self::Degraded,
            "unavailable" => Self::Unavailable,
            "error" => Self::Error,
            _ => Self::Unknown,
        }
    }
}

/// A conversation's binding to one watched application.
///
/// Conversation-scoped rather than global so "pause it" in one chat does not
/// silently retarget another chat's Spotify.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSession {
    pub id: String,
    pub conversation_id: String,
    pub watched_application_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bound_instance_key: Option<String>,
    pub mode: String,
    pub status: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_snapshot_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_event_at: Option<String>,
}

/// Which instance a request should act on.
///
/// The three arms are the product rule from the spec, made explicit so a caller
/// cannot accidentally treat "several matched" as "the first one matched" —
/// which is how a command would run against the wrong VS Code workspace.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum InstanceResolution {
    /// Exactly one instance, or an unambiguous preference.
    Resolved {
        instance: Box<RunningAppInstance>,
        reason: &'static str,
    },
    /// Several plausible instances and no way to choose. Ask.
    Ambiguous {
        candidates: Vec<RunningAppInstance>,
    },
    /// Watched, but nothing is running.
    NotRunning { display_name: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_application_is_not_live_context() {
        assert!(WatchState::Watching.is_live());
        assert!(
            !WatchState::AppClosed.is_live(),
            "a closed app must not supply capabilities — that is how \"press play\" \
             ended up targeting something that was not running"
        );
        assert!(!WatchState::Paused.is_live());
    }

    #[test]
    fn watch_states_round_trip_through_the_database_representation() {
        for state in [
            WatchState::Watching,
            WatchState::Paused,
            WatchState::AppClosed,
            WatchState::PermissionRequired,
            WatchState::AdapterUnavailable,
            WatchState::AdapterError,
            WatchState::Disconnected,
            WatchState::Stale,
        ] {
            assert_eq!(WatchState::parse(state.as_str()), state);
        }
    }

    /// Messaging and mail applications must not leak their subject lines simply
    /// because the user asked ArcSonare to watch them.
    #[test]
    fn messaging_apps_start_with_titles_redacted() {
        let discord = PrivacyPolicy::for_app("discord");
        assert!(!discord.window_title);
        let spotify = PrivacyPolicy::for_app("spotify");
        assert!(
            spotify.window_title,
            "a media player's title is the track — that is the point of watching it"
        );
    }

    #[test]
    fn content_permissions_are_closed_by_default() {
        let policy = PrivacyPolicy::default();
        assert!(!policy.message_content);
        assert!(!policy.source_code);
        assert!(!policy.terminal_output);
        assert!(!policy.screenshots);
    }

    #[test]
    fn a_hidden_title_is_replaced_rather_than_passed_through() {
        let policy = PrivacyPolicy::for_app("discord");
        assert_eq!(
            policy.redact_title(Some("#general — private server")).as_deref(),
            Some("[title hidden by privacy settings]")
        );
    }

    /// The redaction path the native capabilities use.
    ///
    /// `applications.get_window_context` is reachable directly through
    /// `capability_execute`, not only through the TypeScript adapters, so a
    /// model that skips the adapter must still be refused the title. This pins
    /// the behaviour that gate depends on.
    #[test]
    fn a_permitted_title_passes_through_and_a_withheld_one_does_not() {
        let open = PrivacyPolicy::for_app("spotify");
        assert_eq!(
            open.redact_title(Some("Weightless — Marconi Union")).as_deref(),
            Some("Weightless — Marconi Union")
        );

        let closed = PrivacyPolicy::for_app("discord");
        let redacted = closed.redact_title(Some("#salary-negotiation | Private Server"));
        assert!(
            !redacted.as_deref().unwrap_or_default().contains("salary"),
            "a withheld title must not survive redaction in any form"
        );
    }

    /// Absent is absent. A missing title must not become the redaction notice,
    /// or every unnamed window would look like something being hidden.
    #[test]
    fn a_window_with_no_title_stays_absent_rather_than_becoming_a_notice() {
        assert_eq!(PrivacyPolicy::for_app("discord").redact_title(None), None);
        assert_eq!(PrivacyPolicy::for_app("spotify").redact_title(None), None);
    }

    #[test]
    fn path_redaction_removes_locations_but_keeps_the_sentence() {
        let redacted = redact_paths(r"editing C:\Users\ana\secret\plan.md now");
        assert!(!redacted.contains("ana"));
        assert!(redacted.contains("editing"));
        assert!(redacted.contains("now"));
    }
}
