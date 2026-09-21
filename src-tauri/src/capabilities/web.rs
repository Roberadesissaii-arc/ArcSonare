//! Web capabilities: validated URL open, curated service open, web search,
//! and in-page media picks (e.g. “open the second video” on YouTube).

use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

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
        let encoded =
            percent_encoding::utf8_percent_encode(query, percent_encoding::NON_ALPHANUMERIC)
                .to_string();
        // The display name reaches the user verbatim in the summary; "a youtube
        // search" reads as a typo in the chat reply.
        let (url, label) = match site {
            "youtube" => (
                format!("https://www.youtube.com/results?search_query={encoded}"),
                "YouTube",
            ),
            "google" => (format!("https://www.google.com/search?q={encoded}"), "Google"),
            "bing" => (format!("https://www.bing.com/search?q={encoded}"), "Bing"),
            "github" => (format!("https://github.com/search?q={encoded}"), "GitHub"),
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
                format!("Opened a {label} search for \"{query}\"."),
                // The query travels with the result so a follow-up ("show me
                // here") knows what the surface is showing. Recovering it by
                // re-parsing the URL would be a second, weaker source of truth.
                json!({ "url": url, "site": site, "query": query }),
                VerificationEvidence::unverified("return-code"),
            ),
            Err(e) => rb.error("url-rejected", e, true),
        };
    }
    match open_web_search(query) {
        Ok(url) => rb.success(
            format!("Opened a web search for \"{query}\"."),
            json!({ "url": url, "query": query }),
            VerificationEvidence::unverified("return-code"),
        ),
        Err(e) => rb.error("search-failed", e, true),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FetchPageArgs {
    pub url: String,
    /// Optional max characters of extracted text (default 12_000, hard cap 40_000).
    #[serde(default)]
    pub max_chars: Option<u32>,
}

/// Fetch a public http(s) page and return readable text for “what is this link about?”.
/// This is read-only scraping for chat Browser mode — it does not open the browser.
pub fn fetch_page(args: FetchPageArgs) -> ToolResult {
    let rb = ResultBuilder::new("web.fetch_page");
    let url = args.url.trim();
    if let Err(e) = crate::top_overlay::web_launcher::validate_http_url(url) {
        return rb.error("url-rejected", e, true);
    }
    if is_blocked_host(url) {
        return rb.error(
            "url-blocked",
            "That address is blocked for safety (local/private network).",
            true,
        );
    }
    let max_chars = args.max_chars.unwrap_or(12_000).clamp(500, 40_000) as usize;

    match fetch_page_content(url, max_chars) {
        Ok(page) => {
            if page.text.trim().is_empty() && page.images.is_empty() {
                return rb.error(
                    "page-empty",
                    "I could reach that URL but couldn't extract text or images from it.",
                    true,
                );
            }
            let summary = match (
                page.title.as_deref().filter(|s| !s.is_empty()),
                page.images.len(),
                page.chars,
            ) {
                (Some(t), n, c) if n > 0 => {
                    format!(
                        "Read “{t}” ({c} characters, {n} image{}).",
                        if n == 1 { "" } else { "s" }
                    )
                }
                (Some(t), _, c) => format!("Read “{t}” ({c} characters of text)."),
                (_, n, _) if n > 0 => format!(
                    "Found {n} image{} on that page.",
                    if n == 1 { "" } else { "s" }
                ),
                (_, _, c) => format!("Read the page ({c} characters of text)."),
            };
            rb.success(
                summary,
                json!({
                    "url": page.final_url,
                    "title": page.title,
                    "text": page.text,
                    "chars": page.chars,
                    "images": page.images,
                }),
                VerificationEvidence::verified_with(
                    "return-code",
                    json!({
                        "chars": page.chars,
                        "image_count": page.images.len(),
                        "url": page.final_url
                    }),
                ),
            )
        }
        Err(e) => rb.error("fetch-failed", e, true),
    }
}

struct FetchedPage {
    final_url: String,
    title: Option<String>,
    text: String,
    chars: usize,
    images: Vec<String>,
}

/// Public for other commands (e.g. desktop image download) that must share SSRF policy.
pub fn is_blocked_host_public(url: &str) -> bool {
    is_blocked_host(url)
}

fn is_blocked_host(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let host = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim();
    host.is_empty()
        || host == "localhost"
        || host == "0.0.0.0"
        || host == "[::1]"
        || host == "::1"
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
        || {
            // 172.16.0.0 – 172.31.255.255
            if let Some(rest) = host.strip_prefix("172.") {
                if let Some((a, _)) = rest.split_once('.') {
                    if let Ok(n) = a.parse::<u8>() {
                        return (16..=31).contains(&n);
                    }
                }
            }
            false
        }
}

fn fetch_page_content(url: &str, max_chars: usize) -> Result<FetchedPage, String> {
    // YouTube (and youtu.be) — thumbnail without downloading the full page first.
    let mut images = youtube_thumbnails(url);

    let client = reqwest::blocking::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 ArcSonare/1.0",
        )
        .timeout(Duration::from_secs(18))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Could not prepare the request: {e}"))?;

    let res = client
        .get(url)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .map_err(|e| format!("Could not reach that page: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        // Still return YouTube thumbs if we have them.
        if !images.is_empty() {
            return Ok(FetchedPage {
                final_url: url.to_string(),
                title: None,
                text: String::new(),
                chars: 0,
                images,
            });
        }
        return Err(format!("The page returned HTTP {status}."));
    }
    let final_url = res.url().to_string();
    if is_blocked_host(&final_url) {
        return Err("Redirected to a blocked local/private address.".into());
    }
    // Merge thumbs for the final URL too (redirects to youtube.com/watch).
    for img in youtube_thumbnails(&final_url) {
        push_image(&mut images, img);
    }

    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    // Pure image URL — treat as the image itself.
    if content_type.starts_with("image/") {
        if !images.contains(&final_url) {
            images.insert(0, final_url.clone());
        }
        return Ok(FetchedPage {
            final_url: final_url.clone(),
            title: None,
            text: String::new(),
            chars: 0,
            images,
        });
    }
    // Allow HTML and plain text; reject obvious binaries.
    if !content_type.is_empty()
        && !content_type.contains("text/html")
        && !content_type.contains("application/xhtml")
        && !content_type.contains("text/plain")
        && !content_type.contains("application/xml")
        && !content_type.contains("text/xml")
        && !content_type.contains("json")
    {
        if !images.is_empty() {
            return Ok(FetchedPage {
                final_url,
                title: None,
                text: String::new(),
                chars: 0,
                images,
            });
        }
        return Err(format!(
            "That URL is not a readable web page (content-type: {content_type})."
        ));
    }

    // Cap raw body size before parsing (~2MB).
    let bytes = res
        .bytes()
        .map_err(|e| format!("Could not download the page: {e}"))?;
    if bytes.len() > 2_000_000 {
        return Err("That page is too large to read here.".into());
    }
    let html = String::from_utf8_lossy(&bytes).into_owned();
    let title = extract_html_title(&html);
    let text = html_to_readable_text(&html, max_chars);
    let chars = text.chars().count();
    // Prefer og/twitter meta first (extract_page_images returns those first),
    // then a few high-signal CDN hits — never dump every random URL as a "preview".
    for img in extract_page_images(&html, &final_url) {
        push_image(&mut images, img);
        if images.len() >= 6 {
            break;
        }
    }
    Ok(FetchedPage {
        final_url,
        title,
        text,
        chars,
        images,
    })
}

/// YouTube watch / shorts / youtu.be → ordered thumbnail candidates (best first).
fn youtube_thumbnails(url: &str) -> Vec<String> {
    let Some(id) = youtube_video_id(url) else {
        return Vec::new();
    };
    // Prefer maxres, fall through for players that 404 it.
    [
        "maxresdefault",
        "sddefault",
        "hqdefault",
        "mqdefault",
        "default",
    ]
    .iter()
    .map(|q| format!("https://i.ytimg.com/vi/{id}/{q}.jpg"))
    .collect()
}

fn youtube_video_id(url: &str) -> Option<String> {
    let lower = url.to_ascii_lowercase();
    // youtu.be/ID — keep original case for the id slice
    if lower.starts_with("https://youtu.be/") || lower.starts_with("http://youtu.be/") {
        let prefix_len = if lower.starts_with("https://youtu.be/") {
            "https://youtu.be/".len()
        } else {
            "http://youtu.be/".len()
        };
        let id = url
            .get(prefix_len..)
            .unwrap_or("")
            .split(['?', '&', '/'])
            .next()
            .unwrap_or("")
            .trim();
        if id.len() == 11 {
            return Some(id.to_string());
        }
    }
    // youtube.com/watch?v=ID  /shorts/ID  /embed/ID
    if lower.contains("youtube.com") || lower.contains("youtube-nocookie.com") {
        if let Some(pos) = lower.find("v=") {
            let id = url
                .get(pos + 2..)
                .unwrap_or("")
                .split(['&', '#', '?'])
                .next()
                .unwrap_or("")
                .trim();
            if id.len() == 11 {
                return Some(id.to_string());
            }
        }
        for marker in ["/shorts/", "/embed/", "/live/"] {
            if let Some(idx) = lower.find(marker) {
                let start = idx + marker.len();
                let id = url
                    .get(start..)
                    .unwrap_or("")
                    .split(['?', '&', '/', '#'])
                    .next()
                    .unwrap_or("")
                    .trim();
                if id.len() == 11 {
                    return Some(id.to_string());
                }
            }
        }
    }
    None
}

/// og:image / twitter:image / link rel image_src + limited CDN URL scan.
fn extract_page_images(html: &str, base_url: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_ascii_lowercase();
    // meta property="og:image" content="..."
    // meta name="twitter:image" content="..."
    let mut from = 0;
    while let Some(rel) = lower[from..].find("<meta") {
        let start = from + rel;
        let Some(end_rel) = lower[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + end_rel + 1];
        let tag_l = tag.to_ascii_lowercase();
        let is_image_meta = tag_l.contains("og:image")
            || tag_l.contains("twitter:image")
            || tag_l.contains("og:image:secure_url");
        if is_image_meta {
            if let Some(content) = meta_content_attr(tag) {
                if let Some(abs) = absolutize_url(base_url, &content) {
                    if !out.contains(&abs) {
                        out.push(abs);
                    }
                }
            }
        }
        from = start + end_rel + 1;
        if out.len() >= 6 {
            break;
        }
    }
    // link rel="image_src" href="..."
    from = 0;
    while let Some(rel) = lower[from..].find("<link") {
        let start = from + rel;
        let Some(end_rel) = lower[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + end_rel + 1];
        let tag_l = tag.to_ascii_lowercase();
        if tag_l.contains("image_src") || tag_l.contains("rel=\"image_src\"") {
            if let Some(href) = attr_value(tag, "href") {
                if let Some(abs) = absolutize_url(base_url, &href) {
                    if !out.contains(&abs) {
                        out.push(abs);
                    }
                }
            }
        }
        from = start + end_rel + 1;
        if out.len() >= 8 {
            break;
        }
    }
    // Broad scan only when meta tags are empty — reduces junk/ads mistaken for previews.
    // Prefer known content CDNs over random absolute image URLs.
    if out.is_empty() {
        let decoded = html.replace("&amp;", "&");
        let lower_full = decoded.to_ascii_lowercase();
        let mut i = 0usize;
        while i + 12 < lower_full.len() && out.len() < 6 {
            let slice = &lower_full[i..];
            let rel = match (slice.find("https://"), slice.find("http://")) {
                (Some(a), Some(b)) => a.min(b),
                (Some(a), None) => a,
                (None, Some(b)) => b,
                (None, None) => break,
            };
            let start = i + rel;
            let after_lower = &lower_full[start..];
            let end = after_lower
                .find(|c: char| {
                    c.is_whitespace()
                        || c == '"'
                        || c == '\''
                        || c == '<'
                        || c == '>'
                        || c == ')'
                        || c == ']'
                        || c == '}'
                })
                .unwrap_or(after_lower.len().min(500));
            // Use original casing from decoded for the URL body
            let end_idx = (start + end).min(decoded.len());
            if start >= decoded.len() || end_idx <= start {
                i = start + 1;
                continue;
            }
            let candidate = decoded[start..end_idx]
                .trim_end_matches(['.', ',', ';', ':', '!', '?'])
                .to_string();
            let cl = candidate.to_ascii_lowercase();
            // Only keep high-signal content hosts / clear image files in broad scan.
            let high_signal = cl.contains("ytimg.com")
                || cl.contains("ggpht.com")
                || cl.contains("googleusercontent.com")
                || cl.contains("imgur.com")
                || cl.contains("twimg.com")
                || (cl.contains(".jpg") || cl.contains(".jpeg") || cl.contains(".webp"));
            if looks_like_image_url(&candidate)
                && high_signal
                && !cl.contains("favicon")
                && !cl.contains("sprite")
                && !cl.contains("logo")
                && !cl.contains("/icon")
                && !cl.contains("banner")
                && !cl.contains("ads")
                && !out.contains(&candidate)
            {
                out.push(candidate);
            }
            i = start + end.max(1);
        }
    }
    out.truncate(6);
    out
}

fn meta_content_attr(tag: &str) -> Option<String> {
    attr_value(tag, "content")
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let key = format!("{name}=");
    let pos = lower.find(&key)?;
    let after = &tag[pos + key.len()..];
    let quote = after.chars().next()?;
    if quote == '"' || quote == '\'' {
        let rest = &after[1..];
        let end = rest.find(quote)?;
        return Some(decode_basic_entities(rest[..end].trim()));
    }
    // unquoted
    let end = after
        .find(|c: char| c.is_whitespace() || c == '>')
        .unwrap_or(after.len());
    Some(decode_basic_entities(after[..end].trim()))
}

fn looks_like_image_url(url: &str) -> bool {
    let l = url.to_ascii_lowercase();
    if l.contains("favicon") || l.contains("1x1") || l.contains("pixel") {
        return false;
    }
    // Reject bare dimension junk from YouTube meta (…/1280, …/720).
    if l.ends_with("/1280") || l.ends_with("/720") || l.ends_with("/480") {
        return false;
    }
    l.contains("ytimg.com")
        || l.contains("ggpht.com")
        || l.contains("googleusercontent.com")
        || l.contains("twimg.com")
        || l.contains("imgur.com")
        || l.contains("cloudfront.net")
        || l.contains("fbcdn.net")
        || l.contains("cdninstagram")
        || l.contains(".jpg")
        || l.contains(".jpeg")
        || l.contains(".png")
        || l.contains(".webp")
        || l.contains(".gif")
        || l.contains(".avif")
        || l.contains("/vi/")
}

fn absolutize_url(base: &str, raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with("data:") {
        return None;
    }
    if raw.starts_with("https://") || raw.starts_with("http://") {
        if is_blocked_host(raw) {
            return None;
        }
        if !looks_like_image_url(raw) {
            return None;
        }
        return Some(raw.to_string());
    }
    if raw.starts_with("//") {
        let abs = format!("https:{raw}");
        if is_blocked_host(&abs) {
            return None;
        }
        return Some(abs);
    }
    // Relative — join with origin
    let origin = {
        let without = base
            .strip_prefix("https://")
            .or_else(|| base.strip_prefix("http://"))?;
        let host_path = without.split_once('/').map(|(h, _)| h).unwrap_or(without);
        let scheme = if base.starts_with("https") {
            "https"
        } else {
            "http"
        };
        format!("{scheme}://{host_path}")
    };
    let abs = if raw.starts_with('/') {
        format!("{origin}{raw}")
    } else {
        format!("{origin}/{raw}")
    };
    if is_blocked_host(&abs) || !looks_like_image_url(&abs) {
        return None;
    }
    Some(abs)
}

fn push_image(images: &mut Vec<String>, url: String) {
    if !looks_like_image_url(&url) || images.contains(&url) {
        return;
    }
    images.push(url);
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let after = &html[start..];
    let gt = after.find('>')?;
    let rest = &after[gt + 1..];
    let end_rel = rest.to_ascii_lowercase().find("</title>")?;
    let raw = rest[..end_rel].trim();
    let cleaned = decode_basic_entities(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.chars().take(200).collect())
    }
}

fn html_to_readable_text(html: &str, max_chars: usize) -> String {
    let mut s = html.to_string();
    // Drop noisy blocks first.
    for tag in ["script", "style", "noscript", "svg", "iframe"] {
        s = strip_tag_blocks(&s, tag);
    }
    // Line breaks for common block tags.
    for tag in [
        "br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article",
        "header", "footer", "nav",
    ] {
        let open = format!("<{tag}");
        let close = format!("</{tag}>");
        s = s.replace(&close, "\n");
        // crude: replace opening tags later via general strip
        let _ = open;
    }
    s = s
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n");

    // Strip remaining tags.
    let mut out = String::with_capacity(s.len() / 2);
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let decoded = decode_basic_entities(&out);
    // Collapse whitespace, keep paragraph breaks.
    let mut cleaned = String::new();
    let mut prev_nl = 0u8;
    let mut prev_space = false;
    for c in decoded.chars() {
        if c == '\r' {
            continue;
        }
        if c == '\n' {
            if prev_nl < 2 {
                cleaned.push('\n');
                prev_nl += 1;
            }
            prev_space = false;
            continue;
        }
        if c.is_whitespace() {
            if !prev_space && prev_nl == 0 {
                cleaned.push(' ');
                prev_space = true;
            }
            continue;
        }
        cleaned.push(c);
        prev_space = false;
        prev_nl = 0;
        if cleaned.chars().count() >= max_chars {
            cleaned.push('…');
            break;
        }
    }
    cleaned.trim().to_string()
}

fn strip_tag_blocks(html: &str, tag: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(html.len());
    let mut i = 0;
    let bytes = html.as_bytes();
    let lower_bytes = lower.as_bytes();
    while i < bytes.len() {
        if let Some(rel) = find_substr_from(lower_bytes, open.as_bytes(), i) {
            out.push_str(&html[i..rel]);
            // Find end of open tag
            let after_open = rel + open.len();
            let gt = match html[after_open..].find('>') {
                Some(g) => after_open + g + 1,
                None => break,
            };
            if let Some(rel_close) = find_substr_from(lower_bytes, close.as_bytes(), gt) {
                i = rel_close + close.len();
            } else {
                // No close — drop rest of open tag only
                i = gt;
            }
        } else {
            out.push_str(&html[i..]);
            break;
        }
    }
    out
}

fn find_substr_from(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || from >= hay.len() {
        return None;
    }
    hay[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| from + p)
}

fn decode_basic_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivateListedItemArgs {
    /// 1-based index ("second video" → 2).
    pub index: u32,
    /// Currently only `"youtube"`.
    #[serde(default)]
    pub site: Option<String>,
    /// Optional search terms used when the previous step was a YouTube search.
    #[serde(default)]
    pub query: Option<String>,
}

/// Open the Nth video on YouTube (homepage or a search results page).
///
/// Follow-ups like “open the second video” must never go through
/// `applications.open` — that path treats the phrase as an app name.
pub fn activate_listed_item(args: ActivateListedItemArgs) -> ToolResult {
    let rb = ResultBuilder::new("web.activate_listed_item");
    let site = args
        .site
        .as_deref()
        .unwrap_or("youtube")
        .trim()
        .to_ascii_lowercase();
    if site != "youtube" {
        return rb.error(
            "unsupported-site",
            format!("Opening listed items on \"{site}\" is not supported yet."),
            true,
        );
    }
    let index = args.index.max(1) as usize;
    if index > 30 {
        return rb.error(
            "invalid-arguments",
            "I can only pick among the first 30 videos.",
            true,
        );
    }

    match resolve_youtube_nth(index, args.query.as_deref()) {
        Ok((watch_url, title_hint)) => match open_approved_url(&watch_url) {
            Ok(()) => {
                let label = title_hint
                    .clone()
                    .unwrap_or_else(|| format!("video #{index}"));
                rb.success(
                    format!("Playing {label} on YouTube."),
                    json!({
                        "url": watch_url,
                        "site": "youtube",
                        "index": index,
                        "title": title_hint,
                    }),
                    VerificationEvidence::unverified("return-code"),
                )
            }
            Err(e) => rb.error("url-rejected", e, true),
        },
        Err(e) => rb.error("media-item-unavailable", e, true),
    }
}

/// Pages to try when resolving “open the Nth video”.
///
/// YouTube’s bare homepage often returns a consent / empty shell with **zero**
/// `videoId` fields. Search-results pages reliably embed ytInitialData lists.
fn youtube_list_urls(query: Option<&str>) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(q) = query.map(str::trim).filter(|s| !s.is_empty()) {
        let encoded = percent_encoding::utf8_percent_encode(q, percent_encoding::NON_ALPHANUMERIC)
            .to_string();
        urls.push(format!(
            "https://www.youtube.com/results?search_query={encoded}"
        ));
    }
    // Fallbacks when the user only said “open YouTube” then “second video”
    // (no search query in media context).
    urls.push("https://www.youtube.com/results?search_query=trending+videos".into());
    urls.push("https://www.youtube.com/results?search_query=popular+on+youtube".into());
    urls.push("https://www.youtube.com/".into());
    urls
}

fn resolve_youtube_nth(
    index: usize,
    query: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(14))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Could not prepare the YouTube request: {e}"))?;

    let mut last_error = String::from(
        "I couldn't read the video list from YouTube right now. Try searching YouTube for something first, then say “open the second video”.",
    );

    for page_url in youtube_list_urls(query) {
        match fetch_youtube_html(&client, &page_url) {
            Ok(html) => {
                let ids = extract_youtube_video_ids(&html);
                if ids.is_empty() {
                    last_error = format!(
                        "YouTube’s page didn’t expose a video list (often a consent/empty shell)."
                    );
                    continue;
                }
                let Some(id) = ids.get(index - 1) else {
                    last_error = format!(
                        "I only found {} video{} on that YouTube page — there is no #{index}.",
                        ids.len(),
                        if ids.len() == 1 { "" } else { "s" }
                    );
                    // Another page might have more results; only stop if we have some.
                    if ids.len() >= index {
                        // unreachable — get would have succeeded
                    }
                    // If we have fewer than index, try next URL which might have more.
                    if ids.len() < index {
                        continue;
                    }
                    return Err(last_error);
                };
                let title = extract_title_for_id(&html, id);
                return Ok((
                    format!("https://www.youtube.com/watch?v={id}"),
                    title.map(|t| format!("\"{t}\"")),
                ));
            }
            Err(e) => {
                last_error = e;
            }
        }
    }

    Err(last_error)
}

fn fetch_youtube_html(
    client: &reqwest::blocking::Client,
    page_url: &str,
) -> Result<String, String> {
    client
        .get(page_url)
        .header("Accept-Language", "en-US,en;q=0.9")
        // Avoid the EU consent interstitial that strips videoId data.
        .header(
            "Cookie",
            "CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg",
        )
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .map_err(|e| format!("Could not reach YouTube: {e}"))?
        .error_for_status()
        .map_err(|e| format!("YouTube returned an error: {e}"))?
        .text()
        .map_err(|e| format!("Could not read YouTube's response: {e}"))
}

fn extract_youtube_video_ids(html: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let push = |ids: &mut Vec<String>, raw: &str| {
        if ids.len() >= 40 {
            return;
        }
        let id: String = raw
            .chars()
            .take(11)
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        if id.len() != 11 || ids.contains(&id) {
            return;
        }
        // Skip obvious non-video placeholders YouTube sometimes embeds.
        if id.chars().all(|c| c == '0' || c == '-' || c == '_') {
            return;
        }
        ids.push(id);
    };

    // Primary: ytInitialData videoId fields (home + search).
    for needle in ["\"videoId\":\"", "\"videoId\": \""] {
        let mut from = 0;
        while let Some(rel) = html[from..].find(needle) {
            let start = from + rel + needle.len();
            if let Some(slice) = html.get(start..start.saturating_add(11)) {
                push(&mut ids, slice);
            }
            from = start + 1;
            if from >= html.len() || ids.len() >= 40 {
                break;
            }
        }
        if ids.len() >= 40 {
            break;
        }
    }

    // Fallback: watch?v= / shorts/ links in the markup.
    for needle2 in ["watch?v=", "shorts/"] {
        let mut from = 0;
        while let Some(rel) = html[from..].find(needle2) {
            let start = from + rel + needle2.len();
            if let Some(slice) = html.get(start..start.saturating_add(11)) {
                push(&mut ids, slice);
            }
            from = start + 1;
            if from >= html.len() || ids.len() >= 40 {
                break;
            }
        }
    }

    ids
}

fn extract_title_for_id(html: &str, id: &str) -> Option<String> {
    // Nearby "title":{"runs":[{"text":"..."}]} patterns after a videoId.
    let marker = format!("\"videoId\":\"{id}\"");
    let start = html.find(&marker).or_else(|| {
        let alt = format!("\"videoId\": \"{id}\"");
        html.find(&alt)
    })?;
    let window = html.get(start..start.saturating_add(1800).min(html.len()))?;
    let key = "\"text\":\"";
    let mut pos = 0;
    while let Some(rel) = window[pos..].find(key) {
        let abs = pos + rel + key.len();
        let after = &window[abs..];
        let end = after.find('"')?;
        let text = after[..end]
            .replace("\\u0026", "&")
            .replace("\\\"", "\"")
            .replace("\\n", " ")
            .trim()
            .to_string();
        // Skip tiny UI strings.
        if text.len() >= 4
            && !text.eq_ignore_ascii_case("youtube")
            && !text.contains("subscribers")
            && !text.ends_with(" views")
            && !text.eq_ignore_ascii_case("share")
            && !text.eq_ignore_ascii_case("save")
        {
            return Some(text.chars().take(80).collect());
        }
        pos = abs + end + 1;
        if pos >= window.len() {
            break;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_video_ids_from_sample() {
        let html =
            r#"{"videoId":"dQw4w9WgXcQ","title":{"runs":[{"text":"Never Gonna Give You Up"}]}}"#;
        let ids = extract_youtube_video_ids(html);
        assert_eq!(ids, vec!["dQw4w9WgXcQ".to_string()]);
        assert_eq!(
            extract_title_for_id(html, "dQw4w9WgXcQ").as_deref(),
            Some("Never Gonna Give You Up")
        );
    }

    #[test]
    fn list_urls_prefer_search_when_query_set() {
        let urls = youtube_list_urls(Some("lofi hip hop"));
        assert!(urls[0].contains("search_query=lofi"));
        assert!(urls.iter().any(|u| u.contains("trending")));
    }

    #[test]
    fn youtube_id_and_thumbs() {
        assert_eq!(
            youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            youtube_video_id("https://youtu.be/dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        let thumbs = youtube_thumbnails("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        assert!(thumbs[0].contains("maxresdefault"));
    }

    #[test]
    fn extracts_og_image() {
        let html = r#"<html><head><meta property="og:image" content="https://cdn.example.com/a.jpg"></head></html>"#;
        let imgs = extract_page_images(html, "https://example.com/page");
        assert_eq!(imgs, vec!["https://cdn.example.com/a.jpg".to_string()]);
    }

    /// Live network: YouTube watch page must yield at least one thumbnail URL.
    #[test]
    fn live_fetch_youtube_has_thumbnail() {
        let page = match fetch_page_content("https://www.youtube.com/watch?v=dQw4w9WgXcQ", 4_000) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("skip live youtube: {e}");
                return;
            }
        };
        assert!(
            !page.images.is_empty(),
            "expected YouTube thumbnail URLs, got none"
        );
        assert!(
            page.images
                .iter()
                .any(|u| u.contains("ytimg.com") || u.contains("ggpht.com")),
            "images={:?}",
            page.images
        );
        eprintln!("youtube images={:?}", page.images);
    }

    /// Live network: example.com must return some text.
    #[test]
    fn live_fetch_example_has_text() {
        let page = match fetch_page_content("https://example.com", 4_000) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("skip live example: {e}");
                return;
            }
        };
        assert!(
            page.chars > 10 || !page.images.is_empty(),
            "empty example.com fetch"
        );
        eprintln!("example title={:?} chars={}", page.title, page.chars);
    }
}
