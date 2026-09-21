//! OpenAI Realtime session bootstrap.
//!
//! The webview never sees the OpenAI API key. It asks this module for an
//! *ephemeral* client secret, which is what OpenAI intends browser and mobile
//! clients to use for WebRTC. The real key stays in Windows Credential Manager
//! and is only ever read here, server-side.

use serde::{Deserialize, Serialize};

const CLIENT_SECRETS_URL: &str = "https://api.openai.com/v1/realtime/client_secrets";

/// What the frontend gets back. Deliberately contains no long-lived secret.
#[derive(Debug, Serialize)]
pub struct RealtimeClientSecret {
    /// Ephemeral `ek_...` credential used to open the WebRTC call.
    pub value: String,
    /// Unix seconds; the frontend re-mints rather than reusing a stale secret.
    pub expires_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ClientSecretResponse {
    value: Option<String>,
    expires_at: Option<i64>,
    #[serde(default)]
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: Option<String>,
    code: Option<String>,
}

/// Mint an ephemeral Realtime credential.
///
/// `session` is the GA `session` object (type, model, instructions, audio,
/// tools). It is passed through unchanged so session shape lives with the
/// frontend that actually drives the conversation.
#[tauri::command]
pub async fn openai_realtime_client_secret(
    session: serde_json::Value,
    safety_identifier: Option<String>,
) -> Result<RealtimeClientSecret, String> {
    let key = crate::credentials::get_provider_key("openai")?;

    let mut request = reqwest::Client::new()
        .post(CLIENT_SECRETS_URL)
        .bearer_auth(&key)
        .json(&serde_json::json!({ "session": session }));

    // Lets OpenAI scope any enforcement to one user rather than the whole org.
    if let Some(id) = safety_identifier.filter(|s| !s.is_empty()) {
        request = request.header("OpenAI-Safety-Identifier", id);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Could not reach OpenAI: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Could not read OpenAI's response: {e}"))?;

    let parsed: ClientSecretResponse = serde_json::from_str(&body).map_err(|_| {
        // Never echo the raw body — it can contain request context.
        format!("OpenAI returned an unexpected response ({status}).")
    })?;

    if let Some(err) = parsed.error {
        let message = err.message.unwrap_or_else(|| "Unknown error".into());
        return Err(match err.code.as_deref() {
            Some("invalid_api_key") => {
                "That OpenAI API key was rejected. Check it in Settings → Models.".into()
            }
            Some("insufficient_quota") => {
                "Your OpenAI account is out of quota for Realtime.".into()
            }
            _ => message,
        });
    }

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("That OpenAI API key was rejected. Check it in Settings → Models.".into());
    }
    if !status.is_success() {
        return Err(format!("OpenAI refused the Realtime session ({status})."));
    }

    let value = parsed
        .value
        .ok_or_else(|| "OpenAI did not return a session credential.".to_string())?;

    Ok(RealtimeClientSecret {
        value,
        expires_at: parsed.expires_at,
    })
}

/// True when an OpenAI key is stored — lets the UI explain what is missing
/// before the user tries to talk.
#[tauri::command]
pub fn openai_realtime_configured() -> bool {
    crate::credentials::get_provider_key("openai").is_ok()
}
