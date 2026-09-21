//! Google Gemini API — generateContent at generativelanguage.googleapis.com
//!
//! Text chat + multimodal vision (inline base64 images) for screen understanding
//! and click-target detection.

use crate::chat_message::ChatMessage;
use crate::credentials;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

/// Text + vision Gemini models (generateContent supports images on these).
const ALLOWED_MODELS: &[&str] = &[
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro",
    "gemini-3-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    // User docs / cookbook also reference flash-class vision models:
    "gemini-3.6-flash",
    "gemini-2.0-flash",
];

#[derive(Debug, Serialize)]
struct InlineData {
    mime_type: String,
    data: String,
}

#[derive(Debug, Serialize)]
struct Part {
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(rename = "inline_data", skip_serializing_if = "Option::is_none")]
    inline_data: Option<InlineData>,
}

impl Part {
    fn text(s: impl Into<String>) -> Self {
        Self {
            text: Some(s.into()),
            inline_data: None,
        }
    }
    fn image(mime_type: impl Into<String>, data: impl Into<String>) -> Self {
        Self {
            text: None,
            inline_data: Some(InlineData {
                mime_type: mime_type.into(),
                data: data.into(),
            }),
        }
    }
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
    #[serde(rename = "generationConfig", skip_serializing_if = "Option::is_none")]
    generation_config: Option<serde_json::Value>,
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

/// One image for multimodal vision (raw base64, no data: prefix).
#[derive(Debug, Deserialize)]
pub struct VisionImage {
    pub mime_type: String,
    /// Base64 payload (with or without data URL prefix — stripped if present).
    pub data: String,
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
            "Unsupported Gemini model '{model}'. Choose a vision-capable text model such as gemini-3.5-flash or gemini-2.5-flash."
        ));
    }
    Ok(model.to_string())
}

fn strip_data_url(data: &str) -> (String, Option<String>) {
    let data = data.trim();
    if let Some(rest) = data.strip_prefix("data:") {
        // data:image/png;base64,XXXX
        if let Some((meta, b64)) = rest.split_once(',') {
            let mime = meta
                .split(';')
                .next()
                .filter(|m| !m.is_empty())
                .map(|s| s.to_string());
            return (b64.trim().to_string(), mime);
        }
    }
    (data.to_string(), None)
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
                last.parts.push(Part::text(text));
                continue;
            }
        }
        contents.push(Content {
            role: Some(gemini_role.to_string()),
            parts: vec![Part::text(text)],
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
                parts: vec![Part::text("Continue.")],
            },
        );
    }

    let system_instruction = if system_parts.is_empty() {
        None
    } else {
        Some(Content {
            role: None,
            parts: vec![Part::text(system_parts.join("\n\n"))],
        })
    };

    Ok(GenerateRequest {
        contents,
        system_instruction,
        generation_config: None,
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

async fn post_generate(model: &str, request: &GenerateRequest) -> Result<String, String> {
    let api_key = credentials::get_provider_key("google")?;
    let client = client()?;
    let url = format!("{GEMINI_BASE}/models/{model}:generateContent");

    let res = client
        .post(&url)
        .header("x-goog-api-key", api_key)
        .header("Content-Type", "application/json")
        .json(request)
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

/// Non-streaming text chat via Gemini generateContent.
#[tauri::command]
pub async fn gemini_chat(model: String, messages: Vec<ChatMessage>) -> Result<String, String> {
    let model = validate_model(&model)?;
    let request = build_request(&messages)?;
    post_generate(&model, &request).await
}

/// Multimodal vision: text prompt + one or more images (inline base64).
/// Used for "what's on my screen" and click-target detection.
#[tauri::command]
pub async fn gemini_vision(
    model: String,
    prompt: String,
    images: Vec<VisionImage>,
    system: Option<String>,
) -> Result<String, String> {
    let model = validate_model(&model)?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Vision prompt is empty.".into());
    }
    if images.is_empty() {
        return Err("At least one image is required for vision.".into());
    }
    if images.len() > 8 {
        return Err("Too many images (max 8).".into());
    }

    let mut parts: Vec<Part> = Vec::with_capacity(images.len() + 1);
    parts.push(Part::text(prompt));
    for img in images {
        let (data, mime_from_url) = strip_data_url(&img.data);
        if data.is_empty() {
            return Err("Image data is empty.".into());
        }
        // ~15MB base64 safety (inline limit is 20MB total request).
        if data.len() > 15_000_000 {
            return Err("Image is too large for inline vision; use a smaller screenshot.".into());
        }
        let mime = mime_from_url
            .or_else(|| {
                let m = img.mime_type.trim();
                if m.is_empty() {
                    None
                } else {
                    Some(m.to_string())
                }
            })
            .unwrap_or_else(|| "image/png".into());
        parts.push(Part::image(mime, data));
    }

    let system_instruction = system
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| Content {
            role: None,
            parts: vec![Part::text(s)],
        });

    let request = GenerateRequest {
        contents: vec![Content {
            role: Some("user".into()),
            parts,
        }],
        system_instruction,
        // Minimal thinking helps structured detection (per Gemini vision notes).
        generation_config: Some(serde_json::json!({
            "temperature": 0.2,
        })),
    };

    post_generate(&model, &request).await
}
