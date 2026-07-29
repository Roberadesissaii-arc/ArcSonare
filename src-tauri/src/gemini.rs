//! Google Gemini API — generateContent at generativelanguage.googleapis.com
//!
//! Text / multimodal chat only. Image, video, robotics, and Live models are
//! not exposed through this bridge.

use crate::credentials;
use crate::ollama::ChatMessage;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

/// Text-generation Gemini models only (no image / video / robotics / Live / TTS).
const ALLOWED_MODELS: &[&str] = &[
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro",
    "gemini-3-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
];

#[derive(Debug, Serialize)]
struct Part {
    text: String,
}

#[derive(Debug, Serialize)]
struct Content {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    parts: Vec<Part>,
}

#[derive(Debug, Serialize)]
struct GenerateRequest {
    contents: Vec<Content>,
    #[serde(rename = "systemInstruction", skip_serializing_if = "Option::is_none")]
    system_instruction: Option<Content>,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    candidates: Option<Vec<Candidate>>,
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    content: Option<ResponseContent>,
}

#[derive(Debug, Deserialize)]
struct ResponseContent {
    parts: Option<Vec<ResponsePart>>,
}

#[derive(Debug, Deserialize)]
struct ResponsePart {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: Option<String>,
    status: Option<String>,
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
            "Unsupported Gemini model '{model}'. Choose a text model such as gemini-3.5-flash or gemini-2.5-flash."
        ));
    }
    Ok(model.to_string())
}

fn build_request(messages: &[ChatMessage]) -> Result<GenerateRequest, String> {
    if messages.is_empty() {
        return Err("No messages to send.".into());
    }

    let mut system_parts: Vec<String> = Vec::new();
    let mut contents: Vec<Content> = Vec::new();

    for msg in messages {
        let role = msg.role.trim().to_lowercase();
        let text = msg.content.trim();
        if text.is_empty() {
            continue;
        }
        if role == "system" {
            system_parts.push(text.to_string());
            continue;
        }
        let gemini_role = if role == "assistant" || role == "model" {
            "model"
        } else {
            "user"
        };
        // Gemini requires alternating user/model; merge consecutive same-role turns.
        if let Some(last) = contents.last_mut() {
            if last.role.as_deref() == Some(gemini_role) {
                last.parts.push(Part {
                    text: text.to_string(),
                });
                continue;
            }
        }
        contents.push(Content {
            role: Some(gemini_role.to_string()),
            parts: vec![Part {
                text: text.to_string(),
            }],
        });
    }

    if contents.is_empty() {
        return Err("No user message to send to Gemini.".into());
    }
    // First turn must be user.
    if contents[0].role.as_deref() != Some("user") {
        contents.insert(
            0,
            Content {
                role: Some("user".into()),
                parts: vec![Part {
                    text: "Continue.".into(),
                }],
            },
        );
    }

    let system_instruction = if system_parts.is_empty() {
        None
    } else {
        Some(Content {
            role: None,
            parts: vec![Part {
                text: system_parts.join("\n\n"),
            }],
        })
    };

    Ok(GenerateRequest {
        contents,
        system_instruction,
    })
}

fn extract_text(body: GenerateResponse) -> Result<String, String> {
    if let Some(err) = body.error {
        return Err(err
            .message
            .unwrap_or_else(|| err.status.unwrap_or_else(|| "Gemini API error".into())));
    }
    let text = body
        .candidates
        .unwrap_or_default()
        .into_iter()
        .flat_map(|c| c.content.into_iter())
        .flat_map(|c| c.parts.unwrap_or_default())
        .filter_map(|p| p.text)
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Err("Gemini returned an empty reply.".into());
    }
    Ok(text)
}

/// Non-streaming text chat via Gemini generateContent.
#[tauri::command]
pub async fn gemini_chat(model: String, messages: Vec<ChatMessage>) -> Result<String, String> {
    let model = validate_model(&model)?;
    let api_key = credentials::get_provider_key("google")?;
    let request = build_request(&messages)?;
    let client = client()?;
    let url = format!("{GEMINI_BASE}/models/{model}:generateContent");

    let res = client
        .post(&url)
        .header("x-goog-api-key", api_key)
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    let status = res.status();
    let body: GenerateResponse = res
        .json()
        .await
        .map_err(|e| format!("invalid Gemini response: {e}"))?;

    if !status.is_success() {
        if let Some(err) = body.error {
            return Err(err
                .message
                .unwrap_or_else(|| format!("Gemini HTTP {status}")));
        }
        return Err(format!("Gemini HTTP {status}"));
    }

    extract_text(body)
}
