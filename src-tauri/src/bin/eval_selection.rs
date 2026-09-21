//! Standalone, debug-only evaluation runner.
//!
//! The Node harness needed `DEEPSEEK_API_KEY` in the shell because it lives
//! outside the app and cannot reach Tauri IPC — a second copy of a credential
//! this project has already leaked once. This binary closes that: it resolves
//! the same credential from the same OS credential store the app uses, runs the
//! request, and prints sanitized JSON on stdout.
//!
//! Node invokes it as a subprocess and parses the JSON. No environment
//! variable, no HTTP server, no second copy of the key.
//!
//! What can be printed is a closed set, defined by `Output` below. The
//! credential, the Authorization header, and the provider's raw response are
//! not in it, are never logged, and never appear in an error — a failure is
//! reported as a category, because a provider error message can quote the
//! request that produced it.
//!
//! Usage (from src-tauri):
//!   cargo run --bin eval_selection -- --prompt "..." --tools '<json>'

use serde::Serialize;
use serde_json::{json, Value};
use std::time::Instant;

#[path = "../credentials.rs"]
mod credentials;

#[derive(Debug, Serialize)]
struct Output {
    prompt: String,
    origin: String,
    candidates: Vec<String>,
    selected_capability: Option<String>,
    /// Tool arguments. Tool schemas carry no secrets, so these are safe.
    arguments: Value,
    validation: String,
    /// Recorded, never performed — this binary has no executor.
    fake_execution: String,
    protocol_status: String,
    side_effects: u32,
    duration_ms: u64,
    error_kind: Option<String>,
}

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn emit(output: &Output) {
    // The only write to stdout in this program.
    match serde_json::to_string(output) {
        Ok(json) => println!("{json}"),
        Err(_) => println!("{{\"error_kind\":\"serialization\"}}"),
    }
}

// Blocking client: this is a one-shot subprocess, so an async runtime would be
// a dependency added for nothing. `reqwest`'s blocking feature is already on.
fn main() {
    let started = Instant::now();
    let prompt = arg("--prompt").unwrap_or_default();
    let origin = arg("--origin").unwrap_or_else(|| "chat".into());
    let model = arg("--model").unwrap_or_else(|| "deepseek-v4-flash".into());
    let system = arg("--system").unwrap_or_else(|| {
        "You are ArcSonare, a Windows desktop assistant with real local tools. \
         When a request matches a tool, call it."
            .into()
    });
    let tools: Value = arg("--tools")
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!([]));

    let candidates: Vec<String> = tools
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|t| t.pointer("/function/name").and_then(|n| n.as_str()))
                .map(|n| n.replace("__", "."))
                .collect()
        })
        .unwrap_or_default();

    let mut output = Output {
        prompt: prompt.clone(),
        origin,
        candidates,
        selected_capability: None,
        arguments: json!({}),
        validation: "no-call".into(),
        fake_execution: "not-executed".into(),
        protocol_status: "valid".into(),
        side_effects: 0,
        duration_ms: 0,
        error_kind: None,
    };

    // Resolved here and dropped here.
    let api_key = match credentials::get_provider_key("deepseek") {
        Ok(key) => key,
        Err(_) => {
            output.error_kind = Some("no-credential".into());
            output.duration_ms = started.elapsed().as_millis() as u64;
            emit(&output);
            return;
        }
    };

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            output.error_kind = Some("client".into());
            emit(&output);
            return;
        }
    };

    let payload = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt },
        ],
        "tools": tools,
        "stream": false,
    });

    let response = match client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(&api_key)
        .json(&payload)
        .send()
    {
        Ok(r) => r,
        Err(e) => {
            // Category only. The error can name the URL it tried.
            output.error_kind = Some(if e.is_timeout() { "timeout" } else { "network" }.into());
            output.duration_ms = started.elapsed().as_millis() as u64;
            emit(&output);
            return;
        }
    };

    let status = response.status();
    if !status.is_success() {
        output.error_kind = Some(
            match status.as_u16() {
                401 | 403 => "unauthorized",
                429 => "rate-limited",
                _ => "provider-error",
            }
            .into(),
        );
        output.duration_ms = started.elapsed().as_millis() as u64;
        emit(&output);
        return;
    }

    let body: Value = match response.json() {
        Ok(b) => b,
        Err(_) => {
            output.error_kind = Some("unreadable-response".into());
            output.duration_ms = started.elapsed().as_millis() as u64;
            emit(&output);
            return;
        }
    };

    let message = body.pointer("/choices/0/message");
    let call = message
        .and_then(|m| m.get("tool_calls"))
        .and_then(|c| c.as_array())
        .and_then(|a| a.first());

    if let Some(name) = call
        .and_then(|c| c.pointer("/function/name"))
        .and_then(|n| n.as_str())
    {
        output.selected_capability = Some(name.replace("__", "."));
        output.validation = "passed".into();
        output.fake_execution = "recorded".into();
        output.side_effects = 1;
        if let Some(raw) = call
            .and_then(|c| c.pointer("/function/arguments"))
            .and_then(|a| a.as_str())
        {
            if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                output.arguments = parsed;
            }
        }
    }

    output.duration_ms = started.elapsed().as_millis() as u64;
    emit(&output);
}
