//! Nothing in production may draw, move or click without an authority.
//!
//! The type system carries most of this: `show_overlay`, `move_cursor` and
//! `click` on `VisualSideEffects` accept only `AuthorizedRect`/`AuthorizedPoint`,
//! and those have no public constructor. A new visual command that forgets the
//! gate cannot name a value the backend accepts.
//!
//! What the type system cannot prevent is a new command reaching *past* the
//! trait and calling `native_overlay::show_highlight`, `set_cursor_position` or
//! `click_at_point` directly — those are ordinary public functions taking
//! ordinary integers. That is exactly how `agent_highlight.rs` and
//! `interaction/executor.rs` came to bypass the gate, and both were found by
//! audit rather than by anything failing.
//!
//! So this reads the source and fails if a new caller appears outside the small
//! set of modules allowed to have one. It is a lint, not a proof — but it fails
//! at the moment the bypass is written rather than at the next audit.

#![cfg(all(test, windows))]

use std::path::{Path, PathBuf};

/// The native primitives that draw or inject input without asking anything.
const GUARDED: [&str; 3] = [
    "native_overlay::show_highlight",
    "input::set_cursor_position",
    "input::click_at_point",
];

/// Who may still call them, and why.
///
/// Each entry is a deliberate decision, not a backlog:
///
/// - `display/side_effects.rs` — the trait implementation. This *is* the
///   boundary; it receives an already-authorized value and unwraps it.
/// - `display/wizard.rs` — the Display Mapping wizard. It is the thing that
///   creates profiles, so it cannot be made to require one. Documented
///   exception.
///
/// `native_overlay.rs` and `capabilities/input.rs` are absent on purpose: they
/// *define* these functions and call them unqualified, so the scan never sees
/// them. This lint catches qualified cross-module calls, which is where the
/// bypasses actually appeared.
const ALLOWED: [&str; 2] = ["display/side_effects.rs", "display/wizard.rs"];

fn src_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// Every `.rs` file under `src`, with its path relative to `src`.
fn rust_files(dir: &Path, root: &Path, out: &mut Vec<(String, String)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_files(&path, root, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, text));
            }
        }
    }
}

/// A file that only exists for tests may call whatever it likes.
fn is_test_file(rel: &str, text: &str) -> bool {
    rel.ends_with("_test.rs")
        || rel.contains("/tests/")
        || text.contains("#![cfg(all(test, windows))]")
        || text.contains("#![cfg(test)]")
}

/// Drop comment lines.
///
/// Without this the lint flags the prose explaining why a module no longer
/// calls the overlay — which is both wrong and the kind of false positive that
/// gets a lint deleted.
fn without_comments(text: &str) -> String {
    text.lines()
        .filter(|l| {
            let t = l.trim_start();
            !(t.starts_with("//") || t.starts_with("*") || t.starts_with("/*"))
        })
        .collect::<Vec<_>>()
        .join(
            "
",
        )
}

/// Strip `#[cfg(test)] mod tests { ... }` so a test module inside a production
/// file does not count as a production caller.
///
/// Deliberately crude — it cuts from the marker to the end of the file, which is
/// where these modules always sit in this codebase. Cutting too much would only
/// make the lint miss something, and the lint is a backstop, so the failure mode
/// is the safe one.
fn without_test_modules(text: &str) -> &str {
    for marker in ["\n#[cfg(test)]\nmod tests", "\n#[cfg(test)]\nmod unit"] {
        if let Some(at) = text.find(marker) {
            return &text[..at];
        }
    }
    text
}

#[test]
fn no_production_module_reaches_past_the_authority() {
    let root = src_root();
    let mut files = Vec::new();
    rust_files(&root, &root, &mut files);
    assert!(
        files.len() > 20,
        "the source walk found only {} files; the lint is not looking at the tree",
        files.len()
    );

    let mut offenders: Vec<String> = Vec::new();
    for (rel, text) in &files {
        if ALLOWED.contains(&rel.as_str()) || is_test_file(rel, text) {
            continue;
        }
        let production = without_comments(without_test_modules(text));
        for needle in GUARDED {
            if production.contains(needle) {
                offenders.push(format!("{rel} calls {needle}"));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "these production modules bypass VisualExecutionAuthority:\n  {}\n\n\
         Route the call through `display::gate::authorize_desktop_rect` or \
         `authorize_desktop_point` and then `VisualSideEffects`, or add the file \
         to ALLOWED with a written reason.",
        offenders.join("\n  ")
    );
}

/// The allow-list must not rot into a list of files that no longer need it.
#[test]
fn every_allowed_bypass_still_has_one() {
    let root = src_root();
    let mut files = Vec::new();
    rust_files(&root, &root, &mut files);

    for allowed in ALLOWED {
        let Some((_, text)) = files.iter().find(|(rel, _)| rel == allowed) else {
            panic!("{allowed} is on the allow-list but does not exist");
        };
        let production = without_comments(without_test_modules(text));
        assert!(
            GUARDED.iter().any(|n| production.contains(n)),
            "{allowed} is on the bypass allow-list but calls none of the guarded \
             functions; remove it"
        );
    }
}

/// The two routes this work closed must stay closed.
///
/// Named explicitly rather than left to the scan, so that if someone widens
/// `ALLOWED` to make a build green, this still fails and says why.
#[test]
fn the_two_previously_bypassing_routes_stay_closed() {
    let root = src_root();
    for (file, what) in [
        ("agent_highlight.rs", "the frontend outline command"),
        (
            "interaction/executor.rs",
            "the structured Desktop highlight",
        ),
    ] {
        let text = std::fs::read_to_string(root.join(file))
            .unwrap_or_else(|e| panic!("{file} is unreadable: {e}"));
        let production = without_comments(without_test_modules(&text));
        assert!(
            !production.contains("native_overlay::show_highlight"),
            "{what} ({file}) calls the overlay directly again"
        );
        assert!(
            production.contains("authorize_desktop_rect"),
            "{what} ({file}) no longer goes through the gate"
        );
    }
}
