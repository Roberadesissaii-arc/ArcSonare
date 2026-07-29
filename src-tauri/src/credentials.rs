//! Provider credentials and ArcSonare secure session storage in Windows
//! Credential Manager via `keyring`. Secrets are never logged.

const SERVICE: &str = "ArcSonare";

/// Provider ids we accept credentials for; rejects arbitrary account names.
const KNOWN_PROVIDERS: &[&str] = &["anthropic", "openai", "google", "xai", "deepseek", "ollama"];

const ALLOWED_SECURE_PREFIXES: &[&str] = &[
    "oauth.google:",
    "device.id",
    "device.enc_key",
    "provider.",
    "integration.",
];

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    if !KNOWN_PROVIDERS.contains(&provider) {
        return Err(format!("Unknown provider '{provider}'."));
    }
    keyring::Entry::new(SERVICE, provider).map_err(|e| format!("Credential store unavailable: {e}"))
}

fn secure_entry(key: &str) -> Result<keyring::Entry, String> {
    if !ALLOWED_SECURE_PREFIXES
        .iter()
        .any(|prefix| key == *prefix || key.starts_with(prefix))
    {
        return Err(format!("Secure storage key '{key}' is not allowed."));
    }
    if key.len() > 200 {
        return Err("Secure storage key is too long.".into());
    }
    keyring::Entry::new(SERVICE, key).map_err(|e| format!("Credential store unavailable: {e}"))
}

/// Read a stored key for server-side use only. Never exposed to the frontend.
pub(crate) fn get_provider_key(provider: &str) -> Result<String, String> {
    entry(provider)?
        .get_password()
        .map_err(|_| format!("No API key saved for {provider}. Add one in Settings → Models."))
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

#[tauri::command]
pub fn secure_storage_get(key: String) -> Result<Option<String>, String> {
    match secure_entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Credential read failed: {e}")),
    }
}

#[tauri::command]
pub fn secure_storage_set(key: String, value: String) -> Result<(), String> {
    if value.len() > 256_000 {
        return Err("Secure storage value is too large.".into());
    }
    secure_entry(&key)?
        .set_password(&value)
        .map_err(|e| format!("Credential write failed: {e}"))
}

#[tauri::command]
pub fn secure_storage_remove(key: String) -> Result<(), String> {
    match secure_entry(&key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Credential delete failed: {e}")),
    }
}

#[tauri::command]
pub fn secure_storage_has(key: String) -> bool {
    match secure_entry(&key) {
        Ok(e) => e.get_password().is_ok(),
        Err(_) => false,
    }
}

pub(crate) fn secure_storage_read(key: &str) -> Result<Option<String>, String> {
    match secure_entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Credential read failed: {e}")),
    }
}

pub(crate) fn secure_storage_write(key: &str, value: &str) -> Result<(), String> {
    if value.len() > 256_000 {
        return Err("Secure storage value is too large.".into());
    }
    secure_entry(key)?
        .set_password(value)
        .map_err(|e| format!("Credential write failed: {e}"))
}
