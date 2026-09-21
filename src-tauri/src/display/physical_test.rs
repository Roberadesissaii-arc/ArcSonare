//! Overlay and cursor, on the monitors actually plugged in.
//!
//! Everything else proves the arithmetic. This proves the arithmetic reaches
//! the screen: a box drawn through the canonical resolver has to appear on the
//! display the frame named, and the cursor has to arrive where it was sent —
//! including on a portrait monitor whose origin is negative, which is where
//! every previous approach quietly landed on the primary screen instead.
//!
//! Deliberately click-free. Moving the pointer is recoverable; clicking on
//! whatever happens to be under it is not.
//!
//! Run: cargo test --lib physical_overlay_and_cursor -- --nocapture --ignored

#![cfg(windows)]

use super::coordinates::{CoordinateSpace, TypedPoint};
use super::frame::{resolve_visual_target, FrameRegistry, VisualTarget};
use super::production_capture::{capture_display, DisplaySelector};
use super::topology;
use crate::native_overlay;

/// Nine points that between them catch every mapping mistake worth catching:
/// the corners find sign errors, the edges find off-by-one bounds, the centre
/// finds a display substituted wholesale.
const PROBES: [(f64, f64, &str); 9] = [
    (100.0, 100.0, "top-left"),
    (500.0, 100.0, "top-centre"),
    (900.0, 100.0, "top-right"),
    (100.0, 500.0, "mid-left"),
    (500.0, 500.0, "centre"),
    (900.0, 500.0, "mid-right"),
    (100.0, 900.0, "bottom-left"),
    (500.0, 900.0, "bottom-centre"),
    (900.0, 900.0, "bottom-right"),
];

#[test]
#[ignore = "moves the mouse and draws on screen; run explicitly"]
fn physical_overlay_and_cursor() {
    let topo = match topology::read_topology() {
        Ok(t) => t,
        Err(e) => {
            println!("SKIP: no readable topology: {e}");
            return;
        }
    };
    // The overlay windows are created by the running app; a test process has no
    // app, so start them here. They own their own thread and message loop.
    native_overlay::init();
    for _ in 0..40 {
        if native_overlay::show_highlight(-20_000, -20_000, 10, 10).is_ok() {
            native_overlay::hide_highlight();
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    let registry = FrameRegistry::new();
    let start_cursor = crate::capabilities::input::read_cursor_position();

    println!("\n{}", "=".repeat(84));
    println!("PHYSICAL OVERLAY + CURSOR — no clicks are performed");
    println!("{}", "=".repeat(84));

    let mut rows: Vec<(String, bool, String)> = Vec::new();

    for display in &topo.displays {
        let capture = match capture_display(&topo, &DisplaySelector::Id(display.display_id)) {
            Ok(c) => c,
            Err(e) => {
                rows.push((format!("display {}", display.display_id), false, e));
                continue;
            }
        };
        let frame = capture.frame.clone();
        registry.register(frame.clone());
        println!(
            "\ndisplay {}  bounds ({}, {}) {}x{}  frame {}",
            display.display_id, display.x, display.y, display.width, display.height, frame.frame_id
        );

        for (nx, ny, name) in PROBES {
            let target = VisualTarget {
                frame_id: frame.frame_id.clone(),
                display_id: frame.display_id,
                topology_version: frame.topology_version.clone(),
                coordinate_space: CoordinateSpace::ModelNormalized,
                x: nx,
                y: ny,
                normalized_max: 1000.0,
                confidence: Some(1.0),
            };
            let resolved = match resolve_visual_target(&target, &registry, &topo) {
                Ok(r) => r,
                Err(e) => {
                    rows.push((
                        format!("display {} {name}", display.display_id),
                        false,
                        e.to_string(),
                    ));
                    continue;
                }
            };
            let (px, py) = (resolved.x.round() as i32, resolved.y.round() as i32);

            // The point must be on the display the frame named — not merely on
            // some display, which is what a substituted monitor looks like.
            let landed = topo
                .display_containing(&TypedPoint::new(
                    resolved.x,
                    resolved.y,
                    CoordinateSpace::VirtualDesktopPhysical,
                ))
                .map(|d| d.display_id);
            let on_right_display = landed == Some(display.display_id);

            // Overlay: a small box centred on the point, held briefly.
            let overlay_ok = native_overlay::show_highlight(px - 40, py - 40, 80, 80).is_ok();
            std::thread::sleep(std::time::Duration::from_millis(160));
            native_overlay::hide_highlight();

            // Cursor: move, then read back. The read is verification only.
            let moved = crate::capabilities::input::set_cursor_position(px, py).is_ok();
            let actual = crate::capabilities::input::read_cursor_position();
            let error = actual.map(|(ax, ay)| {
                let (dx, dy) = ((ax - px) as f64, (ay - py) as f64);
                (dx * dx + dy * dy).sqrt()
            });
            let cursor_ok = moved && error.map(|d| d <= 2.0).unwrap_or(false);

            println!(
                "  {name:<14} ({px:>6}, {py:>6})  display {landed:?}  overlay {}  cursor {} err {:?}",
                if overlay_ok { "ok" } else { "FAIL" },
                if cursor_ok { "ok" } else { "FAIL" },
                error.map(|e| (e * 10.0).round() / 10.0),
            );
            rows.push((
                format!("display {} {name}", display.display_id),
                on_right_display && overlay_ok && cursor_ok,
                format!("({px}, {py}) on {landed:?} err={error:?}"),
            ));
        }
    }

    // Put the pointer back where the user left it.
    if let Some((x, y)) = start_cursor {
        let _ = crate::capabilities::input::set_cursor_position(x, y);
    }
    native_overlay::hide_highlight();
    native_overlay::hide_pointer();

    println!("\n{}", "-".repeat(84));
    let failed = rows.iter().filter(|(_, p, _)| !p).count();
    for (name, pass, note) in &rows {
        if !pass {
            println!("FAIL  {name}  {note}");
        }
    }
    println!("{}/{} probes passed", rows.len() - failed, rows.len());
    println!("{}\n", "=".repeat(84));

    assert!(!rows.is_empty(), "no displays were probed");
    assert_eq!(failed, 0, "{failed} physical probes failed");
}
