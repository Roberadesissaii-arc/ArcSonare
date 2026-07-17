//! Clipboard read/write. Read is privacy-sensitive: it only runs for explicit
//! user requests (routing enforces this) and is size-capped.

use serde::Deserialize;
use serde_json::json;

use super::types::{ResultBuilder, ToolResult, VerificationEvidence};

const READ_MAX_CHARS: usize = 100_000;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadArgs {}

pub fn read_text(_args: ReadArgs) -> ToolResult {
    let rb = ResultBuilder::new("clipboard.read_text");
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => return rb.error("clipboard-unavailable", e.to_string(), true),
    };
    match clipboard.get_text() {
        Ok(text) => {
            let truncated = text.chars().count() > READ_MAX_CHARS;
            let content: String = text.chars().take(READ_MAX_CHARS).collect();
            let chars = content.chars().count();
            rb.success(
                format!("Clipboard has {chars} characters of text{}.", if truncated { " (truncated)" } else { "" }),
                json!({ "content": content, "chars": chars, "truncated": truncated }),
                VerificationEvidence::verified("state-readback"),
            )
        }
        Err(arboard::Error::ContentNotAvailable) => {
            rb.not_found("The clipboard has no text content right now.")
        }
        Err(e) => rb.error("clipboard-read-failed", e.to_string(), true),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteArgs {
    pub content: String,
}

pub fn write_text(args: WriteArgs) -> ToolResult {
    let rb = ResultBuilder::new("clipboard.write_text");
    if args.content.len() > 1_000_000 {
        return rb.error("content-too-large", "Clipboard writes are capped at 1 MB.", true);
    }
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => return rb.error("clipboard-unavailable", e.to_string(), true),
    };
    if let Err(e) = clipboard.set_text(args.content.clone()) {
        return rb.error("clipboard-write-failed", e.to_string(), true);
    }
    // Readback verification.
    let verified = clipboard
        .get_text()
        .map(|t| t == args.content)
        .unwrap_or(false);
    let chars = args.content.chars().count();
    if verified {
        rb.success(
            format!("Copied {chars} characters to the clipboard."),
            json!({ "chars": chars }),
            VerificationEvidence::verified("state-readback"),
        )
    } else {
        rb.partial(
            "The clipboard write was accepted but readback did not match.",
            json!({ "chars": chars }),
            VerificationEvidence::unverified("state-readback"),
        )
    }
}
