//! Provider credentials and ArcSonare secure session storage in Windows
//! Credential Manager via `keyring`. Secrets are never logged.

const SERVICE: &str = "ArcSonare";

/// Provider ids we accept credentials for; rejects arbitrary account names.
const KNOWN_PROVIDERS: &[&str] = &["anthropic", "openai", "google", "xai", "deepseek"];

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

const fn opt(v: Option<&'static str>) -> &'static str {
    match v {
        Some(s) => s,
        None => "",
    }
}

/// Provider keys that may be compiled in at build time from `.env`.
///
/// `env!` reads at COMPILE time, so whatever is in `.env` when the installer is
/// built travels with the binary. That is the point — the app ships ready to
/// use — but it also means anyone with the .exe can extract these. Ship blank
/// values if the installer goes to people you would not hand your API keys to.
const BUNDLED_KEYS: &[(&str, &str)] = &[
    // option_env! so a missing value is simply empty rather than a build
    // failure — building without a .env must always work.
    ("openai", opt(option_env!("ARCSONARE_OPENAI_API_KEY"))),
    ("deepseek", opt(option_env!("ARCSONARE_DEEPSEEK_API_KEY"))),
    ("google", opt(option_env!("ARCSONARE_GEMINI_API_KEY"))),
];

/// Copy any compiled-in keys into Credential Manager, once, on startup.
///
/// Only fills empty slots. A key the user saved in Settings always wins — a
/// bundled default must never overwrite someone's own credentials.
pub(crate) fn seed_bundled_keys() {
    for (provider, key) in BUNDLED_KEYS {
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        let Ok(entry) = entry(provider) else { continue };
        if entry.get_password().is_ok() {
            continue; // user already has one here
        }
        match entry.set_password(key) {
            // Never log the key itself.
            Ok(()) => log::info!("seeded bundled {provider} key"),
            Err(e) => log::warn!("could not seed {provider} key: {e}"),
        }
    }
}
