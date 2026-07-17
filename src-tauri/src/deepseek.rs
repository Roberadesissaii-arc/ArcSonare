//! DeepSeek cloud API — OpenAI-compatible chat at https://api.deepseek.com

use crate::credentials;
use crate::ollama::ChatMessage;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const DEEPSEEK_BASE: &str = "https://api.deepseek.com";
const ALLOWED_MODELS: &[&str] = &["deepseek-v4-flash", "deepseek-v4-pro"];

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Option<Vec<Choice>>,
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Option<ChatMessage>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: Option<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

fn validate_model(model: &str) -> Result<String, String> {
    let model = model.trim();
    if !ALLOWED_MODELS.contains(&model) {
        return Err(format!(
            "Unsupported DeepSeek model '{model}'. Use deepseek-v4-flash or deepseek-v4-pro."
        ));
    }
    Ok(model.to_string())
}

/// Non-streaming chat completion via the DeepSeek OpenAI-compatible API.
#[tauri::command]
pub async fn deepseek_chat(model: String, messages: Vec<ChatMessage>) -> Result<String, String> {
    let model = validate_model(&model)?;
    if messages.is_empty() {
        return Err("No messages to send.".into());
    }

    let api_key = credentials::get_provider_key("deepseek")?;
    let client = client()?;
    let res = client
        .post(format!("{DEEPSEEK_BASE}/chat/completions"))
        .bearer_auth(api_key)
        .json(&ChatRequest {
            model,
            messages,
            stream: false,
        })
        .send()
        .await
        .map_err(|e| format!("DeepSeek request failed: {e}"))?;

    let status = res.status();
    let body: ChatResponse = res
        .json()
        .await
        .map_err(|e| format!("invalid DeepSeek response: {e}"))?;

    if let Some(err) = body.error {
        return Err(err
            .message
            .unwrap_or_else(|| format!("DeepSeek error {status}")));
    }
    if !status.is_success() {
        return Err(format!("DeepSeek error {status}"));
    }

    body.choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message)
        .map(|m| m.content.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "DeepSeek returned an empty reply.".into())
}

/// Tool-calling chat: messages/tools pass through in OpenAI format and the
/// raw assistant message (content and/or tool_calls) is returned as JSON so
/// the frontend provider adapter can parse structured tool calls.
#[tauri::command]
pub async fn deepseek_chat_tools(
    model: String,
    messages: serde_json::Value,
    tools: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let model = validate_model(&model)?;
    if !messages.is_array() || messages.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        return Err("No messages to send.".into());
    }

    let api_key = credentials::get_provider_key("deepseek")?;
    let client = client()?;
    let mut payload = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
    });
    if let Some(tools) = tools {
        if tools.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
            payload["tools"] = tools;
        }
    }
    let res = client
        .post(format!("{DEEPSEEK_BASE}/chat/completions"))
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("DeepSeek request failed: {e}"))?;

    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("invalid DeepSeek response: {e}"))?;
    if let Some(message) = body.pointer("/error/message").and_then(|m| m.as_str()) {
        return Err(message.to_string());
    }
    if !status.is_success() {
        return Err(format!("DeepSeek error {status}"));
    }
    body.pointer("/choices/0/message")
        .cloned()
        .ok_or_else(|| "DeepSeek returned no assistant message.".into())
}
