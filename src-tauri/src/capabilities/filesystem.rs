//! Filesystem capabilities. All mutations run through permissions.rs and are
//! verified with postconditions before success is reported.

use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::permissions::{
    normalize_path, validate_delete_target, validate_item_name, validate_mutation_target,
    validate_read_target,
};
use super::types::{ResultBuilder, ToolArtifact, ToolResult, VerificationEvidence};

const LIST_DEFAULT_LIMIT: usize = 50;
const LIST_MAX_LIMIT: usize = 500;
const FIND_DEFAULT_LIMIT: usize = 50;
const FIND_MAX_LIMIT: usize = 200;
const FIND_TIME_BUDGET: Duration = Duration::from_secs(4);
const READ_MAX_BYTES: u64 = 512 * 1024;
const WRITE_MAX_BYTES: usize = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Known folders
// ---------------------------------------------------------------------------

pub fn known_folder_path(folder: &str) -> Option<PathBuf> {
    match folder {
        "desktop" => dirs::desktop_dir(),
        "documents" => dirs::document_dir(),
        "downloads" => dirs::download_dir(),
        "pictures" => dirs::picture_dir(),
        "videos" => dirs::video_dir(),
        "music" => dirs::audio_dir(),
        "home" => dirs::home_dir(),
        "app-data" => dirs::config_dir(),
        "local-app-data" => dirs::data_local_dir(),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KnownFolderArgs {
    pub folder: String,
}

pub fn resolve_known_folder(args: KnownFolderArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.resolve_known_folder");
    let Some(path) = known_folder_path(&args.folder) else {
        return rb.error(
            "unknown-folder",
            format!("\"{}\" is not a supported known folder.", args.folder),
            true,
        );
    };
    let exists = path.is_dir();
    // Redirected when it is not the classic %USERPROFILE%\<Name> location.
    let redirected = dirs::home_dir()
        .map(|home| !path.starts_with(&home))
        .unwrap_or(false);
    let data = json!({
        "folder": args.folder,
        "path": path.to_string_lossy(),
        "exists": exists,
        "redirected": redirected,
    });
    rb.success(
        format!("{} is at {}", args.folder, path.display()),
        data,
        VerificationEvidence::verified_with(
            "filesystem-postcondition",
            json!({ "exists": exists }),
        ),
    )
}

// ---------------------------------------------------------------------------
// Directory listing
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListDirectoryArgs {
    pub path: String,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub sort_by: Option<String>,
    #[serde(default)]
    pub sort_direction: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListKnownFolderArgs {
    pub folder: String,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub cursor: Option<String>,
}

fn is_hidden(path: &Path, metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
            return true;
        }
    }
    path.file_name()
        .map(|n| n.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
}

fn entry_kind(path: &Path, metadata: &fs::Metadata) -> &'static str {
    if metadata.is_dir() {
        "directory"
    } else if path
        .extension()
        .map(|e| e.eq_ignore_ascii_case("lnk"))
        .unwrap_or(false)
    {
        "shortcut"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    }
}

fn modified_iso(metadata: &fs::Metadata) -> Option<String> {
    metadata.modified().ok().map(|t| {
        chrono::DateTime::<chrono::Local>::from(t)
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    })
}

struct ListedEntry {
    name: String,
    path: String,
    kind: &'static str,
    extension: Option<String>,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
    hidden: bool,
}

fn read_entries(dir: &Path, include_hidden: bool) -> Result<Vec<ListedEntry>, String> {
    let read = fs::read_dir(dir).map_err(|e| format!("Could not read the folder: {e}"))?;
    let mut out = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let hidden = is_hidden(&path, &metadata);
        if hidden && !include_hidden {
            continue;
        }
        let kind = entry_kind(&path, &metadata);
        out.push(ListedEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            kind,
            extension: path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase()),
            size_bytes: if metadata.is_file() {
                Some(metadata.len())
            } else {
                None
            },
            modified_at: modified_iso(&metadata),
            hidden,
        })
    }
    Ok(out)
}

fn sort_entries(entries: &mut [ListedEntry], sort_by: &str, descending: bool) {
    entries.sort_by(|a, b| {
        // Folders always before files.
        let type_order = |e: &ListedEntry| if e.kind == "directory" { 0 } else { 1 };
        let primary = type_order(a).cmp(&type_order(b));
        if primary != std::cmp::Ordering::Equal {
            return primary;
        }
        let secondary = match sort_by {
            "size" => a.size_bytes.unwrap_or(0).cmp(&b.size_bytes.unwrap_or(0)),
            "modified" => a.modified_at.cmp(&b.modified_at),
            "type" => a
                .extension
                .clone()
                .unwrap_or_default()
                .cmp(&b.extension.clone().unwrap_or_default()),
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        };
        if descending {
            secondary.reverse()
        } else {
            secondary
        }
    });
}

fn list_directory_impl(
    capability_id: &str,
    dir: PathBuf,
    include_hidden: bool,
    sort_by: &str,
    descending: bool,
    limit: usize,
    cursor: Option<String>,
) -> ToolResult {
    let rb = ResultBuilder::new(capability_id);
    if !dir.exists() {
        return rb.not_found(format!("\"{}\" does not exist.", dir.display()));
    }
    if !dir.is_dir() {
        return rb.error(
            "not-a-directory",
            format!("\"{}\" is not a folder.", dir.display()),
            true,
        );
    }
    let mut entries = match read_entries(&dir, include_hidden) {
        Ok(e) => e,
        Err(e) => return rb.error("read-failed", e, true),
    };
    sort_entries(&mut entries, sort_by, descending);

    let total = entries.len();
    let offset = cursor
        .and_then(|c| c.parse::<usize>().ok())
        .unwrap_or(0)
        .min(total);
    let limit = limit.clamp(1, LIST_MAX_LIMIT);
    let page: Vec<serde_json::Value> = entries[offset..]
        .iter()
        .take(limit)
        .map(|e| {
            json!({
                "name": e.name,
                "path": e.path,
                "type": e.kind,
                "extension": e.extension,
                "size_bytes": e.size_bytes,
                "modified_at": e.modified_at,
                "hidden": e.hidden,
            })
        })
        .collect();
    let returned = page.len();
    let next_cursor = if offset + returned < total {
        Some((offset + returned).to_string())
    } else {
        None
    };
    let folders = entries.iter().filter(|e| e.kind == "directory").count();
    let files = entries.iter().filter(|e| e.kind == "file").count();
    let shortcuts = entries.iter().filter(|e| e.kind == "shortcut").count();

    let data = json!({
        "path": dir.to_string_lossy(),
        "total_items": total,
        "returned_items": returned,
        "next_cursor": next_cursor,
        "counts": { "folders": folders, "files": files, "shortcuts": shortcuts },
        "items": page,
    });
    rb.success(
        format!(
            "{total} item{} — {folders} folders, {files} files{}",
            if total == 1 { "" } else { "s" },
            if shortcuts > 0 {
                format!(", {shortcuts} shortcuts")
            } else {
                String::new()
            }
        ),
        data,
        VerificationEvidence::verified("filesystem-postcondition"),
    )
}

pub fn list_directory(args: ListDirectoryArgs) -> ToolResult {
    let dir = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return ResultBuilder::new("filesystem.list_directory").error("invalid-path", e, true),
    };
    if let Err(e) = validate_read_target(&dir) {
        return ResultBuilder::new("filesystem.list_directory").error("invalid-path", e, true);
    }
    list_directory_impl(
        "filesystem.list_directory",
        dir,
        args.include_hidden,
        args.sort_by.as_deref().unwrap_or("name"),
        args.sort_direction.as_deref() == Some("descending"),
        args.limit.unwrap_or(LIST_DEFAULT_LIMIT),
        args.cursor,
    )
}

pub fn list_known_folder(args: ListKnownFolderArgs) -> ToolResult {
    let Some(dir) = known_folder_path(&args.folder) else {
        return ResultBuilder::new("filesystem.list_known_folder").error(
            "unknown-folder",
            format!("\"{}\" is not a supported known folder.", args.folder),
            true,
        );
    };
    list_directory_impl(
        "filesystem.list_known_folder",
        dir,
        args.include_hidden,
        "name",
        false,
        args.limit.unwrap_or(LIST_DEFAULT_LIMIT),
        args.cursor,
    )
}

// ---------------------------------------------------------------------------
// Metadata / summary / disk space
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathArgs {
    pub path: String,
}

pub fn get_metadata(args: PathArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.get_metadata");
    let path = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    let metadata = match fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => return rb.not_found(format!("\"{}\" does not exist.", path.display())),
    };
    let kind = entry_kind(&path, &metadata);
    let data = json!({
        "path": path.to_string_lossy(),
        "name": path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "type": kind,
        "size_bytes": if metadata.is_file() { Some(metadata.len()) } else { None },
        "modified_at": modified_iso(&metadata),
        "readonly": metadata.permissions().readonly(),
        "hidden": is_hidden(&path, &metadata),
    });
    rb.success(
        format!("{} — {}", path.display(), kind),
        data,
        VerificationEvidence::verified("filesystem-postcondition"),
    )
}

pub fn get_directory_summary(args: PathArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.get_directory_summary");
    let path = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    if !path.is_dir() {
        return rb.not_found(format!("\"{}\" is not an existing folder.", path.display()));
    }
    let (files, dirs, bytes, truncated) = summarize_dir(&path, Duration::from_secs(5));
    let data = json!({
        "path": path.to_string_lossy(),
        "files": files,
        "folders": dirs,
        "total_size_bytes": bytes,
        "size_estimate_truncated": truncated,
    });
    rb.success(
        format!(
            "{files} files, {dirs} folders, {}{}",
            human_size(bytes),
            if truncated { " (estimate)" } else { "" }
        ),
        data,
        VerificationEvidence::verified("filesystem-postcondition"),
    )
}

/// Recursive count/size with a hard time budget so huge trees return partials.
pub fn summarize_dir(root: &Path, budget: Duration) -> (u64, u64, u64, bool) {
    let started = Instant::now();
    let mut files = 0u64;
    let mut dirs = 0u64;
    let mut bytes = 0u64;
    let mut truncated = false;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if started.elapsed() > budget {
            truncated = true;
            break;
        }
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                dirs += 1;
                stack.push(entry.path());
            } else {
                files += 1;
                bytes += metadata.len();
            }
        }
    }
    (files, dirs, bytes, truncated)
}

pub fn human_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(windows)]
pub fn get_disk_space(args: PathArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.get_disk_space");
    let path = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            dir: *const u16,
            free_to_caller: *mut u64,
            total: *mut u64,
            total_free: *mut u64,
        ) -> i32;
    }
    let wide: Vec<u16> = path
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut free = 0u64;
    let mut total = 0u64;
    let mut total_free = 0u64;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut total_free) };
    if ok == 0 {
        return rb.error(
            "disk-space-failed",
            format!("Could not read disk space for \"{}\".", path.display()),
            true,
        );
    }
    rb.success(
        format!("{} free of {}", human_size(free), human_size(total)),
        json!({
            "path": path.to_string_lossy(),
            "free_bytes": free,
            "total_bytes": total,
        }),
        VerificationEvidence::verified("state-readback"),
    )
}

#[cfg(not(windows))]
pub fn get_disk_space(_args: PathArgs) -> ToolResult {
    ResultBuilder::new("filesystem.get_disk_space").unsupported("Windows only.")
}

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FindArgs {
    pub query: String,
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default)]
    pub item_type: Option<String>,
    #[serde(default)]
    pub extension: Option<String>,
    #[serde(default)]
    pub recursive: Option<bool>,
    #[serde(default)]
    pub max_depth: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

fn default_search_roots() -> Vec<PathBuf> {
    [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
        dirs::picture_dir(),
        dirs::video_dir(),
        dirs::audio_dir(),
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub fn find(args: FindArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.find");
    let query = args.query.trim().to_lowercase();
    if query.is_empty() {
        return rb.error("invalid-arguments", "Search query is empty.", true);
    }
    let roots: Vec<PathBuf> = if args.roots.is_empty() {
        default_search_roots()
    } else {
        let mut out = Vec::new();
        for raw in &args.roots {
            match normalize_path(raw) {
                Ok(p) if p.is_dir() => out.push(p),
                Ok(p) => {
                    return rb.not_found(format!("Search root \"{}\" does not exist.", p.display()))
                }
                Err(e) => return rb.error("invalid-path", e, true),
            }
        }
        out
    };
    if roots.is_empty() {
        return rb.error("no-roots", "No searchable folders were resolved.", true);
    }

    let want_type = args.item_type.as_deref().unwrap_or("any");
    let want_ext = args
        .extension
        .as_ref()
        .map(|e| e.trim_start_matches('.').to_lowercase());
    let recursive = args.recursive.unwrap_or(true);
    let max_depth = args.max_depth.unwrap_or(6).min(12);
    let limit = args.limit.unwrap_or(FIND_DEFAULT_LIMIT).clamp(1, FIND_MAX_LIMIT);

    let started = Instant::now();
    let mut matches: Vec<(u8, serde_json::Value)> = Vec::new();
    let mut timed_out = false;
    let mut stack: Vec<(PathBuf, usize)> = roots.iter().map(|r| (r.clone(), 0)).collect();

    'walk: while let Some((dir, depth)) = stack.pop() {
        if started.elapsed() > FIND_TIME_BUDGET {
            timed_out = true;
            break;
        }
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            let is_dir = metadata.is_dir();

            if is_dir && recursive && depth < max_depth && !is_hidden(&path, &metadata) {
                stack.push((path.clone(), depth + 1));
            }

            let type_ok = match want_type {
                "file" => !is_dir,
                "directory" => is_dir,
                _ => true,
            };
            if !type_ok {
                continue;
            }
            if let Some(ext) = &want_ext {
                let entry_ext = path
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if &entry_ext != ext {
                    continue;
                }
            }
            // Rank: exact > prefix > contains.
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let rank = if lower == query || stem == query {
                0
            } else if lower.starts_with(&query) {
                1
            } else if lower.contains(&query) {
                2
            } else {
                continue;
            };
            matches.push((
                rank,
                json!({
                    "name": name,
                    "path": path.to_string_lossy(),
                    "type": if is_dir { "directory" } else { "file" },
                    "size_bytes": if is_dir { None } else { Some(metadata.len()) },
                    "modified_at": modified_iso(&metadata),
                }),
            ));
            if matches.len() >= limit * 3 {
                // Enough candidates to rank; stop early.
                break 'walk;
            }
        }
    }

    matches.sort_by_key(|(rank, item)| {
        (
            *rank,
            item["name"].as_str().unwrap_or_default().to_lowercase(),
        )
    });
    let results: Vec<serde_json::Value> =
        matches.into_iter().take(limit).map(|(_, v)| v).collect();
    let count = results.len();
    let data = json!({
        "query": args.query,
        "roots": roots.iter().map(|r| r.to_string_lossy()).collect::<Vec<_>>(),
        "results": results,
        "count": count,
        "timed_out": timed_out,
    });
    if count == 0 && !timed_out {
        return rb.not_found(format!(
            "No items matching \"{}\" were found in the searched folders.",
            args.query
        ));
    }
    let summary = if timed_out {
        format!("{count} match{} (search hit its time limit — results may be partial).", if count == 1 { "" } else { "es" })
    } else {
        format!("{count} match{} found.", if count == 1 { "" } else { "es" })
    };
    if timed_out {
        rb.partial(summary, data, VerificationEvidence::verified("filesystem-postcondition"))
    } else {
        rb.success(summary, data, VerificationEvidence::verified("filesystem-postcondition"))
    }
}

// ---------------------------------------------------------------------------
// Create / write
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateDirectoryArgs {
    pub parent_path: String,
    pub name: String,
    #[serde(default)]
    pub recursive: Option<bool>,
    #[serde(default)]
    pub if_exists: Option<String>,
}

fn folder_artifact(path: &Path) -> ToolArtifact {
    ToolArtifact {
        id: format!("folder-{}", chrono::Local::now().timestamp_millis()),
        kind: "folder".into(),
        display_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        path: Some(path.to_string_lossy().into_owned()),
        local_url: None,
        mime_type: None,
        size_bytes: None,
    }
}

fn file_artifact(path: &Path, size: Option<u64>) -> ToolArtifact {
    ToolArtifact {
        id: format!("file-{}", chrono::Local::now().timestamp_millis()),
        kind: "file".into(),
        display_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        path: Some(path.to_string_lossy().into_owned()),
        local_url: None,
        mime_type: None,
        size_bytes: size,
    }
}

fn numbered_variant(parent: &Path, name: &str) -> PathBuf {
    for i in 2..1000 {
        let candidate = parent.join(format!("{name} ({i})"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{name} ({})", chrono::Local::now().timestamp()))
}

pub fn create_directory(args: CreateDirectoryArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.create_directory");
    if let Err(e) = validate_item_name(&args.name) {
        return rb.error("invalid-name", e, true);
    }
    let parent = match normalize_path(&args.parent_path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    // Canonicalize the existing parent so symlink tricks cannot escape checks.
    let parent = match parent.canonicalize() {
        Ok(p) => strip_verbatim(p),
        Err(_) => return rb.not_found(format!("Parent folder \"{}\" does not exist.", parent.display())),
    };
    if !parent.is_dir() {
        return rb.error(
            "not-a-directory",
            format!("\"{}\" is not a folder.", parent.display()),
            true,
        );
    }
    let mut target = parent.join(args.name.trim());
    if let Err(e) = validate_mutation_target(&target) {
        return rb.denied(e, "path-not-allowed");
    }
    if target.exists() {
        match args.if_exists.as_deref().unwrap_or("return-existing") {
            "create-numbered-copy" => {
                target = numbered_variant(&parent, args.name.trim());
            }
            "ask" => {
                return rb.needs_confirmation(
                    format!("\"{}\" already exists.", target.display()),
                    json!({
                        "reason": "already-exists",
                        "path": target.to_string_lossy(),
                        "options": ["return-existing", "create-numbered-copy"],
                    }),
                );
            }
            _ => {
                if target.is_dir() {
                    return rb.success_with_artifacts(
                        format!("\"{}\" already exists.", target.display()),
                        json!({ "path": target.to_string_lossy(), "created": false, "existed": true }),
                        VerificationEvidence::verified("filesystem-postcondition"),
                        vec![folder_artifact(&target)],
                    );
                }
                return rb.error(
                    "exists-as-file",
                    format!("\"{}\" already exists as a file.", target.display()),
                    true,
                );
            }
        }
    }
    let create = if args.recursive.unwrap_or(false) {
        fs::create_dir_all(&target)
    } else {
        fs::create_dir(&target)
    };
    if let Err(e) = create {
        return rb.error("create-failed", format!("Windows refused the create: {e}"), true);
    }
    // Postcondition: it exists and is a directory.
    if !target.is_dir() {
        return rb.error(
            "verification-failed",
            "The folder was reported created but could not be verified.",
            true,
        );
    }
    rb.success_with_artifacts(
        format!("Created \"{}\".", target.display()),
        json!({ "path": target.to_string_lossy(), "created": true, "existed": false }),
        VerificationEvidence::verified_with(
            "filesystem-postcondition",
            json!({ "exists": true, "is_directory": true }),
        ),
        vec![folder_artifact(&target)],
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteFileArgs {
    pub parent_path: String,
    pub name: String,
    #[serde(default)]
    pub content: Option<String>,
    /// overwrite requires needs-confirmation round-trip; append | numbered-copy | fail
    #[serde(default)]
    pub if_exists: Option<String>,
}

const SAFE_TEXT_EXTENSIONS: &[&str] = &["txt", "md", "json", "csv", "log"];

pub fn create_or_write_file(capability_id: &str, args: WriteFileArgs, confirmed: bool) -> ToolResult {
    let rb = ResultBuilder::new(capability_id);
    if let Err(e) = validate_item_name(&args.name) {
        return rb.error("invalid-name", e, true);
    }
    let ext = Path::new(&args.name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !SAFE_TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return rb.error(
            "unsupported-file-type",
            format!(
                "Only plain-text files are supported right now ({}). \"{ext}\" would produce an invalid file.",
                SAFE_TEXT_EXTENSIONS.join(", ")
            ),
            true,
        );
    }
    let content = args.content.clone().unwrap_or_default();
    if content.len() > WRITE_MAX_BYTES {
        return rb.error("content-too-large", "Content exceeds the 4 MB write limit.", true);
    }
    let parent = match normalize_path(&args.parent_path).and_then(|p| {
        p.canonicalize()
            .map(strip_verbatim)
            .map_err(|_| format!("Parent folder \"{}\" does not exist.", p.display()))
    }) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    let mut target = parent.join(args.name.trim());
    if let Err(e) = validate_mutation_target(&target) {
        return rb.denied(e, "path-not-allowed");
    }
    let mut append = false;
    if target.exists() {
        match args.if_exists.as_deref() {
            Some("append") => append = true,
            Some("numbered-copy") => {
                let stem = Path::new(&args.name)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| args.name.clone());
                target = numbered_variant(&parent, &stem);
                target.set_extension(&ext);
            }
            Some("overwrite") if confirmed => {}
            _ => {
                return rb.needs_confirmation(
                    format!("\"{}\" already exists.", target.display()),
                    json!({
                        "reason": "already-exists",
                        "path": target.to_string_lossy(),
                        "options": ["overwrite", "append", "numbered-copy"],
                    }),
                );
            }
        }
    }
    let write = if append {
        use std::io::Write;
        fs::OpenOptions::new()
            .append(true)
            .open(&target)
            .and_then(|mut f| f.write_all(content.as_bytes()))
    } else {
        fs::write(&target, content.as_bytes())
    };
    if let Err(e) = write {
        return rb.error("write-failed", format!("Windows refused the write: {e}"), true);
    }
    // Postcondition: exists; and unless appending, byte length matches.
    let Ok(metadata) = fs::metadata(&target) else {
        return rb.error(
            "verification-failed",
            "The file was written but could not be verified.",
            true,
        );
    };
    if !append && metadata.len() != content.len() as u64 {
        return rb.error(
            "verification-failed",
            format!(
                "Byte length mismatch after write (expected {}, found {}).",
                content.len(),
                metadata.len()
            ),
            true,
        );
    }
    rb.success_with_artifacts(
        format!(
            "{} \"{}\" ({}).",
            if append { "Appended to" } else { "Wrote" },
            target.display(),
            human_size(metadata.len())
        ),
        json!({
            "path": target.to_string_lossy(),
            "size_bytes": metadata.len(),
            "appended": append,
        }),
        VerificationEvidence::verified_with(
            "filesystem-postcondition",
            json!({ "exists": true, "size_bytes": metadata.len() }),
        ),
        vec![file_artifact(&target, Some(metadata.len()))],
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadTextFileArgs {
    pub path: String,
    #[serde(default)]
    pub max_bytes: Option<u64>,
}

pub fn read_text_file(args: ReadTextFileArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.read_text_file");
    let path = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return rb.not_found(format!("\"{}\" does not exist.", path.display()));
    };
    if !metadata.is_file() {
        return rb.error("not-a-file", format!("\"{}\" is not a file.", path.display()), true);
    }
    let cap = args.max_bytes.unwrap_or(READ_MAX_BYTES).min(READ_MAX_BYTES);
    if metadata.len() > cap {
        return rb.error(
            "file-too-large",
            format!(
                "\"{}\" is {} — larger than the {} read limit.",
                path.display(),
                human_size(metadata.len()),
                human_size(cap)
            ),
            true,
        );
    }
    match fs::read_to_string(&path) {
        Ok(content) => {
            let len = content.len();
            rb.success(
                format!("Read \"{}\" ({}).", path.display(), human_size(len as u64)),
                json!({
                    "path": path.to_string_lossy(),
                    "content": content,
                    "size_bytes": len,
                }),
                VerificationEvidence::verified("filesystem-postcondition"),
            )
        }
        Err(_) => rb.error(
            "not-text",
            format!("\"{}\" is not valid UTF-8 text.", path.display()),
            true,
        ),
    }
}

// ---------------------------------------------------------------------------
// Rename / move / copy
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenameArgs {
    pub path: String,
    pub new_name: String,
}

/// Canonicalize on Windows prefixes `\\?\`; strip it for display/storage.
fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

pub fn rename(args: RenameArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.rename");
    if let Err(e) = validate_item_name(&args.new_name) {
        return rb.error("invalid-name", e, true);
    }
    let source = match normalize_path(&args.path).and_then(|p| {
        p.canonicalize()
            .map(strip_verbatim)
            .map_err(|_| format!("\"{}\" does not exist.", p.display()))
    }) {
        Ok(p) => p,
        Err(e) => return rb.not_found(e),
    };
    if let Err(e) = validate_mutation_target(&source) {
        return rb.denied(e, "path-not-allowed");
    }
    let Some(parent) = source.parent() else {
        return rb.error("invalid-path", "Cannot rename a drive root.", false);
    };
    let target = parent.join(args.new_name.trim());
    if target.exists() {
        return rb.error(
            "target-exists",
            format!("\"{}\" already exists.", target.display()),
            true,
        );
    }
    if let Err(e) = fs::rename(&source, &target) {
        return rb.error("rename-failed", format!("Windows refused the rename: {e}"), true);
    }
    // Postconditions: old gone, new exists.
    let old_gone = !source.exists();
    let new_there = target.exists();
    if !(old_gone && new_there) {
        return rb.error("verification-failed", "Rename could not be verified.", true);
    }
    rb.success_with_artifacts(
        format!("Renamed to \"{}\".", target.display()),
        json!({ "from": source.to_string_lossy(), "to": target.to_string_lossy() }),
        VerificationEvidence::verified_with(
            "filesystem-postcondition",
            json!({ "old_absent": old_gone, "new_exists": new_there }),
        ),
        vec![if target.is_dir() {
            folder_artifact(&target)
        } else {
            file_artifact(&target, fs::metadata(&target).ok().map(|m| m.len()))
        }],
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveCopyArgs {
    pub source_path: String,
    pub destination_folder: String,
    #[serde(default)]
    pub new_name: Option<String>,
}

fn resolve_move_copy(
    rb: &ResultBuilder,
    args: &MoveCopyArgs,
    require_source_mutable: bool,
) -> Result<(PathBuf, PathBuf), ToolResult> {
    let _ = rb;
    let source = normalize_path(&args.source_path)
        .and_then(|p| {
            p.canonicalize()
                .map(strip_verbatim)
                .map_err(|_| format!("\"{}\" does not exist.", p.display()))
        })
        .map_err(|e| ResultBuilder::new("filesystem.move").not_found(e))?;
    if require_source_mutable {
        validate_mutation_target(&source)
            .map_err(|e| ResultBuilder::new("filesystem.move").denied(e, "path-not-allowed"))?;
    }
    let dest_dir = normalize_path(&args.destination_folder)
        .and_then(|p| {
            p.canonicalize()
                .map(strip_verbatim)
                .map_err(|_| format!("Destination \"{}\" does not exist.", p.display()))
        })
        .map_err(|e| ResultBuilder::new("filesystem.move").not_found(e))?;
    if !dest_dir.is_dir() {
        return Err(ResultBuilder::new("filesystem.move").error(
            "not-a-directory",
            format!("Destination \"{}\" is not a folder.", dest_dir.display()),
            true,
        ));
    }
    let name = match &args.new_name {
        Some(n) => {
            validate_item_name(n).map_err(|e| {
                ResultBuilder::new("filesystem.move").error("invalid-name", e, true)
            })?;
            n.trim().to_string()
        }
        None => source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    };
    let target = dest_dir.join(name);
    validate_mutation_target(&target)
        .map_err(|e| ResultBuilder::new("filesystem.move").denied(e, "path-not-allowed"))?;
    Ok((source, target))
}

pub fn move_item(args: MoveCopyArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.move");
    let (source, target) = match resolve_move_copy(&rb, &args, true) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if target.exists() {
        return rb.error(
            "target-exists",
            format!("\"{}\" already exists at the destination.", target.display()),
            true,
        );
    }
    if let Err(e) = fs::rename(&source, &target) {
        return rb.error("move-failed", format!("Windows refused the move: {e}"), true);
    }
    let verified = !source.exists() && target.exists();
    if !verified {
        return rb.error("verification-failed", "Move could not be verified.", true);
    }
    rb.success(
        format!("Moved to \"{}\".", target.display()),
        json!({ "from": source.to_string_lossy(), "to": target.to_string_lossy() }),
        VerificationEvidence::verified_with(
            "filesystem-postcondition",
            json!({ "source_absent": true, "destination_exists": true }),
        ),
    )
}

pub fn copy_item(args: MoveCopyArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.copy");
    let (source, target) = match resolve_move_copy(&rb, &args, false) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if target.exists() {
        return rb.error(
            "target-exists",
            format!("\"{}\" already exists at the destination.", target.display()),
            true,
        );
    }
    if source.is_dir() {
        if let Err(e) = copy_dir_recursive(&source, &target) {
            return rb.error("copy-failed", e, true);
        }
    } else if let Err(e) = fs::copy(&source, &target) {
        return rb.error("copy-failed", format!("Windows refused the copy: {e}"), true);
    }
    if !target.exists() {
        return rb.error("verification-failed", "Copy could not be verified.", true);
    }
    // Size verification for files.
    let mut details = json!({ "destination_exists": true });
    if source.is_file() {
        let src_len = fs::metadata(&source).map(|m| m.len()).unwrap_or(0);
        let dst_len = fs::metadata(&target).map(|m| m.len()).unwrap_or(u64::MAX);
        if src_len != dst_len {
            return rb.error(
                "verification-failed",
                format!("Copied size mismatch (source {src_len} B, copy {dst_len} B)."),
                true,
            );
        }
        details = json!({ "destination_exists": true, "size_verified": true, "size_bytes": dst_len });
    }
    rb.success(
        format!("Copied to \"{}\".", target.display()),
        json!({ "from": source.to_string_lossy(), "to": target.to_string_lossy() }),
        VerificationEvidence::verified_with("filesystem-postcondition", details),
    )
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| format!("Could not create \"{}\": {e}", target.display()))?;
    let read = fs::read_dir(source).map_err(|e| format!("Could not read \"{}\": {e}", source.display()))?;
    for entry in read.flatten() {
        let from = entry.path();
        let to = target.join(entry.file_name());
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("Could not copy \"{}\": {e}", from.display()))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Delete (Recycle Bin default, confirmation enforced by the executor)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct DeleteArgs {
    pub paths: Vec<String>,
    #[serde(default)]
    pub mode: Option<String>,
}

/// Describe what a delete would remove (used to build the confirmation).
pub fn describe_delete(args: &DeleteArgs) -> Result<Vec<super::confirmation::AffectedItem>, String> {
    if args.paths.is_empty() {
        return Err("No paths were given.".into());
    }
    if args.paths.len() > 50 {
        return Err("Too many paths in one delete (max 50).".into());
    }
    let mut items = Vec::new();
    for raw in &args.paths {
        let path = normalize_path(raw)?;
        let path = path
            .canonicalize()
            .map(strip_verbatim)
            .map_err(|_| format!("\"{}\" does not exist.", path.display()))?;
        validate_delete_target(&path)?;
        let kind = if path.is_dir() { "folder" } else { "file" };
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        let detail = if path.is_dir() {
            let (files, dirs, bytes, truncated) = summarize_dir(&path, Duration::from_secs(3));
            format!(
                "{files} files, {dirs} folders, {}{}",
                human_size(bytes),
                if truncated { "+" } else { "" }
            )
        } else {
            human_size(fs::metadata(&path).map(|m| m.len()).unwrap_or(0))
        };
        items.push(super::confirmation::AffectedItem {
            name: format!("{name} ({detail})"),
            path: Some(path.to_string_lossy().into_owned()),
            item_type: Some(kind.into()),
        });
    }
    Ok(items)
}

pub fn delete(args: DeleteArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.delete");
    let permanent = args.mode.as_deref() == Some("permanent");
    let mut resolved = Vec::new();
    for raw in &args.paths {
        let path = match normalize_path(raw).and_then(|p| {
            p.canonicalize()
                .map(strip_verbatim)
                .map_err(|_| format!("\"{}\" no longer exists.", p.display()))
        }) {
            Ok(p) => p,
            Err(e) => return rb.not_found(e),
        };
        // Revalidate after confirmation and before execution.
        if let Err(e) = validate_delete_target(&path) {
            return rb.denied(e, "path-not-allowed");
        }
        resolved.push(path);
    }
    let mut deleted = Vec::new();
    let mut failures = Vec::new();
    for path in &resolved {
        let outcome = if permanent {
            if path.is_dir() {
                fs::remove_dir_all(path).map_err(|e| e.to_string())
            } else {
                fs::remove_file(path).map_err(|e| e.to_string())
            }
        } else {
            trash::delete(path).map_err(|e| e.to_string())
        };
        match outcome {
            Ok(()) if !path.exists() => deleted.push(path.clone()),
            Ok(()) => failures.push((path.clone(), "still present after delete".to_string())),
            Err(e) => failures.push((path.clone(), e)),
        }
    }
    let mode_label = if permanent {
        "Permanently deleted"
    } else {
        "Moved to the Recycle Bin"
    };
    let data = json!({
        "mode": if permanent { "permanent" } else { "recycle-bin" },
        "deleted": deleted.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>(),
        "failed": failures
            .iter()
            .map(|(p, e)| json!({ "path": p.to_string_lossy(), "error": e }))
            .collect::<Vec<_>>(),
    });
    if failures.is_empty() {
        let names = deleted
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect::<Vec<_>>()
            .join(", ");
        rb.success(
            format!("{mode_label}: {names}."),
            data,
            VerificationEvidence::verified_with(
                "filesystem-postcondition",
                json!({ "original_paths_absent": true }),
            ),
        )
    } else if deleted.is_empty() {
        rb.error(
            "delete-failed",
            failures
                .iter()
                .map(|(p, e)| format!("{}: {e}", p.display()))
                .collect::<Vec<_>>()
                .join("; "),
            true,
        )
    } else {
        rb.partial(
            format!(
                "{mode_label} {} of {} items; {} failed.",
                deleted.len(),
                resolved.len(),
                failures.len()
            ),
            data,
            VerificationEvidence::verified("filesystem-postcondition"),
        )
    }
}

// ---------------------------------------------------------------------------
// Explorer integration
// ---------------------------------------------------------------------------

pub fn reveal_in_explorer(args: PathArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.reveal_in_explorer");
    let path = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    if !path.exists() {
        return rb.not_found(format!("\"{}\" does not exist.", path.display()));
    }
    // Structured args to explorer.exe — never a shell string.
    let outcome = std::process::Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
        .spawn();
    match outcome {
        Ok(_) => rb.success(
            format!("Showing \"{}\" in File Explorer.", path.display()),
            json!({ "path": path.to_string_lossy() }),
            VerificationEvidence::unverified("return-code"),
        ),
        Err(e) => rb.error("explorer-failed", format!("Could not open Explorer: {e}"), true),
    }
}

pub fn open_item(args: PathArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.open_item");
    let path = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    if !path.exists() {
        return rb.not_found(format!("\"{}\" does not exist.", path.display()));
    }
    // Block direct execution of program files through this generic opener.
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if matches!(ext.as_str(), "exe" | "bat" | "cmd" | "ps1" | "msi" | "scr" | "com" | "vbs" | "js") {
        return rb.denied(
            "Executables are opened through the application launcher, not the file opener.",
            "executable-blocked",
        );
    }
    match open::that(&path) {
        Ok(()) => rb.success(
            format!("Opened \"{}\" with its default app.", path.display()),
            json!({ "path": path.to_string_lossy() }),
            VerificationEvidence::unverified("return-code"),
        ),
        Err(e) => rb.error("open-failed", format!("Windows could not open it: {e}"), true),
    }
}
