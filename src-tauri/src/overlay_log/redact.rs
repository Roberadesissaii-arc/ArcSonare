//! Centralized privacy and redaction utilities for Overlay Conversation Logs.
//!
//! Owned by Agent 5.

use serde_json::Value;

/// Redact sensitive patterns in text (API keys, tokens, passwords, bearer tokens).
pub fn redact_str(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }

    let mut result = input.to_string();

    // Redact OpenAI API keys (sk-...)
    let re_sk = regex_lite("sk-[a-zA-Z0-9T3BlbkFJ]{20,}");
    result = re_sk.replace_all(&result, "sk-[REDACTED]").to_string();

    // Redact Bearer tokens
    let re_bearer = regex_lite("(?i)bearer\\s+[a-zA-Z0-9._\\-]{16,}");
    result = re_bearer.replace_all(&result, "Bearer [REDACTED]").to_string();

    // Redact password parameters in URLs or strings
    let re_pass = regex_lite("(?i)(password|secret|access_token|refresh_token|api_key|apikey)=[^&\\s'\"]+");
    result = re_pass.replace_all(&result, "$1=[REDACTED]").to_string();

    // Normalize Windows user home directory path
    normalize_user_path(&result)
}

/// Normalize absolute user home directory paths to `<USER_HOME>\...`
pub fn normalize_user_path(input: &str) -> String {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        if !user_profile.is_empty() {
            let normalized = input.replace(&user_profile, "<USER_HOME>");
            let alt_profile = user_profile.replace('\\', "/");
            return normalized.replace(&alt_profile, "<USER_HOME>");
        }
    }
    input.to_string()
}

/// Recursively redact a JSON Value before storing or exporting.
pub fn redact_json_value(val: &Value) -> Value {
    match val {
        Value::String(s) => Value::String(redact_str(s)),
        Value::Array(arr) => Value::Array(arr.iter().map(redact_json_value).collect()),
        Value::Object(obj) => {
            let mut cleaned = serde_json::Map::new();
            for (k, v) in obj {
                let k_lower = k.to_lowercase();
                if k_lower.contains("key")
                    || k_lower.contains("token")
                    || k_lower.contains("password")
                    || k_lower.contains("secret")
                    || k_lower.contains("credential")
                    || k_lower.contains("auth")
                    || k_lower.contains("bearer")
                    || k_lower.contains("prompt")
                    || k_lower.contains("system_prompt")
                    || k_lower.contains("screenshot")
                    || k_lower.contains("raw_audio")
                    || k_lower.contains("audio_buffer")
                {
                    cleaned.insert(k.clone(), Value::String("[REDACTED]".into()));
                } else {
                    cleaned.insert(k.clone(), redact_json_value(v));
                }
            }
            Value::Object(cleaned)
        }
        other => other.clone(),
    }
}

// Simple regex helper using standard string replacement fallback if regex isn't needed.
fn regex_lite(pattern: &str) -> regex::Regex {
    regex::Regex::new(pattern).unwrap_or_else(|_| regex::Regex::new(".*").unwrap())
}
