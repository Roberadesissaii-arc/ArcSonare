//! Google Workspace reads (Gmail / Calendar / Drive).
//!
//! The OAuth layer in `google_oauth.rs` owns the tokens; this module only
//! borrows a valid one and talks to the REST APIs. Every command returns a
//! plain-text summary the assistant can quote directly, so the model never has
//! to invent structure from raw JSON.
//!
//! Failure policy: "not connected" is a normal outcome, not an error — the
//! assistant must be able to say so honestly rather than surfacing a stack of
//! plumbing errors to the user.

use crate::google_oauth;
use futures_util::future::join_all;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
use std::time::Duration;

pub(crate) const GMAIL_BASE: &str = "https://gmail.googleapis.com/gmail/v1";
pub(crate) const CALENDAR_BASE: &str = "https://www.googleapis.com/calendar/v3";
const DRIVE_BASE: &str = "https://www.googleapis.com/drive/v3";
const GOOGLE_CONNECT_TIMEOUT: Duration = Duration::from_secs(6);
const GOOGLE_REQUEST_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleReadResult {
    /// false = not connected / expired. The caller reports this honestly.
    pub ok: bool,
    /// Human-readable summary, ready to show or speak.
    pub text: String,
    /// Number of items found (0 when ok is false).
    pub count: usize,
}

impl GoogleReadResult {
    pub(crate) fn not_connected(service: &str) -> Self {
        Self {
            ok: false,
            text: format!("{service} isn't connected yet. Open Connect and sign in with Google."),
            count: 0,
        }
    }
    pub(crate) fn ok(text: String, count: usize) -> Self {
        Self {
            ok: true,
            text,
            count,
        }
    }
}

/// Safe char-boundary truncation (never panics on multi-byte UTF-8).
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push('…');
    out
}

pub(crate) fn google_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(GOOGLE_CONNECT_TIMEOUT)
        .timeout(GOOGLE_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Could not prepare the Google connection: {e}"))
}

pub(crate) async fn get_json(url: &str, token: &str) -> Result<serde_json::Value, String> {
    let res = google_client()?
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Could not reach Google: {e}"))?;

    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let msg = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        // Google's raw 401 text (console URLs, "login cookie", …) is developer
        // output — never show it to the user.
        log::error!("google api {status}: {msg}");
        return Err(match status.as_u16() {
            401 => "Your Google sign-in has expired. Open Connect and reconnect Google.".into(),
            403 => {
                "ArcSonare doesn't have permission for that yet. Reconnect Google and approve access."
                    .to_string()
            }
            429 => "Google is rate-limiting requests right now. Try again shortly.".to_string(),
            _ => "Google couldn't complete that request. Try again shortly.".to_string(),
        });
    }
    Ok(body)
}

/// Pull a header value out of a Gmail payload's header list.
pub(crate) fn header(payload: &serde_json::Value, name: &str) -> String {
    payload
        .get("payload")
        .and_then(|p| p.get("headers"))
        .and_then(|h| h.as_array())
        .and_then(|headers| {
            headers
                .iter()
                .find(|h| {
                    h.get("name")
                        .and_then(|n| n.as_str())
                        .is_some_and(|n| n.eq_ignore_ascii_case(name))
                })
                .and_then(|h| h.get("value"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("")
        .to_string()
}

/// Recent inbox messages, newest first. `query` accepts Gmail search syntax
/// (e.g. `is:unread`, `from:someone@x.com`).
#[tauri::command]
pub async fn gmail_list_messages(
    max_results: Option<u32>,
    query: Option<String>,
) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Gmail"));
    };
    let max = max_results.unwrap_or(5).clamp(1, 20);
    let q = query.unwrap_or_default();
    let url = format!(
        "{GMAIL_BASE}/users/me/messages?maxResults={max}{}",
        if q.trim().is_empty() {
            String::new()
        } else {
            format!("&q={}", utf8_percent_encode(q.trim(), NON_ALPHANUMERIC))
        }
    );

    let list = get_json(&url, &token).await?;
    let ids: Vec<String> = list
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    if ids.is_empty() {
        let label = if q.trim().is_empty() {
            "Your inbox is empty.".to_string()
        } else {
            format!("No emails matched \"{}\".", q.trim())
        };
        return Ok(GoogleReadResult::ok(label, 0));
    }

    // Fetch metadata concurrently. Sequential requests multiplied the network
    // delay by the number of emails and made chat appear permanently stuck.
    let detail_requests = ids.iter().map(|id| {
        let detail_url = format!(
            "{GMAIL_BASE}/users/me/messages/{id}?format=metadata\
             &metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date"
        );
        let token = token.clone();
        async move { get_json(&detail_url, &token).await.ok() }
    });
    let messages = join_all(detail_requests).await;
    // Markdown table only — chat renders tables; the AI presents, never dumps
    // long snippets. Keep a parallel "- From:" block for parsers that need it.
    let mut blocks = Vec::with_capacity(messages.len());
    let mut table_rows = Vec::with_capacity(messages.len());
    for msg in messages.into_iter().flatten() {
        let from = header(&msg, "From");
        let subject = {
            let s = header(&msg, "Subject");
            if s.is_empty() {
                "(no subject)".into()
            } else {
                s
            }
        };
        let date = header(&msg, "Date");
        blocks.push(format!("- From: {from}\n  Subject: {subject}\n  {date}"));
        let from_cell = from.replace('|', "/");
        let subject_cell = subject.replace('|', "/");
        let date_cell = date.replace('|', "/");
        table_rows.push(format!("| {from_cell} | {subject_cell} | {date_cell} |"));
    }

    let count = table_rows.len();
    let body = if table_rows.is_empty() {
        format!("{count} recent email(s).")
    } else {
        format!(
            "**{count} recent emails**\n\n| From | Subject | When |\n| --- | --- | --- |\n{}\n\n{}",
            table_rows.join("\n"),
            blocks.join("\n")
        )
    };
    Ok(GoogleReadResult::ok(body, count))
}

/// Full body of one message.
#[tauri::command]
pub async fn gmail_read_message(message_id: String) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Gmail"));
    };
    let url = format!("{GMAIL_BASE}/users/me/messages/{message_id}?format=full");
    let msg = get_json(&url, &token).await?;

    /// Walk the MIME tree for the first decodable text part.
    /// Gmail encodes part bodies as base64url without padding.
    fn body_text(payload: &serde_json::Value) -> String {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine;

        if let Some(data) = payload
            .get("body")
            .and_then(|b| b.get("data"))
            .and_then(|d| d.as_str())
        {
            if let Ok(bytes) = URL_SAFE_NO_PAD.decode(data.trim_end_matches('=')) {
                return String::from_utf8_lossy(&bytes).to_string();
            }
        }
        let empty = vec![];
        for part in payload
            .get("parts")
            .and_then(|p| p.as_array())
            .unwrap_or(&empty)
        {
            let text = body_text(part);
            if !text.is_empty() {
                return text;
            }
        }
        String::new()
    }

    let raw = msg.get("payload").map(body_text).unwrap_or_default();
    // Strip tags/whitespace so the model gets prose, not markup.
    let stripped = raw
        .split('<')
        .map(|chunk| chunk.split_once('>').map_or(chunk, |(_, rest)| rest))
        .collect::<Vec<_>>()
        .join(" ");
    let collapsed = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    let body = truncate_chars(&collapsed, 2000);

    Ok(GoogleReadResult::ok(
        format!(
            "Subject: {}\nFrom: {}\nDate: {}\n\n{body}",
            header(&msg, "Subject"),
            header(&msg, "From"),
            header(&msg, "Date"),
        ),
        1,
    ))
}

/// Calendar events in an optional window.
/// - `time_min` / `time_max`: RFC3339 bounds (e.g. start/end of August 8).
/// - Defaults: time_min = now when omitted (upcoming from this moment).
#[tauri::command]
pub async fn calendar_list_events(
    max_results: Option<u32>,
    time_min: Option<String>,
    time_max: Option<String>,
    range_label: Option<String>,
) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Google Calendar"));
    };
    let max = max_results.unwrap_or(10).clamp(1, 25);
    let min = time_min
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(chrono_now_rfc3339);
    let label = range_label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("this range");

    let mut url = format!(
        "{CALENDAR_BASE}/calendars/primary/events?singleEvents=true&orderBy=startTime\
         &maxResults={max}&timeMin={}",
        utf8_percent_encode(&min, NON_ALPHANUMERIC)
    );
    if let Some(max_time) = time_max.filter(|t| !t.trim().is_empty()) {
        url.push_str(&format!(
            "&timeMax={}",
            utf8_percent_encode(max_time.trim(), NON_ALPHANUMERIC)
        ));
    }

    let data = get_json(&url, &token).await?;
    let empty = vec![];
    let items = data
        .get("items")
        .and_then(|i| i.as_array())
        .unwrap_or(&empty);

    if items.is_empty() {
        // Honest, specific empty — never invent email-style tables.
        return Ok(GoogleReadResult::ok(
            format!("No events on your calendar for {label}."),
            0,
        ));
    }

    let rows: Vec<String> = items
        .iter()
        .map(|ev| {
            let title = ev
                .get("summary")
                .and_then(|s| s.as_str())
                .unwrap_or("(no title)")
                .replace('|', "/");
            let start_raw = ev
                .get("start")
                .and_then(|s| s.get("dateTime").or_else(|| s.get("date")))
                .and_then(|s| s.as_str())
                .unwrap_or("");
            let start = format_calendar_when(start_raw).replace('|', "/");
            let location = ev
                .get("location")
                .and_then(|l| l.as_str())
                .unwrap_or("")
                .replace('|', "/");
            let loc = if location.is_empty() {
                "—".to_string()
            } else {
                location
            };
            format!("| {title} | {start} | {loc} |")
        })
        .collect();

    let count = rows.len();
    // Facts for the presentation layer — short heading + table (AI greets by name).
    let heading = if count == 1 {
        format!("**1 event on {label}**")
    } else {
        format!("**{count} events on {label}**")
    };
    Ok(GoogleReadResult::ok(
        format!(
            "{heading}\n\n| Event | When | Where |\n| --- | --- | --- |\n{}",
            rows.join("\n")
        ),
        count,
    ))
}

/// "2026-08-08T14:30:00-04:00" → "Aug 8, 2:30 PM" (local offset already in string).
fn format_calendar_when(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return "—".into();
    }
    // All-day date: 2026-08-08
    if s.len() == 10 && s.as_bytes().get(4) == Some(&b'-') {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
            return d.format("%b %e").to_string().replace("  ", " ");
        }
    }
    // RFC3339 with offset
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        let formatted = dt.format("%b %e, %I:%M %p").to_string().replace("  ", " ");
        // Drop leading zero on hour if present: "02:30" → keep as chrono gives
        return formatted.replace(" 0", " ");
    }
    s.to_string()
}

/// Creates an event on the primary calendar.
/// `start`/`end` are RFC3339 with offset (the frontend resolves "today at 1:30").
#[tauri::command]
pub async fn calendar_create_event(
    summary: String,
    start: String,
    end: String,
    description: Option<String>,
) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Google Calendar"));
    };
    let title = summary.trim();
    if title.is_empty() {
        return Err("An event needs a title.".into());
    }

    let mut body = serde_json::json!({
        "summary": title,
        "start": { "dateTime": start },
        "end": { "dateTime": end },
    });
    if let Some(desc) = description.filter(|d| !d.trim().is_empty()) {
        body["description"] = serde_json::Value::String(desc);
    }

    let res = google_client()?
        .post(format!("{CALENDAR_BASE}/calendars/primary/events"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Google Calendar: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let msg = data
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        log::error!("calendar insert {status}: {msg}");
        return Err(match status.as_u16() {
            401 => "Your Google sign-in has expired. Open Connect and reconnect Google.".into(),
            403 => "ArcSonare doesn't have permission to add calendar events. Reconnect Google and approve calendar access.".to_string(),
            _ => "Google couldn't create that event. Try again shortly.".to_string(),
        });
    }

    // Only claim success once Google returns a real event id.
    let created = data.get("id").and_then(|i| i.as_str()).is_some();
    if !created {
        return Err("Google didn't confirm the event was created.".into());
    }
    Ok(GoogleReadResult::ok(
        format!("Added \"{title}\" to your calendar."),
        1,
    ))
}

/// Recent Drive files, most recently modified first.
#[tauri::command]
pub async fn drive_list_files(
    max_results: Option<u32>,
    query: Option<String>,
) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Google Drive"));
    };
    let max = max_results.unwrap_or(10).clamp(1, 25);
    let mut url = format!(
        "{DRIVE_BASE}/files?pageSize={max}&orderBy=modifiedTime desc\
         &fields=files(name,mimeType,modifiedTime,webViewLink)"
    );
    if let Some(q) = query.filter(|q| !q.trim().is_empty()) {
        // `name contains` is the safest general-purpose Drive filter.
        let escaped = q.trim().replace('\'', "\\'");
        url.push_str(&format!(
            "&q={}",
            utf8_percent_encode(&format!("name contains '{escaped}'"), NON_ALPHANUMERIC)
        ));
    }

    let data = get_json(&url, &token).await?;
    let empty = vec![];
    let files = data
        .get("files")
        .and_then(|f| f.as_array())
        .unwrap_or(&empty);

    if files.is_empty() {
        return Ok(GoogleReadResult::ok("No files found in Drive.".into(), 0));
    }

    let rows: Vec<String> = files
        .iter()
        .map(|f| {
            let name = f
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("(unnamed)")
                .replace('|', "/");
            let modified = f
                .get("modifiedTime")
                .and_then(|m| m.as_str())
                .unwrap_or("—")
                .replace('|', "/");
            let mime = f
                .get("mimeType")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .replace('|', "/");
            let kind = if mime.contains("folder") {
                "folder"
            } else if mime.is_empty() {
                "file"
            } else {
                mime.rsplit('/').next().unwrap_or("file")
            };
            format!("| {name} | {kind} | {modified} |")
        })
        .collect();

    let count = rows.len();
    Ok(GoogleReadResult::ok(
        format!(
            "**{count} files in Drive**\n\n| Name | Type | Modified |\n| --- | --- | --- |\n{}",
            rows.join("\n")
        ),
        count,
    ))
}

/// RFC3339 timestamp for "now" — Calendar's timeMin requires it.
fn chrono_now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
