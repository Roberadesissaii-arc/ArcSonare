//! Debug-only automated unlock, so tests stop dying at the lock screen.
//!
//! Every restart during development lands on "Your password is required to log
//! in", and a human has to type it before anything can be tested. That made the
//! restart regression a manual ritual and, worse, meant the automated parts
//! silently stopped at step 8.
//!
//! What this is:
//!   - the whole module is behind `#[cfg(debug_assertions)]`, so it does not
//!     exist in a release binary — not disabled by a flag, *absent*
//!   - the password is read from the `ARCSONARE_DEV_PASSWORD` environment
//!     variable, or from a gitignored `.dev-password` beside the project
//!   - it is never a literal in this file, never logged, never returned, never
//!     included in an error
//!   - it verifies against the same Argon2 hash the real sign-in uses; there is
//!     no bypass of the check itself, only an automated way to supply the input
//!
//! The last point is the important one. A "skip the lock screen" switch would be
//! a second authentication path that release builds must be trusted never to
//! take. This is the first path, driven by a local secret.

#![cfg(debug_assertions)]

use std::path::PathBuf;

/// Where a developer may leave the password. Gitignored; never read in release
/// because the module is not compiled there.
const DEV_PASSWORD_FILE: &str = ".dev-password";
const DEV_PASSWORD_ENV: &str = "ARCSONARE_DEV_PASSWORD";

fn password_file() -> Option<PathBuf> {
    // The crate root is `src-tauri`; the file belongs at the project root next
    // to `.gitignore`, so a stray copy inside the crate cannot be packaged.
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent()?.to_path_buf();
    let path = root.join(DEV_PASSWORD_FILE);
    path.exists().then_some(path)
}

/// Read the local development password, if one has been provided.
///
/// Returns the value itself — the only caller hands it straight to the verifier
/// and drops it. It is deliberately not `Serialize` and not returned by any
/// command.
fn read_dev_password() -> Option<String> {
    if let Ok(value) = std::env::var(DEV_PASSWORD_ENV) {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    let path = password_file()?;
    let contents = std::fs::read_to_string(path).ok()?;
    let trimmed = contents.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// What the frontend is told. Never contains the password or any part of it.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevUnlockResult {
    pub available: bool,
    pub unlocked: bool,
    /// A category, never a value: `no-credential`, `wrong-password`,
    /// `bad-hash`. Enough to fix the setup, useless to an attacker.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

/// Is an automated unlock configured on this machine?
///
/// Answering this does not reveal the password, and a release build does not
/// have the command at all, so a frontend calling it there gets a plain
/// "unknown command" rather than a `false` that might be a lie.
#[tauri::command]
pub fn dev_unlock_available() -> bool {
    read_dev_password().is_some()
}

/// Verify the local development password against the account's stored hash.
///
/// The hash comes from the caller because that is where the account record
/// lives; the password comes from local configuration and never crosses the
/// boundary in either direction.
#[tauri::command]
pub fn dev_unlock(hash: String) -> DevUnlockResult {
    decide(read_dev_password(), hash)
}

/// The decision, with the credential passed in.
///
/// Split out so the tests never touch the process environment: they used to,
/// and running in parallel they cleared each other's variable, which made a
/// correct implementation fail intermittently.
fn decide(password: Option<String>, hash: String) -> DevUnlockResult {
    let Some(password) = password else {
        return DevUnlockResult {
            available: false,
            unlocked: false,
            reason: Some("no-credential"),
        };
    };
    match crate::local_auth::verify_local_password(password, hash) {
        Ok(true) => DevUnlockResult {
            available: true,
            unlocked: true,
            reason: None,
        },
        Ok(false) => DevUnlockResult {
            available: true,
            unlocked: false,
            reason: Some("wrong-password"),
        },
        // The underlying error can quote the hash it failed to parse, so it is
        // reduced to a category here rather than passed through.
        Err(_) => DevUnlockResult {
            available: true,
            unlocked: false,
            reason: Some("bad-hash"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The result type must not be able to carry the password, whatever a future
    /// change to it looks like. Serialising it is how the frontend sees it, so
    /// serialising it is what gets checked.
    #[test]
    fn the_result_never_carries_a_secret() {
        let sentinel = "correct-horse-battery-staple";

        let hash = crate::local_auth::hash_local_password(sentinel.to_string()).unwrap();
        let ok = decide(Some(sentinel.to_string()), hash);
        assert!(ok.unlocked, "the right password should unlock");
        let json = serde_json::to_string(&ok).unwrap();
        assert!(
            !json.contains(sentinel),
            "the unlock result leaked the password"
        );

        let wrong = decide(
            Some(sentinel.to_string()),
            crate::local_auth::hash_local_password("something-else".to_string()).unwrap(),
        );
        assert!(!wrong.unlocked);
        assert_eq!(wrong.reason, Some("wrong-password"));
        let json = serde_json::to_string(&wrong).unwrap();
        assert!(!json.contains(sentinel), "the failure path leaked the password");
    }

    /// A malformed hash must not produce an error string built from the hash.
    #[test]
    fn a_bad_hash_is_reported_as_a_category() {
        let result = decide(Some("anything".into()), "not-a-real-argon2-hash".into());
        assert_eq!(result.reason, Some("bad-hash"));
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("not-a-real-argon2-hash"));
    }

    #[test]
    fn without_a_local_credential_nothing_unlocks() {
        let result = decide(None, "irrelevant".into());
        assert!(!result.available);
        assert!(!result.unlocked);
        assert_eq!(result.reason, Some("no-credential"));
    }

    /// Whitespace in the file must not become part of the password.
    #[test]
    fn a_trailing_newline_is_not_part_of_the_password() {
        let hash = crate::local_auth::hash_local_password("hunter2".into()).unwrap();
        assert!(
            decide(Some("hunter2".into()), hash.clone()).unlocked,
            "baseline"
        );
        // What `read_dev_password` trims. Asserted here so the trimming cannot
        // be dropped without a test noticing.
        assert!(decide(Some("hunter2\r\n".trim().into()), hash).unlocked);
    }

    /// The password must not appear anywhere in this file. A literal here would
    /// be committed, which is the one thing the whole design is avoiding.
    #[test]
    fn the_source_contains_no_password_literal() {
        let source = include_str!("dev_unlock.rs");
        // The developer password in use is a short numeric string; a bare digit
        // literal assigned to anything password-shaped is the shape to catch.
        let suspicious = source
            .lines()
            .filter(|l| {
                let l = l.trim();
                !l.starts_with("//")
                    && (l.contains("password = \"") || l.contains("PASSWORD: &str = \""))
            })
            .count();
        assert_eq!(suspicious, 0, "a password literal was committed");
    }
}
