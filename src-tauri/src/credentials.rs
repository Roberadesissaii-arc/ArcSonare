//! Provider credentials in the operating system's secure store (Windows
//! Credential Manager via `keyring`). Keys are write-only from the UI's
//! perspective: they can be saved, tested for presence and deleted, but are
//! never returned to the frontend and never logged.

const SERVICE: &str = "ArcSonare";

/// Provider ids we accept credentials for; rejects arbitrary account names.
const KNOWN_PROVIDERS: &[&str] = &["anthropic", "openai", "google", "xai", "ollama"];

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    if !KNOWN_PROVIDERS.contains(&provider) {
        return Err(format!("Unknown provider '{provider}'."));
    }
    keyring::Entry::new(SERVICE, provider)
        .map_err(|e| format!("Credential store unavailable: {e}"))
}

#[tauri::command]
pub fn set_provider_key(provider: String, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("The key is empty.".into());
    }
    if key.len() > 4096 {
        return Err("The key is unreasonably long.".into());
    }
    entry(&provider)?
        .set_password(key)
        .map_err(|e| format!("Windows Credential Manager rejected the key: {e}"))
}

#[tauri::command]
pub fn has_provider_key(provider: String) -> bool {
    match entry(&provider) {
        Ok(e) => e.get_password().is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn delete_provider_key(provider: String) -> Result<(), String> {
    let entry = entry(&provider)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the stored key: {e}")),
    }
}
