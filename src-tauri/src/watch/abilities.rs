//! What ArcSonare can actually do with one watched application, in plain words.
//!
//! This exists because "What can you do?" was answered from the global feature
//! list — open apps, take screenshots, manage tasks, calendar, email — which is
//! true of ArcSonare and false of the conversation the user is in. When a
//! conversation is scoped to Discord, the honest answer describes Discord.
//!
//! Every entry is derived from what an adapter genuinely implements, and each
//! one is tagged with whether it works *now* or only *after the application
//! reopens*. That distinction is the difference between "4 actions available"
//! on a closed application — which is a lie — and an accurate split.

use serde::Serialize;

/// When an ability can be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Availability {
    /// Usable right now.
    Now,
    /// Real, but needs the application running.
    AfterReopening,
    /// Not implemented for this application. Stated so the model cannot claim it.
    Unsupported,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ability {
    /// Plain description, written for a person.
    pub label: String,
    /// The capability behind it. Diagnostics only — never spoken to the user.
    pub capability_id: Option<&'static str>,
    pub availability: Availability,
    /// Why, when it is unsupported or conditional.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

fn now(label: &str, capability_id: &'static str) -> Ability {
    Ability {
        label: label.to_string(),
        capability_id: Some(capability_id),
        availability: Availability::Now,
        note: None,
    }
}

fn unsupported(label: &str, why: &str) -> Ability {
    Ability {
        label: label.to_string(),
        capability_id: None,
        availability: Availability::Unsupported,
        note: Some(why.to_string()),
    }
}

/// The full ability set for one watched application.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationAbilities {
    pub app_catalog_id: String,
    pub display_name: String,
    pub running: bool,
    pub abilities: Vec<Ability>,
    /// One sentence naming what this application is for, in this context.
    pub summary: String,
}

impl ApplicationAbilities {
    /// Abilities callable right now.
    ///
    /// The only split Rust needs: it decides which capability ids the model is
    /// offered. The *presentational* splits — what reopening would restore,
    /// what is impossible — belong to the frontend, which has the serialized
    /// `availability` on every ability and its own helpers in
    /// `watchAbilityTypes.ts`. Duplicating them here would be two definitions
    /// of the same three states.
    pub fn available_now(&self) -> Vec<&Ability> {
        self.abilities
            .iter()
            .filter(|a| a.availability == Availability::Now)
            .collect()
    }

    #[cfg(test)]
    fn with_availability(&self, wanted: Availability) -> Vec<&Ability> {
        self.abilities
            .iter()
            .filter(|a| a.availability == wanted)
            .collect()
    }
}

/// Abilities for one application, given whether it is running.
///
/// The `running` flag rewrites availability rather than filtering: a closed
/// application still *has* these abilities, and the user needs to be told which
/// ones come back when they reopen it.
pub fn abilities_for(
    app_catalog_id: &str,
    display_name: &str,
    running: bool,
    // Whether the user has consented to reading message bodies for this app.
    message_content_allowed: bool,
    // Whether an application bridge is actually reachable (VS Code extension).
    bridge_ready: bool,
) -> ApplicationAbilities {
    let mut abilities = match app_catalog_id {
        "spotify" => vec![
            now("See what's playing — track, artist and album", "spotify.get_playback"),
            now("Play", "spotify.play"),
            now("Pause", "spotify.pause"),
            now("Skip to the next track", "spotify.next"),
            now("Go back to the previous track", "spotify.previous"),
            now("Bring Spotify to the front", "applications.focus_watched"),
            unsupported(
                "Change the volume",
                "Windows exposes the system mixer level for the process, not Spotify's own slider.",
            ),
            unsupported(
                "Search, queue or edit playlists",
                "The Windows media session has no library access.",
            ),
        ],
        "vscode" | "cursor" => {
            let mut list = vec![
                now("Bring this workspace to the front", "applications.focus_watched"),
            ];
            if bridge_ready {
                list.splice(
                    0..0,
                    [
                        now("See which file you're editing", "vscode.get_context"),
                        now("Read the errors and warnings in this workspace", "vscode.get_diagnostics"),
                        now("List the tasks this workspace has configured", "vscode.list_tasks"),
                        now("Run one of those configured tasks by name", "vscode.run_task"),
                        now("Start a configured debug profile", "vscode.start_debug"),
                        now("Stop a running task", "vscode.stop_task"),
                    ],
                );
            } else {
                list.push(Ability {
                    label: "Read the active file, diagnostics and tasks".into(),
                    capability_id: Some("vscode.get_context"),
                    availability: Availability::Unsupported,
                    note: Some(
                        "The ArcSonare VS Code extension isn't reachable in that window, so I can \
                         only see the window title."
                            .into(),
                    ),
                });
            }
            list.push(unsupported(
                "Run an arbitrary shell command",
                "Only tasks already declared in the workspace's tasks.json can be run.",
            ));
            list.push(unsupported(
                "Edit files",
                "The bridge reads and runs; file changes go through ArcSonare's own file tools.",
            ));
            list
        }
        "discord" => {
            let mut list = vec![
                now("See which controls the Discord window exposes", "discord_desktop.get_visible_controls"),
                now("Tell you which server and channel the window says you're in", "discord_desktop.get_current_location"),
                now("Bring Discord to the front", "applications.focus_watched"),
                Ability {
                    label: "Prepare a message for the channel that's open, and send it after you confirm".into(),
                    capability_id: Some("discord_desktop.prepare_message"),
                    availability: Availability::Now,
                    note: Some(
                        "Only when the window title names a channel — I won't prepare a message I \
                         can't address. Sending always takes one confirmation."
                            .into(),
                    ),
                },
            ];
            list.push(if message_content_allowed {
                Ability {
                    label: "Read the messages visible in the window".into(),
                    capability_id: Some("discord_desktop.get_visible_messages"),
                    availability: Availability::Now,
                    note: Some(
                        "Only when Discord exposes an accessibility tree — often it does not, and \
                         I'll say so rather than guess."
                            .into(),
                    ),
                }
            } else {
                unsupported(
                    "Read message content",
                    "Turned off in this application's privacy settings.",
                )
            });
            list.push(unsupported(
                "Use Discord's API — servers, history, other channels",
                "ArcSonare has no working Discord connector. Everything comes from the open window.",
            ));
            list
        }
        "chrome" | "edge" | "firefox" | "brave" => vec![
            now("Tell you which page this window is showing", "browser.get_page_context"),
            now("Bring this browser window to the front", "applications.focus_watched"),
            now("Go back, forward or reload", "browser.navigate"),
            unsupported(
                "Read the address bar or list the tabs",
                "That needs a browser extension, which isn't installed. Only the window title is available.",
            ),
            unsupported(
                "Read the page's content",
                "Nothing here reads the page. Content questions go through a connected integration for that site.",
            ),
        ],
        "youtube" => vec![
            now("Tell you which video or channel page is open", "browser.get_page_context"),
            now("Bring the browser window to the front", "applications.focus_watched"),
            now("Go back, forward or reload", "browser.navigate"),
            Ability {
                label: "Look up channel details, latest uploads and publish dates".into(),
                capability_id: Some("youtube.list_channel_videos"),
                availability: Availability::Now,
                note: Some("Through the connected YouTube integration, when it's connected.".into()),
            },
            Ability {
                label: "Open a result you pick".into(),
                capability_id: Some("youtube.open_result"),
                availability: Availability::Now,
                note: None,
            },
            unsupported(
                "Read the page or the address bar",
                "That needs a browser extension. The page identity comes from the window title.",
            ),
        ],
        _ => vec![
            now("Tell you it's running, and what its window is called", "applications.get_window_context"),
            now("Bring it to the front", "applications.focus_watched"),
            unsupported(
                "Read or control anything inside it",
                "No adapter has been built for this application, so only its window is visible to me.",
            ),
        ],
    };

    // A closed application keeps every ability it has; what changes is when.
    // Focus and inspection genuinely need a window, so they move rather than
    // disappearing — the user is told what reopening would restore.
    if !running {
        for ability in &mut abilities {
            if ability.availability == Availability::Now {
                ability.availability = Availability::AfterReopening;
            }
        }
    }

    let summary = summary_for(app_catalog_id, display_name, running, bridge_ready);
    ApplicationAbilities {
        app_catalog_id: app_catalog_id.to_string(),
        display_name: display_name.to_string(),
        running,
        abilities,
        summary,
    }
}

fn summary_for(
    app_catalog_id: &str,
    display_name: &str,
    running: bool,
    bridge_ready: bool,
) -> String {
    if !running {
        return format!("{display_name} is watched but isn't running right now.");
    }
    match app_catalog_id {
        "spotify" => format!("{display_name} — playback control and what's playing."),
        // The summary has to agree with the ability list. Promising "files,
        // errors and tasks" while every one of them is listed unsupported left
        // the model to reconcile the two, and it did so by deciding VS Code was
        // not running — with the editor plainly open.
        "vscode" | "cursor" if !bridge_ready => format!(
            "{display_name} is running, but the ArcSonare VS Code extension isn't reachable in              that window, so only its window title can be read. Say that plainly; do NOT say it              is closed, and do NOT guess at the project or the file."
        ),
        "vscode" | "cursor" => {
            format!("{display_name} — the workspace you're editing: files, errors and tasks.")
        }
        "discord" => format!("{display_name} — the window that's open, and sending in it."),
        "chrome" | "edge" | "firefox" | "brave" => {
            format!("{display_name} — which page is open, and moving around in it.")
        }
        "youtube" => format!("{display_name} — the page that's open, plus YouTube data."),
        _ => format!("{display_name} — window information only."),
    }
}

/// Every capability id the abilities of these applications can reach.
///
/// This is what narrows tool retrieval: an application in scope contributes its
/// own capability ids and nothing else, so a Discord-scoped conversation is
/// never offered a filesystem tool.
pub fn capability_ids(applications: &[ApplicationAbilities]) -> Vec<&'static str> {
    // Goes through `available_now` rather than re-filtering, so "callable right
    // now" is defined in exactly one place. A second inline filter here is how
    // a closed application would come to contribute a capability id.
    let mut ids: Vec<&'static str> = applications
        .iter()
        .flat_map(|app| app.available_now())
        .filter_map(|a| a.capability_id)
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reported failure, as an assertion: a Discord-scoped conversation
    /// must not describe screenshots, tasks, calendar, email or web lookup.
    #[test]
    fn discord_abilities_contain_nothing_global() {
        let abilities = abilities_for("discord", "Discord", true, false, false);
        let text = abilities
            .abilities
            .iter()
            .map(|a| a.label.to_lowercase())
            .collect::<Vec<_>>()
            .join(" | ");
        for global in [
            "screenshot",
            "calendar",
            "email",
            "task list",
            "web search",
            "open applications",
        ] {
            assert!(
                !text.contains(global),
                "a Discord-scoped answer must not offer \"{global}\": {text}"
            );
        }
        assert!(text.contains("discord"));
    }

    /// Discord must not claim to read messages without consent.
    #[test]
    fn discord_does_not_claim_message_reading_without_consent() {
        let denied = abilities_for("discord", "Discord", true, false, false);
        let reading = denied
            .abilities
            .iter()
            .find(|a| a.label.contains("message content"))
            .expect("the ability is listed, as unsupported");
        assert_eq!(reading.availability, Availability::Unsupported);

        let allowed = abilities_for("discord", "Discord", true, true, false);
        assert!(allowed
            .abilities
            .iter()
            .any(|a| a.label.contains("messages visible") && a.availability == Availability::Now));
    }

    /// The closed-application count must not present everything as runnable.
    #[test]
    fn a_closed_application_has_nothing_available_now() {
        let closed = abilities_for("youtube", "YouTube", false, false, false);
        assert!(
            closed.available_now().is_empty(),
            "a closed application must offer nothing now"
        );
        assert!(
            !closed.with_availability(Availability::AfterReopening).is_empty(),
            "it must still say what reopening restores"
        );
        assert!(closed.summary.contains("isn't running"));
    }

    /// A running application's split is the mirror image.
    #[test]
    fn a_running_application_has_nothing_deferred() {
        let open = abilities_for("youtube", "YouTube", true, false, false);
        assert!(!open.available_now().is_empty());
        assert!(open.with_availability(Availability::AfterReopening).is_empty());
    }

    /// Without the extension, VS Code must not claim to read diagnostics.
    #[test]
    fn vscode_without_a_bridge_does_not_claim_to_read_the_editor() {
        let no_bridge = abilities_for("vscode", "VS Code", true, false, false);
        let read = no_bridge
            .abilities
            .iter()
            .find(|a| a.label.contains("diagnostics"))
            .expect("listed");
        assert_eq!(read.availability, Availability::Unsupported);
        assert!(read.note.as_deref().unwrap_or_default().contains("extension"));

        let bridged = abilities_for("vscode", "VS Code", true, false, true);
        assert!(bridged
            .abilities
            .iter()
            .any(|a| a.capability_id == Some("vscode.get_diagnostics")
                && a.availability == Availability::Now));
    }

    /// An application with no adapter says so rather than implying more.
    #[test]
    fn an_unadapted_application_offers_only_window_information() {
        let abilities = abilities_for("figma", "Figma", true, false, false);
        assert!(abilities
            .abilities
            .iter()
            .any(|a| a.availability == Availability::Unsupported
                && a.note.as_deref().unwrap_or_default().contains("No adapter")));
    }

    /// Capability narrowing: only what is usable now, and only from scope.
    #[test]
    fn capability_ids_come_only_from_applications_in_scope() {
        let ids = capability_ids(&[abilities_for("spotify", "Spotify", true, false, false)]);
        assert!(ids.contains(&"spotify.play"));
        assert!(!ids.iter().any(|id| id.starts_with("filesystem.")));
        assert!(!ids.iter().any(|id| id.starts_with("discord")));

        let closed = capability_ids(&[abilities_for("spotify", "Spotify", false, false, false)]);
        assert!(
            closed.is_empty(),
            "a closed application must contribute no callable capabilities"
        );
    }

    /// Two applications in scope contribute both sets, still nothing global.
    #[test]
    fn two_applications_contribute_both_sets() {
        let ids = capability_ids(&[
            abilities_for("spotify", "Spotify", true, false, false),
            abilities_for("discord", "Discord", true, false, false),
        ]);
        assert!(ids.contains(&"spotify.play"));
        assert!(ids.contains(&"discord_desktop.get_current_location"));
        assert!(!ids.iter().any(|id| id.starts_with("filesystem.")));
    }
}
