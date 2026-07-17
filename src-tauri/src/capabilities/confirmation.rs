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

struct Pending {
    capability_id: String,
    /// Canonical JSON of the args that were approved.
    args_fingerprint: String,
    issued: Instant,
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
    format!("{capability_id}::{}", canonical_json(args))
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
        let token = new_token();
        let expires_at = chrono::Local::now() + chrono::Duration::seconds(TOKEN_TTL.as_secs() as i64);
        let mut map = self.0.lock().unwrap();
        map.retain(|_, p| p.issued.elapsed() < TOKEN_TTL);
        map.insert(
            token.clone(),
            Pending {
                capability_id: capability_id.into(),
                args_fingerprint: fingerprint(capability_id, args),
                issued: Instant::now(),
            },
        );
        (token, expires_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
    }

    /// Consume a token; valid only for the exact capability + args it was
    /// issued for, and only once, within the TTL.
    pub fn consume(
        &self,
        token: &str,
        capability_id: &str,
        args: &serde_json::Value,
    ) -> Result<(), String> {
        let mut map = self.0.lock().unwrap();
        let Some(pending) = map.remove(token) else {
            return Err("Confirmation token is unknown or already used.".into());
        };
        if pending.issued.elapsed() >= TOKEN_TTL {
            return Err("Confirmation expired — please confirm again.".into());
        }
        if pending.capability_id != capability_id
            || pending.args_fingerprint != fingerprint(capability_id, args)
        {
            return Err("The confirmed action changed — please confirm again.".into());
        }
        Ok(())
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
        assert!(store.consume(&token, "filesystem.delete", &swapped).is_err());
    }

    #[test]
    fn fingerprint_is_key_order_independent() {
        let a = json!({"x": 1, "y": [1, 2]});
        let b = serde_json::from_str::<serde_json::Value>(r#"{"y":[1,2],"x":1}"#).unwrap();
        assert_eq!(fingerprint("c", &a), fingerprint("c", &b));
    }
}
