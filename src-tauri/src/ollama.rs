//! Ollama bridge — local runtime (127.0.0.1:11434) and Ollama Cloud (ollama.com).

use crate::credentials;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const OLLAMA_LOCAL: &str = "http://127.0.0.1:11434";
const OLLAMA_CLOUD: &str = "https://ollama.com";

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
    error: Option<String>,
}

fn local_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

fn cloud_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

async fn parse_tags(res: reqwest::Response, source: &str) -> Result<OllamaStatus, String> {
    if !res.status().is_success() {
        return Ok(OllamaStatus {
            available: false,
            models: vec![],
            message: format!("{source} responded with {}", res.status()),
        });
    }

    let body: TagsResponse = res
        .json()
        .await
        .map_err(|e| format!("invalid {source} tags response: {e}"))?;
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
            format!("{source} is reachable, but no models were listed.")
        } else {
            format!("{} model(s) ready", models.len())
        },
    })
}

async fn parse_chat(res: reqwest::Response, source: &str) -> Result<String, String> {
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{source} error {status}: {text}"));
    }

    let body: ChatResponse =
        serde_json::from_str(&text).map_err(|e| format!("invalid {source} chat response: {e}"))?;

    if let Some(err) = body.error {
        return Err(format!("{source}: {err}"));
    }

    body.message
        .map(|m| m.content.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("{source} returned an empty reply."))
}

/// Probe local Ollama and list installed model names.
#[tauri::command]
pub async fn ollama_status() -> Result<OllamaStatus, String> {
    let client = local_client()?;
    let res = client
        .get(format!("{OLLAMA_LOCAL}/api/tags"))
        .send()
        .await
        .map_err(|e| {
            format!("Ollama is not reachable at {OLLAMA_LOCAL}. Is `ollama serve` running? ({e})")
        })?;
    parse_tags(res, "Ollama local").await
}

/// Non-streaming chat against a local Ollama model.
#[tauri::command]
pub async fn ollama_chat(model: String, messages: Vec<ChatMessage>) -> Result<String, String> {
    if model.trim().is_empty() {
        return Err("No Ollama model selected. Choose one in Settings → Models.".into());
    }
    if messages.is_empty() {
        return Err("No messages to send.".into());
    }

    let client = local_client()?;
    let res = client
        .post(format!("{OLLAMA_LOCAL}/api/chat"))
        .json(&ChatRequest {
            model: model.trim().to_string(),
            messages,
            stream: false,
        })
        .send()
        .await
        .map_err(|e| format!("Ollama local chat failed: {e}"))?;

    parse_chat(res, "Ollama local").await
}

/// Probe Ollama Cloud (ollama.com) using the stored API key.
#[tauri::command]
pub async fn ollama_cloud_status() -> Result<OllamaStatus, String> {
    let api_key = credentials::get_provider_key("ollama")?;
    let client = cloud_client()?;
    let res = client
        .get(format!("{OLLAMA_CLOUD}/api/tags"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("Ollama Cloud is not reachable at {OLLAMA_CLOUD}: {e}"))?;
    parse_tags(res, "Ollama Cloud").await
}

/// Non-streaming chat against Ollama Cloud (https://ollama.com).
#[tauri::command]
pub async fn ollama_cloud_chat(
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    if model.trim().is_empty() {
        return Err(
            "No Ollama Cloud model selected. Enter a model name in Settings → Models.".into(),
        );
    }
    if messages.is_empty() {
        return Err("No messages to send.".into());
    }

    let api_key = credentials::get_provider_key("ollama")?;
    let client = cloud_client()?;
    let res = client
        .post(format!("{OLLAMA_CLOUD}/api/chat"))
        .bearer_auth(api_key)
        .json(&ChatRequest {
            model: model.trim().to_string(),
            messages,
            stream: false,
        })
        .send()
        .await
        .map_err(|e| format!("Ollama Cloud chat failed: {e}"))?;

    parse_chat(res, "Ollama Cloud").await
}
