//! Why a visual action was refused, as a type rather than a sentence.
//!
//! Every refusal in this subsystem used to become a `String` the moment it left
//! the gate. That worked for showing the user something, and for nothing else:
//! the capability boundary flattened eight distinct reasons into one
//! `display-not-verified`, so the planner could not tell "this display has never
//! been checked" from "this point is on no display at all", and the frontend had
//! nothing to branch on but prose.
//!
//! So the code travels intact from the gate, through the capability result, into
//! the planner, and only becomes English in the frontend's renderer. The
//! `message` field here is a fallback for logs and for callers that have no
//! renderer — never the thing the code is recovered from.

#![cfg(windows)]

use serde::{Deserialize, Serialize};

/// Every reason a visual action can be refused before it happens.
///
/// The string forms are the wire contract shared with TypeScript. They are
/// SCREAMING_SNAKE because that is what the store and the existing gate already
/// emit, and changing them would break the profile-store refusal strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayInteractionErrorCode {
    DisplayNotConfigured,
    DisplayProfileStale,
    DisplayProfileFailed,
    DisplayIgnored,
    DisplayIdentityMismatch,
    DisplayProfileCorrupt,
    DisplayProfileVersionUnsupported,
    TargetOutsideConnectedDisplay,
    AuthorityExpired,
    AuthorityTopologyChanged,
    AuthorityDisplayMismatch,
}

impl DisplayInteractionErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DisplayNotConfigured => "DISPLAY_NOT_CONFIGURED",
            Self::DisplayProfileStale => "DISPLAY_PROFILE_STALE",
            Self::DisplayProfileFailed => "DISPLAY_PROFILE_FAILED",
            Self::DisplayIgnored => "DISPLAY_IGNORED",
            Self::DisplayIdentityMismatch => "DISPLAY_IDENTITY_MISMATCH",
            Self::DisplayProfileCorrupt => "DISPLAY_PROFILE_CORRUPT",
            Self::DisplayProfileVersionUnsupported => "DISPLAY_PROFILE_VERSION_UNSUPPORTED",
            Self::TargetOutsideConnectedDisplay => "TARGET_OUTSIDE_CONNECTED_DISPLAY",
            Self::AuthorityExpired => "AUTHORITY_EXPIRED",
            Self::AuthorityTopologyChanged => "AUTHORITY_TOPOLOGY_CHANGED",
            Self::AuthorityDisplayMismatch => "AUTHORITY_DISPLAY_MISMATCH",
        }
    }

    /// Parse the gate's existing `&'static str` codes.
    ///
    /// Anything unrecognised becomes `DisplayNotConfigured` — the most
    /// conservative reading, since it is the one that tells the user to check
    /// the display rather than implying the request itself was wrong.
    pub fn from_gate_code(code: &str) -> Self {
        match code {
            "DISPLAY_PROFILE_STALE" => Self::DisplayProfileStale,
            "DISPLAY_PROFILE_FAILED" => Self::DisplayProfileFailed,
            "DISPLAY_IGNORED" => Self::DisplayIgnored,
            "DISPLAY_IDENTITY_MISMATCH" => Self::DisplayIdentityMismatch,
            "DISPLAY_PROFILE_CORRUPT" => Self::DisplayProfileCorrupt,
            "DISPLAY_PROFILE_VERSION_UNSUPPORTED" => Self::DisplayProfileVersionUnsupported,
            "TARGET_OUTSIDE_CONNECTED_DISPLAY" => Self::TargetOutsideConnectedDisplay,
            "AUTHORITY_EXPIRED" => Self::AuthorityExpired,
            "AUTHORITY_TOPOLOGY_CHANGED" => Self::AuthorityTopologyChanged,
            "AUTHORITY_DISPLAY_MISMATCH" => Self::AuthorityDisplayMismatch,
            _ => Self::DisplayNotConfigured,
        }
    }

    /// What the user can actually do about it. Consumed by the planner and by
    /// the frontend's button label.
    pub fn recommended_action(&self) -> &'static str {
        match self {
            Self::DisplayNotConfigured => "verify-display",
            Self::DisplayProfileStale => "recheck-display",
            Self::DisplayProfileFailed => "review-measurements",
            Self::DisplayIgnored => "re-enable-display",
            Self::DisplayIdentityMismatch => "recheck-display",
            Self::DisplayProfileCorrupt => "verify-display",
            Self::DisplayProfileVersionUnsupported => "update-arcsonare",
            Self::TargetOutsideConnectedDisplay => "none",
            Self::AuthorityExpired => "retry-after-recapture",
            Self::AuthorityTopologyChanged => "recheck-display",
            Self::AuthorityDisplayMismatch => "none",
        }
    }

    /// May the caller try the same thing again on its own?
    ///
    /// Only where repeating the request could plausibly succeed without the
    /// user doing anything. An expired authority qualifies because
    /// re-resolution mints a new one; a wrong display never does, because
    /// nothing about retrying changes which monitor the point is on.
    pub fn allows_automatic_retry(&self) -> bool {
        matches!(self, Self::AuthorityExpired)
    }

    /// Is this a refusal the user can clear by configuring something?
    pub fn is_configuration_problem(&self) -> bool {
        matches!(
            self,
            Self::DisplayNotConfigured
                | Self::DisplayProfileStale
                | Self::DisplayProfileFailed
                | Self::DisplayIgnored
                | Self::DisplayProfileCorrupt
                | Self::DisplayProfileVersionUnsupported
        )
    }

    /// Human-readable fallback. The frontend has its own renderer; this is for
    /// logs and for callers with no UI.
    pub fn describe(&self) -> &'static str {
        match self {
            Self::DisplayNotConfigured => {
                "Visual actions are unavailable on this display because it has not been checked yet."
            }
            Self::DisplayProfileStale => {
                "Visual actions are unavailable on this display because it changed since it was checked."
            }
            Self::DisplayProfileFailed => {
                "Visual actions are unavailable on this display because its last check was outside tolerance."
            }
            Self::DisplayIgnored => {
                "Visual actions are unavailable on this display because you asked ArcSonare to ignore it."
            }
            Self::DisplayIdentityMismatch => "That display is no longer the one ArcSonare measured.",
            Self::DisplayProfileCorrupt => {
                "The stored display measurements could not be read. Check the display again."
            }
            Self::DisplayProfileVersionUnsupported => {
                "The stored display measurements were written by a newer version of ArcSonare."
            }
            Self::TargetOutsideConnectedDisplay => {
                "That point is not on any connected display, so there is nothing there to act on."
            }
            Self::AuthorityExpired => {
                "The display target expired before ArcSonare could act on it."
            }
            Self::AuthorityTopologyChanged => {
                "The monitor arrangement changed after I looked, so I stopped."
            }
            Self::AuthorityDisplayMismatch => {
                "That point is not on the display I checked, so I won't act on it."
            }
        }
    }
}

/// A rectangle as the store and the OS report them, for showing a difference.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometrySnapshot {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub rotation_degrees: i32,
}

/// Everything the UI needs to explain the refusal without asking again.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DisplayInteractionErrorDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_geometry: Option<GeometrySnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_geometry: Option<GeometrySnapshot>,
    /// Which property actually differs — "resolution", "scale", "rotation".
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub changed_properties: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_error_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_error_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_ms: Option<u64>,
}

/// A refusal, with everything needed to act on it, at every layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInteractionError {
    pub code: DisplayInteractionErrorCode,
    /// The wire form, so TypeScript can switch on a string without knowing
    /// serde's enum representation.
    pub code_str: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable_identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<DisplayInteractionErrorDetails>,
    pub recommended_action: String,
    pub allows_automatic_retry: bool,
    /// Whether anything reached the user's screen before the refusal.
    ///
    /// Always false today — every one of these is decided before the first
    /// native call — but carried explicitly so a future refusal that happens
    /// after a side effect cannot silently look like one that did not.
    pub side_effect_occurred: bool,
}

impl DisplayInteractionError {
    pub fn new(code: DisplayInteractionErrorCode) -> Self {
        Self {
            code_str: code.as_str().to_string(),
            message: code.describe().to_string(),
            display_id: None,
            stable_identity: None,
            details: None,
            recommended_action: code.recommended_action().to_string(),
            allows_automatic_retry: code.allows_automatic_retry(),
            side_effect_occurred: false,
            code,
        }
    }

    pub fn from_gate_code(code: &str) -> Self {
        Self::new(DisplayInteractionErrorCode::from_gate_code(code))
    }

    pub fn with_display(mut self, display_id: Option<String>, stable: Option<String>) -> Self {
        self.display_id = display_id;
        self.stable_identity = stable;
        self
    }

    pub fn with_details(mut self, details: DisplayInteractionErrorDetails) -> Self {
        self.details = Some(details);
        self
    }

    pub fn code_str(&self) -> &str {
        &self.code_str
    }
}

impl std::fmt::Display for DisplayInteractionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl From<super::authority::AuthorityRefusal> for DisplayInteractionError {
    fn from(r: super::authority::AuthorityRefusal) -> Self {
        use super::authority::AuthorityRefusal as A;
        Self::new(match r {
            A::Expired => DisplayInteractionErrorCode::AuthorityExpired,
            A::TopologyChanged => DisplayInteractionErrorCode::AuthorityTopologyChanged,
            A::WrongDisplay => DisplayInteractionErrorCode::AuthorityDisplayMismatch,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every code must survive the round trip the capability boundary performs:
    /// enum → string → enum. A code that does not is one that silently becomes
    /// `DISPLAY_NOT_CONFIGURED` somewhere in the middle.
    #[test]
    fn every_code_round_trips_through_its_wire_form() {
        for code in ALL_CODES {
            assert_eq!(
                DisplayInteractionErrorCode::from_gate_code(code.as_str()),
                code,
                "{} did not survive the round trip",
                code.as_str()
            );
        }
    }

    const ALL_CODES: [DisplayInteractionErrorCode; 11] = [
        DisplayInteractionErrorCode::DisplayNotConfigured,
        DisplayInteractionErrorCode::DisplayProfileStale,
        DisplayInteractionErrorCode::DisplayProfileFailed,
        DisplayInteractionErrorCode::DisplayIgnored,
        DisplayInteractionErrorCode::DisplayIdentityMismatch,
        DisplayInteractionErrorCode::DisplayProfileCorrupt,
        DisplayInteractionErrorCode::DisplayProfileVersionUnsupported,
        DisplayInteractionErrorCode::TargetOutsideConnectedDisplay,
        DisplayInteractionErrorCode::AuthorityExpired,
        DisplayInteractionErrorCode::AuthorityTopologyChanged,
        DisplayInteractionErrorCode::AuthorityDisplayMismatch,
    ];

    #[test]
    fn an_unknown_code_fails_towards_asking_the_user_to_check_the_display() {
        assert_eq!(
            DisplayInteractionErrorCode::from_gate_code("SOMETHING_NEW"),
            DisplayInteractionErrorCode::DisplayNotConfigured
        );
    }

    /// The point of the type: a wrong display never becomes retryable, because
    /// retrying cannot change which monitor a coordinate is on.
    #[test]
    fn only_an_expired_authority_may_be_retried_without_the_user() {
        for code in ALL_CODES {
            assert_eq!(
                code.allows_automatic_retry(),
                code == DisplayInteractionErrorCode::AuthorityExpired,
                "{} has the wrong retry policy",
                code.as_str()
            );
        }
    }

    #[test]
    fn a_target_on_no_display_is_never_a_configuration_problem() {
        assert!(
            !DisplayInteractionErrorCode::TargetOutsideConnectedDisplay.is_configuration_problem()
        );
        assert!(DisplayInteractionErrorCode::DisplayIgnored.is_configuration_problem());
    }

    #[test]
    fn every_code_has_an_action_and_a_sentence() {
        for code in ALL_CODES {
            assert!(!code.recommended_action().is_empty());
            assert!(code.describe().ends_with('.'), "{}", code.as_str());
        }
    }

    #[test]
    fn the_serialised_form_carries_the_string_code_the_frontend_switches_on() {
        let e = DisplayInteractionError::new(
            DisplayInteractionErrorCode::TargetOutsideConnectedDisplay,
        );
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["codeStr"], "TARGET_OUTSIDE_CONNECTED_DISPLAY");
        assert_eq!(v["allowsAutomaticRetry"], false);
        assert_eq!(v["sideEffectOccurred"], false);
    }

    #[test]
    fn an_authority_refusal_becomes_its_own_code_not_a_generic_one() {
        use super::super::authority::AuthorityRefusal;
        assert_eq!(
            DisplayInteractionError::from(AuthorityRefusal::TopologyChanged).code,
            DisplayInteractionErrorCode::AuthorityTopologyChanged
        );
        assert_eq!(
            DisplayInteractionError::from(AuthorityRefusal::Expired).code,
            DisplayInteractionErrorCode::AuthorityExpired
        );
        assert_eq!(
            DisplayInteractionError::from(AuthorityRefusal::WrongDisplay).code,
            DisplayInteractionErrorCode::AuthorityDisplayMismatch
        );
    }
}
