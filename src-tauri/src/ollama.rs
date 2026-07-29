//! Ollama bridge — local runtime (127.0.0.1:11434) and Ollama Cloud (ollama.com).

use crate::credentials;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Emitter;

const OLLAMA_LOCAL: &str = "http://127.0.0.1:11434";
const OLLAMA_CLOUD: &str = "https://ollama.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub available: bool,
    pub models: Vec<String>,
    pub message: String,
}

/// Access tier for an Ollama Cloud model relative to the stored API key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CloudAccess {
    Free,
    Paid,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaCloudModelEntry {
    pub name: String,
    pub access: CloudAccess,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaCloudCatalog {
    pub available: bool,
    pub models: Vec<OllamaCloudModelEntry>,
    pub message: String,
    pub checked: bool,
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

#[derive(Debug, Deserialize)]
struct ChatStreamChunk {
    message: Option<ChatMessage>,
    error: Option<String>,
}

/// Streaming chat against a local Ollama model. Emits `ollama-chat-chunk:{stream_id}`
/// events with each content delta as they arrive; resolves with the full text.
#[tauri::command]
pub async fn ollama_chat_stream(
    app: tauri::AppHandle,
    stream_id: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
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
            stream: true,
        })
        .send()
        .await
        .map_err(|e| format!("Ollama local chat failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Ollama local error {status}: {text}"));
    }

    let event_name = format!("ollama-chat-chunk:{stream_id}");
    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Ollama local stream error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf = buf[pos + 1..].to_string();
            if line.is_empty() {
                continue;
            }
            let Ok(parsed) = serde_json::from_str::<ChatStreamChunk>(&line) else {
                continue;
            };
            if let Some(err) = parsed.error {
                return Err(format!("Ollama local: {err}"));
            }
            if let Some(msg) = parsed.message {
                if !msg.content.is_empty() {
                    full.push_str(&msg.content);
                    let _ = app.emit(&event_name, msg.content);
                }
            }
        }
    }

    if full.trim().is_empty() {
        return Err("Ollama local returned an empty reply.".into());
    }
    Ok(full)
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

fn heuristic_access(name: &str) -> CloudAccess {
    let n = name.to_lowercase();
    // Larger / flagship cloud names are typically Pro+ after Ollama's gating.
    let paid_markers = [
        "qwen3.5",
        "qwen3-coder",
        "deepseek-v4-pro",
        "deepseek-v3",
        "mistral-large",
        "671b",
        "397b",
        "675b",
        "480b",
        "kimi",
        "glm-5",
        "minimax-m2.7",
    ];
    if paid_markers.iter().any(|m| n.contains(m)) {
        return CloudAccess::Paid;
    }
    let free_markers = [
        "gpt-oss:20b",
        "gpt-oss:120b",
        "gemma4:31b",
        "gemma3:4b",
        "gemma3:12b",
        "gemma3:27b",
        "nemotron",
        "minimax-m2.5",
        "minimax-m2.1",
        "minimax-m3",
    ];
    if free_markers.iter().any(|m| n.contains(m)) {
        return CloudAccess::Free;
    }
    CloudAccess::Unknown
}

fn classify_cloud_error(status: reqwest::StatusCode, body: &str) -> CloudAccess {
    let lower = body.to_lowercase();
    if status.as_u16() == 403
        || lower.contains("requires a subscription")
        || lower.contains("upgrade for access")
    {
        return CloudAccess::Paid;
    }
    CloudAccess::Unknown
}

async fn probe_cloud_access(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
) -> (CloudAccess, String) {
    // Tiny generate — subscription gating shows up here, not on /api/tags or /api/show.
    let payload = serde_json::json!({
        "model": model,
        "prompt": "hi",
        "stream": false,
        "options": { "num_predict": 1 },
    });
    match client
        .post(format!("{OLLAMA_CLOUD}/api/generate"))
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
    {
        Ok(res) => {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            if status.is_success() {
                (CloudAccess::Free, "Works on your current plan".into())
            } else {
                let access = classify_cloud_error(status, &text);
                let detail = if access == CloudAccess::Paid {
                    "Requires Ollama Pro/Max".into()
                } else {
                    format!("Cloud responded {status}")
                };
                (access, detail)
            }
        }
        Err(e) => (CloudAccess::Unknown, format!("Probe failed: {e}")),
    }
}

/// List Ollama Cloud models for the stored key.
/// When `check_access` is true, probes each model (tiny generate) to label Free vs Paid.
#[tauri::command]
pub async fn ollama_cloud_catalog(check_access: bool) -> Result<OllamaCloudCatalog, String> {
    let api_key = credentials::get_provider_key("ollama")?;
    let client = cloud_client()?;
    let res = client
        .get(format!("{OLLAMA_CLOUD}/api/tags"))
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|e| format!("Ollama Cloud is not reachable at {OLLAMA_CLOUD}: {e}"))?;

    let status = parse_tags(res, "Ollama Cloud").await?;
    if !status.available {
        return Ok(OllamaCloudCatalog {
            available: false,
            models: vec![],
            message: status.message,
            checked: false,
        });
    }

    let mut entries: Vec<OllamaCloudModelEntry> = status
        .models
        .iter()
        .map(|name| {
            let access = heuristic_access(name);
            let detail = match access {
                CloudAccess::Free => "Likely free-tier (not verified yet)".into(),
                CloudAccess::Paid => "Likely Pro/Max (not verified yet)".into(),
                CloudAccess::Unknown => "Access unknown — run Check free / paid".into(),
            };
            OllamaCloudModelEntry {
                name: name.clone(),
                access,
                detail,
            }
        })
        .collect();

    if check_access && !entries.is_empty() {
        for entry in entries.iter_mut() {
            let (access, detail) = probe_cloud_access(&client, &api_key, &entry.name).await;
            entry.access = access;
            entry.detail = detail;
        }
    }

    // Free first, then unknown, then paid — easier to pick a working model.
    entries.sort_by(|a, b| {
        let rank = |a: &CloudAccess| match a {
            CloudAccess::Free => 0,
            CloudAccess::Unknown => 1,
            CloudAccess::Paid => 2,
        };
        rank(&a.access)
            .cmp(&rank(&b.access))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let free_count = entries
        .iter()
        .filter(|e| e.access == CloudAccess::Free)
        .count();
    let paid_count = entries
        .iter()
        .filter(|e| e.access == CloudAccess::Paid)
        .count();

    Ok(OllamaCloudCatalog {
        available: true,
        message: if check_access {
            format!(
                "{} model(s): {} free on your plan, {} require Pro/Max.",
                entries.len(),
                free_count,
                paid_count
            )
        } else {
            format!(
                "{} cloud model(s) listed. Press “Check free / paid” to verify access with your key.",
                entries.len()
            )
        },
        models: entries,
        checked: check_access,
    })
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

/// Tool-calling chat (local Ollama). Messages/tools pass through in Ollama's
/// OpenAI-style format; the raw assistant message is returned as JSON.
#[tauri::command]
pub async fn ollama_chat_tools(
    model: String,
    messages: serde_json::Value,
    tools: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if model.trim().is_empty() {
        return Err("No Ollama model selected. Choose one in Settings → Models.".into());
    }
    if !messages.is_array() || messages.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        return Err("No messages to send.".into());
    }
    let client = local_client()?;
    let mut payload = serde_json::json!({
        "model": model.trim(),
        "messages": messages,
        "stream": false,
    });
    if let Some(tools) = tools {
        if tools.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
            payload["tools"] = tools;
        }
    }
    let res = client
        .post(format!("{OLLAMA_LOCAL}/api/chat"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Ollama local chat failed: {e}"))?;
    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("invalid Ollama chat response: {e}"))?;
    if let Some(err) = body.get("error").and_then(|e| e.as_str()) {
        return Err(format!("Ollama local: {err}"));
    }
    if !status.is_success() {
        return Err(format!("Ollama local error {status}"));
    }
    body.get("message")
        .cloned()
        .ok_or_else(|| "Ollama returned no assistant message.".into())
}
