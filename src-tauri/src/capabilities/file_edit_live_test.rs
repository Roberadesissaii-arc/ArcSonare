//! Create a file, then fix it — against the real filesystem.
//!
//! The bug this covers is not a crash. It is ArcSonare being asked to fix a
//! file it made minutes ago, deciding that is a create, discovering the file
//! exists, asking whether it may overwrite, being told yes, and asking again.
//! Nothing in that loop is a compile error, so it needs a test that walks the
//! whole sequence on disk and asserts what did *not* happen.
//!
//! Runs in a temporary ArcSonare-owned folder and cleans up after itself. No
//! user file is read or written.
//!
//! Run: cargo test --lib file_edit_live -- --nocapture

use std::fs;
use std::path::PathBuf;

use super::confirmation::ConfirmationStore;
use super::file_edit::{content_hash, modify_file, read_for_edit, FilePatch, ModifyFileArgs};
use super::filesystem::{create_or_write_file, WriteFileArgs};
use super::types::ToolResultStatus;

/// A Python file with a real bug: the loop bound excludes `n - 1`, so every
/// even number above two is reported prime.
const BUGGY: &str = "def is_prime(n):\n    if n < 2:\n        return False\n    for i in range(2, 2):\n        if n % i == 0:\n            return False\n    return True\n\n\ndef describe(n):\n    return f\"{n} is {'prime' if is_prime(n) else 'not prime'}\"\n\n\nif __name__ == \"__main__\":\n    print(describe(9))\n";

/// A folder of this test's own.
///
/// Counter, not a timestamp: cargo runs these in parallel and four tests
/// starting in the same millisecond would share one directory — and then delete
/// it out from under each other on the way out.
fn scratch() -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "ArcSonare-file-edit-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch folder");
    dir
}

fn create(
    dir: &PathBuf,
    name: &str,
    body: &str,
    if_exists: Option<&str>,
    confirmed: bool,
) -> super::types::ToolResult {
    create_or_write_file(
        "filesystem.create_file",
        WriteFileArgs {
            parent_path: dir.to_string_lossy().into_owned(),
            name: name.into(),
            content: Some(body.into()),
            if_exists: if_exists.map(str::to_string),
        },
        confirmed,
        &ConfirmationStore::default(),
    )
}

#[test]
fn file_edit_live_create_then_fix() {
    let dir = scratch();
    let path = dir.join("prime.py");
    println!("\n{}", "=".repeat(78));
    println!("CREATE THEN FIX — {}", dir.display());
    println!("{}", "=".repeat(78));

    // 1. Create.
    let created = create(&dir, "prime.py", BUGGY, None, false);
    println!("create           {:?}  {}", created.status, created.summary);
    assert_eq!(created.status, ToolResultStatus::Success);
    assert!(path.exists());

    // 2. Read it back the way an edit is supposed to start.
    let read = read_for_edit(super::file_edit::HashArgs {
        path: path.to_string_lossy().into_owned(),
    });
    assert_eq!(read.status, ToolResultStatus::Success);
    let data = read.data.clone().unwrap();
    let original = data["content"].as_str().unwrap().to_string();
    let hash = data["content_hash"].as_str().unwrap().to_string();
    println!("read_for_edit    hash {hash}");
    assert_eq!(hash, content_hash(BUGGY));

    // 3. Fix it. This is the step that used to become a create.
    let fixed = modify_file(ModifyFileArgs {
        path: path.to_string_lossy().into_owned(),
        patch: FilePatch::ReplaceText {
            old_text: "range(2, 2)".into(),
            new_text: "range(2, int(n ** 0.5) + 1)".into(),
            expected_occurrences: None,
        },
        based_on_hash: Some(hash.clone()),
    });
    println!("modify           {:?}  {}", fixed.status, fixed.summary);
    assert_eq!(
        fixed.status,
        ToolResultStatus::Success,
        "fixing an existing file must not need confirmation: {}",
        fixed.summary
    );
    // The thing the loop used to produce.
    assert_ne!(
        fixed.status,
        ToolResultStatus::NeedsConfirmation,
        "modifying an existing file asked to overwrite it"
    );

    let after = fs::read_to_string(&path).unwrap();
    assert!(
        after.contains("int(n ** 0.5)"),
        "the fix is not in the file"
    );
    // Everything the request did not mention has to still be there.
    assert!(
        after.contains("def describe(n):"),
        "an unrelated function was lost"
    );
    assert!(after.contains("__main__"), "the entry point was lost");
    assert_eq!(
        after.lines().count(),
        original.lines().count(),
        "the line count changed, so more than the snippet was rewritten"
    );
    assert_eq!(
        fixed.data.as_ref().unwrap()["syntax_ok"],
        serde_json::Value::Bool(true)
    );
    println!("preserved        describe() and __main__ intact, syntax ok");

    // 4. A second identical patch is now stale: the snippet is gone.
    let again = modify_file(ModifyFileArgs {
        path: path.to_string_lossy().into_owned(),
        patch: FilePatch::ReplaceText {
            old_text: "range(2, 2)".into(),
            new_text: "x".into(),
            expected_occurrences: None,
        },
        based_on_hash: None,
    });
    println!("repeat patch     {:?}  {}", again.status, again.summary);
    assert_eq!(again.status, ToolResultStatus::Error);

    // 5. A patch based on the pre-fix hash must be refused, not applied blindly.
    let stale = modify_file(ModifyFileArgs {
        path: path.to_string_lossy().into_owned(),
        patch: FilePatch::ReplaceText {
            old_text: "def describe(n):".into(),
            new_text: "def describe(number):".into(),
            expected_occurrences: None,
        },
        based_on_hash: Some(hash),
    });
    println!("stale patch      {:?}  {}", stale.status, stale.summary);
    assert_eq!(stale.status, ToolResultStatus::Error);
    assert_eq!(
        stale.error.as_ref().unwrap().code,
        "FILE_CHANGED_SINCE_READ"
    );
    assert!(
        fs::read_to_string(&path)
            .unwrap()
            .contains("def describe(n):"),
        "a stale patch was applied anyway"
    );

    // 6. No temporary file left behind.
    let leftovers: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("arcsonare-tmp"))
        .collect();
    assert!(leftovers.is_empty(), "temporary files left: {leftovers:?}");
    println!("cleanup          no temporary files left behind");

    let _ = fs::remove_dir_all(&dir);
    println!("{}\n", "=".repeat(78));
}

#[test]
fn file_edit_live_create_conflict_asks_once_and_then_proceeds() {
    let dir = scratch();
    let store = ConfirmationStore::default();
    let args = |if_exists: Option<&str>| WriteFileArgs {
        parent_path: dir.to_string_lossy().into_owned(),
        name: "prime.py".into(),
        content: Some("print('v2')\n".into()),
        if_exists: if_exists.map(str::to_string),
    };

    create(&dir, "prime.py", "print('v1')\n", None, false);

    // A create against an existing name asks — once — and hands back a token.
    let conflict = create_or_write_file("filesystem.create_file", args(None), false, &store);
    assert_eq!(conflict.status, ToolResultStatus::NeedsConfirmation);
    let token = conflict.data.as_ref().unwrap()["confirmation"]["token"]
        .as_str()
        .expect("a confirmation with no token is a confirmation that cannot be answered")
        .to_string();
    println!("\nconflict         asked once, token {token}");

    // The frontend resumes with `if_exists: overwrite`, which is exactly what
    // the token was issued against — so it consumes cleanly and the write runs.
    let approved = serde_json::json!({
        "parent_path": dir.to_string_lossy(),
        "name": "prime.py",
        "content": "print('v2')\n",
        "if_exists": "overwrite",
    });
    store
        .consume(&token, "filesystem.create_file", &approved)
        .expect("the approved action must match the token it was issued for");

    let done = create_or_write_file(
        "filesystem.create_file",
        args(Some("overwrite")),
        true,
        &store,
    );
    println!("after approval   {:?}  {}", done.status, done.summary);
    assert_eq!(
        done.status,
        ToolResultStatus::Success,
        "the approved write asked again instead of running"
    );
    assert_eq!(
        fs::read_to_string(dir.join("prime.py")).unwrap(),
        "print('v2')\n"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn file_edit_live_modify_refuses_a_file_that_is_not_there() {
    // A modification of something absent is not a licence to create it.
    let dir = scratch();
    let missing = dir.join("nope.py");
    let result = modify_file(ModifyFileArgs {
        path: missing.to_string_lossy().into_owned(),
        patch: FilePatch::FullContent {
            content: "print(1)\n".into(),
        },
        based_on_hash: None,
    });
    assert_eq!(result.status, ToolResultStatus::NotFound);
    assert!(!missing.exists(), "a modification created a file");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn file_edit_live_a_broken_edit_is_reported_as_broken() {
    // The edit lands — it is on disk — but claiming "fixed" would be a lie.
    let dir = scratch();
    let path = dir.join("prime.py");
    create(&dir, "prime.py", BUGGY, None, false);
    let result = modify_file(ModifyFileArgs {
        path: path.to_string_lossy().into_owned(),
        patch: FilePatch::ReplaceText {
            old_text: "range(2, 2)".into(),
            new_text: "range(2, 2".into(),
            expected_occurrences: None,
        },
        based_on_hash: None,
    });
    assert_eq!(result.status, ToolResultStatus::Partial);
    assert_eq!(
        result.data.as_ref().unwrap()["syntax_ok"],
        serde_json::Value::Bool(false)
    );
    assert!(
        result.summary.contains("bracket"),
        "the user should be told what is wrong: {}",
        result.summary
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn file_edit_live_a_no_op_patch_does_not_claim_a_fix() {
    let dir = scratch();
    let path = dir.join("notes.md");
    create(&dir, "notes.md", "hello\n", None, false);
    let result = modify_file(ModifyFileArgs {
        path: path.to_string_lossy().into_owned(),
        patch: FilePatch::FullContent {
            content: "hello\n".into(),
        },
        based_on_hash: None,
    });
    assert_eq!(result.status, ToolResultStatus::Partial);
    assert_eq!(
        result.data.as_ref().unwrap()["changed"],
        serde_json::Value::Bool(false)
    );
    let _ = fs::remove_dir_all(&dir);
}
