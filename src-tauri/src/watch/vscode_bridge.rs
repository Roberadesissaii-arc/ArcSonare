//! The VS Code bridge: a local, authenticated, per-workspace named pipe.
//!
//! Design constraints, and why each one is here:
//!
//!  - **A named pipe, not a localhost port.** A TCP listener on 127.0.0.1 is
//!    reachable by every process on the machine and by any page the user has
//!    open; `\\.\pipe\...` is not routable and carries the caller's identity.
//!  - **A shared secret in a user-only file.** The pipe name is guessable, so
//!    the token is what proves the peer is the extension ArcSonare installed
//!    rather than anything else that opened the pipe first.
//!  - **One pipe per window, named after the workspace.** A single global pipe
//!    would answer for whichever editor connected last, which is precisely the
//!    "ran the task in the wrong workspace" failure this exists to prevent.
//!
//! The extension lives in `integrations/vscode-arcsonare`. When it is not
//! installed there is no bridge, and the adapter says so instead of guessing
//! from the window title.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

const PIPE_PREFIX: &str = r"\\.\pipe\arcsonare-vscode-";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Where the shared secret lives. Written by the extension on activation.
///
/// Under `%LOCALAPPDATA%`, which is per-user: another account on this machine
/// cannot read it, so another account cannot drive this user's editor.
pub fn token_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(
        PathBuf::from(base)
            .join("ArcSonare")
            .join("vscode-bridge.token"),
    )
}

fn read_token() -> Option<String> {
    let path = token_path()?;
    let token = std::fs::read_to_string(path).ok()?;
    let token = token.trim().to_string();
    if token.len() < 16 {
        // A short or empty token is not a usable secret. Refusing here is
        // better than sending it: a bridge that accepts a blank token is worse
        // than no bridge.
        return None;
    }
    Some(token)
}

/// Pipe name for one workspace, derived the same way on both sides.
pub fn pipe_name(workspace_identity: &str) -> String {
    let slug: String = workspace_identity
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-');
    format!("{PIPE_PREFIX}{slug}")
}

#[derive(Debug, Serialize)]
struct BridgeRequest<'a> {
    token: &'a str,
    /// `get_context` | `list_tasks` | `run_task` | `focus_file` | `save_file` |
    /// `stop_task` | `start_debug`
    command: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    argument: Option<&'a str>,
    /// What the caller believes it is talking to. The extension refuses when it
    /// does not match, so a pipe-name collision cannot act on another folder.
    workspace: &'a str,
}

#[derive(Debug, Deserialize)]
pub struct BridgeResponse {
    pub ok: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Whether the bridge is reachable at all.
///
/// Distinguishes three states the adapter must report differently: the
/// extension is not installed (no token), it is installed but this window is
/// not serving (no pipe), and it is serving.
pub fn availability(workspace_identity: &str) -> BridgeAvailability {
    if read_token().is_none() {
        return BridgeAvailability::NotInstalled;
    }
    match connect(workspace_identity) {
        Ok(_) => BridgeAvailability::Ready,
        Err(_) => BridgeAvailability::NotServing,
    }
}

/// Why a window is not serving, in its own words.
///
/// The extension writes a status file per workspace on activation. Its absence
/// is itself the answer — the extension never activated in that window — and
/// saying that is far more useful than "not serving", which leaves the user
/// with nothing to act on.
pub fn not_serving_reason(workspace_identity: &str) -> String {
    let Some(path) = status_path(workspace_identity) else {
        return "the bridge status could not be read on this machine".into();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        // Observed cause, in practice: VS Code disables the extension in an
        // untrusted workspace, because the extension declares it needs trust to
        // run tasks. The window then looks identical to one where the extension
        // is missing, so naming the likely reason is the difference between an
        // actionable message and a shrug.
        return "the ArcSonare extension did not activate in that window. The usual cause is \
                workspace trust — the bridge can run tasks, so VS Code disables it until you \
                trust the folder. Click \"Trust\" in that window, or reload it"
            .into();
    };
    let Ok(status) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return "the bridge wrote a status this version cannot read".into();
    };
    if status.get("serving").and_then(|s| s.as_bool()) == Some(true) {
        return "the window reports it is serving, but the pipe could not be opened \
                — it may have just closed"
            .into();
    }
    status
        .get("reason")
        .and_then(|r| r.as_str())
        .unwrap_or("the window is not serving and did not say why")
        .to_string()
}

fn status_path(workspace_identity: &str) -> Option<PathBuf> {
    let slug: String = workspace_identity
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-');
    Some(
        PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
            .join("ArcSonare")
            .join(format!("vscode-bridge-{slug}.status.json")),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BridgeAvailability {
    NotInstalled,
    NotServing,
    Ready,
}

#[cfg(windows)]
fn connect(workspace_identity: &str) -> Result<std::fs::File, String> {
    use std::fs::OpenOptions;
    let name = pipe_name(workspace_identity);
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(&name)
        .map_err(|e| format!("the ArcSonare VS Code bridge is not serving this workspace: {e}"))
}

#[cfg(not(windows))]
fn connect(_workspace_identity: &str) -> Result<std::fs::File, String> {
    Err("The VS Code bridge is only available on Windows.".into())
}

/// One request, one response, newline-delimited JSON.
///
/// Synchronous with a deadline rather than a background channel: every caller
/// is already answering a user request, and a bridge that hangs must surface as
/// a timeout the user is told about, not as a reply that never arrives.
pub fn request(
    workspace_identity: &str,
    command: &str,
    argument: Option<&str>,
) -> Result<BridgeResponse, String> {
    let token = read_token()
        .ok_or_else(|| "The ArcSonare VS Code extension is not installed.".to_string())?;
    let mut pipe = connect(workspace_identity)?;

    let payload = serde_json::to_string(&BridgeRequest {
        token: &token,
        command,
        argument,
        workspace: workspace_identity,
    })
    .map_err(|e| format!("could not encode the bridge request: {e}"))?;

    pipe.write_all(payload.as_bytes())
        .and_then(|()| pipe.write_all(b"\n"))
        .and_then(|()| pipe.flush())
        .map_err(|e| format!("could not send to the VS Code bridge: {e}"))?;

    let read_handle = pipe
        .try_clone()
        .map_err(|e| format!("could not read from the VS Code bridge: {e}"))?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(read_handle)
            .read_line(&mut line)
            .map(|_| line)
            .map_err(|e| format!("the VS Code bridge closed the connection: {e}"));
        let _ = tx.send(result);
    });

    let line = rx
        .recv_timeout(REQUEST_TIMEOUT)
        .map_err(|_| "The VS Code bridge did not answer in time.".to_string())??;

    serde_json::from_str::<BridgeResponse>(line.trim())
        .map_err(|e| format!("the VS Code bridge sent something unreadable: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both sides derive the pipe name from the workspace, so the derivation
    /// must be stable and must not collapse different folders together.
    #[test]
    fn different_workspaces_get_different_pipes() {
        assert_ne!(pipe_name("ArcSonare"), pipe_name("website"));
    }

    #[test]
    fn pipe_names_are_case_insensitive_and_punctuation_free() {
        assert_eq!(pipe_name("ArcSonare"), pipe_name("arcsonare"));
        assert_eq!(pipe_name("my project"), pipe_name("my-project"));
        assert!(pipe_name("my project").starts_with(PIPE_PREFIX));
        assert!(
            !pipe_name("a/b\\c").contains('/'),
            "a path separator in a pipe name would change what is opened"
        );
    }

    /// The bridge must never run unauthenticated. Without a token file, the
    /// request path must refuse before it opens anything.
    #[test]
    fn a_request_without_a_token_is_refused_before_connecting() {
        if read_token().is_some() {
            // A real token exists on this machine; the guard cannot be observed
            // here without deleting the user's file, which a test must not do.
            return;
        }
        let err = request("nonexistent-workspace", "get_context", None)
            .expect_err("a missing token must refuse");
        assert!(
            err.contains("not installed"),
            "the refusal must name the real cause, got: {err}"
        );
    }
}
