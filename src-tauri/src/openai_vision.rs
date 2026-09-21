//! OpenAI vision (chat completions + image) for screen understanding.
//! Uses the same OpenAI key as Realtime voice.

use crate::credentials;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const OPENAI_BASE: &str = "https://api.openai.com/v1";
/// Multimodal model available on standard OpenAI keys.
const DEFAULT_VISION_MODEL: &str = "gpt-4o-mini";

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: Vec<ContentPart>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum ContentPart {
    Text {
        #[serde(rename = "type")]
        kind: String,
        text: String,
    },
    Image {
        #[serde(rename = "type")]
        kind: String,
        image_url: ImageUrl,
    },
}

#[derive(Debug, Serialize)]
struct ImageUrl {
    url: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Option<Vec<Choice>>,
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Option<MessageOut>,
}

#[derive(Debug, Deserialize)]
struct MessageOut {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VisionImageIn {
    pub mime_type: Option<String>,
    pub data: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

fn to_data_url(mime: &str, data: &str) -> String {
    let trimmed = data.trim();
    if trimmed.starts_with("data:") {
        return trimmed.to_string();
    }
    format!("data:{mime};base64,{trimmed}")
}

/// Describe one or more images with the stored OpenAI key.
#[tauri::command]
pub async fn openai_vision(
    prompt: String,
    images: Vec<VisionImageIn>,
    system: Option<String>,
) -> Result<String, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Vision prompt is empty.".into());
    }
    if images.is_empty() {
        return Err("At least one image is required.".into());
    }
    if images.len() > 6 {
        return Err("Too many images (max 6).".into());
    }

    let api_key = credentials::get_provider_key("openai")?;
    let mut content: Vec<ContentPart> = Vec::new();
    if let Some(sys) = system.filter(|s| !s.trim().is_empty()) {
        // System goes as a leading text part in the user message for simplicity.
        content.push(ContentPart::Text {
            kind: "text".into(),
            text: format!("{sys}\n\n{prompt}"),
        });
    } else {
        content.push(ContentPart::Text {
            kind: "text".into(),
            text: prompt.to_string(),
        });
    }
    for img in images {
        let mime = img
            .mime_type
            .as_deref()
            .unwrap_or("image/png")
            .trim()
            .to_string();
        let url = to_data_url(&mime, &img.data);
        content.push(ContentPart::Image {
            kind: "image_url".into(),
            image_url: ImageUrl { url },
        });
    }

    let body = ChatRequest {
        model: DEFAULT_VISION_MODEL.into(),
        messages: vec![ChatMessage {
            role: "user".into(),
            content,
        }],
        max_tokens: 800,
    };

    let client = client()?;
    let res = client
        .post(format!("{OPENAI_BASE}/chat/completions"))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI vision request failed: {e}"))?;

    let status = res.status();
    let parsed: ChatResponse = res
        .json()
        .await
        .map_err(|e| format!("invalid OpenAI vision response: {e}"))?;

    if let Some(err) = parsed.error {
        return Err(err
            .message
            .unwrap_or_else(|| format!("OpenAI vision error (HTTP {status})")));
    }
    if !status.is_success() {
        return Err(format!("OpenAI vision HTTP {status}"));
    }

    let text = parsed
        .choices
        .unwrap_or_default()
        .into_iter()
        .filter_map(|c| c.message)
        .filter_map(|m| m.content)
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Err("OpenAI vision returned an empty reply.".into());
    }
    Ok(text)
}
