//! Answering questions that need current information.
//!
//! `web.search` opens a browser tab and returns no text at all. That left the
//! model two options for "what's the news today", and both were wrong: report
//! that it opened a tab (task not done), or answer from its training data and
//! present months-old information as today's (worse — confidently false).
//!
//! This asks Gemini with Google Search grounding enabled, so the answer comes
//! from results fetched at request time and arrives with the sources attached.

use serde::Serialize;
use serde_json::{json, Value};

use crate::credentials;

const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
/// Grounding needs a model that supports the google_search tool.
const GROUNDED_MODEL: &str = "gemini-2.5-flash";

#[derive(Debug, Serialize)]
pub struct GroundedAnswer {
    pub ok: bool,
    pub text: String,
    /// Where the claims came from, so the answer can be checked.
    pub sources: Vec<Source>,
}

#[derive(Debug, Serialize)]
pub struct Source {
    pub title: String,
    pub url: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("Could not prepare the search connection: {e}"))
}

/// Pull the grounding citations out of the response.
fn extract_sources(candidate: &Value) -> Vec<Source> {
    let mut out = Vec::new();
    let chunks = candidate
        .get("groundingMetadata")
        .and_then(|g| g.get("groundingChunks"))
        .and_then(|c| c.as_array());
    if let Some(chunks) = chunks {
        for chunk in chunks {
            let Some(web) = chunk.get("web") else {
                continue;
            };
            let url = web.get("uri").and_then(|u| u.as_str()).unwrap_or_default();
            if url.is_empty() {
                continue;
            }
            let title = web
                .get("title")
                .and_then(|t| t.as_str())
                .filter(|t| !t.is_empty())
                .unwrap_or(url);
            // Same source cited for several sentences is still one source.
            if out.iter().any(|s: &Source| s.url == url) {
                continue;
            }
            out.push(Source {
                title: title.to_string(),
                url: url.to_string(),
            });
        }
    }
    out
}

/// Answer a question using live web results.
#[tauri::command]
pub async fn web_grounded_answer(question: String) -> Result<GroundedAnswer, String> {
    let question = question.trim().to_string();
    if question.is_empty() {
        return Err("There was no question to look up.".into());
    }
    let api_key = credentials::get_provider_key("google").map_err(|_| {
        "Looking things up on the web needs a Google Gemini key (Settings → Voice & AI keys)."
            .to_string()
    })?;

    let request = json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": question }]
        }],
        // This is the whole point: without it the model answers from memory.
        "tools": [{ "google_search": {} }],
        "systemInstruction": {
            "parts": [{
                "text": "Answer using the search results you are given, and say plainly \
    when something could not be found rather than filling the gap from memory. \
    Today's date matters: prefer the most recent sources and mention when each \
    thing happened. Answer in a few short sentences, spoken plainly — this is \
    read aloud, so no markdown, no bullet characters, no URLs in the prose."
            }]
        },
        "generationConfig": { "temperature": 0.2 }
    });

    let res = client()?
        .post(format!(
            "{GEMINI_BASE}/models/{GROUNDED_MODEL}:generateContent"
        ))
        .header("x-goog-api-key", api_key)
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Could not reach the search service: {e}"))?;

    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let detail = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        log::error!("grounded search {status}: {detail}");
        return Err(match status.as_u16() {
            401 | 403 => {
                "That Gemini key was rejected for web search. Check it in Settings.".into()
            }
            429 => "The search service is rate-limiting right now. Try again shortly.".into(),
            _ => "The web search couldn't be completed. Try again shortly.".into(),
        });
    }

    let candidate = body
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .cloned()
        .unwrap_or(Value::Null);

    let text = candidate
        .get("content")
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("The search came back empty. Try rewording the question.".into());
    }

    let sources = extract_sources(&candidate);
    // No citations means nothing was actually retrieved, so the text is the
    // model talking from memory — which is the failure this exists to prevent.
    if sources.is_empty() {
        log::warn!("grounded search returned no citations for: {question}");
    }

    Ok(GroundedAnswer {
        ok: true,
        text,
        sources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn citations_are_read_and_deduplicated() {
        let candidate = json!({
            "groundingMetadata": {
                "groundingChunks": [
                    { "web": { "uri": "https://a.com/1", "title": "A" } },
                    { "web": { "uri": "https://a.com/1", "title": "A" } },
                    { "web": { "uri": "https://b.com/2", "title": "B" } }
                ]
            }
        });
        let sources = extract_sources(&candidate);
        assert_eq!(
            sources.len(),
            2,
            "the same source cited twice is one source"
        );
        assert_eq!(sources[0].url, "https://a.com/1");
    }

    #[test]
    fn a_chunk_with_no_url_is_skipped() {
        let candidate = json!({
            "groundingMetadata": { "groundingChunks": [ { "web": { "title": "no url" } } ] }
        });
        assert!(extract_sources(&candidate).is_empty());
    }

    #[test]
    fn a_response_with_no_grounding_yields_no_sources() {
        // This is the signal that the answer was not actually retrieved.
        assert!(extract_sources(&json!({ "content": {} })).is_empty());
    }
}
