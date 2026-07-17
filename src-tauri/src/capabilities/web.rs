//! Web capabilities: validated URL open, curated service open, web search.

use serde::Deserialize;
use serde_json::json;

use super::types::{ResultBuilder, ToolResult, VerificationEvidence};
use crate::top_overlay::web_launcher::{open_approved_url, open_web_search};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenUrlArgs {
    pub url: String,
}

pub fn open_url(args: OpenUrlArgs) -> ToolResult {
    let rb = ResultBuilder::new("web.open_url");
    match open_approved_url(&args.url) {
        Ok(()) => rb.success(
            "Opened in your default browser.",
            json!({ "url": args.url }),
            // The OS accepted the open; full page load is not verifiable.
            VerificationEvidence::unverified("return-code"),
        ),
        Err(e) => rb.error("url-rejected", e, true),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchArgs {
    pub query: String,
    #[serde(default)]
    pub site: Option<String>,
}

pub fn search(args: SearchArgs) -> ToolResult {
    let rb = ResultBuilder::new("web.search");
    let query = args.query.trim();
    if query.is_empty() {
        return rb.error("invalid-arguments", "Search query is empty.", true);
    }
    // Site-scoped searches use validated official templates only.
    if let Some(site) = args.site.as_deref() {
        let encoded = percent_encoding::utf8_percent_encode(
            query,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let url = match site {
            "youtube" => format!("https://www.youtube.com/results?search_query={encoded}"),
            "google" => format!("https://www.google.com/search?q={encoded}"),
            "bing" => format!("https://www.bing.com/search?q={encoded}"),
            "github" => format!("https://github.com/search?q={encoded}"),
            other => {
                return rb.error(
                    "unsupported-site",
                    format!("Site-scoped search for \"{other}\" is not supported."),
                    true,
                )
            }
        };
        return match open_approved_url(&url) {
            Ok(()) => rb.success(
                format!("Opened a {site} search for \"{query}\"."),
                json!({ "url": url, "site": site }),
                VerificationEvidence::unverified("return-code"),
            ),
            Err(e) => rb.error("url-rejected", e, true),
        };
    }
    match open_web_search(query) {
        Ok(url) => rb.success(
            format!("Opened a web search for \"{query}\"."),
            json!({ "url": url }),
            VerificationEvidence::unverified("return-code"),
        ),
        Err(e) => rb.error("search-failed", e, true),
    }
}
