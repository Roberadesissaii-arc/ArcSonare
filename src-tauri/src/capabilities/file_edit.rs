//! Changing a file that already exists.
//!
//! "Fix the bug in that script" used to route through the create path, which
//! checks whether the file exists and asks permission to overwrite it. That is
//! exactly backwards: for a modification the file existing is the *premise*,
//! not an obstacle. The user gets asked a question they already answered by
//! asking, says yes, and the request comes back around unchanged — because the
//! answer was never attached to anything.
//!
//! So modification is its own operation. It requires the file to exist, never
//! asks about overwriting, applies the smallest change it can, writes through a
//! temporary file so a failure cannot truncate the original, and checks the
//! result still parses before reporting success.

use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

use super::permissions::{normalize_path, validate_mutation_target};
use super::types::{ResultBuilder, ToolArtifact, ToolResult, VerificationEvidence};

/// How the caller wants the file changed.
///
/// `ReplaceText` is first for a reason: it is the only form that can fail
/// loudly when the file is not what the caller thought it was. A full-content
/// write always "succeeds", including when it silently discards someone's edits.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FilePatch {
    /// Swap an exact snippet. The safest edit: it cannot apply to the wrong
    /// place, and it says so when the snippet is gone.
    #[serde(rename_all = "camelCase")]
    ReplaceText {
        old_text: String,
        new_text: String,
        /// How many matches are expected. Defaults to exactly one — a snippet
        /// that appears twice is ambiguous, and picking one is a coin flip.
        #[serde(default)]
        expected_occurrences: Option<u32>,
    },
    /// Add to the end. Used for appending a function or a config block.
    #[serde(rename_all = "camelCase")]
    Append { text: String },
    /// Replace everything. Reserved for "rewrite this file" — never the default
    /// way to fix a bug, because it throws away anything the caller did not
    /// think to include.
    #[serde(rename_all = "camelCase")]
    FullContent { content: String },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct ModifyFileArgs {
    pub path: String,
    pub patch: FilePatch,
    /// Hash of the contents the caller based its patch on. When it no longer
    /// matches, the file changed underneath and the patch is stale.
    #[serde(default)]
    pub based_on_hash: Option<String>,
}

/// Cheap, stable content fingerprint. Not cryptographic — its only job is to
/// notice that a file is not the one that was read.
pub fn content_hash(text: &str) -> String {
    // FNV-1a: a few lines, no dependency, and more than adequate for spotting
    // an edit between a read and the write that follows it.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Formats ArcSonare will edit. Mirrors the create path's allowlist: writing one
/// of these is inert, and running it is a separate, gated capability.
const EDITABLE_EXTENSIONS: &[&str] = &[
    "txt", "md", "json", "csv", "log", "yaml", "yml", "toml", "ini", "xml", "py", "js", "ts",
    "jsx", "tsx", "rs", "go", "java", "c", "h", "cpp", "cs", "rb", "php", "sh", "sql", "html",
    "css", "scss",
];

const MAX_EDIT_BYTES: usize = 4 * 1024 * 1024;

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// The result of applying a patch to text, before anything touches the disk.
#[derive(Debug)]
pub struct AppliedPatch {
    pub content: String,
    pub summary: String,
}

/// Apply a patch to text in memory, or explain why it cannot be applied.
///
/// Pure, so every refusal is testable without a filesystem — and every refusal
/// here is one that would otherwise have become a bad write.
pub fn apply_patch(original: &str, patch: &FilePatch) -> Result<AppliedPatch, (String, String)> {
    match patch {
        FilePatch::ReplaceText {
            old_text,
            new_text,
            expected_occurrences,
        } => {
            if old_text.is_empty() {
                return Err((
                    "invalid-patch".into(),
                    "The text to replace cannot be empty.".into(),
                ));
            }
            let found = original.matches(old_text.as_str()).count() as u32;
            let expected = expected_occurrences.unwrap_or(1);
            if found == 0 {
                return Err((
                    "text-not-found".into(),
                    "That snippet isn't in the file — it may already have been changed.".into(),
                ));
            }
            if found != expected {
                return Err((
                    "occurrence-mismatch".into(),
                    format!(
                        "That snippet appears {found} time(s), not {expected}. Narrow it down so the right one is changed."
                    ),
                ));
            }
            Ok(AppliedPatch {
                content: original.replace(old_text.as_str(), new_text),
                summary: format!("replaced {found} snippet"),
            })
        }
        FilePatch::Append { text } => {
            // Keep the file newline-terminated rather than gluing the addition
            // onto the end of whatever the last line happened to be.
            let mut content = original.to_string();
            if !content.is_empty() && !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(text);
            Ok(AppliedPatch {
                content,
                summary: "appended".into(),
            })
        }
        FilePatch::FullContent { content } => Ok(AppliedPatch {
            content: content.clone(),
            summary: "replaced the whole file".into(),
        }),
    }
}

/// Write `content` to `path` without ever leaving it half-written.
///
/// A crash or a full disk partway through `fs::write` truncates the original and
/// loses it. Writing beside the file and renaming over it means the reader
/// either sees the old file or the new one.
fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "That path has no parent folder.".to_string())?;
    let temp: PathBuf = parent.join(format!(
        "{}.arcsonare-tmp",
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".into())
    ));
    fs::write(&temp, content.as_bytes())
        .map_err(|e| format!("Could not write the updated file: {e}"))?;
    // Windows `rename` fails when the destination exists, so replace instead.
    // The temporary file is ArcSonare's own; removing it is never the user's
    // file being deleted and is not a decision anyone needs to approve.
    if let Err(e) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("Could not replace the original file: {e}"));
    }
    Ok(())
}

/// Does the edited text still parse?
///
/// Deliberately narrow: formats that can be checked without running anything.
/// A Python file is *not* executed to find out whether it works — that would
/// turn "fix my script" into "run my script".
pub fn validate_syntax(path: &Path, content: &str) -> Option<Result<String, String>> {
    match extension_of(path).as_str() {
        "json" => Some(
            serde_json::from_str::<serde_json::Value>(content)
                .map(|_| "JSON parses".to_string())
                .map_err(|e| format!("the JSON is invalid: {e}")),
        ),
        "py" => Some(check_python_syntax(content)),
        _ => None,
    }
}

/// A structural check for Python, without an interpreter.
///
/// Catches the mistakes an edit actually introduces — an unbalanced bracket, an
/// unterminated string, a block header with nothing under it. It is not a
/// parser and does not pretend to be; a clean result means "nothing obviously
/// broken", which is exactly what it reports.
fn check_python_syntax(content: &str) -> Result<String, String> {
    let mut depth: i32 = 0;
    let mut in_string: Option<char> = None;
    let mut triple = false;
    let chars: Vec<char> = content.chars().collect();
    let mut i = 0;
    let mut line = 1usize;

    while i < chars.len() {
        let c = chars[i];
        if c == '\n' {
            line += 1;
            if in_string.is_some() && !triple {
                return Err(format!("unterminated string on line {}", line - 1));
            }
        }
        if let Some(quote) = in_string {
            if c == '\\' {
                i += 2;
                continue;
            }
            if c == quote {
                if triple {
                    if i + 2 < chars.len() && chars[i + 1] == quote && chars[i + 2] == quote {
                        in_string = None;
                        triple = false;
                        i += 3;
                        continue;
                    }
                } else {
                    in_string = None;
                }
            }
            i += 1;
            continue;
        }
        match c {
            '#' => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            '\'' | '"' => {
                if i + 2 < chars.len() && chars[i + 1] == c && chars[i + 2] == c {
                    in_string = Some(c);
                    triple = true;
                    i += 3;
                    continue;
                }
                in_string = Some(c);
            }
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => {
                depth -= 1;
                if depth < 0 {
                    return Err(format!("unbalanced closing bracket on line {line}"));
                }
            }
            _ => {}
        }
        i += 1;
    }
    if in_string.is_some() {
        return Err("unterminated string at end of file".into());
    }
    if depth != 0 {
        return Err(format!("{depth} bracket(s) left open"));
    }
    // A block header with nothing indented under it is the other edit mistake
    // that reliably produces an IndentationError at import time.
    let lines: Vec<&str> = content.lines().collect();
    for (n, raw) in lines.iter().enumerate() {
        let trimmed = raw.trim_end();
        if !trimmed.ends_with(':') || trimmed.trim_start().starts_with('#') {
            continue;
        }
        let indent = raw.len() - raw.trim_start().len();
        let next = lines
            .iter()
            .skip(n + 1)
            .find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'));
        match next {
            Some(l) if l.len() - l.trim_start().len() > indent => {}
            Some(_) => {
                return Err(format!(
                    "nothing is indented under the block on line {}",
                    n + 1
                ))
            }
            None => return Err(format!("the block on line {} has no body", n + 1)),
        }
    }
    Ok("no syntax problems found".into())
}

/// Change a file that already exists.
///
/// Never asks about overwriting: the file existing is what makes this a
/// modification rather than a create.
pub fn modify_file(args: ModifyFileArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.modify_file");
    let path = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    if !path.exists() {
        // A modification of something that is not there is not a create. Saying
        // so lets the caller decide, instead of silently inventing a file.
        return rb.not_found(format!(
            "\"{}\" doesn't exist, so there is nothing to modify.",
            path.display()
        ));
    }
    if path.is_dir() {
        return rb.error(
            "invalid-path",
            format!("\"{}\" is a folder, not a file.", path.display()),
            true,
        );
    }
    if let Err(e) = validate_mutation_target(&path) {
        return rb.denied(e, "path-not-allowed");
    }
    let ext = extension_of(&path);
    if !EDITABLE_EXTENSIONS.contains(&ext.as_str()) {
        return rb.error(
            "unsupported-file-type",
            format!("ArcSonare only edits plain-text files; \"{ext}\" is not one."),
            true,
        );
    }

    let original = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return rb.error("read-failed", format!("Could not read the file: {e}"), true),
    };
    let original_hash = content_hash(&original);

    // Someone else wrote to the file between the read that produced this patch
    // and now. Applying it anyway would discard their change.
    if let Some(expected) = args.based_on_hash.as_deref() {
        if expected != original_hash {
            return rb.error(
                "FILE_CHANGED_SINCE_READ",
                "The file changed after I read it — I'll read it again rather than overwrite that change.",
                true,
            );
        }
    }

    let applied = match apply_patch(&original, &args.patch) {
        Ok(a) => a,
        Err((code, message)) => return rb.error(&code, message, true),
    };
    if applied.content.len() > MAX_EDIT_BYTES {
        return rb.error(
            "content-too-large",
            "The result exceeds the 4 MB limit.",
            true,
        );
    }
    if applied.content == original {
        // Reporting a no-op as a fix is how "I fixed it" gets said about a file
        // that is byte-for-byte the same as before.
        return rb.partial(
            format!(
                "\"{}\" already looks like that — nothing changed.",
                path.display()
            ),
            json!({ "path": path.to_string_lossy(), "changed": false }),
            VerificationEvidence::verified_with(
                "filesystem-postcondition",
                json!({ "changed": false }),
            ),
        );
    }

    if let Err(e) = atomic_write(&path, &applied.content) {
        return rb.error("write-failed", e, true);
    }

    // Read back rather than trust the write. The postcondition that matters is
    // what is on disk, not what was handed to the OS.
    let written = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            return rb.error(
                "verification-failed",
                format!("The file was written but could not be read back: {e}"),
                true,
            )
        }
    };
    if written != applied.content {
        return rb.error(
            "verification-failed",
            "The file on disk does not match what was written.",
            true,
        );
    }

    let syntax = validate_syntax(&path, &written);
    let (syntax_ok, syntax_detail) = match &syntax {
        Some(Ok(detail)) => (Some(true), detail.clone()),
        Some(Err(problem)) => (Some(false), problem.clone()),
        None => (None, "not checked for this file type".into()),
    };

    let data = json!({
        "path": path.to_string_lossy(),
        "changed": true,
        "patch": applied.summary,
        "bytes": written.len(),
        "content_hash": content_hash(&written),
        "previous_hash": original_hash,
        "syntax_checked": syntax.is_some(),
        "syntax_ok": syntax_ok,
        "syntax_detail": syntax_detail,
    });

    if syntax_ok == Some(false) {
        // The edit landed, and it is broken. Both halves have to be said: the
        // file is changed, and it does not parse.
        return rb.partial(
            format!(
                "Updated \"{}\", but {syntax_detail}. The change is on disk — check it before running it.",
                path.display()
            ),
            data,
            VerificationEvidence::verified_with(
                "filesystem-postcondition",
                json!({ "written": true, "syntax_ok": false }),
            ),
        );
    }

    rb.success_with_artifacts(
        format!(
            "Updated \"{}\" — {}{}.",
            path.display(),
            applied.summary,
            match syntax_ok {
                Some(true) => format!(", {syntax_detail}"),
                _ => String::new(),
            }
        ),
        data,
        VerificationEvidence::verified_with(
            "filesystem-postcondition",
            json!({ "written": true, "syntax_ok": syntax_ok }),
        ),
        vec![ToolArtifact {
            id: format!("file-{}", chrono::Local::now().timestamp_millis()),
            kind: "file".into(),
            display_name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.display().to_string()),
            path: Some(path.to_string_lossy().into_owned()),
            local_url: None,
            mime_type: None,
            size_bytes: Some(written.len() as u64),
        }],
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HashArgs {
    pub path: String,
}

/// Read a file plus the hash a later patch should be based on.
///
/// One call rather than read-then-hash-separately, so the two cannot describe
/// different moments in the file's life.
pub fn read_for_edit(args: HashArgs) -> ToolResult {
    let rb = ResultBuilder::new("filesystem.read_for_edit");
    let path = match normalize_path(&args.path) {
        Ok(p) => p,
        Err(e) => return rb.error("invalid-path", e, true),
    };
    if !path.exists() {
        return rb.not_found(format!("\"{}\" doesn't exist.", path.display()));
    }
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return rb.error("read-failed", format!("Could not read it: {e}"), true),
    };
    let hash = content_hash(&text);
    rb.success(
        format!("Read \"{}\" ({} bytes).", path.display(), text.len()),
        json!({
            "path": path.to_string_lossy(),
            "content": text,
            "content_hash": hash,
            "line_count": text.lines().count(),
        }),
        VerificationEvidence::verified("filesystem-postcondition"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCRIPT: &str = "def is_prime(n):\n    if n < 2:\n        return False\n    for i in range(2, n):\n        if n % i == 0:\n            return False\n    return True\n\n\ndef main():\n    print(is_prime(7))\n";

    #[test]
    fn replacing_a_snippet_leaves_everything_else_alone() {
        // The guarantee that makes edit-in-place safe: the other function, the
        // blank lines and the trailing newline all survive.
        let patch = FilePatch::ReplaceText {
            old_text: "range(2, n)".into(),
            new_text: "range(2, int(n ** 0.5) + 1)".into(),
            expected_occurrences: None,
        };
        let out = apply_patch(SCRIPT, &patch).unwrap().content;
        assert!(out.contains("int(n ** 0.5)"));
        assert!(out.contains("def main():"), "the other function vanished");
        assert!(out.contains("print(is_prime(7))"));
        assert!(out.ends_with('\n'), "the trailing newline was lost");
        assert_eq!(out.lines().count(), SCRIPT.lines().count());
    }

    #[test]
    fn a_snippet_that_is_not_there_is_refused_rather_than_guessed() {
        let patch = FilePatch::ReplaceText {
            old_text: "range(3, n)".into(),
            new_text: "x".into(),
            expected_occurrences: None,
        };
        let (code, _) = apply_patch(SCRIPT, &patch).unwrap_err();
        assert_eq!(code, "text-not-found");
    }

    #[test]
    fn an_ambiguous_snippet_is_refused_rather_than_picking_one() {
        // "return False" appears twice: replacing "the" one is a coin flip.
        let patch = FilePatch::ReplaceText {
            old_text: "return False".into(),
            new_text: "return 0".into(),
            expected_occurrences: None,
        };
        let (code, message) = apply_patch(SCRIPT, &patch).unwrap_err();
        assert_eq!(code, "occurrence-mismatch");
        assert!(message.contains("2 time(s)"), "{message}");
    }

    #[test]
    fn an_ambiguous_snippet_is_allowed_when_the_caller_says_how_many() {
        let patch = FilePatch::ReplaceText {
            old_text: "return False".into(),
            new_text: "return 0".into(),
            expected_occurrences: Some(2),
        };
        let out = apply_patch(SCRIPT, &patch).unwrap().content;
        assert_eq!(out.matches("return 0").count(), 2);
    }

    #[test]
    fn appending_keeps_the_file_newline_terminated() {
        let out = apply_patch(
            "a = 1",
            &FilePatch::Append {
                text: "b = 2\n".into(),
            },
        )
        .unwrap()
        .content;
        assert_eq!(out, "a = 1\nb = 2\n");
    }

    #[test]
    fn the_hash_changes_when_the_content_does_and_not_otherwise() {
        assert_eq!(content_hash(SCRIPT), content_hash(SCRIPT));
        assert_ne!(
            content_hash(SCRIPT),
            content_hash(&SCRIPT.replace('7', "8"))
        );
        // Whitespace is content: an edit that only reindents still counts.
        assert_ne!(content_hash("a = 1"), content_hash("a  = 1"));
    }

    #[test]
    fn valid_python_passes_the_syntax_check() {
        let path = Path::new("prime.py");
        assert!(validate_syntax(path, SCRIPT).unwrap().is_ok());
    }

    #[test]
    fn an_unbalanced_bracket_is_caught_before_it_reaches_the_user() {
        let path = Path::new("prime.py");
        let broken = SCRIPT.replace("range(2, n)", "range(2, n");
        assert!(validate_syntax(path, &broken).unwrap().is_err());
    }

    #[test]
    fn a_block_with_no_body_is_caught() {
        let path = Path::new("prime.py");
        let broken = "def main():\nprint(1)\n";
        let err = validate_syntax(path, broken).unwrap().unwrap_err();
        assert!(err.contains("indented"), "{err}");
    }

    #[test]
    fn a_string_containing_a_bracket_does_not_look_unbalanced() {
        let path = Path::new("prime.py");
        let ok = "msg = \"a ( b\"\nprint(msg)\n";
        assert!(validate_syntax(path, ok).unwrap().is_ok());
    }

    #[test]
    fn a_comment_containing_a_bracket_does_not_look_unbalanced() {
        let path = Path::new("prime.py");
        assert!(validate_syntax(path, "x = 1  # note (unclosed\n")
            .unwrap()
            .is_ok());
    }

    #[test]
    fn a_docstring_spanning_lines_is_not_an_unterminated_string() {
        let path = Path::new("prime.py");
        let src = "def f():\n    \"\"\"Does\n    things.\n    \"\"\"\n    return 1\n";
        assert!(validate_syntax(path, src).unwrap().is_ok());
    }

    #[test]
    fn invalid_json_is_caught_and_valid_json_is_not() {
        let path = Path::new("config.json");
        assert!(validate_syntax(path, r#"{"a": 1}"#).unwrap().is_ok());
        assert!(validate_syntax(path, r#"{"a": }"#).unwrap().is_err());
    }

    #[test]
    fn a_file_type_with_no_checker_reports_that_rather_than_passing() {
        // "not checked" and "checked and fine" are different claims.
        assert!(validate_syntax(Path::new("notes.md"), "# hi").is_none());
    }
}
