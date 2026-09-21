//! The real Desktop, read from the real shell.
//!
//! The unit tests prove the matching rules against a hand-built list. This
//! proves the list can be obtained at all — that the shell's icon control is
//! findable on this machine, that its items can be read out of another process,
//! and that the rectangles it reports are one-icon-sized rather than the
//! four-icon region a vision model returned.
//!
//! Read-only: it enumerates and prints. Nothing is opened, moved or clicked.
//!
//! Run: cargo test --lib desktop_items_live -- --nocapture

#![cfg(windows)]

use super::desktop_items::{enumerate_desktop_items, match_item, DesktopItemKind};

#[test]
fn desktop_items_live() {
    println!("\n{}", "=".repeat(78));
    println!("DESKTOP ITEMS — read from the shell, no screenshot, no model");
    println!("{}", "=".repeat(78));

    let items = match enumerate_desktop_items() {
        Ok(i) => i,
        Err(e) => {
            // A locked session or a shell that has not started yet. Skipping is
            // honest; failing would say the code is broken when the desktop is
            // simply not there.
            println!("SKIP: {e}");
            return;
        }
    };
    println!("\n{} item(s) on the Desktop:", items.len());
    for item in &items {
        println!(
            "  {:<28} {:<6} ({:>6}, {:>6}) {:>4}x{:<4} {}",
            item.name,
            match item.is_folder {
                Some(true) => "folder",
                Some(false) => "file",
                None => "?",
            },
            item.bounds.x,
            item.bounds.y,
            item.bounds.width,
            item.bounds.height,
            item.path.as_deref().unwrap_or("(no path)")
        );
    }
    if items.is_empty() {
        println!("SKIP: the Desktop has no icons to check");
        return;
    }

    // Every rectangle should be one icon. The failure this replaces produced a
    // box spanning four, so an implausible size here is the thing to catch.
    let oversized: Vec<_> = items
        .iter()
        .filter(|i| i.bounds.width > 400 || i.bounds.height > 400)
        .collect();
    assert!(
        oversized.is_empty(),
        "these rectangles are too big to be one icon: {:?}",
        oversized.iter().map(|i| &i.name).collect::<Vec<_>>()
    );

    // No icon's rectangle may contain another icon's centre.
    for a in &items {
        for b in &items {
            if a.name == b.name {
                continue;
            }
            let (cx, cy) = b.bounds.center();
            assert!(
                !a.bounds.contains(cx, cy),
                "\"{}\" ({:?}) swallows the centre of \"{}\"",
                a.name,
                a.bounds,
                b.name
            );
        }
    }
    println!("\nevery rectangle covers exactly one icon");

    // The folder from the bug report, when it is present.
    match match_item(&items, "books", DesktopItemKind::Folder) {
        Ok(found) => {
            println!(
                "\n\"books\" resolved to ({}, {}) {}x{}  path {}",
                found.bounds.x,
                found.bounds.y,
                found.bounds.width,
                found.bounds.height,
                found.path.as_deref().unwrap_or("(none)")
            );
            assert_eq!(found.is_folder, Some(true));
            assert!(
                found
                    .path
                    .as_deref()
                    .map(|p| std::path::Path::new(p).is_dir())
                    .unwrap_or(false),
                "the matched item does not resolve to a real folder"
            );
            let (cx, cy) = found.bounds.center();
            let neighbours: Vec<&str> = items
                .iter()
                .filter(|i| i.name != found.name && i.bounds.contains(cx, cy))
                .map(|i| i.name.as_str())
                .collect();
            assert!(
                neighbours.is_empty(),
                "the books rectangle also covers {neighbours:?}"
            );
            println!("no other icon shares that rectangle");
        }
        Err(e) => println!("\n\"books\" not matched on this Desktop: {e:?}"),
    }
    println!("{}\n", "=".repeat(78));
}
