//! Local Ollama runtime bridge — talks to http://127.0.0.1:11434 only.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const OLLAMA_BASE: &str = "http://127.0.0.1:11434";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub available: bool,
    pub models: Vec<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Option<Vec<TagModel>>,
}

#[derive(Debug, Deserialize)]
struct TagModel {
    name: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    message: Option<ChatMessage>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

/// Probe Ollama and list installed model names.
#[tauri::command]
pub async fn ollama_status() -> Result<OllamaStatus, String> {
    let client = client()?;
    let res = client
        .get(format!("{OLLAMA_BASE}/api/tags"))
        .send()
        .await
        .map_err(|e| {
            format!("Ollama is not reachable at {OLLAMA_BASE}. Is `ollama serve` running? ({e})")
        })?;

    if !res.status().is_success() {
        return Ok(OllamaStatus {
            available: false,
            models: vec![],
            message: format!("Ollama responded with {}", res.status()),
        });
    }

    let body: TagsResponse = res
        .json()
        .await
        .map_err(|e| format!("invalid Ollama tags response: {e}"))?;
    let models: Vec<String> = body
        .models
        .unwrap_or_default()
        .into_iter()
        .map(|m| m.name)
        .collect();

    Ok(OllamaStatus {
        available: true,
        models: models.clone(),
        message: if models.is_empty() {
            "Ollama is running, but no models are installed. Run `ollama pull llama3.2`.".into()
        } else {
            format!("{} model(s) ready", models.len())
        },
    })
}

/// Non-streaming chat completion against a local model.
#[tauri::command]
pub async fn ollama_chat(model: String, messages: Vec<ChatMessage>) -> Result<String, String> {
    if model.trim().is_empty() {
        return Err("No Ollama model selected. Choose one in Settings → Models.".into());
    }
    if messages.is_empty() {
        return Err("No messages to send.".into());
    }

    let client = client()?;
    let res = client
        .post(format!("{OLLAMA_BASE}/api/chat"))
        .json(&ChatRequest {
            model: model.trim().to_string(),
            messages,
            stream: false,
        })
        .send()
        .await
        .map_err(|e| format!("Ollama chat failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Ollama error {status}: {body}"));
    }

    let body: ChatResponse = res
        .json()
        .await
        .map_err(|e| format!("invalid Ollama chat response: {e}"))?;

    body.message
        .map(|m| m.content.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Ollama returned an empty reply.".into())
}
