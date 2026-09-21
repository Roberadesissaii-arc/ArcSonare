//! Choosing which instance a request acts on.
//!
//! Kept deterministic and in Rust on purpose. The model may decide *what* to
//! do; it must not decide *which* VS Code workspace that happens in, because a
//! plausible-sounding wrong choice there runs a build in someone else's project.

use super::model::{InstanceResolution, RunningAppInstance, WatchState, WatchedApplication};

/// Resolve the instance for a watched application.
///
/// Order is the product rule, and each step is a fact rather than a guess:
///   1. the instance the user pinned,
///   2. the instance this conversation is already bound to,
///   3. the only one, when there is only one,
///   4. otherwise ask.
///
/// There is deliberately no "most recently focused" fallback for the ambiguous
/// case. Focus is not a decision — the user may simply have alt-tabbed — and
/// treating it as one is how a command lands in the wrong window.
pub fn resolve_instance(
    watched: &WatchedApplication,
    instances: &[RunningAppInstance],
    bound_instance_key: Option<&str>,
) -> InstanceResolution {
    let live: Vec<RunningAppInstance> = instances
        .iter()
        .filter(|i| i.app_catalog_id == watched.app_catalog_id)
        .cloned()
        .collect();

    if live.is_empty() || !watched.state.is_live() {
        return InstanceResolution::NotRunning {
            display_name: watched.display_name.clone(),
        };
    }

    if let Some(key) = watched.preferred_instance_key.as_deref() {
        if let Some(found) = live.iter().find(|i| i.instance_key == key) {
            return InstanceResolution::Resolved {
                instance: Box::new(found.clone()),
                reason: "pinned",
            };
        }
    }

    if let Some(key) = bound_instance_key {
        if let Some(found) = live.iter().find(|i| i.instance_key == key) {
            return InstanceResolution::Resolved {
                instance: Box::new(found.clone()),
                reason: "conversation-bound",
            };
        }
    }

    if live.len() == 1 {
        return InstanceResolution::Resolved {
            instance: Box::new(live[0].clone()),
            reason: "only-instance",
        };
    }

    InstanceResolution::Ambiguous { candidates: live }
}

/// Watched applications relevant to a request, most relevant first.
///
/// The purpose is subtractive: a model request must not carry every watched
/// application's title and every process on the machine. It carries the ones
/// that could plausibly answer, and when that is more than one the caller asks
/// rather than picking.
pub fn rank_relevant<'a>(
    watched: &'a [WatchedApplication],
    request: &str,
    active_conversation_app: Option<&str>,
) -> Vec<&'a WatchedApplication> {
    let lower = request.to_lowercase();
    let mut scored: Vec<(i32, &WatchedApplication)> = watched
        .iter()
        .filter(|w| w.state != WatchState::Paused)
        .map(|w| {
            let mut score = 0;

            // Named outright — the strongest possible signal.
            if lower.contains(&w.display_name.to_lowercase()) {
                score += 100;
            }
            if lower.contains(&w.app_catalog_id.replace('-', " ")) {
                score += 90;
            }

            // The application this conversation is already talking about.
            if active_conversation_app == Some(w.app_catalog_id.as_str()) {
                score += 60;
            }

            score += domain_score(&w.app_catalog_id, &lower);

            // A closed application can still be the right answer ("Spotify is
            // not running — want me to open it?"), but never outranks a live one.
            if !w.state.is_live() {
                score -= 40;
            }
            (score, w)
        })
        .filter(|(score, _)| *score > 0)
        .collect();

    scored.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    scored.into_iter().map(|(_, w)| w).collect()
}

/// How much this application's domain matches the request's vocabulary.
fn domain_score(app_catalog_id: &str, lower: &str) -> i32 {
    let media = [
        "play", "pause", "resume", "skip", "next song", "next track", "previous",
        "volume", "playing", "music", "track", "song", "album", "artist",
    ];
    let dev = [
        "code", "build", "run this", "compile", "error", "errors", "diagnostic",
        "crash", "crashing", "test", "task", "terminal", "debug", "editing", "file",
    ];
    let chat = [
        "channel", "server", "message", "send", "dm", "chat", "unread", "thread",
    ];
    let browsing = [
        "tab", "page", "browser", "back", "forward", "navigate", "website", "site",
    ];

    let hits = |words: &[&str]| words.iter().filter(|w| lower.contains(**w)).count() as i32 * 20;

    match app_catalog_id {
        "spotify" | "netflix" | "youtube" => hits(&media),
        "vscode" | "cursor" => hits(&dev),
        "discord" | "slack" | "teams" => hits(&chat),
        "chrome" | "edge" | "firefox" | "brave" => hits(&browsing),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::model::{AdapterHealth, InstanceState, PrivacyPolicy};

    fn watched(app: &str, name: &str, state: WatchState) -> WatchedApplication {
        WatchedApplication {
            id: format!("wa-{app}"),
            app_catalog_id: app.into(),
            display_name: name.into(),
            state,
            preferred_instance_key: None,
            privacy_policy: PrivacyPolicy::for_app(app),
            enabled_context_providers: Vec::new(),
            enabled_action_providers: Vec::new(),
            adapter_id: None,
            adapter_health: AdapterHealth::Unknown,
            adapter_message: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            last_seen_at: None,
            instances: Vec::new(),
        }
    }

    fn instance(app: &str, key: &str, workspace: Option<&str>) -> RunningAppInstance {
        RunningAppInstance {
            id: format!("inst-{key}"),
            instance_key: key.into(),
            app_catalog_id: app.into(),
            process_id: 10,
            executable_path: None,
            executable_name: format!("{app}.exe"),
            window_id: None,
            window_title: None,
            window_bounds: None,
            monitor_id: None,
            workspace_identity: workspace.map(str::to_string),
            parent_process_id: None,
            state: InstanceState::Running,
            started_at: None,
            last_seen_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn one_instance_resolves_without_asking() {
        let app = watched("spotify", "Spotify", WatchState::Watching);
        let found = resolve_instance(&app, &[instance("spotify", "spotify:exe:s:0", None)], None);
        assert!(matches!(found, InstanceResolution::Resolved { .. }));
    }

    /// Two workspaces and no pin must produce a question, never a coin flip.
    #[test]
    fn two_workspaces_without_a_pin_are_ambiguous() {
        let app = watched("vscode", "VS Code", WatchState::Watching);
        let found = resolve_instance(
            &app,
            &[
                instance("vscode", "vscode:ws:a", Some("a")),
                instance("vscode", "vscode:ws:b", Some("b")),
            ],
            None,
        );
        match found {
            InstanceResolution::Ambiguous { candidates } => assert_eq!(candidates.len(), 2),
            other => panic!("expected ambiguity, got {other:?}"),
        }
    }

    #[test]
    fn a_pinned_workspace_wins_over_ambiguity() {
        let mut app = watched("vscode", "VS Code", WatchState::Watching);
        app.preferred_instance_key = Some("vscode:ws:b".into());
        let found = resolve_instance(
            &app,
            &[
                instance("vscode", "vscode:ws:a", Some("a")),
                instance("vscode", "vscode:ws:b", Some("b")),
            ],
            None,
        );
        match found {
            InstanceResolution::Resolved { instance, reason } => {
                assert_eq!(instance.instance_key, "vscode:ws:b");
                assert_eq!(reason, "pinned");
            }
            other => panic!("expected the pin to win, got {other:?}"),
        }
    }

    /// The pin outranks the conversation binding: an explicit choice beats an
    /// inferred one.
    #[test]
    fn an_explicit_pin_outranks_the_conversation_binding() {
        let mut app = watched("vscode", "VS Code", WatchState::Watching);
        app.preferred_instance_key = Some("vscode:ws:a".into());
        let found = resolve_instance(
            &app,
            &[
                instance("vscode", "vscode:ws:a", Some("a")),
                instance("vscode", "vscode:ws:b", Some("b")),
            ],
            Some("vscode:ws:b"),
        );
        match found {
            InstanceResolution::Resolved { instance, .. } => {
                assert_eq!(instance.instance_key, "vscode:ws:a")
            }
            other => panic!("expected the pin, got {other:?}"),
        }
    }

    /// A watched-but-closed application must report that, not silently resolve.
    #[test]
    fn a_closed_application_reports_not_running() {
        let app = watched("spotify", "Spotify", WatchState::AppClosed);
        let found = resolve_instance(&app, &[], None);
        match found {
            InstanceResolution::NotRunning { display_name } => assert_eq!(display_name, "Spotify"),
            other => panic!("expected not-running, got {other:?}"),
        }
    }

    /// "Press play" with only Spotify watched must resolve to Spotify.
    #[test]
    fn press_play_selects_the_watched_media_application() {
        let apps = vec![
            watched("spotify", "Spotify", WatchState::Watching),
            watched("vscode", "VS Code", WatchState::Watching),
        ];
        let ranked = rank_relevant(&apps, "press play", None);
        assert_eq!(ranked.first().map(|w| w.app_catalog_id.as_str()), Some("spotify"));
    }

    /// "Run this code" must reach the editor, not the music player.
    #[test]
    fn run_this_code_selects_the_watched_editor() {
        let apps = vec![
            watched("spotify", "Spotify", WatchState::Watching),
            watched("vscode", "VS Code", WatchState::Watching),
        ];
        let ranked = rank_relevant(&apps, "run this code", None);
        assert_eq!(ranked.first().map(|w| w.app_catalog_id.as_str()), Some("vscode"));
    }

    /// Follow-ups carry no vocabulary of their own; the conversation binding is
    /// what keeps "pause it" pointed at Spotify.
    #[test]
    fn a_bare_follow_up_stays_on_the_conversations_application() {
        let apps = vec![
            watched("spotify", "Spotify", WatchState::Watching),
            watched("vscode", "VS Code", WatchState::Watching),
        ];
        let ranked = rank_relevant(&apps, "pause it", Some("spotify"));
        assert_eq!(ranked.first().map(|w| w.app_catalog_id.as_str()), Some("spotify"));
    }

    /// Both Spotify and YouTube watched, "press play", no other signal: the
    /// caller must see two candidates and ask, not receive a silent winner.
    #[test]
    fn two_media_applications_both_rank_so_the_caller_can_ask() {
        let apps = vec![
            watched("spotify", "Spotify", WatchState::Watching),
            watched("youtube", "YouTube", WatchState::Watching),
        ];
        let ranked = rank_relevant(&apps, "press play", None);
        assert_eq!(ranked.len(), 2, "neither may be discarded without asking");
    }

    /// A closed application still appears — so it can be reported honestly —
    /// but must never outrank one that is actually running.
    #[test]
    fn a_running_application_outranks_a_closed_one() {
        let apps = vec![
            watched("spotify", "Spotify", WatchState::AppClosed),
            watched("youtube", "YouTube", WatchState::Watching),
        ];
        let ranked = rank_relevant(&apps, "press play", None);
        assert_eq!(ranked.first().map(|w| w.app_catalog_id.as_str()), Some("youtube"));
    }

    #[test]
    fn unrelated_applications_are_left_out_entirely() {
        let apps = vec![
            watched("spotify", "Spotify", WatchState::Watching),
            watched("figma", "Figma", WatchState::Watching),
        ];
        let ranked = rank_relevant(&apps, "press play", None);
        assert!(ranked.iter().all(|w| w.app_catalog_id != "figma"));
    }
}
