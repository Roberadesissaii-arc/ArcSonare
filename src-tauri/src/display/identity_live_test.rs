//! The monitors actually plugged in, named the way profiles are stored.
//!
//! The unit tests prove the key derivation. This proves the names can be
//! obtained at all on this machine, and — the point of the exercise — that they
//! are not the runtime display ids. A profile keyed on a runtime id is attached
//! to whichever monitor lands in that enumeration slot next run, which is how a
//! mapping ends up confidently applied to the wrong screen.
//!
//! Read-only: it enumerates and prints. Nothing is drawn, moved or clicked.
//!
//! Run: cargo test --lib display_identity_live -- --nocapture

#![cfg(windows)]

use super::identity::{enumerate_monitor_identities, pair_with_topology};
use super::topology::read_topology;

#[test]
fn display_identity_live() {
    println!("\n{}", "=".repeat(78));
    println!("MONITOR IDENTITY — from Windows, stable across restarts");
    println!("{}", "=".repeat(78));

    let identities = match enumerate_monitor_identities() {
        Ok(i) => i,
        Err(e) => {
            println!("SKIP: {e}");
            return;
        }
    };
    println!("\n{} monitor(s) attached:", identities.len());
    for m in &identities {
        println!(
            "\n  {}{}\n    slot        {}\n    bounds      {}x{} at ({}, {})\n    stable key  {}",
            if m.friendly_name.is_empty() {
                "(unnamed)"
            } else {
                &m.friendly_name
            },
            if m.primary { "  [primary]" } else { "" },
            m.adapter_slot,
            m.width,
            m.height,
            m.x,
            m.y,
            m.stable_key(),
        );
    }
    if identities.is_empty() {
        println!("SKIP: no monitors reported");
        return;
    }

    // The whole point: the key must not be an enumeration index.
    for m in &identities {
        let key = m.stable_key();
        assert!(!key.is_empty(), "a monitor came back with no stable key");
        assert!(
            !key.chars().all(|c| c.is_ascii_digit()),
            "\"{key}\" is an index, not a hardware identity"
        );
    }

    // Two monitors must never share a key, or their profiles would collide.
    for (i, a) in identities.iter().enumerate() {
        for b in identities.iter().skip(i + 1) {
            assert_ne!(
                a.stable_key(),
                b.stable_key(),
                "two monitors share a stable key"
            );
        }
    }
    println!("\nevery monitor has its own hardware identity");

    // The runtime ids everything else speaks must still be reachable from it.
    match read_topology() {
        Ok(topology) => {
            let pairs = pair_with_topology(&identities, &topology);
            println!("\nstable key -> runtime display id (rebuilt every run, never stored):");
            for (key, id) in &pairs {
                println!("  {id:<6} {key}");
            }
            assert_eq!(
                pairs.len(),
                identities.len(),
                "not every monitor could be paired with a runtime display"
            );
        }
        Err(e) => println!("\ncould not read topology to pair against: {e}"),
    }
    println!("{}\n", "=".repeat(78));
}
