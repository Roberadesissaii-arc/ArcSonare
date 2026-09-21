//! Sending, drafting and replying — the write half of Gmail and Calendar.
//!
//! Gmail takes a whole RFC 2822 message, base64url encoded, rather than
//! structured fields. Threading a reply is not just quoting the original: the
//! reply has to carry In-Reply-To and References headers *and* be posted with
//! the original threadId, or Gmail files it as a brand new conversation.

use serde_json::{json, Value};

use crate::google_api::{
    get_json, google_client, header, GoogleReadResult, CALENDAR_BASE, GMAIL_BASE,
};
use crate::google_oauth;

fn base64url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Build an RFC 2822 message. A header containing a line break is rejected
/// rather than escaped — that is header injection, not a formatting quirk.
fn build_mime(
    to: &str,
    subject: &str,
    body: &str,
    cc: Option<&str>,
    extra_headers: &[(String, String)],
) -> Result<String, String> {
    for (label, value) in [("recipient", to), ("subject", subject)] {
        if value.contains('\n') || value.contains('\r') {
            return Err(format!(
                "That {label} contains a line break, which isn't allowed."
            ));
        }
    }
    let mut msg = String::new();
    msg.push_str(&format!("To: {to}\r\n"));
    if let Some(cc) = cc.filter(|c| !c.trim().is_empty()) {
        if cc.contains('\n') || cc.contains('\r') {
            return Err("That CC address contains a line break, which isn't allowed.".into());
        }
        msg.push_str(&format!("Cc: {cc}\r\n"));
    }
    for (name, value) in extra_headers {
        msg.push_str(&format!("{name}: {value}\r\n"));
    }
    msg.push_str(&format!("Subject: {subject}\r\n"));
    msg.push_str("MIME-Version: 1.0\r\n");
    msg.push_str("Content-Type: text/plain; charset=UTF-8\r\n\r\n");
    msg.push_str(body);
    Ok(msg)
}

async fn gmail_post(path: &str, token: &str, body: Value) -> Result<Value, String> {
    let res = google_client()?
        .post(format!("{GMAIL_BASE}{path}"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Gmail: {e}"))?;
    let status = res.status();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = data
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        log::error!("gmail {path} {status}: {msg}");
        return Err(match status.as_u16() {
            401 => "Your Google sign-in has expired. Open Connect and reconnect Google.".into(),
            403 => "ArcSonare doesn't have permission to send mail yet. Open Connect, reconnect Google and approve sending.".to_string(),
            _ => "Gmail couldn't complete that. Try again shortly.".to_string(),
        });
    }
    Ok(data)
}

/// Send an email.
#[tauri::command]
pub async fn gmail_send_message(
    to: String,
    subject: String,
    body: String,
    cc: Option<String>,
) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Gmail"));
    };
    if to.trim().is_empty() {
        return Err("An email needs a recipient.".into());
    }
    let mime = build_mime(to.trim(), subject.trim(), &body, cc.as_deref(), &[])?;
    let data = gmail_post(
        "/users/me/messages/send",
        &token,
        json!({ "raw": base64url(mime.as_bytes()) }),
    )
    .await?;
    if data.get("id").and_then(|i| i.as_str()).is_none() {
        return Err("Gmail didn't confirm the message was sent.".into());
    }
    Ok(GoogleReadResult::ok(format!("Sent your email to {to}."), 1))
}

/// Save an email as a draft instead of sending it.
#[tauri::command]
pub async fn gmail_create_draft(
    to: String,
    subject: String,
    body: String,
    cc: Option<String>,
) -> Result<Value, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Err("Gmail isn't connected yet. Open Connect and sign in with Google.".into());
    };
    let mime = build_mime(to.trim(), subject.trim(), &body, cc.as_deref(), &[])?;
    let data = gmail_post(
        "/users/me/drafts",
        &token,
        json!({ "message": { "raw": base64url(mime.as_bytes()) } }),
    )
    .await?;
    let id = data
        .get("id")
        .and_then(|i| i.as_str())
        .ok_or("Gmail didn't confirm the draft was saved.")?;
    Ok(json!({
        "draft_id": id,
        "to": to,
        "subject": subject,
        "summary": format!("Saved a draft to {to}."),
    }))
}

/// Replace the contents of an existing draft.
#[tauri::command]
pub async fn gmail_update_draft(
    draft_id: String,
    to: String,
    subject: String,
    body: String,
    cc: Option<String>,
) -> Result<Value, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Err("Gmail isn't connected yet. Open Connect and sign in with Google.".into());
    };
    let mime = build_mime(to.trim(), subject.trim(), &body, cc.as_deref(), &[])?;
    let res = google_client()?
        .put(format!("{GMAIL_BASE}/users/me/drafts/{draft_id}"))
        .bearer_auth(&token)
        .json(&json!({ "message": { "raw": base64url(mime.as_bytes()) } }))
        .send()
        .await
        .map_err(|e| format!("Could not reach Gmail: {e}"))?;
    let status = res.status();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        log::error!("gmail draft update {status}: {data}");
        return Err(match status.as_u16() {
            401 => "Your Google sign-in has expired. Open Connect and reconnect Google.".into(),
            404 => "That draft no longer exists.".into(),
            _ => "Gmail couldn't update that draft. Try again shortly.".into(),
        });
    }
    Ok(json!({
        "draft_id": draft_id,
        "summary": format!("Updated the draft to {to}."),
    }))
}

/// Drafts currently waiting in Gmail.
#[tauri::command]
pub async fn gmail_list_drafts(max_results: Option<u32>) -> Result<Value, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Err("Gmail isn't connected yet. Open Connect and sign in with Google.".into());
    };
    let max = max_results.unwrap_or(20).clamp(1, 100);
    let list = get_json(
        &format!("{GMAIL_BASE}/users/me/drafts?maxResults={max}"),
        &token,
    )
    .await?;

    let mut out = Vec::new();
    if let Some(items) = list.get("drafts").and_then(|d| d.as_array()) {
        for item in items.iter().take(max as usize) {
            let Some(id) = item.get("id").and_then(|i| i.as_str()) else {
                continue;
            };
            let full = get_json(
                &format!("{GMAIL_BASE}/users/me/drafts/{id}?format=metadata"),
                &token,
            )
            .await
            .unwrap_or(Value::Null);
            let message = full.get("message").cloned().unwrap_or(Value::Null);
            out.push(json!({
                "draft_id": id,
                "to": header(&message, "To"),
                "subject": header(&message, "Subject"),
            }));
        }
    }
    let count = out.len();
    Ok(json!({ "drafts": out, "count": count }))
}

/// Reply to a message, keeping it in the same conversation.
#[tauri::command]
pub async fn gmail_reply_message(
    message_id: String,
    body: String,
    reply_all: Option<bool>,
) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Gmail"));
    };
    let original = get_json(
        &format!(
            "{GMAIL_BASE}/users/me/messages/{message_id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References"
        ),
        &token,
    )
    .await?;

    let from = header(&original, "From");
    if from.is_empty() {
        return Err("That message couldn't be read, so there's nothing to reply to.".into());
    }
    let subject = header(&original, "Subject");
    let reply_subject = if subject.to_lowercase().starts_with("re:") {
        subject.clone()
    } else {
        format!("Re: {subject}")
    };
    let msg_id_header = header(&original, "Message-ID");
    let references = header(&original, "References");
    let thread_id = original
        .get("threadId")
        .and_then(|t| t.as_str())
        .unwrap_or_default()
        .to_string();

    // Reply-all keeps the other recipients; a plain reply goes to the sender.
    let cc = if reply_all.unwrap_or(false) {
        let joined = [header(&original, "To"), header(&original, "Cc")]
            .iter()
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        (!joined.is_empty()).then_some(joined)
    } else {
        None
    };

    let mut extra = Vec::new();
    if !msg_id_header.is_empty() {
        extra.push(("In-Reply-To".to_string(), msg_id_header.clone()));
        let refs = if references.is_empty() {
            msg_id_header.clone()
        } else {
            format!("{references} {msg_id_header}")
        };
        extra.push(("References".to_string(), refs));
    }

    let mime = build_mime(&from, &reply_subject, &body, cc.as_deref(), &extra)?;
    let mut payload = json!({ "raw": base64url(mime.as_bytes()) });
    if !thread_id.is_empty() {
        payload["threadId"] = Value::String(thread_id);
    }
    let data = gmail_post("/users/me/messages/send", &token, payload).await?;
    if data.get("id").and_then(|i| i.as_str()).is_none() {
        return Err("Gmail didn't confirm the reply was sent.".into());
    }
    Ok(GoogleReadResult::ok(format!("Replied to {from}."), 1))
}

/// Change an existing calendar event.
#[tauri::command]
pub async fn calendar_update_event(
    event_id: String,
    summary: Option<String>,
    start: Option<String>,
    end: Option<String>,
    description: Option<String>,
) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Google Calendar"));
    };
    let mut patch = serde_json::Map::new();
    if let Some(s) = summary.as_ref().filter(|s| !s.trim().is_empty()) {
        patch.insert("summary".into(), Value::String(s.clone()));
    }
    if let Some(s) = start.as_ref() {
        patch.insert("start".into(), json!({ "dateTime": s }));
    }
    if let Some(e) = end.as_ref() {
        patch.insert("end".into(), json!({ "dateTime": e }));
    }
    if let Some(d) = description.as_ref() {
        patch.insert("description".into(), Value::String(d.clone()));
    }
    if patch.is_empty() {
        return Err("Nothing was given to change on that event.".into());
    }

    let res = google_client()?
        .patch(format!(
            "{CALENDAR_BASE}/calendars/primary/events/{event_id}"
        ))
        .bearer_auth(&token)
        .json(&Value::Object(patch))
        .send()
        .await
        .map_err(|e| format!("Could not reach Google Calendar: {e}"))?;
    let status = res.status();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        log::error!("calendar patch {status}: {data}");
        return Err(match status.as_u16() {
            401 => "Your Google sign-in has expired. Open Connect and reconnect Google.".into(),
            404 => "That event no longer exists.".into(),
            _ => "Google couldn't update that event. Try again shortly.".into(),
        });
    }
    let title = data
        .get("summary")
        .and_then(|s| s.as_str())
        .unwrap_or("the event");
    Ok(GoogleReadResult::ok(format!("Updated \"{title}\"."), 1))
}

/// Remove a calendar event.
#[tauri::command]
pub async fn calendar_delete_event(event_id: String) -> Result<GoogleReadResult, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Ok(GoogleReadResult::not_connected("Google Calendar"));
    };
    let res = google_client()?
        .delete(format!(
            "{CALENDAR_BASE}/calendars/primary/events/{event_id}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Could not reach Google Calendar: {e}"))?;
    let status = res.status();
    // A successful delete returns 204 with no body; 410 means already gone.
    if !status.is_success() && status.as_u16() != 410 {
        log::error!("calendar delete {status}");
        return Err(match status.as_u16() {
            401 => "Your Google sign-in has expired. Open Connect and reconnect Google.".into(),
            404 => "That event no longer exists.".into(),
            _ => "Google couldn't delete that event. Try again shortly.".into(),
        });
    }
    Ok(GoogleReadResult::ok("Deleted that event.".into(), 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_newline_in_a_header_is_refused() {
        // Without this, a crafted subject could inject Bcc and silently copy
        // the message to someone else.
        let err = build_mime("a@b.com", "Hi\r\nBcc: sneak@evil.com", "body", None, &[]);
        assert!(err.is_err());
    }

    #[test]
    fn a_normal_message_has_headers_then_a_blank_line_then_the_body() {
        let mime = build_mime("a@b.com", "Hello", "The body", None, &[]).unwrap();
        assert!(mime.starts_with("To: a@b.com\r\n"));
        assert!(mime.contains("Subject: Hello\r\n"));
        assert!(mime.ends_with("\r\n\r\nThe body"));
    }

    #[test]
    fn reply_headers_are_carried_so_gmail_threads_it() {
        let extra = vec![
            ("In-Reply-To".to_string(), "<abc@mail>".to_string()),
            ("References".to_string(), "<abc@mail>".to_string()),
        ];
        let mime = build_mime("a@b.com", "Re: Hello", "sure", None, &extra).unwrap();
        assert!(mime.contains("In-Reply-To: <abc@mail>"));
        assert!(mime.contains("References: <abc@mail>"));
    }
}
