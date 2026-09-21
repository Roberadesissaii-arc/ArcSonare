//! A debug-only record of what one locate attempt actually did.
//!
//! "The vision model didn't find the person" is a conclusion, not an
//! observation. Between the request and that sentence there is a capture, a
//! provider choice, a prompt category, a response, a parse and several
//! rejections — and any of them can produce the same message. This writes one
//! line per attempt so the answer comes from the run rather than from reading
//! the code and guessing.
//!
//! What may be written is a closed set, defined by `LocateTrace`. Credentials,
//! prompts, image bytes and provider response bodies are not in it: a prompt
//! can contain the user's own words about a private picture, and a response
//! body can quote the request that produced it. Only shapes, categories and
//! counts are recorded.

#![cfg(debug_assertions)]

use serde::{Deserialize, Serialize};
use std::io::Write;

/// One attempt, as a closed set of fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocateTrace {
    pub at: String,
    /// What the user asked for, in their words. Not private image content — it
    /// is the request itself, which is already in the transcript.
    pub requested_target: String,
    /// After pronoun and reference resolution.
    pub resolved_target: String,
    /// `visual-content` | `ui-control` | `face-within-parent`.
    pub locator_mode: String,
    pub provider: String,
    /// `available` | `missing-credential` | `disabled` | `unavailable`.
    pub provider_status: String,
    /// The exact function that ran, so a fallback is visible rather than
    /// inferred.
    pub locator_function: String,
    pub image_attached: bool,
    pub image_width: u32,
    pub image_height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor_id: Option<String>,
    /// A category name, never the prompt text.
    pub prompt_category: String,
    /// Top-level key names of the parsed response. Names only, no values.
    pub response_shape: Vec<String>,
    pub candidate_count: u32,
    /// `box_2d-0-1000` | `normalized-0-1` | `none`.
    pub box_format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    /// Horizontal centres of the candidates, in the canonical 0–1 space. Enough
    /// to see that the leftmost was chosen; not enough to reconstruct a picture.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidate_centres_x: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejection_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
    /// Capture sanity, so "the model failed" can be distinguished from "we
    /// photographed a black rectangle".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_non_empty_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_mostly_black: Option<bool>,
}

fn trace_path() -> Option<std::path::PathBuf> {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("test-output");
    std::fs::create_dir_all(&root).ok()?;
    Some(root.join("locate-trace.jsonl"))
}

/// Append one attempt. Debug builds only — the module does not exist elsewhere.
#[tauri::command]
pub fn locate_trace_write(trace: LocateTrace) {
    let Some(path) = trace_path() else { return };
    let Ok(line) = serde_json::to_string(&trace) else {
        return;
    };
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

/// Read the attempts back, newest last. For the physical test runner.
#[tauri::command]
pub fn locate_trace_read(limit: usize) -> Vec<LocateTrace> {
    let Some(path) = trace_path() else {
        return Vec::new();
    };
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let all: Vec<LocateTrace> = contents
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    let start = all.len().saturating_sub(limit);
    all[start..].to_vec()
}

#[tauri::command]
pub fn locate_trace_clear() {
    if let Some(path) = trace_path() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> LocateTrace {
        LocateTrace {
            at: "2026-08-03T01:00:00Z".into(),
            requested_target: "the person on the left".into(),
            resolved_target: "the person on the left".into(),
            locator_mode: "visual-content".into(),
            provider: "gemini".into(),
            provider_status: "available".into(),
            locator_function: "geminiLocateContent".into(),
            image_attached: true,
            image_width: 3840,
            image_height: 1080,
            source_window_id: Some("5508174".into()),
            monitor_id: Some("1".into()),
            prompt_category: "content-locator".into(),
            response_shape: vec!["found".into(), "box_2d".into()],
            candidate_count: 2,
            box_format: "box_2d-0-1000".into(),
            confidence: Some(0.91),
            candidate_centres_x: vec![0.21, 0.68],
            selected_index: Some(0),
            rejection_reason: None,
            fallback_reason: None,
            capture_non_empty_ratio: Some(0.97),
            capture_mostly_black: Some(false),
        }
    }

    /// The trace must not be able to carry a secret or an image, whatever a
    /// future change to the struct looks like. Serialising it is how it reaches
    /// disk, so serialising it is what gets checked.
    #[test]
    fn the_trace_carries_no_secret_and_no_image() {
        let json = serde_json::to_string(&sample()).unwrap();
        for forbidden in [
            "apiKey",
            "api_key",
            "authorization",
            "Bearer",
            "imageData",
            "dataUrl",
            "base64",
            "promptText",
            "responseBody",
        ] {
            assert!(
                !json.contains(forbidden),
                "the trace exposed {forbidden}: {json}"
            );
        }
    }

    /// Every field is a name, a category, a count or a coordinate — never a
    /// payload. Asserted by size: a trace that grew an image would blow past it.
    #[test]
    fn a_trace_line_stays_small() {
        let json = serde_json::to_string(&sample()).unwrap();
        assert!(json.len() < 900, "trace line is {} bytes", json.len());
    }

    #[test]
    fn a_rejection_records_why_without_quoting_the_response() {
        let mut t = sample();
        t.candidate_count = 0;
        t.rejection_reason = Some("no-candidates".into());
        t.fallback_reason = Some("gemini-error".into());
        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("no-candidates"));
        assert!(json.contains("gemini-error"));
        assert!(!json.contains("{\"error\""), "a provider body leaked in");
    }
}
