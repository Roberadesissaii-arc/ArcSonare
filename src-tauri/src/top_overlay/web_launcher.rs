//! Safe default-browser URL opening with strict scheme validation.

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

/// Only http and https URLs are allowed. Rejects javascript:, file:, data:, etc.
pub fn validate_http_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }
    if trimmed.len() > 2048 {
        return Err("URL is too long".into());
    }
    // Reject control characters / whitespace injection.
    if trimmed
        .chars()
        .any(|c| c.is_control() || c == '`' || c == '|')
    {
        return Err("URL contains invalid characters".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("only http and https URLs are allowed".into());
    }
    // Block credentials-in-URL style surprises for safety.
    if let Some(rest) = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
    {
        if rest.contains('@') {
            return Err("URLs with embedded credentials are not allowed".into());
        }
    }
    Ok(())
}

/// Open an approved URL in the user's default browser via the `open` crate.
pub fn open_approved_url(url: &str) -> Result<(), String> {
    validate_http_url(url)?;
    open::that(url).map_err(|e| format!("failed to open URL: {e}"))
}

/// Build a Google search URL from a free-text query and open it.
pub fn open_web_search(query: &str) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("search query is empty".into());
    }
    if q.len() > 500 {
        return Err("search query is too long".into());
    }
    // Encode the query; never pass raw speech to a shell.
    let encoded = utf8_percent_encode(q, NON_ALPHANUMERIC).to_string();
    let url = format!("https://www.google.com/search?q={encoded}");
    open_approved_url(&url)?;
    Ok(url)
}
