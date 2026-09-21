//! The Rust catalog and the frontend catalog must agree on ids.
//!
//! They are two files because they carry different things — matching rules here,
//! icons and copy there — but a watch created from a Rust-discovered instance is
//! rendered by the frontend using its own catalog. An id present on one side and
//! absent on the other produces a row with no icon and no name, or an icon for
//! an application that can never be discovered.

use std::collections::BTreeSet;
use std::path::PathBuf;

use super::catalog::WATCH_CATALOG;

fn frontend_catalog_ids() -> Option<BTreeSet<String>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("src/features/dashboard/contextAppCatalog.ts");
    let source = std::fs::read_to_string(path).ok()?;
    let mut ids = BTreeSet::new();
    for line in source.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("id: \"") {
            if let Some(end) = rest.find('"') {
                ids.insert(rest[..end].to_string());
            }
        }
    }
    Some(ids)
}

#[test]
fn every_rust_catalog_id_exists_in_the_frontend_catalog() {
    let Some(frontend) = frontend_catalog_ids() else {
        // The repository layout is not available (packaged build). Skipping is
        // correct here — this asserts a source-tree invariant, not a runtime one.
        return;
    };
    assert!(
        !frontend.is_empty(),
        "the frontend catalog was found but no ids parsed — the parser is stale"
    );
    let missing: Vec<&str> = WATCH_CATALOG
        .iter()
        .map(|e| e.id)
        .filter(|id| !frontend.contains(*id))
        .collect();
    assert!(
        missing.is_empty(),
        "these applications can be discovered but cannot be rendered: {missing:?}"
    );
}
