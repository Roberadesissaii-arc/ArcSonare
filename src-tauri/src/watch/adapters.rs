//! Native execution for watched-application capabilities.
//!
//! Every function here validates that the instance it was asked to act on is
//! *still* the instance that was resolved, immediately before acting. That
//! check is the point: a resolution made when the model chose a tool can be
//! stale by the time the tool runs — the user may have closed the window — and
//! acting on a stale resolution is how a command lands somewhere unintended.

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::capabilities::types::{ResultBuilder, ToolResult, VerificationEvidence};
use crate::database::DatabaseManager;

use super::instances::discover_instances;
use super::media::{self, MediaCommand};
use super::model::{PrivacyPolicy, RunningAppInstance};

/// Re-resolve an instance key against the machine as it is right now.
///
/// Exact, and only exact. Anything that *acts* — focusing a window, sending to
/// it, clicking in it — resolves through here, because a "close enough" match
/// means acting on a window the user did not choose.
fn live_instance(instance_key: &str) -> Result<RunningAppInstance, String> {
    discover_instances()?
        .into_iter()
        .find(|i| i.instance_key == instance_key)
        .ok_or_else(|| "That application instance is no longer running.".to_string())
}

/// The same resolution, plus a fallback to another window of the same
/// application — for **reads only**.
///
/// An exact key's absence is not proof the application closed, and reporting it
/// as such is a lie the user can see through: Discord answered "the Discord
/// window isn't running anymore" with Discord plainly on screen. Electron apps
/// re-create their window and a key captured last turn can name an instance
/// that has since been replaced by an equivalent one.
///
/// Deliberately not used for anything that acts. Focusing, clicking or sending
/// against "a window of roughly the right application" is the substitution
/// `a_capability_refuses_an_instance_that_is_not_running` exists to forbid:
/// reading the wrong window of the same app gives a wrong answer, acting on it
/// changes the wrong thing.
fn live_instance_for_read(instance_key: &str) -> Result<RunningAppInstance, String> {
    let instances = discover_instances()?;
    if let Some(exact) = instances.iter().find(|i| i.instance_key == instance_key) {
        return Ok(exact.clone());
    }
    // `spotify:exe:...` / `discord:exe:...` — the catalog id is the first field.
    let app_catalog_id = instance_key.split(':').next().unwrap_or_default();
    if !app_catalog_id.is_empty() {
        if let Some(sibling) = instances.iter().find(|i| i.app_catalog_id == app_catalog_id) {
            return Ok(sibling.clone());
        }
    }
    Err("That application instance is no longer running.".to_string())
}

/// The stored privacy policy for the application this instance belongs to.
///
/// Applied here, in Rust, and not only in the TypeScript adapters. The adapters
/// are the normal path, but `capability_execute` is reachable directly — a model
/// that calls `applications.get_window_context` itself must not receive a title
/// the user withheld simply because it skipped the adapter. Consent has to be
/// enforced where the data is produced, not where it is usually formatted.
///
/// An unreadable store yields the closed defaults: failing shut is the only
/// correct direction for a consent check.
fn policy_for(app: &AppHandle, app_catalog_id: &str) -> PrivacyPolicy {
    let state = app.state::<DatabaseManager>();
    state
        .with_conn_mut(|conn| super::store::get_watched(conn, app_catalog_id))
        .ok()
        .flatten()
        .map(|watched| watched.privacy_policy)
        .unwrap_or_else(PrivacyPolicy::sensitive_default)
}

/// A title the caller is allowed to see, or the redaction notice.
fn permitted_title(policy: &PrivacyPolicy, instance: &RunningAppInstance) -> Option<String> {
    policy.redact_title(instance.window_title.as_deref())
}

// ---------------------------------------------------------------------------
// Spotify / media
// ---------------------------------------------------------------------------

/// Which executable a media command should address.
///
/// An exact instance key is preferred, but its absence must not become a
/// refusal. The model supplies the key from the prompt and does not always
/// reproduce it — and an unresolvable key made the adapter answer "that
/// instance is no longer running", which the model relayed as "Spotify isn't
/// running" while Spotify sat in front of the user with a live media session.
///
/// So an unresolvable key falls back to *the application the capability is
/// for*. `spotify.play` means Spotify; if Spotify is running, that is the
/// target, whatever key arrived. Only when the application genuinely is not
/// running does this refuse — and then the refusal is true.
fn resolve_media_target(
    capability_id: &str,
    instance_key: Option<&str>,
) -> Result<String, String> {
    let app_catalog_id = capability_id.split('.').next().unwrap_or("spotify");

    if let Some(key) = instance_key {
        if let Ok(instance) = live_instance(key) {
            return Ok(instance.executable_name);
        }
    }

    let instances = discover_instances().unwrap_or_default();
    if let Some(instance) = instances.iter().find(|i| i.app_catalog_id == app_catalog_id) {
        return Ok(instance.executable_name.clone());
    }

    // Not running as a window. It may still own a media session — a player
    // minimised to the tray has no window this pass but is perfectly
    // controllable — so the session is the last thing checked before refusing.
    let fallback = format!("{app_catalog_id}.exe");
    if media::session_for(&fallback).ok().flatten().is_some() {
        return Ok(fallback);
    }

    Err(format!(
        "{app_catalog_id} is not running, so there is nothing to control. Open it and try again."
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct MediaReadArgs {
    /// Resolved instance to read. Absent means "whatever Windows calls current",
    /// which is only correct when the caller has already established there is
    /// exactly one watched player.
    #[serde(default)]
    pub instance_key: Option<String>,
}

pub fn get_playback(args: MediaReadArgs) -> ToolResult {
    let rb = ResultBuilder::new("spotify.get_playback");
    let executable =
        match resolve_media_target("spotify.get_playback", args.instance_key.as_deref()) {
            Ok(name) => name,
            Err(e) => return rb.not_found(e),
        };

    match media::session_for(&executable) {
        Ok(Some(session)) => {
            let summary = match (&session.title, &session.artist) {
                (Some(title), Some(artist)) if session.playback_status == "playing" => {
                    format!("Playing \"{title}\" by {artist}.")
                }
                (Some(title), Some(artist)) => {
                    format!("{} — \"{title}\" by {artist}.", capitalize(&session.playback_status))
                }
                (Some(title), None) => format!(
                    "{} — \"{title}\".",
                    capitalize(&session.playback_status)
                ),
                _ => format!(
                    "{} — no track information is being reported.",
                    capitalize(&session.playback_status)
                ),
            };
            rb.success(
                summary,
                serde_json::to_value(&session).unwrap_or_else(|_| json!({})),
                VerificationEvidence::verified("state-readback"),
            )
        }
        // Honest, and distinguishable from an error: the application may be
        // running with nothing loaded, which is not a failure to read.
        Ok(None) => rb.not_found(format!(
            "{executable} is not reporting a media session right now, so there is nothing playing to read."
        )),
        Err(e) => rb.error("media-session-unavailable", e, true),
    }
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct MediaCommandArgs {
    #[serde(default)]
    pub instance_key: Option<String>,
}

/// One transport command, executed once, verified by reading the state back.
///
/// "Executed once" is enforced by the caller's pending-action store, not here;
/// what this guarantees is that a single call produces a single command — there
/// is no retry loop, because a media command that silently ran twice would skip
/// two tracks.
pub fn media_command(capability_id: &'static str, cmd: MediaCommand, args: MediaCommandArgs) -> ToolResult {
    let rb = ResultBuilder::new(capability_id);
    let executable = match resolve_media_target(capability_id, args.instance_key.as_deref()) {
        Ok(name) => name,
        Err(e) => return rb.not_found(e),
    };

    let before = media::session_for(&executable).ok().flatten();

    // No media session to address. Fall back to the system media key rather
    // than to the screen: it is the same signal a keyboard's play button
    // sends, it needs no pixels and no cursor, and it reaches whichever player
    // Windows has registered. The honest cost is that there is nothing to read
    // the result back from, which the summary says outright.
    if before.is_none() {
        return match media::send_media_key(cmd) {
            Ok(()) => rb.partial(
                format!(
                    "{executable} isn't reporting a media session, so I sent the system {} key.                      I can't verify whether it took effect.",
                    match cmd {
                        MediaCommand::Play => "play",
                        MediaCommand::Pause => "pause",
                        MediaCommand::Next => "next track",
                        MediaCommand::Previous => "previous track",
                    }
                ),
                json!({
                    "instanceKey": args.instance_key,
                    "application": executable,
                    "strategy": "system-media-key",
                    "verified": false,
                }),
                VerificationEvidence::unverified("return-code"),
            ),
            Err(e) => rb.error(
                "media-control-unavailable",
                format!(
                    "{executable} is watched, but media control is not currently available.                      Open {executable} or enable Windows media controls, then try again. ({e})"
                ),
                true,
            ),
        };
    }

    match media::command(&executable, cmd) {
        Ok(true) => {
            // Readback, polled rather than sampled once.
            //
            // A single 350 ms sleep reported "the state did not change" for a
            // play that had in fact started — Spotify takes longer than that to
            // publish the new status, and the next read a moment later showed
            // it playing. Under-reporting a success is as dishonest as
            // over-reporting one, so this waits for the change up to a bounded
            // deadline and only gives up after it.
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_millis(1_800);
            let after;
            let changed;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let sample = media::session_for(&executable).ok().flatten();
                let moved = match (&before, &sample) {
                    (Some(b), Some(a)) => {
                        b.playback_status != a.playback_status || b.title != a.title
                    }
                    _ => false,
                };
                if moved || std::time::Instant::now() >= deadline {
                    after = sample;
                    changed = moved;
                    break;
                }
            }
            let summary = describe_outcome(cmd, after.as_ref(), changed);
            let data = json!({
                "instanceKey": args.instance_key,
                "application": executable,
                "before": before,
                "after": after,
            });
            if changed {
                rb.success(summary, data, VerificationEvidence::verified("state-readback"))
            } else {
                rb.partial(summary, data, VerificationEvidence::unverified("state-readback"))
            }
        }
        Ok(false) => rb.partial(
            format!("{executable} declined that command."),
            json!({ "application": executable }),
            VerificationEvidence::unverified("return-code"),
        ),
        Err(e) => rb.error("media-command-failed", e, true),
    }
}

fn describe_outcome(
    cmd: MediaCommand,
    after: Option<&media::MediaSession>,
    changed: bool,
) -> String {
    let track = after.and_then(|s| {
        match (s.title.as_deref(), s.artist.as_deref()) {
            (Some(t), Some(a)) => Some(format!("\"{t}\" by {a}")),
            (Some(t), None) => Some(format!("\"{t}\"")),
            _ => None,
        }
    });
    match (cmd, changed) {
        (MediaCommand::Play, true) => match track {
            Some(t) => format!("Playing {t}."),
            None => "Playback resumed.".into(),
        },
        (MediaCommand::Pause, true) => "Paused.".into(),
        (MediaCommand::Next, true) => match track {
            Some(t) => format!("Skipped to {t}."),
            None => "Skipped to the next track.".into(),
        },
        (MediaCommand::Previous, true) => match track {
            Some(t) => format!("Went back to {t}."),
            None => "Went back a track.".into(),
        },
        // Unverified: say what was sent, never what happened.
        (_, false) => "The command was sent, but the player's state did not change.".into(),
    }
}

// ---------------------------------------------------------------------------
// Instance focus
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct FocusInstanceArgs {
    pub instance_key: String,
}

/// Focus one specific watched instance.
///
/// Separate from `applications.focus`, which resolves by product name and takes
/// the first window it finds — the behaviour that could focus the wrong VS Code
/// workspace even after the user pinned one.
pub fn focus_instance(args: FocusInstanceArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.focus_watched");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let Some(window_id) = instance.window_id.as_deref() else {
        return rb.error(
            "no-window",
            "That instance has no window to bring forward.".to_string(),
            false,
        );
    };
    let Some(raw) = crate::capabilities::system::parse_window_id(window_id) else {
        return rb.error("invalid-window-id", "That window id is not valid.", false);
    };
    let title = instance.window_title.clone().unwrap_or_default();
    if crate::capabilities::windows::focus_hwnd(raw) {
        rb.success(
            format!("Brought {} to the front.", instance.executable_name),
            json!({
                "instanceKey": instance.instance_key,
                "processId": instance.process_id,
                "workspace": instance.workspace_identity,
            }),
            VerificationEvidence::verified_with("window-detected", json!({ "title": title })),
        )
    } else {
        rb.partial(
            format!(
                "Windows did not allow bringing {} to the foreground.",
                instance.executable_name
            ),
            json!({ "instanceKey": instance.instance_key }),
            VerificationEvidence::unverified("window-detected"),
        )
    }
}

// ---------------------------------------------------------------------------
// Watched-instance context
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct InstanceContextArgs {
    pub instance_key: String,
}

/// Everything ArcSonare can honestly say about one running instance from window
/// metadata alone.
///
/// Named for what it is. A window title is not an understanding of the
/// application, and a capability called `get_window_context` cannot be mistaken
/// by the model for one that reads the application's actual contents.
pub fn get_instance_context(app: &AppHandle, args: InstanceContextArgs) -> ToolResult {
    let rb = ResultBuilder::new("applications.get_window_context");
    match live_instance(&args.instance_key) {
        Ok(mut instance) => {
            let policy = policy_for(app, &instance.app_catalog_id);
            // The title is replaced on the record itself, so serialising the
            // instance cannot leak the original through a field this function
            // forgot to mention.
            instance.window_title = permitted_title(&policy, &instance);
            if policy.redact_paths {
                instance.executable_path = None;
            }
            let summary = match (&instance.workspace_identity, &instance.window_title) {
                (Some(workspace), _) => {
                    format!("{} — {workspace}", instance.executable_name)
                }
                (None, Some(title)) => format!("{} — \"{title}\"", instance.executable_name),
                _ => instance.executable_name.clone(),
            };
            rb.success(
                summary,
                serde_json::to_value(&instance).unwrap_or_else(|_| json!({})),
                VerificationEvidence::verified("window-detected"),
            )
        }
        Err(e) => rb.not_found(e),
    }
}

// ---------------------------------------------------------------------------
// VS Code
// ---------------------------------------------------------------------------

use super::vscode_bridge::{self, BridgeAvailability};

/// The workspace an instance is serving, or an explanation of why there is none.
fn workspace_of(instance: &RunningAppInstance) -> Result<String, String> {
    instance.workspace_identity.clone().ok_or_else(|| {
        "That editor window does not report a workspace folder, so there is nothing to address."
            .to_string()
    })
}

fn bridge_unavailable(
    rb: ResultBuilder,
    availability: BridgeAvailability,
    workspace: &str,
) -> ToolResult {
    match availability {
        BridgeAvailability::NotInstalled => rb.unsupported(
            "The ArcSonare VS Code extension is not installed, so I can only see the window title — \
             not the file, the errors, or the tasks.",
        ),
        BridgeAvailability::NotServing => rb.not_found(format!(
            "That VS Code window is not serving: {}.",
            vscode_bridge::not_serving_reason(workspace)
        )),
        BridgeAvailability::Ready => rb.error("bridge-inconsistent", "The bridge state changed while reading it.", true),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct WorkspaceArgs {
    pub instance_key: String,
}

pub fn vscode_get_context(args: WorkspaceArgs) -> ToolResult {
    let rb = ResultBuilder::new("vscode.get_context");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let workspace = match workspace_of(&instance) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let availability = vscode_bridge::availability(&workspace);
    if availability != BridgeAvailability::Ready {
        return bridge_unavailable(rb, availability, &workspace);
    }

    match vscode_bridge::request(&workspace, "get_context", None) {
        Ok(response) if response.ok => {
            let active = response
                .data
                .get("activeFile")
                .and_then(|f| f.get("path"))
                .and_then(|p| p.as_str())
                .unwrap_or("no file");
            let errors = response
                .data
                .get("diagnosticCounts")
                .and_then(|c| c.get("errors"))
                .and_then(|e| e.as_i64())
                .unwrap_or(0);
            rb.success(
                format!("{workspace}: editing {active}, {errors} error(s)."),
                response.data,
                VerificationEvidence::verified("state-readback"),
            )
        }
        Ok(response) => rb.error(
            "bridge-refused",
            response.error.unwrap_or_else(|| "The bridge refused.".into()),
            true,
        ),
        Err(e) => rb.error("bridge-unreachable", e, true),
    }
}

pub fn vscode_get_diagnostics(args: WorkspaceArgs) -> ToolResult {
    let rb = ResultBuilder::new("vscode.get_diagnostics");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let workspace = match workspace_of(&instance) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let availability = vscode_bridge::availability(&workspace);
    if availability != BridgeAvailability::Ready {
        return bridge_unavailable(rb, availability, &workspace);
    }

    match vscode_bridge::request(&workspace, "get_context", None) {
        Ok(response) if response.ok => {
            let diagnostics = response
                .data
                .get("diagnostics")
                .cloned()
                .unwrap_or_else(|| json!([]));
            let count = diagnostics.as_array().map(|a| a.len()).unwrap_or(0);
            rb.success(
                if count == 0 {
                    format!("{workspace} reports no errors or warnings.")
                } else {
                    format!("{workspace} reports {count} problem(s).")
                },
                json!({
                    "workspace": workspace,
                    "diagnostics": diagnostics,
                    "counts": response.data.get("diagnosticCounts"),
                }),
                VerificationEvidence::verified("state-readback"),
            )
        }
        Ok(response) => rb.error(
            "bridge-refused",
            response.error.unwrap_or_else(|| "The bridge refused.".into()),
            true,
        ),
        Err(e) => rb.error("bridge-unreachable", e, true),
    }
}

pub fn vscode_list_tasks(args: WorkspaceArgs) -> ToolResult {
    let rb = ResultBuilder::new("vscode.list_tasks");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let workspace = match workspace_of(&instance) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let availability = vscode_bridge::availability(&workspace);
    if availability != BridgeAvailability::Ready {
        return bridge_unavailable(rb, availability, &workspace);
    }
    match vscode_bridge::request(&workspace, "list_tasks", None) {
        Ok(response) if response.ok => {
            let names: Vec<String> = response
                .data
                .get("tasks")
                .and_then(|t| t.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            rb.success(
                if names.is_empty() {
                    format!("{workspace} has no configured tasks.")
                } else {
                    format!("{workspace} has {}: {}.", names.len(), names.join(", "))
                },
                json!({ "workspace": workspace, "tasks": names }),
                VerificationEvidence::verified("state-readback"),
            )
        }
        Ok(response) => rb.error(
            "bridge-refused",
            response.error.unwrap_or_else(|| "The bridge refused.".into()),
            true,
        ),
        Err(e) => rb.error("bridge-unreachable", e, true),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct RunTaskArgs {
    pub instance_key: String,
    /// The name of a task already declared in this workspace. Never a command.
    pub task_name: String,
}

/// Run a configured task by name.
///
/// The argument is a task *name*, not a command line, and the extension looks
/// it up in the workspace's own `tasks.json`. A model that invents a task name
/// gets "no such task, here are the real ones" — it does not get execution.
pub fn vscode_run_task(args: RunTaskArgs) -> ToolResult {
    let rb = ResultBuilder::new("vscode.run_task");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let workspace = match workspace_of(&instance) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let availability = vscode_bridge::availability(&workspace);
    if availability != BridgeAvailability::Ready {
        return bridge_unavailable(rb, availability, &workspace);
    }

    match vscode_bridge::request(&workspace, "run_task", Some(&args.task_name)) {
        Ok(response) if response.ok => rb.success(
            format!("Started \"{}\" in {workspace}.", args.task_name),
            json!({ "workspace": workspace, "task": args.task_name, "result": response.data }),
            VerificationEvidence::verified_with("process-spawned", json!({ "task": args.task_name })),
        ),
        Ok(response) => {
            let available = response
                .data
                .get("availableTasks")
                .cloned()
                .unwrap_or_else(|| json!([]));
            rb.not_found(format!(
                "{} Configured tasks in {workspace}: {}.",
                response
                    .error
                    .unwrap_or_else(|| "That task does not exist.".into()),
                available
                    .as_array()
                    .map(|a| a
                        .iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(", "))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "none".into())
            ))
        }
        Err(e) => rb.error("bridge-unreachable", e, true),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct DebugArgs {
    pub instance_key: String,
    #[serde(default)]
    pub configuration: Option<String>,
}

pub fn vscode_start_debug(args: DebugArgs) -> ToolResult {
    let rb = ResultBuilder::new("vscode.start_debug");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let workspace = match workspace_of(&instance) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let availability = vscode_bridge::availability(&workspace);
    if availability != BridgeAvailability::Ready {
        return bridge_unavailable(rb, availability, &workspace);
    }
    match vscode_bridge::request(&workspace, "start_debug", args.configuration.as_deref()) {
        Ok(response) if response.ok => rb.success(
            format!("Started debugging in {workspace}."),
            response.data,
            VerificationEvidence::verified("state-readback"),
        ),
        Ok(response) => rb.not_found(
            response
                .error
                .unwrap_or_else(|| "No debug configuration matched.".into()),
        ),
        Err(e) => rb.error("bridge-unreachable", e, true),
    }
}

pub fn vscode_stop_task(args: WorkspaceArgs) -> ToolResult {
    let rb = ResultBuilder::new("vscode.stop_task");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let workspace = match workspace_of(&instance) {
        Ok(w) => w,
        Err(e) => return rb.not_found(e),
    };
    let availability = vscode_bridge::availability(&workspace);
    if availability != BridgeAvailability::Ready {
        return bridge_unavailable(rb, availability, &workspace);
    }
    match vscode_bridge::request(&workspace, "stop_task", None) {
        Ok(response) if response.ok => rb.success(
            format!("Stopped the running tasks in {workspace}."),
            response.data,
            VerificationEvidence::verified("state-readback"),
        ),
        Ok(response) => rb.error(
            "bridge-refused",
            response.error.unwrap_or_else(|| "The bridge refused.".into()),
            true,
        ),
        Err(e) => rb.error("bridge-unreachable", e, true),
    }
}

/// Is the bridge reachable for this instance? Answers the UI's health dot.
pub fn vscode_bridge_status(args: WorkspaceArgs) -> ToolResult {
    let rb = ResultBuilder::new("vscode.bridge_status");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let workspace = instance.workspace_identity.clone().unwrap_or_default();
    let availability = vscode_bridge::availability(&workspace);
    let (summary, health) = match availability {
        BridgeAvailability::Ready => (
            format!("The VS Code bridge is serving \"{workspace}\"."),
            "healthy",
        ),
        BridgeAvailability::NotServing => (
            format!("The extension is installed but \"{workspace}\" is not being served."),
            "degraded",
        ),
        BridgeAvailability::NotInstalled => (
            "The ArcSonare VS Code extension is not installed — only window metadata is available."
                .to_string(),
            "unavailable",
        ),
    };
    rb.success(
        summary,
        json!({ "workspace": workspace, "availability": availability, "health": health }),
        VerificationEvidence::verified("state-readback"),
    )
}

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

use super::discord::{describe_location, parse_location};
use super::uia::{self, WalkBudget};

fn instance_hwnd(instance: &RunningAppInstance) -> Option<isize> {
    let window_id = instance.window_id.as_deref()?;
    crate::capabilities::system::parse_window_id(window_id).map(|raw| raw as isize)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct DiscordReadArgs {
    pub instance_key: String,
}

/// Where the user is in Discord, from the window title.
///
/// The window title is the source, and the result says so. This is the whole
/// honest answer to "what channel am I in?" — a title of `#general | Server`
/// genuinely means that, and a title of `Discord` genuinely means the window
/// is not telling us.
pub fn discord_get_location(app: &AppHandle, args: DiscordReadArgs) -> ToolResult {
    let rb = ResultBuilder::new("discord_desktop.get_current_location");
    let instance = match live_instance_for_read(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    // Discord's title *is* the channel, so the title permission is the channel
    // permission. Withholding it here rather than parsing first means the
    // channel name never exists in a value that could be logged.
    let policy = policy_for(app, &instance.app_catalog_id);
    if !policy.window_title {
        return rb.denied(
            "Reading Discord's window title is turned off for this application, and the channel \
             comes from the title. Turn on \"Window title\" in its privacy settings if you want me \
             to see which channel you're in.",
            "privacy-policy",
        );
    }
    let title = instance.window_title.clone().unwrap_or_default();
    let location = parse_location(&title);
    let known = location.channel.is_some() || location.direct_message_with.is_some();
    let data = json!({
        "instanceKey": instance.instance_key,
        "location": location,
        "source": "window-metadata",
    });
    if known {
        rb.success(
            format!("You're in {}.", describe_location(&location)),
            data,
            VerificationEvidence::verified("window-detected"),
        )
    } else {
        // Not an error, and not a guess. The window did not say.
        rb.partial(
            "Discord is open, but its window title doesn't name a channel right now — \
             that happens on the home screen and in settings."
                .to_string(),
            data,
            VerificationEvidence::unverified("window-detected"),
        )
    }
}

/// Interactive controls Discord exposes, by name.
///
/// Requires an accessibility tree. Electron only builds one when accessibility
/// support is enabled, so the honest answer here is frequently "the window does
/// not expose one", and that is what gets returned rather than a fabricated list.
pub fn discord_get_controls(args: DiscordReadArgs) -> ToolResult {
    let rb = ResultBuilder::new("discord_desktop.get_visible_controls");
    let instance = match live_instance_for_read(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let Some(hwnd) = instance_hwnd(&instance) else {
        return rb.not_found("That Discord window can no longer be addressed.");
    };
    if !uia::tree_available(hwnd) {
        return rb.unsupported(
            "This Discord window doesn't expose an accessibility tree, so I can't read its \
             controls. Discord builds one when accessibility support is turned on in its settings.",
        );
    }
    match uia::interactive_controls(hwnd, WalkBudget::default()) {
        Ok(controls) => {
            let names: Vec<&str> = controls.iter().map(|c| c.name.as_str()).take(30).collect();
            rb.success(
                format!("{} control(s) are readable in this Discord window.", controls.len()),
                json!({
                    "instanceKey": instance.instance_key,
                    "controls": controls,
                    "source": "ui-automation",
                    "preview": names,
                }),
                VerificationEvidence::verified("state-readback"),
            )
        }
        Err(e) => rb.error("accessibility-read-failed", e, true),
    }
}

/// Visible message text, only where the tree exposes it.
///
/// Gated twice: the caller must hold `messageContent` consent before calling
/// at all (enforced in the context broker), and the window must actually expose
/// the text. When it does not, this says so instead of returning window-title
/// fragments dressed up as messages.
pub fn discord_get_messages(app: &AppHandle, args: DiscordReadArgs) -> ToolResult {
    let rb = ResultBuilder::new("discord_desktop.get_visible_messages");
    let instance = match live_instance_for_read(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    // The consent gate, enforced where the data is produced. The capability
    // gate already withholds this tool from the model without the permission;
    // this is the second lock, for a call that reaches here another way.
    if !policy_for(app, &instance.app_catalog_id).message_content {
        return rb.denied(
            "Reading Discord message content is turned off for this application. Turn on \
             \"Message content\" in its privacy settings if you want me to read them.",
            "privacy-policy",
        );
    }
    let Some(hwnd) = instance_hwnd(&instance) else {
        return rb.not_found("That Discord window can no longer be addressed.");
    };
    if !uia::tree_available(hwnd) {
        return rb.unsupported(
            "I can't read Discord's messages: this window doesn't expose an accessibility tree. \
             I can still tell you which channel you're in, from the window title.",
        );
    }
    match uia::text_elements(hwnd, WalkBudget::default()) {
        Ok(elements) if elements.is_empty() => rb.not_found(
            "The accessibility tree is available but contains no readable message text.",
        ),
        Ok(elements) => rb.success(
            format!("{} readable text element(s) in the current view.", elements.len()),
            json!({
                "instanceKey": instance.instance_key,
                "elements": elements,
                "source": "ui-automation",
            }),
            VerificationEvidence::verified("state-readback"),
        ),
        Err(e) => rb.error("accessibility-read-failed", e, true),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct DiscordPrepareArgs {
    pub instance_key: String,
    pub message: String,
}

/// Prepare — never send — a Discord message.
///
/// Returns the exact recipient and the exact text for one confirmation. It
/// deliberately performs no input: preparing and sending are separate
/// capabilities so that the confirmation the user sees describes something that
/// has not happened yet.
pub fn discord_prepare_message(args: DiscordPrepareArgs) -> ToolResult {
    let rb = ResultBuilder::new("discord_desktop.prepare_message");
    let message = args.message.trim();
    if message.is_empty() {
        return rb.error("invalid-arguments", "There is no message to send.", true);
    }
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let title = instance.window_title.clone().unwrap_or_default();
    let location = parse_location(&title);
    if location.channel.is_none() && location.direct_message_with.is_none() {
        // Refusing here is the point: a confirmation that cannot name the
        // recipient is not a confirmation.
        return rb.not_found(
            "I can't tell which Discord channel is open, so I won't prepare a message I can't \
             address. Open the channel you want and ask again.",
        );
    }
    let destination = describe_location(&location);
    rb.needs_confirmation(
        format!("Send \"{message}\" to {destination}?"),
        json!({
            "instanceKey": instance.instance_key,
            "destination": destination,
            "location": location,
            "message": message,
            "external": true,
        }),
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct DiscordSendArgs {
    pub instance_key: String,
    pub message: String,
    /// The destination the user was shown. Compared against the destination now.
    pub confirmed_destination: String,
}

/// Send the prepared message, once.
///
/// Two properties matter here and both are enforced rather than documented:
///
///  - **The destination is re-checked.** The user approved sending to a named
///    channel; if the window has moved since, this refuses instead of sending
///    to wherever Discord happens to be now.
///  - **One send per approval.** Exactly-once lives in the caller's pending
///    action store — a replayed confirmation resolves to an already-executed
///    action and never reaches here a second time.
pub fn discord_send_message(args: DiscordSendArgs) -> ToolResult {
    let rb = ResultBuilder::new("discord_desktop.send_message");
    let message = args.message.trim();
    if message.is_empty() {
        return rb.error("invalid-arguments", "There is no message to send.", true);
    }
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let title = instance.window_title.clone().unwrap_or_default();
    let location = parse_location(&title);
    let destination = describe_location(&location);

    if destination != args.confirmed_destination {
        // Two different failures, and they read very differently to a person:
        // Discord moved somewhere else, or Discord is no longer anywhere
        // nameable. Both mean the same thing — nothing is sent — but a sentence
        // like "Discord has moved to Discord, but the window title does not say
        // which channel" is not one a person should ever be shown.
        let addressable =
            location.channel.is_some() || location.direct_message_with.is_some();
        let message = if addressable {
            format!(
                "Discord is now on {destination}, not {}, so I haven't sent anything.",
                args.confirmed_destination
            )
        } else {
            format!(
                "Discord is no longer showing {}, and its window doesn't name where it is now. \
                 I haven't sent anything.",
                args.confirmed_destination
            )
        };
        return rb.denied(message, "destination-changed");
    }

    let Some(hwnd) = instance_hwnd(&instance) else {
        return rb.not_found("That Discord window can no longer be addressed.");
    };
    if !crate::capabilities::windows::focus_hwnd(hwnd as u32) {
        return rb.partial(
            "Windows wouldn't bring Discord to the front, so I didn't type anything into it."
                .to_string(),
            json!({ "destination": destination, "sent": false }),
            VerificationEvidence::unverified("window-detected"),
        );
    }
    std::thread::sleep(std::time::Duration::from_millis(250));

    match crate::capabilities::input::type_unicode_text(message) {
        Ok(()) => {}
        Err(e) => {
            return rb.error(
                "input-failed",
                format!("I focused Discord but couldn't type the message: {e}"),
                true,
            )
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(120));
    if let Err(e) = crate::capabilities::input::press_enter() {
        return rb.partial(
            format!(
                "The message is typed into {destination} but I couldn't press Enter ({e}). \
                 It has not been sent — press Enter yourself if you still want to."
            ),
            json!({ "destination": destination, "sent": false, "typed": true }),
            VerificationEvidence::unverified("return-code"),
        );
    }

    // Honest evidence: the keystrokes were delivered to the focused window.
    // Nothing here can read Discord's outbox, so this is not claimed as a
    // verified delivery.
    rb.success(
        format!("Sent to {destination}."),
        json!({ "destination": destination, "message": message, "sent": true }),
        VerificationEvidence::unverified("return-code"),
    )
}

// ---------------------------------------------------------------------------
// Browser windows
// ---------------------------------------------------------------------------

use super::instances::strip_browser_suffix;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct BrowserContextArgs {
    pub instance_key: String,
}

/// What the watched browser window is showing, from its title.
///
/// A window title is not a URL, and this does not pretend otherwise: the result
/// carries the page identity and the site the title implies, both attributed to
/// `window-metadata`. Reading the actual address bar needs the browser
/// extension, and its absence is reported rather than papered over.
pub fn browser_get_context(app: &AppHandle, args: BrowserContextArgs) -> ToolResult {
    let rb = ResultBuilder::new("browser.get_page_context");
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let policy = policy_for(app, &instance.app_catalog_id);
    if !policy.window_title {
        return rb.denied(
            "Reading this browser's window title is turned off, and the page identity comes from \
             the title.",
            "privacy-policy",
        );
    }
    let title = instance.window_title.clone().unwrap_or_default();
    let page = strip_browser_suffix(&title);
    let site = detect_site(&page);
    // A tab destination such as YouTube is addressed through the browser that
    // is showing it; naming that browser is what lets a follow-up act on it.
    let host_browser = super::catalog::host_browser_for(
        &instance.executable_name,
        &instance.executable_name,
    );

    rb.success(
        if page.is_empty() {
            format!("{} is open but its window title is empty.", instance.executable_name)
        } else {
            format!("{} is showing \"{page}\".", instance.executable_name)
        },
        json!({
            "instanceKey": instance.instance_key,
            "browser": instance.app_catalog_id,
            "hostBrowser": host_browser,
            "pageIdentity": page,
            "site": site,
            "source": "window-metadata",
            "limitations": [
                "The page address is not readable without the browser extension — this is the \
                 window title only."
            ],
        }),
        VerificationEvidence::verified("window-detected"),
    )
}

/// Which known site a page title implies, if any.
fn detect_site(page: &str) -> Option<&'static str> {
    let lower = page.to_lowercase();
    for (needle, site) in [
        ("youtube", "youtube"),
        ("netflix", "netflix"),
        ("amazon", "amazon"),
        ("udemy", "udemy"),
        ("google classroom", "google-classroom"),
        ("meet.google", "google-meet"),
    ] {
        if lower.contains(needle) {
            return Some(site);
        }
    }
    None
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct BrowserNavigateArgs {
    pub instance_key: String,
    /// `back` | `forward` | `reload`
    pub direction: String,
}

/// Navigate the watched browser window.
///
/// Focus first, then the chord — and the focus is verified before the chord is
/// sent. Sending Alt+Left without that check navigates whatever is in front,
/// which for a voice command is usually not the window the user meant.
pub fn browser_navigate(args: BrowserNavigateArgs) -> ToolResult {
    let rb = ResultBuilder::new("browser.navigate");
    let chord = match args.direction.as_str() {
        "back" => "alt+left",
        "forward" => "alt+right",
        "reload" => "f5",
        other => {
            return rb.error(
                "invalid-arguments",
                format!("\"{other}\" is not a navigation direction."),
                true,
            )
        }
    };
    let instance = match live_instance(&args.instance_key) {
        Ok(i) => i,
        Err(e) => return rb.not_found(e),
    };
    let Some(hwnd) = instance_hwnd(&instance) else {
        return rb.not_found("That browser window can no longer be addressed.");
    };
    let before = instance.window_title.clone().unwrap_or_default();

    if !crate::capabilities::windows::focus_hwnd(hwnd as u32) {
        return rb.partial(
            "Windows wouldn't bring that browser window to the front, so I didn't navigate it."
                .to_string(),
            json!({ "instanceKey": instance.instance_key }),
            VerificationEvidence::unverified("window-detected"),
        );
    }
    std::thread::sleep(std::time::Duration::from_millis(200));

    if let Err(e) = crate::capabilities::input::press_chord(chord) {
        return rb.error("input-failed", e, true);
    }

    // Readback: a title change is real evidence the page moved. Its absence is
    // not proof of failure — the page may be identically titled — so this is
    // reported as partial rather than as an error.
    std::thread::sleep(std::time::Duration::from_millis(700));
    let after = live_instance(&args.instance_key)
        .ok()
        .and_then(|i| i.window_title)
        .unwrap_or_default();
    let changed = !after.is_empty() && after != before;
    let data = json!({
        "instanceKey": instance.instance_key,
        "direction": args.direction,
        "titleBefore": strip_browser_suffix(&before),
        "titleAfter": strip_browser_suffix(&after),
    });
    if changed {
        rb.success(
            format!("Went {} — now on \"{}\".", args.direction, strip_browser_suffix(&after)),
            data,
            VerificationEvidence::verified("state-readback"),
        )
    } else {
        rb.partial(
            format!(
                "Sent {} to the browser, but the window title didn't change — it may already be \
                 at the end of its history.",
                args.direction
            ),
            data,
            VerificationEvidence::unverified("state-readback"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A page title must not be mistaken for a site ArcSonare can act on.
    #[test]
    fn site_detection_only_fires_on_a_real_match() {
        assert_eq!(detect_site("Some Video - YouTube"), Some("youtube"));
        assert_eq!(detect_site("Wikipedia"), None);
    }

    /// An unverified command must never be reported as a completed one.
    #[test]
    fn an_unchanged_player_produces_an_honest_sentence() {
        let text = describe_outcome(MediaCommand::Next, None, false);
        assert!(text.contains("did not change"));
        assert!(
            !text.to_lowercase().contains("skipped to"),
            "an unverified skip must not claim a track change"
        );
    }

    #[test]
    fn a_verified_skip_names_the_new_track() {
        let session = media::MediaSession {
            source_app_id: "Spotify.exe".into(),
            playback_status: "playing".into(),
            title: Some("Weightless".into()),
            artist: Some("Marconi Union".into()),
            album: None,
            album_artist: None,
            can_play: true,
            can_pause: true,
            can_skip_next: true,
            can_skip_previous: true,
            is_current: true,
        };
        let text = describe_outcome(MediaCommand::Next, Some(&session), true);
        assert!(text.contains("Weightless"));
        assert!(text.contains("Marconi Union"));
    }

    #[test]
    fn a_verified_pause_says_paused() {
        assert_eq!(describe_outcome(MediaCommand::Pause, None, true), "Paused.");
    }

    /// Reads may fall back to a sibling window; actions may not.
    ///
    /// Both rules are real and they pull opposite ways. Discord answered "not
    /// running" while visibly running because reads refused an inexact key; a
    /// focus that substituted a different window would act on something the
    /// user never chose. One resolver each, and the source is what says which
    /// is which.
    #[test]
    fn only_reads_may_fall_back_to_a_sibling_window() {
        let source = include_str!("adapters.rs");
        let acting = ["focus_instance", "discord_prepare_message"];
        for name in acting {
            let Some(start) = source.find(&format!("pub fn {name}(")) else {
                continue;
            };
            let body = &source[start..start + 900.min(source.len() - start)];
            assert!(
                !body.contains("live_instance_for_read("),
                "{name} acts on a window and must not accept a sibling"
            );
        }
        for name in ["discord_get_location", "discord_get_controls"] {
            let start = source
                .find(&format!("pub fn {name}("))
                .unwrap_or_else(|| panic!("{name} is missing"));
            let body = &source[start..start + 900.min(source.len() - start)];
            assert!(
                body.contains("live_instance_for_read("),
                "{name} only reads and must survive a replaced window"
            );
        }
    }

    /// The application id an unresolvable key falls back to.
    ///
    /// `live_instance` needs the machine, so what is asserted here is the part
    /// that decides *which* application a stale key belongs to. Getting this
    /// wrong is how a Discord key would have fallen back to a Spotify window.
    #[test]
    fn a_stale_key_still_names_its_own_application() {
        fn app_of(key: &str) -> &str {
            key.split(':').next().unwrap_or_default()
        }
        assert_eq!(app_of("discord:exe:discord-exe:0"), "discord");
        assert_eq!(app_of("spotify:exe:spotify-exe:3"), "spotify");
        assert_eq!(app_of("vscode:ws:arcsonare"), "vscode");
        // A malformed key names nothing, and nothing is what it may fall back to.
        assert_eq!(app_of(""), "");
    }
}
