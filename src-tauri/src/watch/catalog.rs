//! Which running window belongs to which application.
//!
//! Mirrors the frontend's `contextAppCatalog`, deliberately. The frontend copy
//! carries icons and copywriting; this one carries only matching rules, and it
//! lives in Rust because instance discovery must not depend on a webview being
//! open — the voice overlay asks for watched context before the Dashboard has
//! ever rendered.
//!
//! `check-watch-catalog-parity` asserts the two id sets agree, so a catalog
//! entry added on one side cannot silently go unmatched on the other.

/// A browser tab destination (`youtube`) versus a real application (`spotify`).
///
/// The distinction matters for actions: focusing YouTube means focusing the
/// browser window showing it, and there is no YouTube process to press play in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppSurface {
    Desktop,
    BrowserTab,
}

pub struct CatalogEntry {
    pub id: &'static str,
    pub display_name: &'static str,
    /// Executable basenames, lowercase, without `.exe`.
    pub process_names: &'static [&'static str],
    /// Lowercase substrings matched against the window title.
    pub title_hints: &'static [&'static str],
    pub surface: AppSurface,
    /// The adapter that can read and act on this application, if one exists.
    pub adapter_id: Option<&'static str>,
}

pub const WATCH_CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        id: "spotify",
        display_name: "Spotify",
        process_names: &["spotify"],
        title_hints: &["spotify"],
        surface: AppSurface::Desktop,
        adapter_id: Some("spotify-desktop"),
    },
    CatalogEntry {
        id: "vscode",
        display_name: "VS Code",
        process_names: &["code"],
        title_hints: &["visual studio code"],
        surface: AppSurface::Desktop,
        adapter_id: Some("vscode-bridge"),
    },
    CatalogEntry {
        id: "cursor",
        display_name: "Cursor",
        process_names: &["cursor"],
        title_hints: &["cursor"],
        surface: AppSurface::Desktop,
        adapter_id: Some("vscode-bridge"),
    },
    CatalogEntry {
        id: "discord",
        display_name: "Discord",
        process_names: &["discord"],
        title_hints: &["discord"],
        surface: AppSurface::Desktop,
        adapter_id: Some("discord-desktop"),
    },
    CatalogEntry {
        id: "slack",
        display_name: "Slack",
        process_names: &["slack"],
        title_hints: &["slack"],
        surface: AppSurface::Desktop,
        adapter_id: None,
    },
    CatalogEntry {
        id: "chrome",
        display_name: "Chrome",
        process_names: &["chrome"],
        title_hints: &[],
        surface: AppSurface::Desktop,
        adapter_id: Some("browser-window"),
    },
    CatalogEntry {
        id: "edge",
        display_name: "Edge",
        process_names: &["msedge"],
        title_hints: &[],
        surface: AppSurface::Desktop,
        adapter_id: Some("browser-window"),
    },
    CatalogEntry {
        id: "firefox",
        display_name: "Firefox",
        process_names: &["firefox"],
        title_hints: &[],
        surface: AppSurface::Desktop,
        adapter_id: Some("browser-window"),
    },
    CatalogEntry {
        id: "brave",
        display_name: "Brave",
        process_names: &["brave"],
        title_hints: &[],
        surface: AppSurface::Desktop,
        adapter_id: Some("browser-window"),
    },
    CatalogEntry {
        id: "zoom",
        display_name: "Zoom",
        process_names: &["zoom", "cpthost", "zoomus"],
        title_hints: &["zoom meeting", "zoom webinar"],
        surface: AppSurface::Desktop,
        adapter_id: None,
    },
    CatalogEntry {
        id: "teams",
        display_name: "Microsoft Teams",
        process_names: &["ms-teams", "teams", "msteams"],
        title_hints: &["microsoft teams"],
        surface: AppSurface::Desktop,
        adapter_id: None,
    },
    CatalogEntry {
        id: "notion",
        display_name: "Notion",
        process_names: &["notion"],
        title_hints: &["notion"],
        surface: AppSurface::Desktop,
        adapter_id: None,
    },
    CatalogEntry {
        id: "outlook",
        display_name: "Outlook",
        process_names: &["outlook", "olk"],
        title_hints: &["outlook"],
        surface: AppSurface::Desktop,
        adapter_id: None,
    },
    CatalogEntry {
        id: "figma",
        display_name: "Figma",
        process_names: &["figma"],
        title_hints: &["figma"],
        surface: AppSurface::Desktop,
        adapter_id: None,
    },
    CatalogEntry {
        id: "onenote",
        display_name: "OneNote",
        process_names: &["onenote", "onenotem"],
        title_hints: &["onenote"],
        surface: AppSurface::Desktop,
        adapter_id: None,
    },
    // ---- browser tab destinations -----------------------------------------
    // These have no process of their own. They are recognised on a browser
    // window whose title says so, and they are addressed through the browser.
    CatalogEntry {
        id: "youtube",
        display_name: "YouTube",
        process_names: &["chrome", "msedge", "firefox", "brave", "opera"],
        title_hints: &["youtube"],
        surface: AppSurface::BrowserTab,
        adapter_id: Some("browser-youtube"),
    },
    CatalogEntry {
        id: "netflix",
        display_name: "Netflix",
        process_names: &["chrome", "msedge", "firefox", "brave", "opera"],
        title_hints: &["netflix"],
        surface: AppSurface::BrowserTab,
        adapter_id: None,
    },
    CatalogEntry {
        id: "amazon",
        display_name: "Amazon",
        process_names: &["chrome", "msedge", "firefox", "brave", "opera"],
        title_hints: &["amazon.com", "amazon.co", "| amazon"],
        surface: AppSurface::BrowserTab,
        adapter_id: None,
    },
    CatalogEntry {
        id: "google-meet",
        display_name: "Google Meet",
        process_names: &["chrome", "msedge", "firefox", "brave", "opera"],
        title_hints: &["meet.google", "google meet"],
        surface: AppSurface::BrowserTab,
        adapter_id: None,
    },
    CatalogEntry {
        id: "google-classroom",
        display_name: "Classroom",
        process_names: &["chrome", "msedge", "firefox", "brave", "opera"],
        title_hints: &["google classroom", "classroom.google"],
        surface: AppSurface::BrowserTab,
        adapter_id: None,
    },
    CatalogEntry {
        id: "udemy",
        display_name: "Udemy",
        process_names: &["chrome", "msedge", "firefox", "brave", "opera"],
        title_hints: &["udemy"],
        surface: AppSurface::BrowserTab,
        adapter_id: None,
    },
];

pub fn catalog_entry(id: &str) -> Option<&'static CatalogEntry> {
    WATCH_CATALOG.iter().find(|e| e.id == id)
}

fn normalize_exe(raw: &str) -> String {
    raw.trim()
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(raw)
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_lowercase()
}

/// Which catalog application this window belongs to, if any.
///
/// A browser window showing YouTube is *both* Chrome and YouTube. It resolves
/// to the tab destination, because that is the more specific answer and the
/// browser instance is still reachable from it — the reverse is not true. The
/// browser row is produced separately by the caller when it is watched in its
/// own right.
pub fn match_catalog_id(exe_name: &str, app_name: &str, title: &str) -> Option<String> {
    let exe = normalize_exe(exe_name);
    let app = normalize_exe(app_name);
    let lower_title = title.to_lowercase();

    let process_matches = |entry: &CatalogEntry| {
        entry
            .process_names
            .iter()
            .any(|p| *p == exe || *p == app)
    };

    // Tab destinations first: more specific, and only on a browser process.
    for entry in WATCH_CATALOG
        .iter()
        .filter(|e| e.surface == AppSurface::BrowserTab)
    {
        if !process_matches(entry) {
            continue;
        }
        if entry
            .title_hints
            .iter()
            .any(|h| lower_title.contains(h))
        {
            return Some(entry.id.to_string());
        }
    }

    for entry in WATCH_CATALOG
        .iter()
        .filter(|e| e.surface == AppSurface::Desktop)
    {
        if process_matches(entry) {
            return Some(entry.id.to_string());
        }
    }

    None
}

/// The browser application a tab destination is showing in, if any.
pub fn host_browser_for(exe_name: &str, app_name: &str) -> Option<String> {
    let exe = normalize_exe(exe_name);
    let app = normalize_exe(app_name);
    WATCH_CATALOG
        .iter()
        .find(|e| {
            e.surface == AppSurface::Desktop
                && e.adapter_id == Some("browser-window")
                && e.process_names.iter().any(|p| *p == exe || *p == app)
        })
        .map(|e| e.id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_catalog_id_is_unique() {
        let mut ids: Vec<&str> = WATCH_CATALOG.iter().map(|e| e.id).collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total, "duplicate catalog id");
    }

    #[test]
    fn a_spotify_window_matches_spotify() {
        assert_eq!(
            match_catalog_id("Spotify.exe", "Spotify", "Artist - Track").as_deref(),
            Some("spotify")
        );
    }

    /// A browser showing YouTube must resolve to YouTube, not to Chrome —
    /// otherwise "show me the channel" has nothing site-specific to work from.
    #[test]
    fn a_browser_on_youtube_resolves_to_the_tab_destination() {
        assert_eq!(
            match_catalog_id("chrome.exe", "Chrome", "Some Video - YouTube - Google Chrome")
                .as_deref(),
            Some("youtube")
        );
    }

    /// The same browser on an unrelated page is just the browser.
    #[test]
    fn a_browser_on_an_ordinary_page_resolves_to_the_browser() {
        assert_eq!(
            match_catalog_id("chrome.exe", "Chrome", "Wikipedia - Google Chrome").as_deref(),
            Some("chrome")
        );
    }

    /// A desktop application whose title happens to mention a site must not be
    /// mistaken for a browser tab.
    #[test]
    fn a_desktop_app_is_not_matched_as_a_tab_destination() {
        assert_eq!(
            match_catalog_id("Spotify.exe", "Spotify", "Watching YouTube playlist").as_deref(),
            Some("spotify"),
            "the tab rule requires a browser process, not just the word"
        );
    }

    #[test]
    fn an_unknown_application_matches_nothing() {
        assert_eq!(match_catalog_id("solitaire.exe", "Solitaire", "Klondike"), None);
    }

    #[test]
    fn the_host_browser_of_a_tab_is_identifiable() {
        assert_eq!(host_browser_for("msedge.exe", "Edge").as_deref(), Some("edge"));
        assert_eq!(host_browser_for("spotify.exe", "Spotify"), None);
    }
}
