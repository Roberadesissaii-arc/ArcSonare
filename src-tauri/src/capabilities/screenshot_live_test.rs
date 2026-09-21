//! The production capture path, run against the monitors actually plugged in.
//!
//! Unit tests build a topology by hand, so they prove the arithmetic but not
//! that the real capture picks the right monitor. This runs the production
//! sequence — resolve the display first, match the xcap monitor by identity,
//! validate its geometry, capture, register the frame, resolve a point back —
//! and writes the images to `Desktop\screenshot` so the result can be looked at
//! rather than only asserted on.
//!
//! Read-only with respect to the desktop: it captures and computes, but never
//! moves the cursor and never clicks.
//!
//! Run: cargo test --lib screenshot_live -- --nocapture

#![cfg(windows)]

use std::path::PathBuf;

use super::screenshots::portion_region;
use crate::display::coordinates::{CoordinateSpace, TypedPoint};
use crate::display::frame::{resolve_visual_target, FrameRegistry, VisualTarget};
use crate::display::production_capture::{capture_display, capture_region, DisplaySelector};
use crate::display::topology;

fn out_dir() -> PathBuf {
    let dir = dirs::desktop_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("screenshot");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[test]
fn screenshot_live() {
    let dir = out_dir();
    println!("\n{}", "=".repeat(78));
    println!("PRODUCTION CAPTURE OWNERSHIP — images written to:");
    println!("  {}", dir.display());
    println!("{}", "=".repeat(78));

    let topo = match topology::read_topology() {
        Ok(t) => t,
        Err(e) => {
            println!("SKIP: no readable topology: {e}");
            return;
        }
    };
    println!(
        "\nvirtual desktop: left={} top={} {}x{}",
        topo.virtual_desktop.left,
        topo.virtual_desktop.top,
        topo.virtual_desktop.width,
        topo.virtual_desktop.height
    );
    println!("topology version: {}", topo.version);

    let registry = FrameRegistry::new();
    let mut rows: Vec<(String, bool, String)> = Vec::new();

    // ---- every display, captured by identity and resolved back to itself ----
    for display in &topo.displays {
        let label = format!("display {}", display.display_id);
        let capture = match capture_display(&topo, &DisplaySelector::Id(display.display_id)) {
            Ok(c) => c,
            Err(e) => {
                println!("FAIL   {label}: {e}");
                rows.push((format!("capture {label}"), false, e));
                continue;
            }
        };
        let frame = capture.frame.clone();
        registry.register(frame.clone());

        let path = dir.join(format!("display-{}-full.png", display.display_id));
        let saved = capture.image.save(&path).is_ok();

        // Resolve the centre exactly as a model answer would.
        let target = VisualTarget {
            frame_id: frame.frame_id.clone(),
            display_id: frame.display_id,
            topology_version: frame.topology_version.clone(),
            coordinate_space: CoordinateSpace::ModelNormalized,
            x: 500.0,
            y: 500.0,
            normalized_max: 1000.0,
            confidence: Some(1.0),
        };
        let resolved = resolve_visual_target(&target, &registry, &topo);

        println!("\n{label}");
        println!("  frame_id          {}", frame.frame_id);
        println!("  display_id        {}", frame.display_id);
        println!("  topology_version  {}", frame.topology_version);
        println!(
            "  physical bounds   ({}, {}) {}x{}",
            display.x, display.y, display.width, display.height
        );
        println!(
            "  capture size      {}x{}",
            frame.capture_width, frame.capture_height
        );
        println!("  image saved       {saved} -> {}", path.display());

        match resolved {
            Ok(point) => {
                let landed = topo
                    .display_containing(&TypedPoint::new(
                        point.x,
                        point.y,
                        CoordinateSpace::VirtualDesktopPhysical,
                    ))
                    .map(|d| d.display_id);
                let correct = landed == Some(display.display_id);
                println!(
                    "  centre resolves   ({:.0}, {:.0}) -> display {:?}  {}",
                    point.x,
                    point.y,
                    landed,
                    if correct { "OK" } else { "WRONG DISPLAY" }
                );
                rows.push((
                    format!("{label} owns its capture"),
                    correct && saved,
                    format!("centre ({:.0}, {:.0}) on {landed:?}", point.x, point.y),
                ));
            }
            Err(e) => {
                println!("  centre resolves   FAILED: {e}");
                rows.push((format!("{label} owns its capture"), false, e.to_string()));
            }
        }
    }

    // ---- portions of the primary display, captured as owned regions ----
    if let Ok(primary) =
        crate::display::production_capture::resolve_display(&topo, &DisplaySelector::Primary)
    {
        for portion in [
            "left-half",
            "right-half",
            "top-half",
            "bottom-half",
            "left-third",
            "center-third",
            "right-third",
        ] {
            let region = match portion_region(portion, &primary) {
                Ok(r) => r,
                Err(e) => {
                    rows.push((format!("{portion} of primary"), false, e));
                    continue;
                }
            };
            match capture_region(&topo, region.x, region.y, region.width, region.height) {
                Ok(c) => {
                    let name = format!("display-{}-{portion}.png", primary.display_id);
                    let ok = c.image.save(dir.join(&name)).is_ok();
                    // The crop must stay bound to the display it was cut from.
                    let bound = c.frame.display_id == primary.display_id;
                    println!(
                        "SAVED  {name}  ({}x{} at ({}, {}), frame {}, display {})",
                        c.image.width(),
                        c.image.height(),
                        region.x,
                        region.y,
                        c.frame.frame_id,
                        c.frame.display_id
                    );
                    rows.push((
                        format!("{portion} of primary"),
                        ok && bound,
                        format!("{}x{}", c.image.width(), c.image.height()),
                    ));
                }
                Err(e) => rows.push((format!("{portion} of primary"), false, e)),
            }
        }
    }

    // ---- a display that does not exist must be refused, not substituted ----
    let ghost = topo
        .displays
        .iter()
        .map(|d| d.display_id)
        .max()
        .unwrap_or(0)
        + 999;
    match crate::display::production_capture::resolve_display(&topo, &DisplaySelector::Id(ghost)) {
        Ok(d) => rows.push((
            "reject an unknown display".into(),
            false,
            format!("substituted display {}", d.display_id),
        )),
        Err(e) => {
            println!("\nREFUSED (correct)  display {ghost}: {e}");
            rows.push(("reject an unknown display".into(), true, e));
        }
    }

    // ---- table ----
    println!("\n{}", "=".repeat(78));
    println!("{:<44}{:<8}{}", "SCENARIO", "RESULT", "DETAIL");
    println!("{}", "-".repeat(78));
    for (name, pass, note) in &rows {
        println!(
            "{:<44}{:<8}{}",
            name,
            if *pass { "PASS" } else { "FAIL" },
            note
        );
    }
    let failed = rows.iter().filter(|(_, p, _)| !p).count();
    println!("{}", "-".repeat(78));
    println!("{}/{} passed", rows.len() - failed, rows.len());
    println!("\nGO LOOK:  {}", dir.display());
    println!("{}\n", "=".repeat(78));

    assert_eq!(failed, 0, "{failed} production capture checks failed");
}
