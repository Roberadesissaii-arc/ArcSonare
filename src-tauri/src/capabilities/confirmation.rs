//! Confirmation tokens for destructive operations. A destructive execute call
//! without a valid token returns `needs-confirmation` plus a token; the
//! frontend shows the dialog and re-invokes with the token. The affected-path
//! snapshot is revalidated at execution so a path swap after approval aborts.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TOKEN_TTL: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedItem {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationRequest {
    pub token: String,
    pub capability_id: String,
    pub title: String,
    pub description: String,
    pub risk_level: String,
    pub affected_items: Vec<AffectedItem>,
    pub reversible: bool,
    pub consequence: String,
    pub expires_at: String,
}

/// How far an approval reaches.
///
/// One variant, deliberately. The current behaviour is already the narrowest
/// possible — a grant covers one operation on one target for one run — and
/// writing that down makes it testable rather than merely true. Wider scopes
/// (this file for this request, this plan, this session) are what a permission
/// system usually grows next; adding them without a reason to is how a system
/// ends up able to overwrite anything forever.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalScope {
    ExactAction,
}

struct Pending {
    capability_id: String,
    /// Canonical JSON of the args that were approved.
    args_fingerprint: String,
    /// The run this approval belongs to. A token from one conversation must not
    /// authorise an action in another, however identical the arguments look.
    run_id: Option<String>,
    scope: ApprovalScope,
    issued: Instant,
}

/// Why a token could not be used. Each of these used to be the same opaque
/// string, which made "you already used this" indistinguishable from "this
/// belongs to something else".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantError {
    Unknown,
    Expired,
    ActionChanged,
    WrongRun,
}

impl GrantError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::Unknown => "Confirmation token is unknown or already used.",
            Self::Expired => "Confirmation expired — please confirm again.",
            Self::ActionChanged => "The confirmed action changed — please confirm again.",
            Self::WrongRun => "That confirmation belongs to a different request.",
        }
    }
}

#[derive(Default)]
pub struct ConfirmationStore(Mutex<HashMap<String, Pending>>);

fn new_token() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!(
        "confirm-{}-{:x}",
        chrono::Local::now().timestamp_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// Stable fingerprint of args so the approved action cannot be swapped.
pub fn fingerprint(capability_id: &str, args: &serde_json::Value) -> String {
    format!(
        "{capability_id}::{}",
        canonical_json(&normalise_for_fingerprint(capability_id, args))
    )
}

/// Reduce args to the thing the user was actually asked about.
///
/// This exists because of a loop that survived the first fix. The overwrite
/// token is issued against the args *as they will be re-sent* — deliberately,
/// so approval and execution are provably the same action — but "as they will
/// be re-sent" was guessed, and the guess had two ways to be wrong:
///
///   - the model may omit `content` entirely, while the issued form spelled it
///     as an explicit `null`;
///   - the issued form always carried `if_exists: "overwrite"`, while the
///     original call carried whatever the model sent, or nothing.
///
/// Either mismatch made `consume_for_run` return `ActionChanged`, which
/// `capability_execute` swallows — so `confirmed` stayed false, the same
/// question came back, and "yes" did nothing forever. That is the loop the user
/// reported, and it is a fingerprint bug, not a policy one.
///
/// What is normalised away is only the mechanics. The path and the content
/// still decide identity, so a token for one write can never authorise another.
fn normalise_for_fingerprint(
    capability_id: &str,
    args: &serde_json::Value,
) -> serde_json::Value {
    match capability_id {
        "filesystem.create_file" | "filesystem.write_text_file" => {
            let Some(map) = args.as_object() else {
                return args.clone();
            };
            let mut map = map.clone();
            // Absent, null and empty are the same write of nothing.
            let empty = map
                .get("content")
                .map(|c| c.is_null() || c.as_str() == Some(""))
                .unwrap_or(true);
            if empty {
                map.insert("content".into(), serde_json::Value::Null);
            }
            // The approval *is* the decision to overwrite; carrying the flag
            // into the identity would mean the answer changed the question.
            map.remove("if_exists");
            serde_json::Value::Object(map)
        }
        _ => args.clone(),
    }
}

fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .into_iter()
                .map(|k| format!("{}:{}", k, canonical_json(&map[k])))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        serde_json::Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", inner.join(","))
        }
        other => other.to_string(),
    }
}

impl ConfirmationStore {
    /// Issue a token for a pending destructive action.
    pub fn issue(&self, capability_id: &str, args: &serde_json::Value) -> (String, String) {
        self.issue_for_run(capability_id, args, None)
    }

    /// Issue a token bound to the run that asked for it.
    pub fn issue_for_run(
        &self,
        capability_id: &str,
        args: &serde_json::Value,
        run_id: Option<&str>,
    ) -> (String, String) {
        let token = new_token();
        let expires_at =
            chrono::Local::now() + chrono::Duration::seconds(TOKEN_TTL.as_secs() as i64);
        let mut map = self.0.lock().unwrap();
        map.retain(|_, p| p.issued.elapsed() < TOKEN_TTL);
        map.insert(
            token.clone(),
            Pending {
                capability_id: capability_id.into(),
                args_fingerprint: fingerprint(capability_id, args),
                run_id: run_id.map(str::to_string),
                scope: ApprovalScope::ExactAction,
                issued: Instant::now(),
            },
        );
        (
            token,
            expires_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        )
    }

    /// Consume a token; valid only for the exact capability + args it was
    /// issued for, in the run it was issued for, once, within the TTL.
    pub fn consume(
        &self,
        token: &str,
        capability_id: &str,
        args: &serde_json::Value,
    ) -> Result<(), String> {
        self.consume_for_run(token, capability_id, args, None)
            .map(|_| ())
            .map_err(|e| e.message().to_string())
    }

    pub fn consume_for_run(
        &self,
        token: &str,
        capability_id: &str,
        args: &serde_json::Value,
        run_id: Option<&str>,
    ) -> Result<ApprovalScope, GrantError> {
        let mut map = self.0.lock().unwrap();
        // Removed before it is validated: a token that fails one check must not
        // stay usable for a second attempt at a different check.
        let Some(pending) = map.remove(token) else {
            return Err(GrantError::Unknown);
        };
        if pending.issued.elapsed() >= TOKEN_TTL {
            return Err(GrantError::Expired);
        }
        if pending.capability_id != capability_id
            || pending.args_fingerprint != fingerprint(capability_id, args)
        {
            return Err(GrantError::ActionChanged);
        }
        // Only checked when the grant was bound to a run. An unbound grant is
        // the pre-existing behaviour and stays permissive rather than suddenly
        // rejecting callers that never supplied one.
        if let (Some(bound), Some(actual)) = (pending.run_id.as_deref(), run_id) {
            if bound != actual {
                return Err(GrantError::WrongRun);
            }
        }
        Ok(pending.scope)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn token_roundtrip() {
        let store = ConfirmationStore::default();
        let args = json!({"paths": ["C:/Users/x/Desktop/y"], "mode": "recycle-bin"});
        let (token, _) = store.issue("filesystem.delete", &args);
        assert!(store.consume(&token, "filesystem.delete", &args).is_ok());
        // Single use.
        assert!(store.consume(&token, "filesystem.delete", &args).is_err());
    }

    #[test]
    fn token_rejects_changed_args() {
        let store = ConfirmationStore::default();
        let args = json!({"paths": ["C:/a"], "mode": "recycle-bin"});
        let swapped = json!({"paths": ["C:/b"], "mode": "recycle-bin"});
        let (token, _) = store.issue("filesystem.delete", &args);
        assert!(store
            .consume(&token, "filesystem.delete", &swapped)
            .is_err());
    }

    #[test]
    fn a_token_from_another_run_cannot_authorise_this_one() {
        // The same file, the same operation, a different conversation. Without
        // this, an approval given in one place would silently authorise an
        // identical-looking action started somewhere else.
        let store = ConfirmationStore::default();
        let args = json!({"paths": ["C:/a"], "mode": "recycle-bin"});
        let (token, _) = store.issue_for_run("filesystem.delete", &args, Some("run-A"));
        assert_eq!(
            store.consume_for_run(&token, "filesystem.delete", &args, Some("run-B")),
            Err(GrantError::WrongRun)
        );
    }

    #[test]
    fn a_rejected_token_is_spent_rather_than_left_for_a_second_try() {
        let store = ConfirmationStore::default();
        let args = json!({"paths": ["C:/a"]});
        let (token, _) = store.issue_for_run("filesystem.delete", &args, Some("run-A"));
        let _ = store.consume_for_run(&token, "filesystem.delete", &args, Some("run-B"));
        // Now presented with the right run: still refused, because guessing the
        // run id must not become a way to reuse someone else's approval.
        assert_eq!(
            store.consume_for_run(&token, "filesystem.delete", &args, Some("run-A")),
            Err(GrantError::Unknown)
        );
    }

    #[test]
    fn the_right_run_consumes_the_grant_exactly_once() {
        let store = ConfirmationStore::default();
        let args = json!({"paths": ["C:/a"]});
        let (token, _) = store.issue_for_run("filesystem.delete", &args, Some("run-A"));
        assert_eq!(
            store.consume_for_run(&token, "filesystem.delete", &args, Some("run-A")),
            Ok(ApprovalScope::ExactAction)
        );
        assert_eq!(
            store.consume_for_run(&token, "filesystem.delete", &args, Some("run-A")),
            Err(GrantError::Unknown)
        );
    }

    #[test]
    fn an_unbound_grant_still_works_for_callers_that_send_no_run() {
        let store = ConfirmationStore::default();
        let args = json!({"x": 1});
        let (token, _) = store.issue("filesystem.create_file", &args);
        assert!(store
            .consume(&token, "filesystem.create_file", &args)
            .is_ok());
    }

    #[test]
    fn the_only_scope_is_the_narrowest_one() {
        // Stated as a test so widening it is a deliberate act with a diff,
        // rather than something that drifts in.
        let store = ConfirmationStore::default();
        let args = json!({"x": 1});
        let (token, _) = store.issue_for_run("filesystem.delete", &args, Some("r"));
        assert_eq!(
            store.consume_for_run(&token, "filesystem.delete", &args, Some("r")),
            Ok(ApprovalScope::ExactAction)
        );
    }

    /// The reported loop, as a test.
    ///
    /// The model calls `create_file` without `content`; Rust issues the token
    /// against the form it expects back, which spells `content` as null and
    /// adds `if_exists`. Before normalisation these were different actions, the
    /// consume failed, and the identical question came straight back.
    #[test]
    fn approving_an_overwrite_is_not_a_different_action() {
        let store = ConfirmationStore::default();
        // What Rust issues the token against.
        let approved = json!({
            "parent_path": "C:\\Users\\rober\\Desktop",
            "name": "notes.txt",
            "content": null,
            "if_exists": "overwrite",
        });
        let (token, _) = store.issue("filesystem.create_file", &approved);

        // What the frontend actually re-sends: the model's original args, which
        // never mentioned `content`, plus the overwrite decision.
        let resent = json!({
            "parent_path": "C:\\Users\\rober\\Desktop",
            "name": "notes.txt",
            "if_exists": "overwrite",
        });
        assert!(
            store.consume(&token, "filesystem.create_file", &resent).is_ok(),
            "saying yes must run the write, not ask again",
        );
    }

    /// The other half of the same drift: the original call carried its own
    /// `if_exists`, so the approved form and the resent form disagreed on a
    /// field that is not part of what the user was asked.
    #[test]
    fn the_overwrite_flag_is_not_part_of_the_approved_identity() {
        let store = ConfirmationStore::default();
        let approved = json!({
            "parent_path": "C:\\a",
            "name": "x.txt",
            "content": "hello",
            "if_exists": "overwrite",
        });
        let (token, _) = store.issue("filesystem.create_file", &approved);
        let resent = json!({
            "parent_path": "C:\\a",
            "name": "x.txt",
            "content": "hello",
            "if_exists": "fail",
        });
        assert!(store.consume(&token, "filesystem.create_file", &resent).is_ok());
    }

    /// Normalisation must not become a way to approve a different write.
    #[test]
    fn a_different_path_or_content_is_still_a_different_write() {
        let store = ConfirmationStore::default();
        let approved = json!({
            "parent_path": "C:\\a",
            "name": "x.txt",
            "content": "hello",
            "if_exists": "overwrite",
        });

        let (token, _) = store.issue("filesystem.create_file", &approved);
        let other_path = json!({
            "parent_path": "C:\\b",
            "name": "x.txt",
            "content": "hello",
            "if_exists": "overwrite",
        });
        assert!(store
            .consume(&token, "filesystem.create_file", &other_path)
            .is_err());

        let (token, _) = store.issue("filesystem.create_file", &approved);
        let other_content = json!({
            "parent_path": "C:\\a",
            "name": "x.txt",
            "content": "goodbye",
            "if_exists": "overwrite",
        });
        assert!(store
            .consume(&token, "filesystem.create_file", &other_content)
            .is_err());
    }

    /// Delete is untouched by any of this: its args are compared exactly.
    #[test]
    fn normalisation_does_not_reach_destructive_capabilities() {
        let store = ConfirmationStore::default();
        let approved = json!({ "paths": ["C:\\a"], "mode": "recycle-bin" });
        let (token, _) = store.issue("filesystem.delete", &approved);
        let escalated = json!({ "paths": ["C:\\a"], "mode": "permanent" });
        assert!(store
            .consume(&token, "filesystem.delete", &escalated)
            .is_err());
    }

    #[test]
    fn fingerprint_is_key_order_independent() {
        let a = json!({"x": 1, "y": [1, 2]});
        let b = serde_json::from_str::<serde_json::Value>(r#"{"y":[1,2],"x":1}"#).unwrap();
        assert_eq!(fingerprint("c", &a), fingerprint("c", &b));
    }
}
