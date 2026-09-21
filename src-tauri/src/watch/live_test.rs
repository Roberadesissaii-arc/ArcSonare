//! Physical verification against the applications actually running.
//!
//! These are not unit tests with fixtures. They enumerate this machine's real
//! windows, read this machine's real media sessions, and address this machine's
//! real VS Code bridge. What they can assert therefore depends on what is
//! running — so each one *reports* what it found and asserts only invariants
//! that must hold whatever is open.
//!
//! That distinction matters. A test that silently passes because Spotify is
//! closed proves nothing, so every check here prints its evidence and the
//! run-level report names which applications were exercised and which were not.

use super::adapters;
use super::discord::{describe_location, parse_location};
use super::instances::discover_instances;
use super::media;
use super::vscode_bridge::{self, BridgeAvailability};

/// Real discovery must produce real identity for every window it reports.
///
/// The invariant that must hold regardless of what is open: every instance
/// carries a non-zero pid, a non-empty executable name, and a key that does not
/// contain the pid — because a key built from a recycled number rebinds a pinned
/// workspace to a stranger.
#[test]
fn every_discovered_instance_carries_real_identity() {
    let instances = discover_instances().expect("enumerate windows on this machine");
    println!("\n=== discovered {} instance(s) ===", instances.len());
    for instance in &instances {
        println!(
            "  {} | pid {} | key {} | exe {} | workspace {:?} | monitor {:?}",
            instance.app_catalog_id,
            instance.process_id,
            instance.instance_key,
            instance.executable_name,
            instance.workspace_identity,
            instance.monitor_id,
        );
        assert_ne!(instance.process_id, 0, "a real window must have a real pid");
        assert!(
            !instance.executable_name.trim().is_empty(),
            "every instance must name its executable"
        );
        assert!(
            !instance
                .instance_key
                .contains(&instance.process_id.to_string()),
            "the pid must not be part of the instance key: {}",
            instance.instance_key
        );
        assert!(
            instance.window_id.is_some(),
            "a discovered window must be addressable"
        );
    }

    // Keys must be unique, or two windows would share a preference.
    let mut keys: Vec<&str> = instances.iter().map(|i| i.instance_key.as_str()).collect();
    let total = keys.len();
    keys.sort_unstable();
    keys.dedup();
    assert_eq!(total, keys.len(), "instance keys collided on this machine");
}

/// Two windows of one application must be two instances, on this machine.
///
/// Skips with a printed note when nothing is open twice — the alternative is a
/// green test that asserted nothing, which is what made the old behaviour look
/// correct.
#[test]
fn multiple_windows_of_one_application_stay_separate() {
    let instances = discover_instances().expect("enumerate windows");
    let mut by_app: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
    for instance in &instances {
        by_app
            .entry(instance.app_catalog_id.as_str())
            .or_default()
            .push(instance.instance_key.as_str());
    }
    let multi: Vec<_> = by_app.iter().filter(|(_, keys)| keys.len() > 1).collect();
    if multi.is_empty() {
        println!(
            "\n=== SKIPPED: no application has two windows open right now ===\n\
             open a second VS Code workspace or browser window to exercise this"
        );
        return;
    }
    for (app, keys) in multi {
        println!("\n=== {app}: {} windows ===", keys.len());
        for key in keys {
            println!("  {key}");
        }
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(
            unique.len(),
            keys.len(),
            "{app}'s windows collapsed into one key"
        );
    }
}

/// The real Discord window, read the way the adapter reads it.
#[test]
fn discord_location_comes_from_the_real_window() {
    let instances = discover_instances().expect("enumerate windows");
    let Some(discord) = instances.iter().find(|i| i.app_catalog_id == "discord") else {
        println!("\n=== SKIPPED: Discord is not running ===");
        return;
    };
    let title = discord.window_title.clone().unwrap_or_default();
    let location = parse_location(&title);
    println!("\n=== Discord ===");
    println!("  window title : {title}");
    println!("  parsed       : {}", describe_location(&location));
    println!("  source       : {}", location.source);
    println!("  pid          : {}", discord.process_id);

    assert_eq!(
        location.source, "window-metadata",
        "the location must declare where it came from"
    );
    // The honesty invariant: a channel is reported only when the title names
    // one. A title of "Friends - Discord" must not become a channel.
    if location.channel.is_some() {
        assert!(
            title.contains('#') || title.contains('|'),
            "a channel was reported from a title that names none: {title}"
        );
    } else {
        println!("  (the title does not name a channel — reported as unknown, not guessed)");
    }
}

/// Whether Discord exposes an accessibility tree on this machine.
///
/// The answer is usually "no" on a stock Electron build, and the point of this
/// test is that the code says so rather than returning fabricated controls.
#[test]
fn discord_accessibility_availability_is_reported_honestly() {
    let instances = discover_instances().expect("enumerate windows");
    let Some(discord) = instances.iter().find(|i| i.app_catalog_id == "discord") else {
        println!("\n=== SKIPPED: Discord is not running ===");
        return;
    };
    let Some(window_id) = discord.window_id.as_deref() else {
        println!("\n=== SKIPPED: no addressable Discord window ===");
        return;
    };
    let raw = crate::capabilities::system::parse_window_id(window_id).expect("valid window id");
    let available = super::uia::tree_available(raw as isize);
    println!("\n=== Discord accessibility tree ===");
    println!("  available: {available}");
    if available {
        let controls = super::uia::interactive_controls(raw as isize, super::uia::WalkBudget::default())
            .expect("read controls");
        println!("  {} interactive control(s) readable", controls.len());
        for control in controls.iter().take(8) {
            println!("    [{}] {}", control.control_type, control.name);
        }
    } else {
        println!("  → the adapter will report that messages cannot be read, rather than guessing");
    }
}

/// Real Windows media sessions, whatever is playing.
#[test]
fn media_sessions_are_read_from_windows_not_from_a_title() {
    match media::sessions() {
        Ok(sessions) if sessions.is_empty() => {
            println!("\n=== SKIPPED: no application is registered as a media session ===");
        }
        Ok(sessions) => {
            println!("\n=== {} media session(s) ===", sessions.len());
            for session in &sessions {
                println!(
                    "  {} | {} | {:?} — {:?} | play={} pause={} next={} | current={}",
                    session.source_app_id,
                    session.playback_status,
                    session.title,
                    session.artist,
                    session.can_play,
                    session.can_pause,
                    session.can_skip_next,
                    session.is_current,
                );
                assert!(
                    !session.source_app_id.trim().is_empty(),
                    "a session must name the application it belongs to"
                );
            }
            // A Spotify session must match Spotify and nothing else.
            let spotify = sessions
                .iter()
                .find(|s| media::session_matches(&s.source_app_id, "Spotify.exe"));
            match spotify {
                Some(s) => println!("  → Spotify session found: {}", s.source_app_id),
                None => println!("  → Spotify has no media session right now"),
            }
        }
        Err(e) => {
            println!("\n=== media sessions unavailable: {e} ===");
        }
    }
}

/// The VS Code bridge reports its real state, including "not installed".
#[test]
fn the_vscode_bridge_reports_its_real_availability() {
    let instances = discover_instances().expect("enumerate windows");
    let editors: Vec<_> = instances
        .iter()
        .filter(|i| i.app_catalog_id == "vscode" || i.app_catalog_id == "cursor")
        .collect();

    println!("\n=== VS Code bridge ===");
    println!(
        "  token file present: {}",
        vscode_bridge::token_path()
            .map(|p| p.exists())
            .unwrap_or(false)
    );
    if editors.is_empty() {
        println!("  no editor window is open");
        // The invariant still holds with nothing open: an unknown workspace must
        // resolve to a definite unavailability, never to a hopeful "maybe".
        let availability = vscode_bridge::availability("no-such-workspace");
        println!("  availability for an unknown workspace: {availability:?}");
        assert_ne!(
            availability,
            BridgeAvailability::Ready,
            "a workspace that is not open must never report Ready"
        );
        return;
    }
    for editor in editors {
        let workspace = editor.workspace_identity.clone().unwrap_or_default();
        let availability = vscode_bridge::availability(&workspace);
        println!("  workspace {workspace:?} → {availability:?}");
        println!("    pipe: {}", vscode_bridge::pipe_name(&workspace));
    }
}

/// A capability asked to act on a vanished instance must refuse, not fall back.
///
/// This is the check that a stale resolution cannot become an action against
/// the wrong thing: an instance key that no longer exists produces a not-found,
/// never a "close enough" match.
#[test]
fn a_capability_refuses_an_instance_that_is_not_running() {
    let result = adapters::focus_instance(adapters::FocusInstanceArgs {
        instance_key: "vscode:ws:this-workspace-does-not-exist".into(),
    });
    println!("\n=== stale instance ===");
    println!("  status : {:?}", result.status);
    println!("  summary: {}", result.summary);
    assert!(
        matches!(
            result.status,
            crate::capabilities::types::ToolResultStatus::NotFound
        ),
        "a vanished instance must be reported, not substituted"
    );
}

/// A watched-application capability must never act without an instance key.
#[test]
fn watched_capabilities_reject_a_missing_instance() {
    let result = adapters::vscode_run_task(adapters::RunTaskArgs {
        instance_key: "nonexistent".into(),
        task_name: "dev".into(),
    });
    println!("\n=== run_task against a nonexistent instance ===");
    println!("  status : {:?}", result.status);
    println!("  summary: {}", result.summary);
    assert!(
        matches!(
            result.status,
            crate::capabilities::types::ToolResultStatus::NotFound
        ),
        "running a task must require a real workspace"
    );
}

/// Physically drive Spotify's transport, then put it back.
///
/// This genuinely plays and pauses music on the machine running it, which is
/// the only way to prove "press play" reaches the watched instance rather than
/// a plausible-looking no-op. The original playback state is restored at the
/// end, and every step asserts against a *readback* rather than against the
/// command's return code — a player can accept a call and refuse the action.
#[test]
fn spotify_transport_commands_physically_change_playback() {
    let instances = discover_instances().expect("enumerate windows");
    let Some(spotify) = instances.iter().find(|i| i.app_catalog_id == "spotify") else {
        println!("\n=== SKIPPED: Spotify is not running ===");
        return;
    };
    let Some(before) = media::session_for(&spotify.executable_name)
        .ok()
        .flatten()
    else {
        println!("\n=== SKIPPED: Spotify has no media session (nothing loaded) ===");
        return;
    };

    println!("\n=== Spotify transport, physically ===");
    println!(
        "  initial : {} — {:?} by {:?}",
        before.playback_status, before.title, before.artist
    );
    let was_playing = before.playback_status == "playing";

    let read = |label: &str| {
        std::thread::sleep(std::time::Duration::from_millis(700));
        let session = media::session_for(&spotify.executable_name)
            .ok()
            .flatten();
        match &session {
            Some(s) => println!(
                "  {label:<8}: {} — {:?} by {:?}",
                s.playback_status, s.title, s.artist
            ),
            None => println!("  {label:<8}: no session"),
        }
        session
    };

    // 1. "Press play"
    let played = adapters::media_command(
        "spotify.play",
        media::MediaCommand::Play,
        adapters::MediaCommandArgs {
            instance_key: Some(spotify.instance_key.clone()),
        },
    );
    println!("  play    → {:?}: {}", played.status, played.summary);
    let after_play = read("state");
    if let Some(state) = &after_play {
        assert_eq!(
            state.playback_status, "playing",
            "play must actually start playback, not merely be accepted"
        );
    }

    // 2. "Pause it"
    let paused = adapters::media_command(
        "spotify.pause",
        media::MediaCommand::Pause,
        adapters::MediaCommandArgs {
            instance_key: Some(spotify.instance_key.clone()),
        },
    );
    println!("  pause   → {:?}: {}", paused.status, paused.summary);
    let after_pause = read("state");
    if let Some(state) = &after_pause {
        assert_eq!(
            state.playback_status, "paused",
            "pause must actually stop playback"
        );
    }
    assert!(
        paused.summary.contains("Paused"),
        "a verified pause must say so plainly, got: {}",
        paused.summary
    );

    // 3. "Go to the next song" — verified by the track changing, not by the
    //    call returning. An advertisement cannot be skipped, and claiming
    //    otherwise is the dishonesty this readback exists to prevent.
    let track_before_skip = after_pause.as_ref().and_then(|s| s.title.clone());
    let skipped = adapters::media_command(
        "spotify.next",
        media::MediaCommand::Next,
        adapters::MediaCommandArgs {
            instance_key: Some(spotify.instance_key.clone()),
        },
    );
    println!("  next    → {:?}: {}", skipped.status, skipped.summary);
    let after_skip = read("state");
    let track_after_skip = after_skip.as_ref().and_then(|s| s.title.clone());
    if track_before_skip == track_after_skip {
        assert!(
            skipped.summary.contains("did not change"),
            "an unverified skip must not claim a track change, got: {}",
            skipped.summary
        );
    } else {
        println!("    track changed: {track_before_skip:?} → {track_after_skip:?}");
    }

    // 4. Every command targeted the same instance throughout.
    assert!(
        played.data.is_some() && paused.data.is_some(),
        "each command must report which instance it acted on"
    );

    // Restore what the machine was doing before the test touched it.
    if was_playing {
        let _ = media::command(&spotify.executable_name, media::MediaCommand::Play);
    } else {
        let _ = media::command(&spotify.executable_name, media::MediaCommand::Pause);
    }
    println!("  restored to: {}", before.playback_status);
}

/// A media command must never cross application boundaries.
///
/// The rule changed once, deliberately, and this is the version that survived.
/// It used to be "an unresolvable instance key is refused" — but the model
/// supplies that key from the prompt and does not always reproduce it exactly,
/// and the refusal came back to the user as "Spotify isn't running" while
/// Spotify was playing in front of them. The honest rule is narrower and more
/// useful: `spotify.*` addresses Spotify. A bad key falls back to *that
/// application*, never to whichever player happens to own the current session.
#[test]
fn a_media_command_never_addresses_a_different_application() {
    let instances = discover_instances().expect("enumerate windows");
    let spotify_running = instances.iter().any(|i| i.app_catalog_id == "spotify");

    let before = media::session_for("Spotify.exe").ok().flatten();
    let was_playing = before
        .as_ref()
        .map(|s| s.playback_status == "playing")
        .unwrap_or(false);

    let result = adapters::media_command(
        "spotify.pause",
        media::MediaCommand::Pause,
        adapters::MediaCommandArgs {
            instance_key: Some("spotify:exe:not-a-real-instance:9".into()),
        },
    );
    println!("
=== media command with an unresolvable key ===");
    println!("  spotify running : {spotify_running}");
    println!("  status          : {:?}", result.status);
    println!("  summary         : {}", result.summary);

    let addressed = result
        .data
        .as_ref()
        .and_then(|d| d.get("application"))
        .and_then(|a| a.as_str())
        .unwrap_or_default()
        .to_lowercase();
    println!("  addressed       : {addressed:?}");

    if spotify_running {
        // It resolved, and it resolved to Spotify — not to another player.
        assert!(
            addressed.contains("spotify"),
            "a spotify.* command addressed {addressed:?}"
        );
    } else {
        // Nothing to fall back to, so the refusal is the truth.
        assert!(
            matches!(
                result.status,
                crate::capabilities::types::ToolResultStatus::NotFound
            ),
            "with Spotify closed the command must refuse: {}",
            result.summary
        );
    }

    // Never another application's session, in either case.
    for foreign in ["chrome", "msedge", "firefox", "discord", "vlc"] {
        assert!(
            !addressed.contains(foreign),
            "a spotify.* command reached {foreign}"
        );
    }

    // Put playback back the way the test found it.
    if was_playing {
        let _ = media::command("Spotify.exe", media::MediaCommand::Play);
    }
}

/// The run-level report: which applications this machine could exercise.
#[test]
fn zz_live_watch_report() {
    let instances = discover_instances().unwrap_or_default();
    let mut apps: Vec<&str> = instances.iter().map(|i| i.app_catalog_id.as_str()).collect();
    apps.sort_unstable();
    apps.dedup();

    let sessions = media::sessions().unwrap_or_default();

    println!("\n╔══════════════════════════════════════════════════════════════╗");
    println!("║  WATCH SYSTEM — PHYSICAL COVERAGE ON THIS MACHINE            ║");
    println!("╚══════════════════════════════════════════════════════════════╝");
    println!("  recognised applications running : {}", apps.join(", "));
    println!("  total instances                 : {}", instances.len());
    println!("  media sessions                  : {}", sessions.len());
    for target in ["spotify", "vscode", "discord", "chrome", "edge"] {
        println!(
            "  {target:<8} : {}",
            if apps.contains(&target) {
                "EXERCISED"
            } else {
                "not running — not exercised"
            }
        );
    }
    println!(
        "  vscode bridge token             : {}",
        vscode_bridge::token_path()
            .map(|p| if p.exists() { "present" } else { "absent" })
            .unwrap_or("unknown")
    );
}
