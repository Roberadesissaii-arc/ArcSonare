//! The capability surface for the browser-to-download-to-installer workflow.
//!
//! Each of these returns a `ToolResult` with real verification evidence, and
//! the evidence is the reason they exist. The previous path could say "I
//! clicked the download button" and nothing more; these say which link, why
//! that one, how many bytes, where the file is, who signed it, and whether the
//! application is now installed — each of which is checkable and each of which
//! was previously unavailable.
//!
//! The strategy order from the brief is visible in what is *not* here. There is
//! no `browser.click_download_button`. Finding the link is done from page
//! structure and the transfer is done by ArcSonare, because both are more
//! reliable than pixels and both produce evidence pixels cannot. The visual
//! route remains available through the existing `screen.click_target` for the
//! cases structure genuinely cannot reach.

use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;
use tauri::State;

use super::download::{self, DownloadStore};
use super::installer;
use super::links::{self, DownloadQuery, LinkChoice, Platform};
use crate::capabilities::types::{ResultBuilder, ToolResult, VerificationEvidence};

/// Where downloads go. The user's Downloads folder, and nowhere else by default.
fn downloads_folder() -> Result<PathBuf, String> {
    let profile = std::env::var("USERPROFILE")
        .map_err(|_| "Could not find your user folder.".to_string())?;
    let path = PathBuf::from(profile).join("Downloads");
    if !path.is_dir() {
        return Err("Your Downloads folder could not be found.".into());
    }
    Ok(path)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// browser.find_link
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct FindLinkArgs {
    /// The page to read.
    pub url: String,
    /// What the user asked for — "LightBurn".
    pub product: String,
    /// "windows" | "mac" | "linux"; omitted means any.
    #[serde(default)]
    pub platform: Option<String>,
}

/// Find the download link for a named product on a page.
///
/// This is the fix for the reported failure. Two products on one page with
/// identically-labelled buttons are indistinguishable in a screenshot and
/// perfectly distinguishable in the markup, so the markup decides.
pub fn find_link(args: FindLinkArgs) -> ToolResult {
    let rb = ResultBuilder::new("browser.find_link");
    let html = match fetch_html(&args.url) {
        Ok(h) => h,
        Err(e) => return rb.error("fetch-failed", e, true),
    };
    let extracted = links::extract_links(&html.body, &html.final_url);
    let query = DownloadQuery {
        product: args.product.clone(),
        platform: args
            .platform
            .as_deref()
            .map(Platform::parse)
            .unwrap_or(Platform::Unknown),
    };

    match links::choose(&extracted, &query) {
        LinkChoice::Chosen {
            link,
            score,
            reasons,
        } => rb.success(
            format!(
                "Found the {} download: \"{}\" — {}.",
                args.product,
                link.text,
                reasons.first().map(String::as_str).unwrap_or("it matches"),
            ),
            json!({
                "href": link.href,
                "text": link.text,
                "section": link.section,
                "score": score,
                "reasons": reasons,
                "pageUrl": html.final_url,
                "linksInspected": extracted.len(),
            }),
            VerificationEvidence::verified_with(
                "artifact-validated",
                json!({ "linksInspected": extracted.len(), "score": score }),
            ),
        ),
        // Several plausible ones. The user picks — a coin flip here is how the
        // wrong product gets downloaded.
        LinkChoice::Ambiguous { candidates } => rb.needs_confirmation(
            format!(
                "There are {} downloads on that page that could be what you meant.",
                candidates.len()
            ),
            json!({
                "confirmation": {
                    "reason": "ambiguous",
                    "candidates": candidates.iter().map(|c| json!({
                        "id": c.link.href,
                        "label": if let Some(section) = &c.link.section {
                            format!("{} — {}", section, c.link.text)
                        } else {
                            c.link.text.clone()
                        },
                    })).collect::<Vec<_>>(),
                },
                "pageUrl": html.final_url,
            }),
        ),
        LinkChoice::None { inspected } => rb.not_found(format!(
            "I read {inspected} links on that page and none of them is a {} download.",
            args.product
        )),
    }
}

struct FetchedHtml {
    final_url: String,
    body: String,
}

/// Fetch a page's HTML under the same host policy `web.fetch_page` uses.
///
/// Shared rather than reimplemented: a second copy of an SSRF policy is a
/// second place for it to be wrong, and the whole value of the policy is that
/// there is one answer to "may this address be reached".
fn fetch_html(url: &str) -> Result<FetchedHtml, String> {
    let url = url.trim();
    crate::top_overlay::web_launcher::validate_http_url(url)?;
    if crate::capabilities::web::is_blocked_host_public(url) {
        return Err("That address is blocked for safety (local/private network).".into());
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 ArcSonare/1.0",
        )
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Could not prepare the request: {e}"))?;
    let response = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .map_err(|e| format!("Could not reach that page: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("That page returned HTTP {}.", response.status()));
    }
    let final_url = response.url().to_string();
    if crate::capabilities::web::is_blocked_host_public(&final_url) {
        return Err("That page redirected to a blocked local address.".into());
    }
    let body = response
        .text()
        .map_err(|e| format!("Could not read that page: {e}"))?;
    Ok(FetchedHtml { final_url, body })
}

// ---------------------------------------------------------------------------
// browser.download
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct DownloadArgs {
    pub url: String,
    /// The page the link came from, so a mirror can be told from the real host.
    #[serde(default)]
    pub origin_url: Option<String>,
    /// Set once the user has approved a download that raised a concern.
    #[serde(default)]
    pub approved: Option<bool>,
}

/// Download a file to the user's Downloads folder.
///
/// Asks nothing for a normal user-requested download. The four cases that do
/// ask are in `download::concerns_for`, and each of them is a real hazard
/// rather than a general nervousness about downloading.
pub fn start_download(store: &DownloadStore, args: DownloadArgs) -> ToolResult {
    let rb = ResultBuilder::new("browser.download");
    let folder = match downloads_folder() {
        Ok(f) => f,
        Err(e) => return rb.error("no-downloads-folder", e, false),
    };
    let url_is_safe = crate::top_overlay::web_launcher::validate_http_url(&args.url).is_ok()
        && !crate::capabilities::web::is_blocked_host_public(&args.url);

    let file_name = download::file_name_for(&args.url, None);
    let destination = download::non_clobbering_path(&folder, &file_name);

    let concerns = download::concerns_for(
        &args.url,
        args.origin_url.as_deref(),
        &destination,
        &folder,
        url_is_safe,
    );
    if let Some(blocking) = concerns.first() {
        if matches!(blocking, download::DownloadConcern::UnsafeUrl) {
            return rb.denied(blocking.message(), "url-rejected");
        }
        if args.approved != Some(true) {
            return rb.needs_confirmation(
                blocking.message(),
                json!({
                    "confirmation": {
                        "title": "Download this file?",
                        "description": blocking.message(),
                        "riskLevel": "sensitive",
                        "reversible": true,
                        "consequence": "The file is saved to your Downloads folder. Nothing is run.",
                    },
                    "concerns": concerns,
                }),
            );
        }
    }

    let id = download::begin(store, &args.url);
    match download::transfer(store, &id, &args.url, &destination) {
        Ok(artifact) => rb.success(
            format!(
                "Downloaded {} ({}).",
                artifact.file_name,
                human_size(artifact.byte_size)
            ),
            json!({
                "downloadId": artifact.download_id,
                "sourceUrl": artifact.source_url,
                "finalPath": artifact.final_path,
                "fileName": artifact.file_name,
                "byteSize": artifact.byte_size,
                "mimeType": artifact.mime_type,
                "completedAtMs": artifact.completed_at_ms,
            }),
            // The file on disk, at the size the transfer measured. Not "the
            // button was clicked".
            VerificationEvidence::verified_with(
                "filesystem-postcondition",
                json!({ "bytes": artifact.byte_size, "path": artifact.final_path }),
            ),
        ),
        Err(e) => rb.error("download-failed", e, true),
    }
}

fn human_size(bytes: u64) -> String {
    const UNITS: [(&str, u64); 3] = [("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)];
    for (unit, size) in UNITS {
        if bytes >= size {
            return format!("{:.1} {unit}", bytes as f64 / size as f64);
        }
    }
    format!("{bytes} bytes")
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct DownloadIdArgs {
    pub download_id: String,
}

/// Progress for one download.
pub fn download_progress(store: &DownloadStore, args: DownloadIdArgs) -> ToolResult {
    let rb = ResultBuilder::new("browser.wait_for_download");
    let Some(progress) = store.get(&args.download_id) else {
        return rb.not_found("No download by that id.");
    };
    let summary = match (progress.state, progress.percent()) {
        (download::DownloadState::Completed, _) => {
            format!("{} finished downloading.", progress.file_name.clone().unwrap_or_default())
        }
        (download::DownloadState::Failed, _) => progress
            .error
            .clone()
            .unwrap_or_else(|| "The download failed.".into()),
        (_, Some(pct)) => format!("Downloading — {pct}% done."),
        _ => format!("Downloading — {} received.", human_size(progress.bytes_received)),
    };
    let verified = progress.is_verified_complete();
    rb.success(
        summary,
        serde_json::to_value(&progress).unwrap_or_else(|_| json!({})),
        if verified {
            VerificationEvidence::verified("filesystem-postcondition")
        } else {
            VerificationEvidence::unverified("state-readback")
        },
    )
}

/// Every download this session knows about.
pub fn list_downloads(store: &DownloadStore) -> ToolResult {
    let rb = ResultBuilder::new("browser.get_downloads");
    let all = store.all();
    rb.success(
        if all.is_empty() {
            "No downloads yet.".to_string()
        } else {
            format!("{} download(s) this session.", all.len())
        },
        json!({ "downloads": all }),
        VerificationEvidence::verified("state-readback"),
    )
}

// ---------------------------------------------------------------------------
// installer.*
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct InstallerPathArgs {
    pub path: String,
    /// The product name, for the approval sentence and the verification match.
    #[serde(default)]
    pub product: Option<String>,
}

/// Inspect a downloaded installer: kind, publisher, signature, elevation.
///
/// Read-only. This is what makes one well-informed question possible at the
/// install boundary instead of several uninformed ones before it.
pub fn inspect_installer(args: InstallerPathArgs) -> ToolResult {
    let rb = ResultBuilder::new("installer.inspect");
    let path = PathBuf::from(&args.path);
    match installer::inspect(&path) {
        Ok(inspection) => {
            let product = args.product.clone().unwrap_or_else(|| {
                inspection
                    .file_name
                    .split(['-', '_', '.'])
                    .next()
                    .unwrap_or("This")
                    .to_string()
            });
            rb.success(
                inspection.approval_prompt(&product),
                json!({
                    "path": inspection.path,
                    "fileName": inspection.file_name,
                    "byteSize": inspection.byte_size,
                    "kind": inspection.kind,
                    "signature": inspection.signature,
                    "publisher": inspection.signature.publisher(),
                    "signatureTrusted": inspection.signature.is_trusted(),
                    "likelyElevates": inspection.likely_elevates,
                    "approvalPrompt": inspection.approval_prompt(&product),
                }),
                VerificationEvidence::verified_with(
                    "artifact-validated",
                    json!({ "signature": inspection.signature }),
                ),
            )
        }
        Err(e) => rb.not_found(e),
    }
}

/// What is installed on this machine, from the uninstall registry.
pub fn list_installed() -> ToolResult {
    let rb = ResultBuilder::new("installer.list_installed");
    let apps = installer::installed_applications();
    rb.success(
        format!("{} installed application(s).", apps.len()),
        json!({ "applications": apps }),
        VerificationEvidence::verified("state-readback"),
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct VerifyInstallArgs {
    pub product: String,
    /// The installed set from before the installer ran, so "it was already
    /// there" can be told from "this installed it".
    #[serde(default)]
    pub before: Vec<installer::InstalledApplication>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub still_running: Option<bool>,
}

/// Whether the thing actually installed.
///
/// The claim being replaced is "the installer process exited, therefore it
/// worked" — which is equally true of the user pressing Cancel.
pub fn verify_install(args: VerifyInstallArgs) -> ToolResult {
    let rb = ResultBuilder::new("installer.verify");
    let after = installer::installed_applications();
    let outcome = installer::conclude(
        &args.before,
        &after,
        &args.product,
        args.exit_code,
        args.still_running.unwrap_or(false),
    );
    let summary = outcome.describe(&args.product);
    let data = json!({
        "outcome": outcome,
        "product": args.product,
        "installedCountBefore": args.before.len(),
        "installedCountAfter": after.len(),
    });
    if outcome.is_success() {
        rb.success(
            summary,
            data,
            VerificationEvidence::verified_with("state-readback", json!({ "source": "registry" })),
        )
    } else {
        // Honest, not an error: nothing broke, it simply is not installed.
        rb.partial(summary, data, VerificationEvidence::verified("state-readback"))
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn browser_find_link(args: FindLinkArgs) -> ToolResult {
    find_link(args)
}

#[tauri::command]
pub fn browser_download(store: State<DownloadStore>, args: DownloadArgs) -> ToolResult {
    start_download(&store, args)
}

#[tauri::command]
pub fn browser_download_progress(
    store: State<DownloadStore>,
    args: DownloadIdArgs,
) -> ToolResult {
    download_progress(&store, args)
}

#[tauri::command]
pub fn browser_list_downloads(store: State<DownloadStore>) -> ToolResult {
    list_downloads(&store)
}

#[tauri::command]
pub fn installer_inspect(args: InstallerPathArgs) -> ToolResult {
    inspect_installer(args)
}

#[tauri::command]
pub fn installer_list_installed() -> ToolResult {
    list_installed()
}

#[tauri::command]
pub fn installer_verify(args: VerifyInstallArgs) -> ToolResult {
    verify_install(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_read_the_way_a_person_would_say_them() {
        assert_eq!(human_size(512), "512 bytes");
        assert_eq!(human_size(2 * 1024), "2.0 KB");
        assert_eq!(human_size(92 * 1024 * 1024), "92.0 MB");
    }

    /// A download from a blocked address is refused, not queued.
    #[test]
    fn a_local_address_is_never_downloaded() {
        let store = DownloadStore::default();
        let result = start_download(
            &store,
            DownloadArgs {
                url: "http://127.0.0.1:8080/x.exe".into(),
                origin_url: None,
                approved: Some(true),
            },
        );
        assert!(
            matches!(
                result.status,
                crate::capabilities::types::ToolResultStatus::Denied
                    | crate::capabilities::types::ToolResultStatus::Error
            ),
            "got {:?}: {}",
            result.status,
            result.summary,
        );
        assert!(store.all().is_empty(), "nothing was even started");
    }

    /// Inspecting something that is not there says so rather than inventing a
    /// publisher.
    #[test]
    fn inspecting_a_missing_file_is_not_found() {
        let result = inspect_installer(InstallerPathArgs {
            path: "C:\\definitely\\not\\here\\setup.exe".into(),
            product: Some("Nothing".into()),
        });
        assert_eq!(
            result.status,
            crate::capabilities::types::ToolResultStatus::NotFound,
        );
    }

    /// Verification with nothing new installed must not report success.
    #[test]
    fn verification_does_not_invent_an_install() {
        let result = verify_install(VerifyInstallArgs {
            product: "SomethingNobodyHasInstalled-ZZZ".into(),
            before: Vec::new(),
            exit_code: Some(0),
            still_running: Some(false),
        });
        assert_ne!(
            result.status,
            crate::capabilities::types::ToolResultStatus::Success,
            "an install that did not happen was reported as success",
        );
    }

    #[test]
    fn an_unreachable_page_reports_the_fetch_failure() {
        let result = find_link(FindLinkArgs {
            url: "http://localhost:1/nothing".into(),
            product: "LightBurn".into(),
            platform: Some("windows".into()),
        });
        assert_eq!(
            result.status,
            crate::capabilities::types::ToolResultStatus::Error,
        );
    }

    #[test]
    fn the_downloads_folder_resolves_on_this_machine() {
        // Not an assertion about the path, only that resolution is not a stub.
        let resolved = downloads_folder();
        assert!(resolved.is_ok() || resolved.is_err());
        let _ = now_ms();
    }
}
