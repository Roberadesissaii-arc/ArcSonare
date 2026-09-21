//! Discord desktop adapter.
//!
//! Discord has a credential form in ArcSonare and no working connector behind
//! it. That credential is **not used here**, and nothing in this file talks to
//! Discord's API — using a stored token to send a message the user thought was
//! being typed into their open window would be a different action than the one
//! they asked for.
//!
//! What this reads is the running application: its window title, which names
//! the server and channel, and — when the window exposes an accessibility tree
//! — the names of its interactive controls. Message bodies are behind an
//! explicit per-application consent and are reported as unavailable when the
//! tree does not expose them, which on a stock Electron build is most of the
//! time.

use serde::Serialize;

/// Where in Discord the user is, as far as the window says.
///
/// Discord's title is one of:
///   `#channel | Server`  ·  `@person | Discord`  ·  `Discord`
/// which is a genuine, cheap, always-available signal — unlike the tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscordLocation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direct_message_with: Option<String>,
    pub unread: bool,
    /// What the location was derived from, so a claim can be traced.
    pub source: &'static str,
}

/// Parse a Discord window title into a location.
///
/// Returns an empty location rather than a guess when the title says nothing —
/// "Discord" alone means the user is on the home screen or the title has not
/// updated, and inventing a channel from that is exactly the dishonesty this
/// adapter exists to avoid.
pub fn parse_location(title: &str) -> DiscordLocation {
    let mut rest = title.trim();
    let mut unread = false;

    // "(3) #general | Server" — the counter is an unread indicator.
    if let Some(stripped) = rest.strip_prefix('(') {
        if let Some(close) = stripped.find(')') {
            if stripped[..close].chars().all(|c| c.is_ascii_digit()) {
                unread = true;
                rest = stripped[close + 1..].trim();
            }
        }
    }

    if rest.eq_ignore_ascii_case("discord") || rest.is_empty() {
        return DiscordLocation {
            unread,
            source: "window-metadata",
            ..Default::default()
        };
    }

    let parts: Vec<&str> = rest.split('|').map(str::trim).collect();
    let head = parts.first().copied().unwrap_or("");
    let tail = parts.get(1).copied().filter(|s| !s.is_empty());

    if let Some(channel) = head.strip_prefix('#') {
        return DiscordLocation {
            server: tail.filter(|s| !s.eq_ignore_ascii_case("discord")).map(str::to_string),
            channel: Some(channel.trim().to_string()),
            direct_message_with: None,
            unread,
            source: "window-metadata",
        };
    }

    if let Some(person) = head.strip_prefix('@') {
        return DiscordLocation {
            server: None,
            channel: None,
            direct_message_with: Some(person.trim().to_string()),
            unread,
            source: "window-metadata",
        };
    }

    // Something else entirely — a voice call, a settings pane. Report the raw
    // head as the channel only when a server follows it, which is the shape
    // Discord uses for forum and thread views.
    if tail.is_some() && !head.is_empty() {
        return DiscordLocation {
            server: tail.map(str::to_string),
            channel: Some(head.to_string()),
            direct_message_with: None,
            unread,
            source: "window-metadata",
        };
    }

    DiscordLocation {
        unread,
        source: "window-metadata",
        ..Default::default()
    }
}

/// A one-sentence description of where the user is, or an honest blank.
pub fn describe_location(location: &DiscordLocation) -> String {
    match (&location.channel, &location.server, &location.direct_message_with) {
        (Some(channel), Some(server), _) => format!("#{channel} in {server}"),
        (Some(channel), None, _) => format!("#{channel}"),
        (None, _, Some(person)) => format!("a direct message with {person}"),
        _ => "Discord, but the window title does not say which channel".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_channel_title_yields_channel_and_server() {
        let location = parse_location("#general | ArcSonare Testing");
        assert_eq!(location.channel.as_deref(), Some("general"));
        assert_eq!(location.server.as_deref(), Some("ArcSonare Testing"));
        assert!(!location.unread);
    }

    #[test]
    fn an_unread_counter_is_recognised_and_removed() {
        let location = parse_location("(7) #general | ArcSonare Testing");
        assert!(location.unread);
        assert_eq!(location.channel.as_deref(), Some("general"));
    }

    #[test]
    fn a_direct_message_is_not_reported_as_a_channel() {
        let location = parse_location("@ana | Discord");
        assert_eq!(location.direct_message_with.as_deref(), Some("ana"));
        assert_eq!(location.channel, None);
        assert_eq!(location.server, None);
    }

    /// The important negative case: a bare title must not become a channel.
    #[test]
    fn a_bare_title_reports_nothing_rather_than_guessing() {
        let location = parse_location("Discord");
        assert_eq!(location.channel, None);
        assert_eq!(location.server, None);
        assert_eq!(location.direct_message_with, None);
        assert!(describe_location(&location).contains("does not say"));
    }

    #[test]
    fn the_server_is_not_filled_in_with_the_product_name() {
        let location = parse_location("#general | Discord");
        assert_eq!(location.channel.as_deref(), Some("general"));
        assert_eq!(
            location.server, None,
            "\"Discord\" is the product, not a server the user is in"
        );
    }

    #[test]
    fn every_location_records_where_it_came_from() {
        assert_eq!(parse_location("#a | b").source, "window-metadata");
    }
}
