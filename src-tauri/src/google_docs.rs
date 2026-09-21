//! Google Docs authoring.
//!
//! The point of this module is that a document should come out looking like
//! someone wrote it, not like text was dumped into a box. The model writes
//! plain Markdown — headings, bullets, numbered steps, bold — and this turns
//! that into real Docs structure: heading styles, bulleted and numbered lists,
//! and paragraph spacing.
//!
//! Order matters and is the easy thing to get wrong. Docs indexes are computed
//! over the document as it exists when a request runs, so every insert shifts
//! everything after it. All the text goes in as one insert first, ranges are
//! measured against that final text, and the styling requests are then applied
//! back-to-front so earlier ranges stay valid.

use serde_json::{json, Value};

use crate::google_oauth;

const DOCS_BASE: &str = "https://docs.googleapis.com/v1";
const DRIVE_FILES: &str = "https://www.googleapis.com/drive/v3/files";

/// One line of the document, already classified.
enum Block {
    Heading { level: u8, text: String },
    Bullet(String),
    Numbered(String),
    Paragraph(String),
    Blank,
}

/// Bold spans, as character offsets into the emitted line.
struct Line {
    text: String,
    bold: Vec<(usize, usize)>,
}

/// Strip `**bold**` markers and record where the bold runs were.
fn extract_bold(raw: &str) -> Line {
    let chars: Vec<char> = raw.chars().collect();
    let mut text = String::new();
    let mut bold = Vec::new();
    let mut i = 0;
    let mut open: Option<usize> = None;
    let mut out_len = 0usize;
    while i < chars.len() {
        if i + 1 < chars.len() && chars[i] == '*' && chars[i + 1] == '*' {
            match open {
                Some(start) => {
                    bold.push((start, out_len));
                    open = None;
                }
                None => open = Some(out_len),
            }
            i += 2;
            continue;
        }
        text.push(chars[i]);
        out_len += 1;
        i += 1;
    }
    Line { text, bold }
}

fn classify(line: &str) -> Block {
    let t = line.trim_end();
    let trimmed = t.trim_start();
    if trimmed.is_empty() {
        return Block::Blank;
    }
    for (marker, level) in [("### ", 3u8), ("## ", 2), ("# ", 1)] {
        if let Some(rest) = trimmed.strip_prefix(marker) {
            return Block::Heading {
                level,
                text: rest.to_string(),
            };
        }
    }
    if let Some(rest) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
    {
        return Block::Bullet(rest.to_string());
    }
    // "1. ", "2. ", ...
    if let Some(dot) = trimmed.find(". ") {
        if dot > 0 && trimmed[..dot].chars().all(|c| c.is_ascii_digit()) {
            return Block::Numbered(trimmed[dot + 2..].to_string());
        }
    }
    Block::Paragraph(trimmed.to_string())
}

/// Build the insert text plus the styling requests that shape it.
fn build_requests(markdown: &str) -> (String, Vec<Value>) {
    // Docs body content starts at index 1.
    let mut cursor = 1usize;
    let mut text = String::new();
    let mut requests: Vec<Value> = Vec::new();
    // Consecutive list items are bulleted as one range, or Docs restarts the
    // numbering on every single-line request.
    let mut run: Option<(usize, usize, bool)> = None; // (start, end, numbered)

    let flush_run = |run: &mut Option<(usize, usize, bool)>, requests: &mut Vec<Value>| {
        if let Some((start, end, numbered)) = run.take() {
            requests.push(json!({
                "createParagraphBullets": {
                    "range": { "startIndex": start, "endIndex": end },
                    "bulletPreset": if numbered {
                        "NUMBERED_DECIMAL_ALPHA_ROMAN"
                    } else {
                        "BULLET_DISC_CIRCLE_SQUARE"
                    }
                }
            }));
        }
    };

    for raw in markdown.lines() {
        let block = classify(raw);
        if matches!(block, Block::Blank) {
            // Spacing comes from paragraph styles, not from empty paragraphs.
            flush_run(&mut run, &mut requests);
            continue;
        }

        let (body, kind) = match block {
            Block::Heading { level, text } => (extract_bold(&text), Some(level)),
            Block::Bullet(t) => (extract_bold(&t), None),
            Block::Numbered(t) => (extract_bold(&t), None),
            Block::Paragraph(t) => (extract_bold(&t), None),
            Block::Blank => unreachable!(),
        };
        let is_bullet = matches!(classify(raw), Block::Bullet(_));
        let is_numbered = matches!(classify(raw), Block::Numbered(_));

        let line_text = format!("{}\n", body.text);
        let char_len = line_text.chars().count();
        let start = cursor;
        let end = cursor + char_len;

        // Paragraph style: headings get their named style and generous space
        // above; body text gets readable line spacing and a little room below.
        let (named, space_above, space_below, line_spacing) = match kind {
            Some(1) => ("HEADING_1", 18.0, 8.0, 115.0),
            Some(2) => ("HEADING_2", 16.0, 6.0, 115.0),
            Some(_) => ("HEADING_3", 14.0, 4.0, 115.0),
            None if is_bullet || is_numbered => ("NORMAL_TEXT", 2.0, 2.0, 115.0),
            None => ("NORMAL_TEXT", 0.0, 10.0, 130.0),
        };
        requests.push(json!({
            "updateParagraphStyle": {
                "range": { "startIndex": start, "endIndex": end },
                "paragraphStyle": {
                    "namedStyleType": named,
                    "spaceAbove": { "magnitude": space_above, "unit": "PT" },
                    "spaceBelow": { "magnitude": space_below, "unit": "PT" },
                    "lineSpacing": line_spacing,
                },
                "fields": "namedStyleType,spaceAbove,spaceBelow,lineSpacing"
            }
        }));

        for (b0, b1) in &body.bold {
            requests.push(json!({
                "updateTextStyle": {
                    "range": { "startIndex": start + b0, "endIndex": start + b1 },
                    "textStyle": { "bold": true },
                    "fields": "bold"
                }
            }));
        }

        if is_bullet || is_numbered {
            run = match run.take() {
                Some((s, _, n)) if n == is_numbered => Some((s, end, n)),
                Some(prev) => {
                    let mut tmp = Some(prev);
                    flush_run(&mut tmp, &mut requests);
                    Some((start, end, is_numbered))
                }
                None => Some((start, end, is_numbered)),
            };
        } else {
            flush_run(&mut run, &mut requests);
        }

        text.push_str(&line_text);
        cursor = end;
    }
    flush_run(&mut run, &mut requests);

    // The text insert has to run before anything that references its indexes,
    // and the style requests are emitted last-first so earlier ranges survive.
    requests.reverse();
    let mut all = vec![json!({
        "insertText": { "location": { "index": 1 }, "text": text }
    })];
    all.extend(requests);
    (text, all)
}

async fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not prepare the Google connection: {e}"))
}

fn friendly(status: u16, context: &str) -> String {
    match status {
        401 => "Your Google sign-in has expired. Open Connect and reconnect Google.".into(),
        403 => format!(
            "ArcSonare doesn't have permission to {context}. Open Connect, reconnect Google and approve Docs access."
        ),
        429 => "Google is rate-limiting requests right now. Try again shortly.".into(),
        _ => format!("Google couldn't {context}. Try again shortly."),
    }
}

/// Create a formatted Google Doc from Markdown. Returns its URL.
#[tauri::command]
pub async fn docs_create(title: String, markdown: String) -> Result<Value, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Err("Google isn't connected yet. Open Connect and sign in with Google.".into());
    };
    let title = title.trim();
    if title.is_empty() {
        return Err("The document needs a title.".into());
    }

    let http = client().await?;
    let created: Value = {
        let res = http
            .post(format!("{DOCS_BASE}/documents"))
            .bearer_auth(&token)
            .json(&json!({ "title": title }))
            .send()
            .await
            .map_err(|e| format!("Could not reach Google Docs: {e}"))?;
        let status = res.status();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            log::error!("docs create {status}: {body}");
            return Err(friendly(status.as_u16(), "create documents"));
        }
        body
    };

    let doc_id = created
        .get("documentId")
        .and_then(|v| v.as_str())
        .ok_or("Google didn't confirm the document was created.")?
        .to_string();

    let (plain, requests) = build_requests(&markdown);
    if !plain.trim().is_empty() {
        let res = http
            .post(format!("{DOCS_BASE}/documents/{doc_id}:batchUpdate"))
            .bearer_auth(&token)
            .json(&json!({ "requests": requests }))
            .send()
            .await
            .map_err(|e| format!("Could not reach Google Docs: {e}"))?;
        let status = res.status();
        if !status.is_success() {
            let body: Value = res.json().await.unwrap_or(Value::Null);
            log::error!("docs batchUpdate {status}: {body}");
            return Err(friendly(status.as_u16(), "write into that document"));
        }
    }

    Ok(json!({
        "document_id": doc_id,
        "title": title,
        "url": format!("https://docs.google.com/document/d/{doc_id}/edit"),
        "characters": plain.chars().count(),
    }))
}

/// Append formatted Markdown to the end of an existing document.
#[tauri::command]
pub async fn docs_append(document_id: String, markdown: String) -> Result<Value, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Err("Google isn't connected yet. Open Connect and sign in with Google.".into());
    };
    let http = client().await?;

    // Find the current end so the new content lands after it.
    let res = http
        .get(format!("{DOCS_BASE}/documents/{document_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Could not reach Google Docs: {e}"))?;
    let status = res.status();
    let doc: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        log::error!("docs get {status}: {doc}");
        return Err(friendly(status.as_u16(), "open that document"));
    }
    let end_index = doc
        .get("body")
        .and_then(|b| b.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|items| items.last())
        .and_then(|last| last.get("endIndex"))
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        .saturating_sub(1)
        .max(1) as usize;

    let (plain, mut requests) = build_requests(&markdown);
    // build_requests is written for a fresh document starting at index 1;
    // shift every index to the end of this one.
    shift_indexes(&mut requests, end_index.saturating_sub(1));
    if plain.trim().is_empty() {
        return Err("There was nothing to append.".into());
    }

    let res = http
        .post(format!("{DOCS_BASE}/documents/{document_id}:batchUpdate"))
        .bearer_auth(&token)
        .json(&json!({ "requests": requests }))
        .send()
        .await
        .map_err(|e| format!("Could not reach Google Docs: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let body: Value = res.json().await.unwrap_or(Value::Null);
        log::error!("docs append {status}: {body}");
        return Err(friendly(status.as_u16(), "write into that document"));
    }
    Ok(json!({
        "document_id": document_id,
        "url": format!("https://docs.google.com/document/d/{document_id}/edit"),
        "characters": plain.chars().count(),
    }))
}

/// Add `offset` to every index in a batch of requests.
fn shift_indexes(requests: &mut [Value], offset: usize) {
    fn walk(v: &mut Value, offset: usize) {
        match v {
            Value::Object(map) => {
                for (k, val) in map.iter_mut() {
                    if (k == "startIndex" || k == "endIndex" || k == "index") && val.is_number() {
                        let n = val.as_u64().unwrap_or(0) as usize + offset;
                        *val = json!(n);
                    } else {
                        walk(val, offset);
                    }
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item, offset);
                }
            }
            _ => {}
        }
    }
    for r in requests {
        walk(r, offset);
    }
}

/// Documents in the user's Drive, most recently modified first.
#[tauri::command]
pub async fn docs_list(max_results: Option<u32>) -> Result<Value, String> {
    let Some(token) = google_oauth::valid_access_token().await? else {
        return Err("Google isn't connected yet. Open Connect and sign in with Google.".into());
    };
    let max = max_results.unwrap_or(20).clamp(1, 100);
    let url = format!(
        "{DRIVE_FILES}?q=mimeType%3D%27application%2Fvnd.google-apps.document%27+and+trashed%3Dfalse\
         &orderBy=modifiedTime+desc&pageSize={max}&fields=files(id,name,modifiedTime,webViewLink)"
    );
    let res = client()
        .await?
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Could not reach Google Drive: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        log::error!("docs list {status}: {body}");
        return Err(friendly(status.as_u16(), "list your documents"));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_bullets_and_bold_become_real_structure() {
        let (text, reqs) = build_requests("# Title\n\nHello **world**\n\n- one\n- two\n");
        assert!(text.starts_with("Title\n"));
        // The text insert must come first, or every index below it is wrong.
        assert!(reqs[0].get("insertText").is_some());
        let dump = serde_json::to_string(&reqs).unwrap();
        assert!(dump.contains("HEADING_1"));
        assert!(dump.contains("BULLET_DISC_CIRCLE_SQUARE"));
        assert!(dump.contains("\"bold\":true"));
    }

    #[test]
    fn bold_offsets_point_at_the_bold_word() {
        let line = extract_bold("Hello **world**");
        assert_eq!(line.text, "Hello world");
        assert_eq!(line.bold, vec![(6, 11)]);
    }

    #[test]
    fn consecutive_bullets_are_one_list() {
        let (_, reqs) = build_requests("- a\n- b\n- c\n");
        let bullets = serde_json::to_string(&reqs)
            .unwrap()
            .matches("createParagraphBullets")
            .count();
        assert_eq!(
            bullets, 1,
            "one range, or Docs restarts numbering each line"
        );
    }
}
