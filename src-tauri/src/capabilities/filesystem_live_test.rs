//! 20 live scenarios: move / copy / rename / organize / find.
//!
//! Artifacts are LEFT under `Desktop\Fantastic` so every claim in the report
//! can be verified by hand rather than taken on trust.
//!
//! Run: cargo test --lib live_report -- --nocapture

use super::filesystem::*;
use super::types::{ToolResult, ToolResultStatus};
use std::fs;
use std::path::Path;

struct Rep {
    rows: Vec<(u32, String, bool, String)>,
}

impl Rep {
    /// `want` is the expected success value — for guard scenarios a refusal
    /// is the correct outcome, so `want: false` means "must not succeed".
    fn add(&mut self, n: u32, ask: &str, r: &ToolResult, want: bool, disk: Option<bool>) {
        let ok = matches!(r.status, ToolResultStatus::Success);
        let pass = (ok == want) && disk.unwrap_or(true);
        println!("\n{n}. ASK   : {ask}");
        println!("   STATUS: {:?}", r.status);
        println!("   REPLY : {}", r.summary);
        if let Some(d) = disk {
            println!("   ON DISK: {d}");
        }
        self.rows
            .push((n, ask.to_string(), pass, r.summary.clone()));
    }
}

fn mkdir(parent: &Path, name: &str) -> ToolResult {
    create_directory(CreateDirectoryArgs {
        parent_path: parent.to_string_lossy().to_string(),
        name: name.into(),
        recursive: Some(false),
        if_exists: None,
    })
}

fn write_file(parent: &Path, name: &str, body: &str) -> ToolResult {
    create_or_write_file(
        "filesystem.create_file",
        WriteFileArgs {
            parent_path: parent.to_string_lossy().to_string(),
            name: name.into(),
            content: Some(body.into()),
            if_exists: Some("fail".into()),
        },
        false,
        &super::confirmation::ConfirmationStore::default(),
    )
}

fn mv(src: &Path, dest_folder: &Path) -> ToolResult {
    move_item(MoveCopyArgs {
        source_path: src.to_string_lossy().to_string(),
        destination_folder: dest_folder.to_string_lossy().to_string(),
        new_name: None,
    })
}

fn cp(src: &Path, dest_folder: &Path) -> ToolResult {
    copy_item(MoveCopyArgs {
        source_path: src.to_string_lossy().to_string(),
        destination_folder: dest_folder.to_string_lossy().to_string(),
        new_name: None,
    })
}

fn ls(p: &Path) -> ToolResult {
    list_directory(ListDirectoryArgs {
        path: p.to_string_lossy().to_string(),
        include_hidden: false,
        sort_by: None,
        sort_direction: None,
        limit: None,
        cursor: None,
    })
}

#[test]
fn live_report() {
    let desktop = known_folder_path("desktop").expect("desktop resolves");
    let root = desktop.join("Fantastic");

    // Windows keeps a deleted directory in a pending-delete state while another
    // process (Explorer, from a previous run's "open" scenario) still holds a
    // handle. Recreating it immediately succeeds, but creating children inside
    // fails with os error 3. Wait for the delete to actually settle.
    let _ = fs::remove_dir_all(&root);
    for _ in 0..50 {
        if !root.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if root.exists() {
        println!(
            "\nWARNING: {} is still held by another process (close Explorer).",
            root.display()
        );
    }

    println!("\n{}", "=".repeat(80));
    println!("LIVE EXECUTION — 20 scenarios (move / copy / rename / organize / find)");
    println!("Artifacts LEFT at: {}", root.display());
    println!("{}", "=".repeat(80));
    let mut rep = Rep { rows: Vec::new() };

    // ---- 1-3: two separate folders inside a workspace root ----
    let r = mkdir(&desktop, "Fantastic");
    rep.add(
        1,
        "create a folder called Fantastic on my desktop",
        &r,
        true,
        Some(root.is_dir()),
    );

    let alpha = root.join("Alpha");
    let r = mkdir(&root, "Alpha");
    rep.add(
        2,
        "create a folder called Alpha",
        &r,
        true,
        Some(alpha.is_dir()),
    );

    let beta = root.join("Beta");
    let r = mkdir(&root, "Beta");
    rep.add(
        3,
        "create a separate folder called Beta",
        &r,
        true,
        Some(beta.is_dir()),
    );

    // ---- 4-6: files to move around ----
    let r = write_file(&alpha, "report.md", "# Q4 report\n");
    rep.add(
        4,
        "create report.md inside Alpha",
        &r,
        true,
        Some(alpha.join("report.md").is_file()),
    );

    let r = write_file(&alpha, "data.csv", "a,b\n1,2\n");
    rep.add(
        5,
        "create data.csv inside Alpha",
        &r,
        true,
        Some(alpha.join("data.csv").is_file()),
    );

    let r = write_file(&alpha, "script.py", "print(sum(range(10)))\n");
    rep.add(
        6,
        "create script.py inside Alpha",
        &r,
        true,
        Some(alpha.join("script.py").is_file()),
    );

    // ---- 7: move a FILE into another folder ----
    let r = mv(&alpha.join("report.md"), &beta);
    let moved = beta.join("report.md").is_file() && !alpha.join("report.md").exists();
    rep.add(
        7,
        "move report.md from Alpha into Beta",
        &r,
        true,
        Some(moved),
    );

    // ---- 8: copy — the original must survive ----
    let r = cp(&alpha.join("data.csv"), &beta);
    let copied = beta.join("data.csv").is_file() && alpha.join("data.csv").is_file();
    rep.add(
        8,
        "copy data.csv into Beta, keeping the original",
        &r,
        true,
        Some(copied),
    );

    // ---- 9: move a whole FOLDER ----
    let gamma = root.join("Gamma");
    let _ = mkdir(&root, "Gamma");
    let r = mv(&gamma, &beta);
    let folder_moved = beta.join("Gamma").is_dir() && !gamma.exists();
    rep.add(
        9,
        "move the Gamma folder into Beta",
        &r,
        true,
        Some(folder_moved),
    );

    // ---- 10: rename ----
    let r = rename(RenameArgs {
        path: beta.join("Gamma").to_string_lossy().to_string(),
        new_name: "Archive".into(),
    });
    rep.add(
        10,
        "rename Gamma to Archive",
        &r,
        true,
        Some(beta.join("Archive").is_dir()),
    );

    // ---- 11-15: organize by type ----
    let docs = root.join("Documents");
    let code = root.join("Code");
    let data = root.join("Data");
    let _ = mkdir(&root, "Documents");
    let _ = mkdir(&root, "Code");
    let r = mkdir(&root, "Data");
    rep.add(
        11,
        "create Documents, Code and Data folders to organize into",
        &r,
        true,
        Some(docs.is_dir() && code.is_dir() && data.is_dir()),
    );

    let r = mv(&beta.join("report.md"), &docs);
    rep.add(
        12,
        "organize: move report.md into Documents",
        &r,
        true,
        Some(docs.join("report.md").is_file()),
    );

    let r = mv(&alpha.join("script.py"), &code);
    rep.add(
        13,
        "organize: move script.py into Code",
        &r,
        true,
        Some(code.join("script.py").is_file()),
    );

    let r = mv(&alpha.join("data.csv"), &data);
    rep.add(
        14,
        "organize: move data.csv into Data",
        &r,
        true,
        Some(data.join("data.csv").is_file()),
    );

    let r = ls(&root);
    rep.add(15, "show me how Fantastic is organized now", &r, true, None);

    // ---- 16-18: find ----
    let r = find(FindArgs {
        query: "script.py".into(),
        roots: vec![],
        item_type: None,
        extension: None,
        recursive: Some(true),
        max_depth: Some(4),
        limit: Some(5),
    });
    rep.add(16, "find script.py", &r, true, None);

    // The user's real file. If it is not on this machine, a clean not-found is
    // still correct behaviour — what would be wrong is inventing a location.
    let r = find(FindArgs {
        query: "red_distortion_4.heic".into(),
        roots: vec![],
        item_type: None,
        extension: None,
        recursive: Some(true),
        max_depth: Some(4),
        limit: Some(5),
    });
    let found_ok = matches!(
        r.status,
        ToolResultStatus::Success | ToolResultStatus::NotFound
    );
    println!("\n17. ASK   : find red_distortion_4.heic");
    println!("   STATUS: {:?}", r.status);
    println!("   REPLY : {}", r.summary);
    rep.rows.push((
        17,
        "find red_distortion_4.heic".into(),
        found_ok,
        r.summary.clone(),
    ));

    let r = find(FindArgs {
        query: "distortion".into(),
        roots: vec![],
        item_type: None,
        extension: Some("heic".into()),
        recursive: Some(true),
        max_depth: Some(3),
        limit: Some(10),
    });
    let heic_ok = matches!(
        r.status,
        ToolResultStatus::Success | ToolResultStatus::NotFound
    );
    println!("\n18. ASK   : find .heic files matching \"distortion\"");
    println!("   STATUS: {:?}", r.status);
    println!("   REPLY : {}", r.summary);
    rep.rows.push((
        18,
        "find .heic matching distortion".into(),
        heic_ok,
        r.summary.clone(),
    ));

    // ---- 19-20: guards — refusal is the pass ----
    let r = mv(&docs.join("report.md"), &docs);
    rep.add(
        19,
        "move report.md into the folder it is already in (must refuse)",
        &r,
        false,
        None,
    );

    let r = mv(&root.join("does_not_exist.txt"), &beta);
    rep.add(
        20,
        "move a file that does not exist (must refuse)",
        &r,
        false,
        None,
    );

    // ---- report ----
    println!("\n{}", "=".repeat(80));
    println!("{:<4}{:<56}{}", "#", "SCENARIO", "RESULT");
    println!("{}", "-".repeat(80));
    for (n, ask, pass, _) in &rep.rows {
        let s: String = if ask.len() > 54 {
            format!("{}…", &ask[..53])
        } else {
            ask.clone()
        };
        println!("{:<4}{:<56}{}", n, s, if *pass { "PASS" } else { "FAIL" });
    }
    let failed = rep.rows.iter().filter(|(_, _, p, _)| !p).count();
    println!("{}", "-".repeat(80));
    println!("{}/{} passed", rep.rows.len() - failed, rep.rows.len());
    if failed > 0 {
        println!("\nFAILURES:");
        for (n, ask, pass, why) in &rep.rows {
            if !pass {
                println!("  {n}. {ask}\n     -> {why}");
            }
        }
    }
    println!("\nLEFT ON DISK: {}", root.display());
    println!("{}\n", "=".repeat(80));
}
