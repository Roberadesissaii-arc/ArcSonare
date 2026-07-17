//! Explicit trusted application registry for native launching.

#[derive(Debug, Clone, Copy)]
pub struct AppEntry {
    pub id: &'static str,
    pub display_name: &'static str,
    pub can_open_desktop: bool,
    pub web_url: Option<&'static str>,
    /// Candidate relative / absolute executable paths (checked in order).
    pub exe_candidates: &'static [&'static str],
    /// Windows process names (reserved for future running-app detection).
    #[allow(dead_code)]
    pub process_names: &'static [&'static str],
}

pub static APP_REGISTRY: &[AppEntry] = &[
    AppEntry {
        id: "spotify",
        display_name: "Spotify",
        can_open_desktop: true,
        web_url: Some("https://open.spotify.com"),
        exe_candidates: &[
            r"%APPDATA%\Spotify\Spotify.exe",
            r"%LOCALAPPDATA%\Microsoft\WindowsApps\Spotify.exe",
        ],
        process_names: &["Spotify.exe"],
    },
    AppEntry {
        id: "gmail",
        display_name: "Gmail",
        can_open_desktop: false,
        web_url: Some("https://mail.google.com"),
        exe_candidates: &[],
        process_names: &[],
    },
    AppEntry {
        id: "youtube",
        display_name: "YouTube",
        can_open_desktop: false,
        web_url: Some("https://www.youtube.com"),
        exe_candidates: &[],
        process_names: &[],
    },
    AppEntry {
        id: "slack",
        display_name: "Slack",
        can_open_desktop: true,
        web_url: Some("https://app.slack.com"),
        exe_candidates: &[
            r"%LOCALAPPDATA%\slack\slack.exe",
            r"%LOCALAPPDATA%\slack\Update.exe",
        ],
        process_names: &["slack.exe"],
    },
    AppEntry {
        id: "notion",
        display_name: "Notion",
        can_open_desktop: true,
        web_url: Some("https://www.notion.so"),
        exe_candidates: &[r"%LOCALAPPDATA%\Programs\Notion\Notion.exe"],
        process_names: &["Notion.exe"],
    },
    AppEntry {
        id: "vscode",
        display_name: "VS Code",
        can_open_desktop: true,
        web_url: Some("https://vscode.dev"),
        exe_candidates: &[
            r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe",
            r"%ProgramFiles%\Microsoft VS Code\Code.exe",
            r"%ProgramFiles(x86)%\Microsoft VS Code\Code.exe",
        ],
        process_names: &["Code.exe"],
    },
    AppEntry {
        id: "cursor",
        display_name: "Cursor",
        can_open_desktop: true,
        web_url: None,
        exe_candidates: &[r"%LOCALAPPDATA%\Programs\cursor\Cursor.exe"],
        process_names: &["Cursor.exe"],
    },
    AppEntry {
        id: "adobe-creative-cloud",
        display_name: "Adobe Creative Cloud",
        can_open_desktop: true,
        web_url: Some("https://www.adobe.com/creativecloud.html"),
        exe_candidates: &[
            r"%ProgramFiles%\Adobe\Adobe Creative Cloud\ACC\Creative Cloud.exe",
            r"%ProgramFiles(x86)%\Adobe\Adobe Creative Cloud\ACC\Creative Cloud.exe",
        ],
        process_names: &["Creative Cloud.exe"],
    },
    AppEntry {
        id: "chrome",
        display_name: "Google Chrome",
        can_open_desktop: true,
        web_url: Some("https://www.google.com"),
        exe_candidates: &[
            r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
            r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
            r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
        ],
        process_names: &["chrome.exe"],
    },
    AppEntry {
        id: "discord",
        display_name: "Discord",
        can_open_desktop: true,
        web_url: Some("https://discord.com/app"),
        // Discord is launched via Update.exe --processStart (see launcher.rs).
        exe_candidates: &[],
        process_names: &["Discord.exe"],
    },
    AppEntry {
        id: "github",
        display_name: "GitHub",
        can_open_desktop: false,
        web_url: Some("https://github.com"),
        exe_candidates: &[],
        process_names: &[],
    },
    AppEntry {
        id: "google-calendar",
        display_name: "Google Calendar",
        can_open_desktop: false,
        web_url: Some("https://calendar.google.com"),
        exe_candidates: &[],
        process_names: &[],
    },
    AppEntry {
        id: "google-meet",
        display_name: "Google Meet",
        can_open_desktop: false,
        web_url: Some("https://meet.google.com"),
        exe_candidates: &[],
        process_names: &[],
    },
    AppEntry {
        id: "zoom",
        display_name: "Zoom",
        can_open_desktop: true,
        web_url: Some("https://zoom.us/start"),
        exe_candidates: &[
            r"%APPDATA%\Zoom\bin\Zoom.exe",
            r"%ProgramFiles%\Zoom\bin\Zoom.exe",
        ],
        process_names: &["Zoom.exe"],
    },
    AppEntry {
        id: "windows-terminal",
        display_name: "Windows Terminal",
        can_open_desktop: true,
        web_url: None,
        exe_candidates: &[
            r"%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe",
            r"%ProgramFiles%\WindowsApps\Microsoft.WindowsTerminal_*\wt.exe",
        ],
        process_names: &["WindowsTerminal.exe", "wt.exe"],
    },
    AppEntry {
        id: "figma",
        display_name: "Figma",
        can_open_desktop: true,
        web_url: Some("https://www.figma.com"),
        exe_candidates: &[r"%LOCALAPPDATA%\Figma\Figma.exe"],
        process_names: &["Figma.exe"],
    },
    AppEntry {
        id: "edge",
        display_name: "Microsoft Edge",
        can_open_desktop: true,
        web_url: Some("https://www.microsoft.com/edge"),
        exe_candidates: &[
            r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
            r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
        ],
        process_names: &["msedge.exe"],
    },
    AppEntry {
        id: "outlook",
        display_name: "Outlook",
        can_open_desktop: true,
        web_url: Some("https://outlook.live.com/mail"),
        exe_candidates: &[
            r"%ProgramFiles%\Microsoft Office\root\Office16\OUTLOOK.EXE",
            r"%ProgramFiles(x86)%\Microsoft Office\root\Office16\OUTLOOK.EXE",
        ],
        process_names: &["OUTLOOK.EXE"],
    },
    AppEntry {
        id: "web-search",
        display_name: "Web Search",
        can_open_desktop: false,
        web_url: Some("https://www.google.com/search?q="),
        exe_candidates: &[],
        process_names: &[],
    },
];
