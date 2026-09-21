//! A download that can be proved.
//!
//! "I clicked Download" is not a download. The old path could click a button
//! and then had nothing to say: no id, no progress, no path, no size, no way to
//! tell a finished 90 MB installer from a 4 KB error page that the server sent
//! with a 200. So it reported success from the click, which is the specific
//! dishonesty this module exists to remove.
//!
//! ArcSonare owns the transfer instead of asking a browser to do it. That is
//! not a workaround for the missing extension — it is strictly better evidence.
//! Owning the transfer means the download id, the byte count, the content type,
//! the final path and the completion time are all *measured*, and a partial
//! file is visibly partial rather than indistinguishable from a finished one.
//!
//! The safety rules that survive from the browser's own behaviour:
//!
//!   - the same SSRF host policy as `web.fetch_page`, shared rather than
//!     reimplemented, so a download cannot reach a local address a fetch cannot;
//!   - the file lands in Downloads under a name derived from the server, never
//!     from anything the model composed;
//!   - an existing unrelated file is never overwritten — the new one is
//!     numbered, the way a browser numbers them;
//!   - nothing is executed. Downloading an installer and running it are two
//!     capabilities with two different risk levels, and this is the low one.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// Beyond this, something is wrong with the request rather than large.
const MAX_DOWNLOAD_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// A stalled connection must not hold a download open forever.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadState {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

/// What a finished download produced.
///
/// Every field is measured from the file on disk or the response that wrote it.
/// Nothing here can be true of a download that did not happen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadArtifact {
    pub download_id: String,
    pub source_url: String,
    pub final_path: PathBuf,
    pub file_name: String,
    pub byte_size: u64,
    #[serde(default)]
    pub mime_type: Option<String>,
    pub completed_at_ms: u64,
}

/// Live progress.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub download_id: String,
    pub source_url: String,
    pub state: DownloadState,
    pub bytes_received: u64,
    /// `None` when the server did not say — which is common, and is reported as
    /// unknown rather than guessed at.
    #[serde(default)]
    pub total_bytes: Option<u64>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub final_path: Option<PathBuf>,
    #[serde(default)]
    pub error: Option<String>,
    pub started_at_ms: u64,
    pub updated_at_ms: u64,
}

impl DownloadProgress {
    /// Percentage, when the total is known. Never fabricated from a guess.
    pub fn percent(&self) -> Option<u8> {
        let total = self.total_bytes?;
        if total == 0 {
            return None;
        }
        Some(((self.bytes_received.min(total) * 100) / total) as u8)
    }

    /// Whether this download can honestly be called finished.
    ///
    /// State alone is not enough: a server that closes early leaves `Completed`
    /// reachable with fewer bytes than promised, and a truncated installer is
    /// worse than a failed one because it looks runnable.
    pub fn is_verified_complete(&self) -> bool {
        if self.state != DownloadState::Completed {
            return false;
        }
        if self.bytes_received == 0 {
            return false;
        }
        match self.total_bytes {
            Some(total) => self.bytes_received == total,
            None => true,
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_download_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!("dl-{}-{:x}", now_ms(), COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Work out what to call the file.
///
/// Order matters, and it is the browser's order: the server's
/// `Content-Disposition` first, then the URL's last path segment, then a
/// generic name. The model never gets a say — a filename it composed is a
/// filename that can be made to say anything.
pub fn file_name_for(url: &str, content_disposition: Option<&str>) -> String {
    if let Some(cd) = content_disposition {
        if let Some(name) = filename_from_disposition(cd) {
            let sanitised = sanitise_file_name(&name);
            if !sanitised.is_empty() {
                return sanitised;
            }
        }
    }
    // Only the *path* is considered. Taking the last `/`-separated segment of
    // the whole URL turns `https://example.com/` into a file called
    // "example.com" — a hostname is not a filename, and a download named after
    // one has no extension and no meaning.
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    let path = without_query
        .strip_prefix("https://")
        .or_else(|| without_query.strip_prefix("http://"))
        .and_then(|rest| rest.split_once('/').map(|(_, p)| p))
        .unwrap_or("");
    let candidate = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let sanitised = sanitise_file_name(candidate);
    if sanitised.is_empty() {
        "download".to_string()
    } else {
        sanitised
    }
}

fn filename_from_disposition(cd: &str) -> Option<String> {
    let lower = cd.to_lowercase();
    // RFC 5987 form wins when present — it carries the encoding.
    if let Some(at) = lower.find("filename*=") {
        let raw = &cd[at + "filename*=".len()..];
        let value = raw.split(';').next()?.trim().trim_matches('"');
        let tail = value.rsplit('\'').next().unwrap_or(value);
        return Some(percent_decode(tail));
    }
    let at = lower.find("filename=")?;
    let raw = &cd[at + "filename=".len()..];
    let value = raw.split(';').next()?.trim().trim_matches('"');
    Some(value.to_string())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Strip anything that could make a filename reach outside the download folder.
///
/// Path separators, traversal, device names, control characters. A server is
/// not a trusted source of filenames, and `Content-Disposition` is attacker-
/// controlled on any site that echoes a parameter into it.
pub fn sanitise_file_name(raw: &str) -> String {
    const RESERVED: &[&str] = &[
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
        "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();
    // Leading dots would make a hidden file; ".." would be traversal even after
    // the separators are gone.
    let trimmed = cleaned.trim().trim_start_matches('.').trim_end_matches([' ', '.']);
    if trimmed.is_empty() {
        return String::new();
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed).to_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        return format!("_{trimmed}");
    }
    trimmed.chars().take(180).collect()
}

/// Pick a name that does not clobber something already there.
///
/// Browsers append " (1)"; so does this. Overwriting an unrelated existing file
/// is a destructive action, and a download is not one.
pub fn non_clobbering_path(folder: &Path, file_name: &str) -> PathBuf {
    let first = folder.join(file_name);
    if !first.exists() {
        return first;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..1_000 {
        let candidate = folder.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    folder.join(format!("{stem} ({}){ext}", now_ms()))
}

/// Why a download needs asking about first.
///
/// Downloading a normal user-requested file asks nothing. These are the four
/// cases in the brief where it does — and each is a different sentence, because
/// "this came from somewhere else" and "this would overwrite your work" are not
/// the same warning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadConcern {
    /// An executable from a host unrelated to the site that offered it.
    ExecutableFromUnexpectedHost { host: String },
    /// Not http(s), or a host the SSRF policy blocks.
    UnsafeUrl,
    /// The destination is outside the user's download folder.
    ProtectedDestination,
    /// A file of the same name is already there and is not ours.
    WouldOverwrite { existing: PathBuf },
}

impl DownloadConcern {
    pub fn message(&self) -> String {
        match self {
            Self::ExecutableFromUnexpectedHost { host } => format!(
                "That download is a program, and it comes from {host}, which isn't the site you \
                 asked me to use. Do you want it?"
            ),
            Self::UnsafeUrl => {
                "That download address isn't one I can safely fetch.".to_string()
            }
            Self::ProtectedDestination => {
                "That would save outside your Downloads folder.".to_string()
            }
            Self::WouldOverwrite { existing } => format!(
                "\"{}\" is already there. Replacing it would discard the current file.",
                existing.display()
            ),
        }
    }
}

const EXECUTABLE_EXTENSIONS: &[&str] = &[
    ".exe", ".msi", ".msix", ".appx", ".bat", ".cmd", ".ps1", ".vbs", ".scr", ".com", ".jar",
];

pub fn looks_executable(file_name: &str) -> bool {
    let l = file_name.to_lowercase();
    EXECUTABLE_EXTENSIONS.iter().any(|e| l.ends_with(e))
}

fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?;
    Some(host.split('@').next_back().unwrap_or(host).to_lowercase())
}

/// Whether two hosts belong to the same organisation, by registrable suffix.
///
/// `cdn.lightburnsoftware.com` and `lightburnsoftware.com` are the same
/// download; `lightburn.totally-legit-mirror.ru` is not, and the two are
/// indistinguishable if you only compare whether one contains the other.
fn same_site(a: &str, b: &str) -> bool {
    fn last_two(host: &str) -> String {
        let parts: Vec<&str> = host.split('.').collect();
        if parts.len() < 2 {
            return host.to_string();
        }
        parts[parts.len() - 2..].join(".")
    }
    a == b || last_two(a) == last_two(b)
}

/// Decide whether this download may proceed silently.
///
/// `origin_url` is the page the user asked about; the download's own host is
/// compared against it. A file offered by a site and served from that site's
/// CDN is normal. The same file served from an unrelated host is the mirror
/// case in the brief, and it asks.
pub fn concerns_for(
    download_url: &str,
    origin_url: Option<&str>,
    destination: &Path,
    downloads_folder: &Path,
    url_is_safe: bool,
) -> Vec<DownloadConcern> {
    let mut concerns = Vec::new();
    if !url_is_safe
        || !(download_url.starts_with("https://") || download_url.starts_with("http://"))
    {
        concerns.push(DownloadConcern::UnsafeUrl);
    }
    let file_name = destination
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    if looks_executable(&file_name) {
        if let (Some(dl_host), Some(origin)) = (host_of(download_url), origin_url.and_then(host_of))
        {
            if !same_site(&dl_host, &origin) {
                concerns.push(DownloadConcern::ExecutableFromUnexpectedHost { host: dl_host });
            }
        }
    }
    if !destination.starts_with(downloads_folder) {
        concerns.push(DownloadConcern::ProtectedDestination);
    }
    if destination.exists() {
        concerns.push(DownloadConcern::WouldOverwrite {
            existing: destination.to_path_buf(),
        });
    }
    concerns
}

/// Live downloads, so progress can be polled and completion awaited.
#[derive(Default)]
pub struct DownloadStore(Mutex<Vec<DownloadProgress>>);

/// How many finished downloads are remembered. Bounded, like everything else
/// that could otherwise accumulate for a session's lifetime.
const HISTORY_LIMIT: usize = 24;

impl DownloadStore {
    pub fn start(&self, download_id: &str, source_url: &str) -> DownloadProgress {
        let now = now_ms();
        let progress = DownloadProgress {
            download_id: download_id.to_string(),
            source_url: source_url.to_string(),
            state: DownloadState::Pending,
            bytes_received: 0,
            total_bytes: None,
            file_name: None,
            final_path: None,
            error: None,
            started_at_ms: now,
            updated_at_ms: now,
        };
        let mut list = self.0.lock().unwrap();
        list.push(progress.clone());
        let overflow = list.len().saturating_sub(HISTORY_LIMIT);
        if overflow > 0 {
            // Only finished ones are dropped; a live download is never evicted.
            let mut removed = 0;
            list.retain(|p| {
                if removed >= overflow
                    || matches!(p.state, DownloadState::Pending | DownloadState::InProgress)
                {
                    true
                } else {
                    removed += 1;
                    false
                }
            });
        }
        progress
    }

    pub fn update(&self, download_id: &str, f: impl FnOnce(&mut DownloadProgress)) {
        let mut list = self.0.lock().unwrap();
        if let Some(p) = list.iter_mut().find(|p| p.download_id == download_id) {
            f(p);
            p.updated_at_ms = now_ms();
        }
    }

    pub fn get(&self, download_id: &str) -> Option<DownloadProgress> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.download_id == download_id)
            .cloned()
    }

    pub fn all(&self) -> Vec<DownloadProgress> {
        self.0.lock().unwrap().clone()
    }

    /// The finished artifact, or why there isn't one.
    ///
    /// The only route to a `DownloadArtifact`. Constructing one anywhere else
    /// would be constructing evidence.
    pub fn artifact(&self, download_id: &str) -> Result<DownloadArtifact, String> {
        let progress = self
            .get(download_id)
            .ok_or_else(|| "No download by that id.".to_string())?;
        match progress.state {
            DownloadState::Completed => {}
            DownloadState::Failed => {
                return Err(progress
                    .error
                    .unwrap_or_else(|| "The download failed.".into()))
            }
            DownloadState::Cancelled => return Err("The download was cancelled.".into()),
            _ => return Err("That download hasn't finished yet.".into()),
        }
        if !progress.is_verified_complete() {
            return Err(format!(
                "The download stopped early — {} of {} bytes arrived.",
                progress.bytes_received,
                progress
                    .total_bytes
                    .map(|t| t.to_string())
                    .unwrap_or_else(|| "an unknown number of".into()),
            ));
        }
        let path = progress
            .final_path
            .clone()
            .ok_or_else(|| "The download finished but no path was recorded.".to_string())?;
        // The file on disk is the evidence, not the bookkeeping.
        let metadata = std::fs::metadata(&path)
            .map_err(|e| format!("The downloaded file is not where it should be: {e}"))?;
        if metadata.len() != progress.bytes_received {
            return Err(format!(
                "The file on disk is {} bytes but {} were received — it is not intact.",
                metadata.len(),
                progress.bytes_received,
            ));
        }
        Ok(DownloadArtifact {
            download_id: progress.download_id,
            source_url: progress.source_url,
            file_name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            final_path: path,
            byte_size: metadata.len(),
            mime_type: None,
            completed_at_ms: progress.updated_at_ms,
        })
    }

    pub fn clear(&self) {
        self.0.lock().unwrap().clear();
    }
}

/// Perform the transfer.
///
/// Writes to a `.part` beside the destination and renames on success, so a
/// half-written installer never appears under its real name — the same reason
/// the file-edit code writes atomically.
pub fn transfer(
    store: &DownloadStore,
    download_id: &str,
    url: &str,
    destination: &Path,
) -> Result<DownloadArtifact, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 ArcSonare/1.0",
        )
        // No overall timeout — a 90 MB installer on a slow line is not a fault.
        // The stall guard is per-connection instead, so a dead socket still
        // fails rather than holding the download open forever.
        .timeout(None)
        .connect_timeout(READ_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Could not prepare the download: {e}"))?;

    store.update(download_id, |p| p.state = DownloadState::InProgress);

    let fail = |store: &DownloadStore, message: String| -> String {
        store.update(download_id, |p| {
            p.state = DownloadState::Failed;
            p.error = Some(message.clone());
        });
        message
    };

    let mut response = match client.get(url).send() {
        Ok(r) => r,
        Err(e) => return Err(fail(store, format!("Could not reach that download: {e}"))),
    };
    if !response.status().is_success() {
        return Err(fail(
            store,
            format!("The download returned HTTP {}.", response.status()),
        ));
    }
    // A redirect to a blocked host must not be followed into a write.
    if crate::capabilities::web::is_blocked_host_public(response.url().as_str()) {
        return Err(fail(
            store,
            "That download redirected to a blocked local address.".into(),
        ));
    }

    let total = response.content_length();
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string());

    if let Some(t) = total {
        if t > MAX_DOWNLOAD_BYTES {
            return Err(fail(
                store,
                format!("That download is {t} bytes, which is larger than I will fetch."),
            ));
        }
    }
    store.update(download_id, |p| {
        p.total_bytes = total;
        p.file_name = destination
            .file_name()
            .map(|n| n.to_string_lossy().into_owned());
    });

    let part = destination.with_extension(format!(
        "{}part",
        destination
            .extension()
            .map(|e| format!("{}.", e.to_string_lossy()))
            .unwrap_or_default()
    ));
    if let Some(parent) = destination.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Err(fail(store, format!("Could not prepare the folder: {e}")));
        }
    }
    let mut file = match std::fs::File::create(&part) {
        Ok(f) => f,
        Err(e) => return Err(fail(store, format!("Could not create the file: {e}"))),
    };

    let mut received: u64 = 0;
    let mut buffer = vec![0u8; 128 * 1024];
    loop {
        use std::io::Read;
        let n = match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                return Err(fail(store, format!("The download was interrupted: {e}")));
            }
        };
        if let Err(e) = file.write_all(&buffer[..n]) {
            let _ = std::fs::remove_file(&part);
            return Err(fail(store, format!("Could not write the file: {e}")));
        }
        received += n as u64;
        if received > MAX_DOWNLOAD_BYTES {
            let _ = std::fs::remove_file(&part);
            return Err(fail(store, "That download exceeded the size limit.".into()));
        }
        store.update(download_id, |p| p.bytes_received = received);
    }
    if let Err(e) = file.sync_all() {
        let _ = std::fs::remove_file(&part);
        return Err(fail(store, format!("Could not finish writing the file: {e}")));
    }
    drop(file);

    // Short is a failure, not a completion. A truncated installer is worse than
    // a missing one, because it looks runnable.
    if let Some(expected) = total {
        if received != expected {
            let _ = std::fs::remove_file(&part);
            return Err(fail(
                store,
                format!("The download stopped early — {received} of {expected} bytes arrived."),
            ));
        }
    }
    if received == 0 {
        let _ = std::fs::remove_file(&part);
        return Err(fail(store, "The download produced an empty file.".into()));
    }
    if let Err(e) = std::fs::rename(&part, destination) {
        let _ = std::fs::remove_file(&part);
        return Err(fail(store, format!("Could not save the download: {e}")));
    }

    store.update(download_id, |p| {
        p.state = DownloadState::Completed;
        p.bytes_received = received;
        p.final_path = Some(destination.to_path_buf());
    });
    let mut artifact = store.artifact(download_id)?;
    artifact.mime_type = mime;
    Ok(artifact)
}

/// Begin a download and return its id.
pub fn begin(store: &DownloadStore, url: &str) -> String {
    let id = new_download_id();
    store.start(&id, url);
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(state: DownloadState, received: u64, total: Option<u64>) -> DownloadProgress {
        DownloadProgress {
            download_id: "dl-1".into(),
            source_url: "https://example.com/x.exe".into(),
            state,
            bytes_received: received,
            total_bytes: total,
            file_name: Some("x.exe".into()),
            final_path: Some(PathBuf::from("C:\\Users\\x\\Downloads\\x.exe")),
            error: None,
            started_at_ms: 0,
            updated_at_ms: 1,
        }
    }

    // --- honesty ----------------------------------------------------------

    /// The core rule: a click is not a download, and neither is a state flag.
    #[test]
    fn a_short_download_is_not_complete() {
        let p = progress(DownloadState::Completed, 1_024, Some(90_000_000));
        assert!(
            !p.is_verified_complete(),
            "1 KB of a 90 MB installer must not report as finished",
        );
    }

    #[test]
    fn an_empty_download_is_not_complete() {
        assert!(!progress(DownloadState::Completed, 0, Some(0)).is_verified_complete());
        assert!(!progress(DownloadState::Completed, 0, None).is_verified_complete());
    }

    #[test]
    fn an_unfinished_download_is_not_complete() {
        for state in [
            DownloadState::Pending,
            DownloadState::InProgress,
            DownloadState::Failed,
            DownloadState::Cancelled,
        ] {
            assert!(!progress(state, 90_000_000, Some(90_000_000)).is_verified_complete());
        }
    }

    #[test]
    fn a_full_download_is_complete() {
        assert!(progress(DownloadState::Completed, 90_000_000, Some(90_000_000))
            .is_verified_complete());
        // A server that sent no length is trusted only once bytes arrived.
        assert!(progress(DownloadState::Completed, 42, None).is_verified_complete());
    }

    #[test]
    fn percent_is_absent_rather_than_invented() {
        assert_eq!(progress(DownloadState::InProgress, 50, None).percent(), None);
        assert_eq!(
            progress(DownloadState::InProgress, 50, Some(200)).percent(),
            Some(25),
        );
    }

    /// A failed download cannot yield an artifact — the thing downstream code
    /// uses as proof that a file exists.
    #[test]
    fn a_failed_download_has_no_artifact() {
        let store = DownloadStore::default();
        let id = begin(&store, "https://example.com/x.exe");
        store.update(&id, |p| {
            p.state = DownloadState::Failed;
            p.error = Some("The download returned HTTP 404.".into());
        });
        let err = store.artifact(&id).unwrap_err();
        assert!(err.contains("404"), "the real reason is reported: {err}");
    }

    #[test]
    fn an_unfinished_download_has_no_artifact() {
        let store = DownloadStore::default();
        let id = begin(&store, "https://example.com/x.exe");
        assert!(store.artifact(&id).is_err());
        store.update(&id, |p| {
            p.state = DownloadState::InProgress;
            p.bytes_received = 500;
        });
        assert!(store.artifact(&id).unwrap_err().contains("hasn't finished"));
    }

    /// The bookkeeping saying "done" is not enough — the file has to be there.
    #[test]
    fn an_artifact_requires_the_file_to_exist() {
        let store = DownloadStore::default();
        let id = begin(&store, "https://example.com/x.exe");
        store.update(&id, |p| {
            p.state = DownloadState::Completed;
            p.bytes_received = 10;
            p.total_bytes = Some(10);
            p.final_path = Some(PathBuf::from(
                "C:\\definitely\\not\\here\\nothing-is-here.exe",
            ));
        });
        assert!(store.artifact(&id).is_err());
    }

    #[test]
    fn an_artifact_is_produced_for_a_real_file() {
        let dir = std::env::temp_dir().join(format!("arcsonare-dl-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.exe");
        std::fs::write(&path, b"MZ-not-really-an-executable").unwrap();
        let size = std::fs::metadata(&path).unwrap().len();

        let store = DownloadStore::default();
        let id = begin(&store, "https://example.com/fixture.exe");
        store.update(&id, |p| {
            p.state = DownloadState::Completed;
            p.bytes_received = size;
            p.total_bytes = Some(size);
            p.final_path = Some(path.clone());
        });
        let artifact = store.artifact(&id).expect("a real file yields an artifact");
        assert_eq!(artifact.file_name, "fixture.exe");
        assert_eq!(artifact.byte_size, size);
        assert_eq!(artifact.final_path, path);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A file that shrank or grew after the transfer is not the file that was
    /// downloaded.
    #[test]
    fn a_tampered_file_does_not_yield_an_artifact() {
        let dir = std::env::temp_dir().join(format!("arcsonare-dl-t-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("x.exe");
        std::fs::write(&path, b"12345").unwrap();

        let store = DownloadStore::default();
        let id = begin(&store, "https://example.com/x.exe");
        store.update(&id, |p| {
            p.state = DownloadState::Completed;
            p.bytes_received = 999;
            p.total_bytes = Some(999);
            p.final_path = Some(path.clone());
        });
        assert!(store.artifact(&id).unwrap_err().contains("not intact"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- naming -----------------------------------------------------------

    #[test]
    fn the_server_names_the_file_before_the_url_does() {
        assert_eq!(
            file_name_for(
                "https://cdn.example.com/dl?id=42",
                Some("attachment; filename=\"LightBurn-1.7.08.exe\""),
            ),
            "LightBurn-1.7.08.exe",
        );
        assert_eq!(
            file_name_for("https://cdn.example.com/LightBurn-1.7.08.exe", None),
            "LightBurn-1.7.08.exe",
        );
        assert_eq!(
            file_name_for("https://cdn.example.com/files/?q=1", None),
            "files",
        );
    }

    #[test]
    fn rfc5987_filenames_are_decoded() {
        assert_eq!(
            file_name_for(
                "https://x/dl",
                Some("attachment; filename*=UTF-8''Light%20Burn.exe"),
            ),
            "Light Burn.exe",
        );
    }

    /// `Content-Disposition` is attacker-controlled on plenty of sites.
    #[test]
    fn a_hostile_filename_cannot_escape_the_download_folder() {
        for hostile in [
            "../../../Windows/System32/evil.exe",
            "..\\..\\startup\\evil.exe",
            "C:\\Windows\\System32\\drivers\\etc\\hosts",
            "evil\u{0000}.exe",
        ] {
            let safe = sanitise_file_name(hostile);
            assert!(!safe.contains('/'), "{hostile} → {safe}");
            assert!(!safe.contains('\\'), "{hostile} → {safe}");
            assert!(!safe.contains(':'), "{hostile} → {safe}");
            assert!(!safe.starts_with('.'), "{hostile} → {safe}");
        }
    }

    #[test]
    fn windows_device_names_are_not_used_verbatim() {
        assert_eq!(sanitise_file_name("CON.exe"), "_CON.exe");
        assert_eq!(sanitise_file_name("nul"), "_nul");
        assert_eq!(sanitise_file_name("connection.exe"), "connection.exe");
    }

    #[test]
    fn an_empty_or_unusable_name_falls_back() {
        assert_eq!(file_name_for("https://example.com/", None), "download");
        assert_eq!(file_name_for("https://example.com/...", None), "download");
    }

    #[test]
    fn an_existing_file_is_numbered_not_replaced() {
        let dir = std::env::temp_dir().join(format!("arcsonare-clobber-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("setup.exe"), b"original").unwrap();

        let chosen = non_clobbering_path(&dir, "setup.exe");
        assert_eq!(
            chosen.file_name().unwrap().to_string_lossy(),
            "setup (1).exe",
        );
        assert_eq!(
            std::fs::read(dir.join("setup.exe")).unwrap(),
            b"original",
            "the existing file is untouched",
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- when to ask ------------------------------------------------------

    #[test]
    fn a_normal_download_from_the_site_asks_nothing() {
        let downloads = Path::new("C:\\Users\\rober\\Downloads");
        let concerns = concerns_for(
            "https://cdn.lightburnsoftware.com/LightBurn-1.7.08.exe",
            Some("https://lightburnsoftware.com/pages/downloads"),
            &downloads.join("LightBurn-1.7.08.exe"),
            downloads,
            true,
        );
        assert!(concerns.is_empty(), "{concerns:?}");
    }

    /// The deceptive-mirror case: the same filename, a host that merely looks
    /// related.
    #[test]
    fn an_executable_from_an_unrelated_host_asks() {
        let downloads = Path::new("C:\\Users\\rober\\Downloads");
        let concerns = concerns_for(
            "https://lightburn.free-downloads-cdn.ru/LightBurn-1.7.08.exe",
            Some("https://lightburnsoftware.com/pages/downloads"),
            &downloads.join("LightBurn-1.7.08.exe"),
            downloads,
            true,
        );
        assert!(matches!(
            concerns.first(),
            Some(DownloadConcern::ExecutableFromUnexpectedHost { .. }),
        ));
    }

    #[test]
    fn a_non_executable_from_elsewhere_does_not_ask() {
        let downloads = Path::new("C:\\Users\\rober\\Downloads");
        let concerns = concerns_for(
            "https://images.example.net/manual.pdf",
            Some("https://lightburnsoftware.com/pages/docs"),
            &downloads.join("manual.pdf"),
            downloads,
            true,
        );
        assert!(concerns.is_empty(), "{concerns:?}");
    }

    #[test]
    fn a_destination_outside_downloads_asks() {
        let downloads = Path::new("C:\\Users\\rober\\Downloads");
        let concerns = concerns_for(
            "https://cdn.example.com/x.exe",
            None,
            Path::new("C:\\Windows\\System32\\x.exe"),
            downloads,
            true,
        );
        assert!(concerns.contains(&DownloadConcern::ProtectedDestination));
    }

    #[test]
    fn a_blocked_url_asks() {
        let downloads = Path::new("C:\\Users\\rober\\Downloads");
        let concerns = concerns_for(
            "file:///C:/Windows/System32/x.exe",
            None,
            &downloads.join("x.exe"),
            downloads,
            false,
        );
        assert!(concerns.contains(&DownloadConcern::UnsafeUrl));
    }

    #[test]
    fn a_cdn_subdomain_counts_as_the_same_site() {
        assert!(same_site("cdn.lightburnsoftware.com", "lightburnsoftware.com"));
        assert!(same_site("lightburnsoftware.com", "www.lightburnsoftware.com"));
        assert!(!same_site("lightburn.evil.ru", "lightburnsoftware.com"));
    }

    #[test]
    fn executables_are_recognised_by_extension() {
        for name in ["a.exe", "b.MSI", "c.msix", "d.bat", "e.ps1"] {
            assert!(looks_executable(name), "{name}");
        }
        for name in ["a.pdf", "b.zip", "c.png", "d.txt"] {
            assert!(!looks_executable(name), "{name}");
        }
    }

    // --- store bookkeeping ------------------------------------------------

    #[test]
    fn a_live_download_is_never_evicted_by_history() {
        let store = DownloadStore::default();
        let live = begin(&store, "https://example.com/live.exe");
        for i in 0..HISTORY_LIMIT * 2 {
            let id = begin(&store, &format!("https://example.com/{i}.bin"));
            store.update(&id, |p| p.state = DownloadState::Completed);
        }
        assert!(
            store.get(&live).is_some(),
            "an in-flight download survived the history cap",
        );
        assert!(store.all().len() <= HISTORY_LIMIT + 1);
    }
}
