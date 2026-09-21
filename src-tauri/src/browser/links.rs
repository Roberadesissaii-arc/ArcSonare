//! Choosing the right link, from structure rather than from pixels.
//!
//! The reported failure is precise: asked to download LightBurn, ArcSonare
//! reached the page, found *a* Download button, and had no way to tell it from
//! the MillMage one twenty pixels below. A vision model looking at a screenshot
//! sees two identical buttons; the page markup does not — the two live under
//! different headings, point at different hosts, and carry different filenames.
//!
//! So the choice is made here, on the page's own structure, and the visual
//! route is what happens when this cannot answer. That ordering is the whole
//! point of the strategy ladder: structure knows things pixels cannot.
//!
//! Nothing in this module touches the network or the screen. It takes HTML and
//! a description of what was asked for and returns ranked candidates, which is
//! what makes the disambiguation testable against the real page markup instead
//! of against a screenshot nobody can assert on.

use serde::{Deserialize, Serialize};

/// One link found on a page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLink {
    /// Absolute where possible; whatever the markup said otherwise.
    pub href: String,
    /// The link's visible text, whitespace collapsed.
    pub text: String,
    /// The nearest heading above it, which is how a page groups two products
    /// that have identically-labelled buttons.
    #[serde(default)]
    pub section: Option<String>,
    /// Order of appearance, so ties break the way a reader would break them.
    pub ordinal: usize,
}

/// Which platform a download is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
    Unknown,
}

impl Platform {
    pub fn parse(raw: &str) -> Self {
        let l = raw.to_lowercase();
        if l.contains("win") {
            Self::Windows
        } else if l.contains("mac") || l.contains("osx") || l.contains("darwin") {
            Self::MacOs
        } else if l.contains("linux") || l.contains("ubuntu") || l.contains("deb") {
            Self::Linux
        } else {
            Self::Unknown
        }
    }

    /// File extensions that only ever mean this platform.
    fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::Windows => &[".exe", ".msi", ".msix", ".appx"],
            Self::MacOs => &[".dmg", ".pkg"],
            Self::Linux => &[".deb", ".rpm", ".appimage", ".tar.gz", ".tar.xz"],
            Self::Unknown => &[],
        }
    }

    fn words(self) -> &'static [&'static str] {
        match self {
            Self::Windows => &["windows", "win64", "win32", "win", "x64", "64-bit"],
            Self::MacOs => &["mac", "macos", "osx", "apple silicon", "intel mac"],
            Self::Linux => &["linux", "ubuntu", "debian", "fedora", "appimage"],
            Self::Unknown => &[],
        }
    }
}

/// What the user asked for.
#[derive(Debug, Clone)]
pub struct DownloadQuery {
    /// The product name as the user said it — "LightBurn".
    pub product: String,
    pub platform: Platform,
}

/// A ranked candidate, with the reason it ranked where it did.
///
/// The reason is not decoration: when nothing scores well enough the user is
/// told what was found and why none of it matched, which is a far better
/// outcome than clicking the best of a bad set.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredLink {
    pub link: PageLink,
    pub score: i32,
    pub reasons: Vec<String>,
}

/// How far ahead the best candidate must be before it is acted on without
/// asking.
///
/// Two near-identical scores mean the page really is ambiguous — which is
/// exactly the LightBurn/MillMage situation before the product name is taken
/// into account — and guessing between them is how the wrong thing gets
/// downloaded.
pub const DECISIVE_MARGIN: i32 = 25;

fn normalise(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether `haystack` contains `needle` as whole words.
///
/// Substring matching is not good enough here: "mill" is inside "millmage" and
/// also inside "sawmill", and a product picker that matches on substrings picks
/// the wrong product for exactly the reason this module exists.
fn contains_words(haystack: &str, needle: &str) -> bool {
    let h = normalise(haystack);
    let n = normalise(needle);
    if n.is_empty() {
        return false;
    }
    h == n || h.starts_with(&format!("{n} ")) || h.ends_with(&format!(" {n}")) || h.contains(&format!(" {n} "))
}

/// Score every link against the query.
pub fn rank(links: &[PageLink], query: &DownloadQuery) -> Vec<ScoredLink> {
    let product = normalise(&query.product);
    let product_compact: String = product.chars().filter(|c| !c.is_whitespace()).collect();

    let mut scored: Vec<ScoredLink> = links
        .iter()
        .map(|link| {
            let mut score = 0;
            let mut reasons = Vec::new();
            let href_l = link.href.to_lowercase();
            let text_l = link.text.to_lowercase();
            let section_l = link.section.clone().unwrap_or_default().to_lowercase();
            let haystack = format!("{text_l} {section_l} {href_l}");

            // --- the product itself -------------------------------------
            //
            // Weighted highest, because this is the axis the failure was on.
            // A "Download" button under the MillMage heading is a MillMage
            // download however much it looks like the other one.
            if contains_words(&text_l, &product) {
                score += 60;
                reasons.push("the link names the product".into());
            }
            if contains_words(&section_l, &product) {
                score += 45;
                reasons.push("it sits under the product's heading".into());
            }
            // In the URL — filenames and paths are usually product-specific.
            let href_compact: String = normalise(&href_l).chars().filter(|c| !c.is_whitespace()).collect();
            if !product_compact.is_empty() && href_compact.contains(&product_compact) {
                score += 40;
                reasons.push("the address names the product".into());
            }

            // A *different* product named prominently is disqualifying, not
            // merely unhelpful.
            if !product.is_empty()
                && !contains_words(&haystack, &product)
                && looks_like_a_named_product(&text_l, &section_l)
            {
                score -= 50;
                reasons.push("it belongs to a different product".into());
            }

            // --- platform ------------------------------------------------
            if query.platform != Platform::Unknown {
                if query
                    .platform
                    .extensions()
                    .iter()
                    .any(|ext| href_l.ends_with(ext) || href_l.contains(&format!("{ext}?")))
                {
                    score += 45;
                    reasons.push("the file is a Windows installer".into());
                } else if query.platform.words().iter().any(|w| contains_words(&haystack, w)) {
                    score += 30;
                    reasons.push("it is labelled for this platform".into());
                }

                // Explicitly another platform.
                for other in [Platform::Windows, Platform::MacOs, Platform::Linux] {
                    if other == query.platform {
                        continue;
                    }
                    let wrong_ext = other.extensions().iter().any(|e| href_l.ends_with(e));
                    let wrong_word = other.words().iter().any(|w| contains_words(&text_l, w));
                    if wrong_ext || wrong_word {
                        score -= 55;
                        reasons.push("it is for a different platform".into());
                        break;
                    }
                }
            }

            // --- is it even a download ----------------------------------
            if DOWNLOAD_WORDS.iter().any(|w| contains_words(&text_l, w)) {
                score += 20;
                reasons.push("it is a download link".into());
            }
            if href_l.contains("/download") || href_l.contains("download.") {
                score += 12;
            }
            // A direct file beats a page that leads to one.
            if Platform::Windows
                .extensions()
                .iter()
                .chain(Platform::MacOs.extensions())
                .chain(Platform::Linux.extensions())
                .any(|e| href_l.ends_with(e))
            {
                score += 10;
                reasons.push("it points straight at a file".into());
            }

            // --- things that are not the download ------------------------
            for (needle, penalty, why) in NEGATIVE_SIGNALS {
                if contains_words(&text_l, needle) || href_l.contains(needle) {
                    score -= penalty;
                    reasons.push((*why).into());
                }
            }

            ScoredLink {
                link: link.clone(),
                score,
                reasons,
            }
        })
        .collect();

    scored.sort_by(|a, b| b.score.cmp(&a.score).then(a.link.ordinal.cmp(&b.link.ordinal)));
    scored
}

const DOWNLOAD_WORDS: &[&str] = &["download", "get", "install", "trial", "installer"];

/// Link text that means "not the thing you came for".
const NEGATIVE_SIGNALS: &[(&str, i32, &str)] = &[
    ("docs", 30, "it is documentation"),
    ("documentation", 30, "it is documentation"),
    ("forum", 40, "it is the forum"),
    ("support", 25, "it is a support page"),
    ("buy", 35, "it is a purchase link"),
    ("purchase", 35, "it is a purchase link"),
    ("store", 30, "it is the store"),
    ("pricing", 30, "it is the pricing page"),
    ("login", 40, "it is a sign-in link"),
    ("sign in", 40, "it is a sign-in link"),
    ("account", 30, "it is an account link"),
    ("beta", 20, "it is a beta build"),
    ("source", 20, "it is source code"),
    ("changelog", 30, "it is the changelog"),
    ("release notes", 30, "it is the release notes"),
];

/// Whether this link looks like it belongs to some *other* named product.
///
/// The heuristic is deliberately conservative: a heading of one or two
/// capitalised words that is not a generic navigation label. Getting this wrong
/// in the permissive direction merely loses a bonus; getting it wrong in the
/// strict direction would suppress the correct link.
fn looks_like_a_named_product(text: &str, section: &str) -> bool {
    const GENERIC: &[&str] = &[
        "download", "downloads", "home", "products", "product", "features", "support",
        "docs", "help", "about", "contact", "pricing", "blog", "news", "get started",
        "learn more", "free trial", "try it", "windows", "mac", "macos", "linux",
    ];
    let candidate = if section.trim().is_empty() { text } else { section };
    let n = normalise(candidate);
    if n.is_empty() || GENERIC.contains(&n.as_str()) {
        return false;
    }
    let words = n.split_whitespace().count();
    (1..=3).contains(&words)
}

/// What the ranking concluded.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum LinkChoice {
    /// One clear winner.
    Chosen { link: PageLink, score: i32, reasons: Vec<String> },
    /// Several plausible ones. The user picks; nothing is clicked on a guess.
    Ambiguous { candidates: Vec<ScoredLink> },
    /// Nothing on the page matched well enough to act on.
    None { inspected: usize },
}

/// The minimum score a candidate must reach before it is a real answer.
///
/// A page full of navigation links will always have a "best" one; without a
/// floor, "download LightBurn" on a page that offers no download would confidently
/// pick the Support link.
pub const MIN_VIABLE_SCORE: i32 = 45;

/// Pick the link, or refuse to.
pub fn choose(links: &[PageLink], query: &DownloadQuery) -> LinkChoice {
    let ranked = rank(links, query);
    let Some(best) = ranked.first() else {
        return LinkChoice::None { inspected: 0 };
    };
    if best.score < MIN_VIABLE_SCORE {
        return LinkChoice::None {
            inspected: links.len(),
        };
    }
    let runner_up = ranked.get(1).map(|s| s.score).unwrap_or(i32::MIN);
    if best.score - runner_up < DECISIVE_MARGIN {
        return LinkChoice::Ambiguous {
            candidates: ranked.into_iter().take(4).collect(),
        };
    }
    LinkChoice::Chosen {
        link: best.link.clone(),
        score: best.score,
        reasons: best.reasons.clone(),
    }
}

// ---------------------------------------------------------------------------
// Extraction
//
// A small, allocation-light HTML scan rather than a parser dependency. It has
// to survive real marketing pages, which are not well-formed, so everything
// here fails soft: a tag it cannot read is a link it does not return, never an
// error that loses the other forty.
// ---------------------------------------------------------------------------

/// Pull anchors and their nearest preceding heading out of an HTML document.
pub fn extract_links(html: &str, base_url: &str) -> Vec<PageLink> {
    let mut links = Vec::new();
    let mut current_section: Option<String> = None;
    let lower = html.to_lowercase();
    let bytes = lower.as_bytes();
    let mut i = 0usize;
    let mut ordinal = 0usize;

    while i < bytes.len() {
        let Some(open) = lower[i..].find('<').map(|p| p + i) else {
            break;
        };
        // Headings define the section a following link belongs to.
        if let Some(level) = heading_level(&lower, open) {
            let _ = level;
            if let Some((text, after)) = read_element_text(html, &lower, open) {
                let t = collapse(&text);
                if !t.is_empty() {
                    current_section = Some(t);
                }
                i = after;
                continue;
            }
        }
        if lower[open..].starts_with("<a ") || lower[open..].starts_with("<a\n") {
            // Read the attribute out of the *original* text, located by the
            // lowercased copy. Reading it from the lowercased copy returns a
            // lowercased URL, and plenty of download hosts are case-sensitive
            // about filenames — `LightBurn-1.7.08.exe` is not the same object
            // as `lightburn-1.7.08.exe`.
            if let Some(href) = read_attribute(html, &lower, open, "href") {
                if let Some((text, after)) = read_element_text(html, &lower, open) {
                    let absolute = absolutise(&href, base_url);
                    if !absolute.is_empty() {
                        links.push(PageLink {
                            href: absolute,
                            text: collapse(&text),
                            section: current_section.clone(),
                            ordinal,
                        });
                        ordinal += 1;
                    }
                    i = after;
                    continue;
                }
            }
        }
        i = open + 1;
    }
    links
}

fn heading_level(lower: &str, at: usize) -> Option<u8> {
    let rest = &lower[at..];
    for level in 1..=4u8 {
        if rest.starts_with(&format!("<h{level}>")) || rest.starts_with(&format!("<h{level} ")) {
            return Some(level);
        }
    }
    None
}

/// Read the text between an element's open and close tag, tags stripped.
fn read_element_text(original: &str, lower: &str, open: usize) -> Option<(String, usize)> {
    let tag_end = lower[open..].find('>')? + open + 1;
    let tag_name: String = lower[open + 1..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect();
    let close_marker = format!("</{tag_name}");
    let close = lower[tag_end..].find(&close_marker).map(|p| p + tag_end)?;

    // An anchor that was never closed must cost one link, not every link after
    // it. Without this, `<a href=x>never closed` swallows the following anchor
    // whole — its `</a>` becomes this one's — and the real download link
    // disappears from a page that plainly contains it.
    let open_marker = format!("<{tag_name}");
    if let Some(next_open) = lower[tag_end..close].find(&open_marker) {
        let boundary = tag_end + next_open;
        // Only a genuine tag start counts: `<abbr>` is not another `<a>`.
        let following = lower[boundary + open_marker.len()..].chars().next();
        if matches!(following, Some(c) if c.is_whitespace() || c == '>') {
            return None;
        }
    }

    // Cap the span: a close tag a page away is not this element's.
    if close.saturating_sub(tag_end) > 4_000 {
        return None;
    }
    let inner = &original[tag_end..close];
    Some((strip_tags(inner), close + close_marker.len()))
}

/// Read an attribute's value, located in `lower` but taken from `original`.
///
/// The two-string split is the point: tag and attribute *names* are
/// case-insensitive and are matched in the lowercased copy, while the *value*
/// is case-sensitive and must come back exactly as written.
fn read_attribute(original: &str, lower: &str, open: usize, name: &str) -> Option<String> {
    let tag_end = lower[open..].find('>')? + open;
    let tag = &lower[open..tag_end];
    let key = format!("{name}=");
    let at = tag.find(&key)? + key.len();
    let absolute = open + at;
    let rest_lower = &lower[absolute..tag_end];
    let quote = rest_lower.chars().next()?;
    if quote == '"' || quote == '\'' {
        let end = rest_lower[1..].find(quote)? + 1;
        Some(original[absolute + 1..absolute + end].to_string())
    } else {
        let len = rest_lower
            .chars()
            .take_while(|c| !c.is_whitespace() && *c != '>')
            .map(char::len_utf8)
            .sum::<usize>();
        Some(original[absolute..absolute + len].to_string())
    }
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut inside = false;
    for c in s.chars() {
        match c {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(c),
            _ => {}
        }
    }
    out
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Resolve a possibly-relative href against the page it was found on.
fn absolutise(href: &str, base: &str) -> String {
    let h = href.trim();
    if h.is_empty() || h.starts_with('#') {
        return String::new();
    }
    // Rejected on the *raw* href, before resolution. Checking afterwards misses
    // them entirely: `javascript:void(0)` resolves to
    // `https://site/pages/javascript:void(0)`, which no longer starts with the
    // scheme that was supposed to disqualify it.
    let scheme_l = h.to_lowercase();
    for scheme in ["javascript:", "mailto:", "tel:", "data:", "file:", "about:"] {
        if scheme_l.starts_with(scheme) {
            return String::new();
        }
    }
    if h.starts_with("http://") || h.starts_with("https://") {
        return h.to_string();
    }
    if let Some(rest) = h.strip_prefix("//") {
        let scheme = if base.starts_with("http://") { "http" } else { "https" };
        return format!("{scheme}://{rest}");
    }
    let origin = origin_of(base);
    if h.starts_with('/') {
        return format!("{origin}{h}");
    }
    let dir = base.rsplit_once('/').map(|(d, _)| d).unwrap_or(&origin);
    format!("{dir}/{h}")
}

fn origin_of(url: &str) -> String {
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    match without_scheme {
        Some(rest) => {
            let host = rest.split('/').next().unwrap_or(rest);
            let scheme = if url.starts_with("http://") { "http" } else { "https" };
            format!("{scheme}://{host}")
        }
        None => url.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(href: &str, text: &str, section: Option<&str>, ordinal: usize) -> PageLink {
        PageLink {
            href: href.into(),
            text: text.into(),
            section: section.map(str::to_string),
            ordinal,
        }
    }

    fn lightburn(platform: Platform) -> DownloadQuery {
        DownloadQuery {
            product: "LightBurn".into(),
            platform,
        }
    }

    /// The regression, stated exactly.
    ///
    /// Two products, two identically-labelled buttons, and the wrong one is the
    /// one a screenshot cannot rule out.
    #[test]
    fn the_lightburn_button_is_chosen_over_the_millmage_one() {
        let links = vec![
            link(
                "https://lightburnsoftware.com/products/millmage/download-trial",
                "Download Free Trial",
                Some("MillMage"),
                0,
            ),
            link(
                "https://lightburnsoftware.com/products/lightburn/download-trial",
                "Download Free Trial",
                Some("LightBurn"),
                1,
            ),
        ];
        match choose(&links, &lightburn(Platform::Windows)) {
            LinkChoice::Chosen { link, .. } => {
                assert!(
                    link.href.contains("lightburn"),
                    "picked {} — that is the wrong product",
                    link.href,
                );
                assert_eq!(link.section.as_deref(), Some("LightBurn"));
            }
            other => panic!("expected a decisive choice, got {other:?}"),
        }
    }

    /// The same page, asked for the other product. The mechanism has to work
    /// both ways or it is a hardcoded preference, not a chooser.
    #[test]
    fn asking_for_millmage_chooses_millmage() {
        let links = vec![
            link(
                "https://lightburnsoftware.com/products/millmage/download-trial",
                "Download Free Trial",
                Some("MillMage"),
                0,
            ),
            link(
                "https://lightburnsoftware.com/products/lightburn/download-trial",
                "Download Free Trial",
                Some("LightBurn"),
                1,
            ),
        ];
        let query = DownloadQuery {
            product: "MillMage".into(),
            platform: Platform::Windows,
        };
        match choose(&links, &query) {
            LinkChoice::Chosen { link, .. } => assert!(link.href.contains("millmage")),
            other => panic!("expected millmage, got {other:?}"),
        }
    }

    #[test]
    fn the_windows_installer_beats_the_mac_one() {
        let links = vec![
            link("https://cdn.example.com/LightBurn-1.7.08.dmg", "macOS", Some("LightBurn"), 0),
            link("https://cdn.example.com/LightBurn-1.7.08.exe", "Windows 64-bit", Some("LightBurn"), 1),
            link("https://cdn.example.com/LightBurn-1.7.08.AppImage", "Linux", Some("LightBurn"), 2),
        ];
        match choose(&links, &lightburn(Platform::Windows)) {
            LinkChoice::Chosen { link, .. } => assert!(link.href.ends_with(".exe")),
            other => panic!("expected the .exe, got {other:?}"),
        }
    }

    /// Two Windows builds of the right product with nothing to choose between
    /// them is a question, not a coin flip.
    #[test]
    fn a_genuinely_ambiguous_page_asks() {
        let links = vec![
            link("https://cdn.example.com/LightBurn-1.7.08-win.exe", "Windows", Some("LightBurn"), 0),
            link("https://cdn.example.com/LightBurn-1.7.09-win.exe", "Windows", Some("LightBurn"), 1),
        ];
        match choose(&links, &lightburn(Platform::Windows)) {
            LinkChoice::Ambiguous { candidates } => assert!(candidates.len() >= 2),
            other => panic!("expected ambiguity, got {other:?}"),
        }
    }

    /// A page with no download on it must say so rather than pick the best of
    /// the navigation bar.
    #[test]
    fn a_page_without_a_download_returns_nothing() {
        let links = vec![
            link("https://lightburnsoftware.com/pages/support", "Support", None, 0),
            link("https://forum.lightburnsoftware.com/", "Forum", None, 1),
            link("https://lightburnsoftware.com/pages/docs", "Documentation", None, 2),
        ];
        assert!(matches!(
            choose(&links, &lightburn(Platform::Windows)),
            LinkChoice::None { .. }
        ));
    }

    #[test]
    fn buying_is_not_downloading() {
        let links = vec![
            link("https://store.example.com/lightburn/buy", "Buy LightBurn", Some("LightBurn"), 0),
            link("https://cdn.example.com/LightBurn-1.7.08.exe", "Download for Windows", Some("LightBurn"), 1),
        ];
        match choose(&links, &lightburn(Platform::Windows)) {
            LinkChoice::Chosen { link, .. } => assert!(link.href.ends_with(".exe")),
            other => panic!("expected the download, got {other:?}"),
        }
    }

    /// "mill" is a substring of "millmage"; a substring matcher gets this wrong.
    #[test]
    fn product_matching_is_by_word_not_by_substring() {
        assert!(contains_words("Download LightBurn", "lightburn"));
        assert!(!contains_words("MillMage download", "mill"));
        assert!(!contains_words("sawmill tools", "mill"));
    }

    // --- extraction -------------------------------------------------------

    #[test]
    fn links_are_extracted_with_their_headings() {
        let html = r#"
            <h2>MillMage</h2>
            <p><a href="/products/millmage/trial">Download Free Trial</a></p>
            <h2>LightBurn</h2>
            <p><a href="/products/lightburn/trial">Download Free Trial</a></p>
        "#;
        let links = extract_links(html, "https://lightburnsoftware.com/pages/downloads");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].section.as_deref(), Some("MillMage"));
        assert_eq!(links[1].section.as_deref(), Some("LightBurn"));
        assert_eq!(links[1].href, "https://lightburnsoftware.com/products/lightburn/trial");
        assert_eq!(links[1].text, "Download Free Trial");
    }

    /// And the extracted form feeds the chooser, which is the path production
    /// actually takes.
    #[test]
    fn extraction_and_choice_together_pick_lightburn() {
        let html = r#"
            <h2>MillMage</h2>
            <a href="https://cdn.example.com/MillMage-1.0.4.exe">Download Free Trial</a>
            <h2>LightBurn</h2>
            <a href="https://cdn.example.com/LightBurn-1.7.08.exe">Download Free Trial</a>
        "#;
        let links = extract_links(html, "https://lightburnsoftware.com/pages/downloads");
        match choose(&links, &lightburn(Platform::Windows)) {
            LinkChoice::Chosen { link, .. } => {
                assert!(link.href.contains("LightBurn-1.7.08.exe"), "got {}", link.href)
            }
            other => panic!("expected LightBurn, got {other:?}"),
        }
    }

    #[test]
    fn nested_markup_inside_a_link_does_not_break_its_text() {
        let html = r#"<a href="/dl"><span class="btn"><strong>Download</strong> Free Trial</span></a>"#;
        let links = extract_links(html, "https://example.com/");
        assert_eq!(links[0].text, "Download Free Trial");
    }

    #[test]
    fn relative_and_protocol_relative_hrefs_resolve() {
        // `r##"…"##`: the markup contains `"#`, which closes an `r#"…"#`.
        let html = r##"
            <a href="/a">A</a>
            <a href="//cdn.example.com/b.exe">B</a>
            <a href="c.exe">C</a>
            <a href="#top">Skip</a>
            <a href="javascript:void(0)">JS</a>
        "##;
        let links = extract_links(html, "https://site.example.com/pages/downloads");
        let hrefs: Vec<&str> = links.iter().map(|l| l.href.as_str()).collect();
        assert!(hrefs.contains(&"https://site.example.com/a"));
        assert!(hrefs.contains(&"https://cdn.example.com/b.exe"));
        assert!(hrefs.contains(&"https://site.example.com/pages/c.exe"));
        assert_eq!(hrefs.len(), 3, "anchors and javascript: are not links to follow");
    }

    /// Real marketing pages are not well-formed. An unclosed tag must cost one
    /// link, not the page.
    #[test]
    fn malformed_markup_loses_one_link_not_all_of_them() {
        let html = r#"
            <a href="/good1">Download for Windows</a>
            <a href="/broken">never closed
            <a href="/good2">Download installer</a>
        "#;
        let links = extract_links(html, "https://example.com/");
        assert!(
            links.iter().any(|l| l.href.ends_with("/good2")),
            "the link after the malformed one survived",
        );
    }

    #[test]
    fn single_quoted_and_unquoted_attributes_are_read() {
        let html = "<a href='/single'>One</a><a href=/bare >Two</a>";
        let links = extract_links(html, "https://example.com/");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].href, "https://example.com/single");
        assert_eq!(links[1].href, "https://example.com/bare");
    }

    #[test]
    fn platform_parsing_reads_what_the_user_said() {
        assert_eq!(Platform::parse("for Windows"), Platform::Windows);
        assert_eq!(Platform::parse("windows 11"), Platform::Windows);
        assert_eq!(Platform::parse("my Mac"), Platform::MacOs);
        assert_eq!(Platform::parse("ubuntu"), Platform::Linux);
        assert_eq!(Platform::parse(""), Platform::Unknown);
    }
}
