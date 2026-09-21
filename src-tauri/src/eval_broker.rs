//! Debug-only model-evaluation broker.
//!
//! Evaluating tool selection needs the configured provider credential. Handing
//! that to a Node process meant a second copy of the key in a shell environment
//! — and a leak has already happened once in this project, from an error
//! message that echoed its own input.
//!
//! So the credential never leaves Rust. The caller sends a prompt and the tool
//! schemas; this resolves the key from the OS credential store, makes the
//! request, and returns **only** the parts of the answer an evaluation needs.
//! The raw provider response, the request URL, and the Authorization header all
//! stay inside this function and are never returned, logged, or embedded in an
//! error.
//!
//! Compiled only in debug builds. A release binary has no evaluation surface at
//! all, rather than one that is merely hidden.

use serde::Serialize;
use serde_json::json;
use std::time::Instant;

use crate::credentials;

/// Everything the evaluator learns. Deliberately not the provider's response.
#[derive(Debug, Serialize)]
pub struct EvalSelection {
    /// Tool the model asked for, in registry form ("youtube.search").
    pub selected_capability: Option<String>,
    /// Arguments as the model supplied them. Never contains a credential —
    /// these are tool arguments, and tool schemas carry no secrets.
    pub arguments: serde_json::Value,
    /// Assistant prose, when it answered without calling a tool.
    pub text: String,
    /// Provider HTTP status, so a failure is diagnosable without its body.
    pub provider_status: u16,
    /// Category only — never the provider's message, which can quote the request.
    pub error_kind: Option<String>,
    pub duration_ms: u64,
}

fn tool_name_to_capability(name: &str) -> String {
    name.replace("__", ".")
}

/// Run one selection through the configured provider.
///
/// `tools` is the OpenAI-format schema array the caller built from the
/// production capability registry — the evaluation is only meaningful if the
/// model sees exactly what the app would show it.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn eval_model_selection(
    model: String,
    system_prompt: String,
    user_prompt: String,
    tools: serde_json::Value,
) -> Result<EvalSelection, String> {
    let started = Instant::now();

    // Resolved here and dropped here. It is never returned, never formatted
    // into an error, and never written to a log.
    let api_key = credentials::get_provider_key("deepseek")
        .map_err(|_| String::from("No provider credential is configured."))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|_| String::from("Could not create the HTTP client."))?;

    let payload = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt },
        ],
        "tools": tools,
        "stream": false,
    });

    let response = match client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(&api_key)
        .json(&payload)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // `e` can name the URL it tried. The URL has no key on it (the key
            // is a header), but the category alone is what an evaluation needs,
            // so nothing from the error is propagated.
            let kind = if e.is_timeout() { "timeout" } else { "network" };
            return Ok(EvalSelection {
                selected_capability: None,
                arguments: json!({}),
                text: String::new(),
                provider_status: 0,
                error_kind: Some(kind.into()),
                duration_ms: started.elapsed().as_millis() as u64,
            });
        }
    };

    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Ok(EvalSelection {
            selected_capability: None,
            arguments: json!({}),
            text: String::new(),
            provider_status: status,
            error_kind: Some(match status {
                401 | 403 => "unauthorized".into(),
                429 => "rate-limited".into(),
                _ => "provider-error".into(),
            }),
            duration_ms: started.elapsed().as_millis() as u64,
        });
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| String::from("The provider returned a response that could not be read."))?;

    let message = body.pointer("/choices/0/message");
    let text = message
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    let call = message
        .and_then(|m| m.get("tool_calls"))
        .and_then(|c| c.as_array())
        .and_then(|a| a.first());

    let selected_capability = call
        .and_then(|c| c.pointer("/function/name"))
        .and_then(|n| n.as_str())
        .map(tool_name_to_capability);

    let arguments = call
        .and_then(|c| c.pointer("/function/arguments"))
        .and_then(|a| a.as_str())
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!({}));

    Ok(EvalSelection {
        selected_capability,
        arguments,
        text,
        provider_status: status,
        error_kind: None,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// Whether an evaluation could run at all, without revealing anything about the
/// credential beyond its presence.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn eval_provider_available() -> bool {
    credentials::get_provider_key("deepseek").is_ok()
}
