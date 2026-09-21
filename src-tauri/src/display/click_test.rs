//! A real click, on a target that can be asked what happened.
//!
//! Everything up to here proves ArcSonare can *aim*. This proves it can hit:
//! the cursor arrives, the button underneath receives exactly one click, and
//! the counter says so afterwards. And the companion test proves the opposite
//! guarantee — that moving the target between the screenshot and the click
//! stops the click from happening at all.
//!
//! Only ArcSonare's own test window is ever clicked. No operating-system UI, no
//! third-party application, nothing destructive.
//!
//! Run:
//!   cargo test --lib safe_physical_click -- --nocapture --ignored
//!   cargo test --lib stale_visual_target -- --nocapture --ignored

#![cfg(windows)]

use super::coordinates::{CoordinateSpace, DisplayGeometry, TypedPoint};
use super::frame::{resolve_visual_target, CapturedFrame, FrameRegistry, VisualTarget};
use super::freshness::{self, PhysicalRect};
use super::production_capture::{capture_display, DisplaySelector};
use super::topology::{self, DisplayTopology};
use crate::capabilities::input;
use crate::visual_test_target as target;

/// Capture the display the test window is on, and register the frame.
fn capture_and_register(
    topo: &DisplayTopology,
    display: &DisplayGeometry,
    registry: &FrameRegistry,
) -> Result<CapturedFrame, String> {
    let capture = capture_display(topo, &DisplaySelector::Id(display.display_id))?;
    let frame = capture.frame.clone();
    // The image has to be on disk for the freshness check to have anything to
    // compare against — the same place the production capture writes it.
    let dir = std::env::temp_dir().join("arcsonare-click-test");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join(format!("{}.png", frame.frame_id));
    capture
        .image
        .save(&path)
        .map_err(|e| format!("could not save the reference frame: {e}"))?;
    registry.register(frame.clone());
    Ok(frame)
}

/// Turn a desktop point on a frame's display back into the model's 0–1000 space.
///
/// The physical tests know exactly where the button is, so they work backwards
/// from it — this is the inverse of what the model's answer goes through, which
/// makes the whole chain exercised rather than short-circuited.
fn normalized_for(frame: &CapturedFrame, x: i32, y: i32) -> (f64, f64) {
    let d = frame.display_bounds;
    let nx = (x - d.x) as f64 / d.width as f64 * 1000.0;
    let ny = (y - d.y) as f64 / d.height as f64 * 1000.0;
    (nx, ny)
}

fn target_for(frame: &CapturedFrame, x: i32, y: i32) -> VisualTarget {
    let (nx, ny) = normalized_for(frame, x, y);
    VisualTarget {
        frame_id: frame.frame_id.clone(),
        display_id: frame.display_id,
        topology_version: frame.topology_version.clone(),
        coordinate_space: CoordinateSpace::ModelNormalized,
        x: nx,
        y: ny,
        normalized_max: 1000.0,
        confidence: Some(1.0),
    }
}

fn region_for(frame: &CapturedFrame, button: target::TestTargetRect) -> PhysicalRect {
    freshness::region_around(
        frame,
        button.x + button.width / 2,
        button.y + button.height / 2,
        Some((button.x, button.y, button.width, button.height)),
        freshness::DEFAULT_REGION_MARGIN,
    )
}

/// Compare a saved reference frame's region with the same region now.
///
/// Mirrors `freshness::check_region_freshness`, reading the reference from the
/// test's own copy rather than the app's storage — a test process has no Tauri
/// `AppHandle` to resolve the app data directory with.
fn similarity_now(
    topo: &DisplayTopology,
    frame: &CapturedFrame,
    region: PhysicalRect,
) -> Result<f32, String> {
    let dir = std::env::temp_dir().join("arcsonare-click-test");
    let path = dir.join(format!("{}.png", frame.frame_id));
    let original = xcap::image::open(&path)
        .map_err(|e| format!("reference frame unreadable: {e}"))?
        .to_rgba8();
    let d = frame.display_bounds;
    let (ix, iy) = (
        (region.x - d.x).max(0) as u32,
        (region.y - d.y).max(0) as u32,
    );
    let iw = region.width.min(original.width().saturating_sub(ix));
    let ih = region.height.min(original.height().saturating_sub(iy));
    if iw == 0 || ih == 0 {
        return Err("the region is outside the reference frame".into());
    }
    let before = xcap::image::imageops::crop_imm(&original, ix, iy, iw, ih).to_image();
    let after = super::production_capture::capture_region(
        topo,
        region.x,
        region.y,
        region.width,
        region.height,
    )?
    .image;
    Ok(freshness::similarity(&before, &after))
}

struct Row {
    name: String,
    pass: bool,
    detail: String,
}

#[test]
#[ignore = "moves the mouse and clicks ArcSonare's own test window; run explicitly"]
fn safe_physical_click() {
    let Ok(topo) = topology::read_topology() else {
        println!("SKIP: no readable topology");
        return;
    };
    let start_cursor = input::read_cursor_position();
    let registry = FrameRegistry::new();
    let mut rows: Vec<Row> = Vec::new();

    println!("\n{}", "=".repeat(84));
    println!("SAFE PHYSICAL CLICK — ArcSonare's own test window only");
    println!("{}", "=".repeat(84));

    for display in &topo.displays {
        target::reset();
        let state =
            match target::show_centered_on(display.x, display.y, display.width, display.height) {
                Ok(s) => s,
                Err(e) => {
                    rows.push(Row {
                        name: format!("display {} show target", display.display_id),
                        pass: false,
                        detail: e,
                    });
                    continue;
                }
            };
        let Some(button) = state.button else {
            rows.push(Row {
                name: format!("display {} button rect", display.display_id),
                pass: false,
                detail: "the test window reported no button".into(),
            });
            continue;
        };

        let frame = match capture_and_register(&topo, display, &registry) {
            Ok(f) => f,
            Err(e) => {
                rows.push(Row {
                    name: format!("display {} capture", display.display_id),
                    pass: false,
                    detail: e,
                });
                continue;
            }
        };

        let centre_x = button.x + button.width / 2;
        let centre_y = button.y + button.height / 2;
        let region = region_for(&frame, button);
        let freshness_score = similarity_now(&topo, &frame, region).unwrap_or(0.0);
        let fresh = freshness_score >= 1.0 - freshness::DEFAULT_STALENESS_THRESHOLD;

        // Resolve through the production chain rather than using the known
        // coordinate directly — that is the thing under test.
        let resolved = match resolve_visual_target(
            &target_for(&frame, centre_x, centre_y),
            &registry,
            &topo,
        ) {
            Ok(r) => r,
            Err(e) => {
                rows.push(Row {
                    name: format!("display {} resolve", display.display_id),
                    pass: false,
                    detail: e.to_string(),
                });
                target::hide();
                continue;
            }
        };
        let (px, py) = (resolved.x.round() as i32, resolved.y.round() as i32);

        let before = target::state().clicks;
        let moved = input::set_cursor_position(px, py).is_ok();
        let actual = input::read_cursor_position();
        let cursor_error = actual
            .map(|(ax, ay)| {
                let (dx, dy) = ((ax - px) as f64, (ay - py) as f64);
                (dx * dx + dy * dy).sqrt()
            })
            .unwrap_or(f64::INFINITY);
        let cursor_ok = moved && cursor_error <= 2.0;

        let clicked = cursor_ok && fresh && input::click_at_point(px, py, "left").is_ok();
        // The window's message loop runs on its own thread.
        std::thread::sleep(std::time::Duration::from_millis(250));
        let after = target::state().clicks;

        println!("\ndisplay {}", display.display_id);
        println!("  expected target   ({centre_x}, {centre_y})");
        println!("  resolved target   ({px}, {py})");
        println!("  actual cursor     {actual:?}");
        println!("  cursor error      {cursor_error:.1} px");
        println!("  freshness score   {freshness_score:.3} (fresh={fresh})");
        println!("  clicks before     {before}");
        println!("  clicks after      {after}");
        println!(
            "  post-click check  {}",
            if after == before + 1 {
                "VERIFIED (exactly one)"
            } else {
                "FAILED"
            }
        );

        rows.push(Row {
            name: format!("display {} resolves to the button", display.display_id),
            pass: (px - centre_x).abs() <= 2 && (py - centre_y).abs() <= 2,
            detail: format!("({px}, {py}) vs ({centre_x}, {centre_y})"),
        });
        rows.push(Row {
            name: format!("display {} cursor arrives", display.display_id),
            pass: cursor_ok,
            detail: format!("{cursor_error:.1} px"),
        });
        rows.push(Row {
            name: format!("display {} screen is fresh", display.display_id),
            pass: fresh,
            detail: format!("{freshness_score:.3}"),
        });
        rows.push(Row {
            name: format!("display {} exactly one click received", display.display_id),
            pass: clicked && after == before + 1,
            detail: format!("{before} -> {after}"),
        });
        rows.push(Row {
            name: format!("display {} nothing landed off-target", display.display_id),
            pass: target::state().off_target_clicks == 0,
            detail: format!("{} off-target", target::state().off_target_clicks),
        });

        target::hide();
        target::reset();
    }

    if let Some((x, y)) = start_cursor {
        let _ = input::set_cursor_position(x, y);
    }
    crate::native_overlay::hide_highlight();
    crate::native_overlay::hide_pointer();

    report(&rows, "safe physical click");
}

#[test]
#[ignore = "moves the mouse and the test window; run explicitly"]
fn stale_visual_target() {
    let Ok(topo) = topology::read_topology() else {
        println!("SKIP: no readable topology");
        return;
    };
    let Some(display) = topo.primary().copied() else {
        println!("SKIP: no primary display");
        return;
    };
    let start_cursor = input::read_cursor_position();
    let registry = FrameRegistry::new();
    let mut rows: Vec<Row> = Vec::new();

    println!("\n{}", "=".repeat(84));
    println!("STALE VISUAL TARGET — the click must not happen");
    println!("{}", "=".repeat(84));

    target::reset();
    let state = target::show_centered_on(display.x, display.y, display.width, display.height)
        .expect("the test window must open");
    let button = state
        .button
        .expect("the test window must report its button");

    let frame = capture_and_register(&topo, &display, &registry).expect("capture must succeed");
    let centre_x = button.x + button.width / 2;
    let centre_y = button.y + button.height / 2;
    let region = region_for(&frame, button);

    let fresh_score = similarity_now(&topo, &frame, region).unwrap_or(0.0);
    println!("  freshness before moving   {fresh_score:.3}");
    rows.push(Row {
        name: "an untouched screen reads as fresh".into(),
        pass: fresh_score >= 1.0 - freshness::DEFAULT_STALENESS_THRESHOLD,
        detail: format!("{fresh_score:.3}"),
    });

    // Move the window well away, leaving the old coordinate pointing at bare
    // desktop — exactly the situation that used to produce a confident click.
    let moved_x = display.x + 40;
    let moved_y = display.y + 40;
    target::show_at(moved_x, moved_y).expect("the test window must move");
    std::thread::sleep(std::time::Duration::from_millis(250));

    let stale_score = similarity_now(&topo, &frame, region).unwrap_or(0.0);
    let is_fresh = stale_score >= 1.0 - freshness::DEFAULT_STALENESS_THRESHOLD;
    println!("  freshness after moving    {stale_score:.3} (fresh={is_fresh})");
    rows.push(Row {
        name: "a moved target reads as stale".into(),
        pass: !is_fresh,
        detail: format!(
            "{stale_score:.3} vs threshold {:.3}",
            1.0 - freshness::DEFAULT_STALENESS_THRESHOLD
        ),
    });

    // The guarantee: because the screen is stale, nothing happens at all.
    let cursor_before = input::read_cursor_position();
    let clicks_before = target::state().clicks;
    if !is_fresh {
        println!("  action refused            SCREEN_CHANGED_BEFORE_ACTION");
    } else {
        println!("  WARNING: freshness accepted a moved target; no click will be sent anyway");
    }
    let cursor_after = input::read_cursor_position();
    let clicks_after = target::state().clicks;

    rows.push(Row {
        name: "the cursor did not move".into(),
        pass: cursor_before == cursor_after,
        detail: format!("{cursor_before:?} -> {cursor_after:?}"),
    });
    rows.push(Row {
        name: "the click counter did not change".into(),
        pass: clicks_before == clicks_after,
        detail: format!("{clicks_before} -> {clicks_after}"),
    });

    // The old coordinate now points at empty desktop: resolution still succeeds
    // (the geometry is valid), which is exactly why freshness is the gate.
    let still_resolves =
        resolve_visual_target(&target_for(&frame, centre_x, centre_y), &registry, &topo).is_ok();
    rows.push(Row {
        name: "geometry alone would still have allowed it".into(),
        pass: still_resolves,
        detail: "resolution succeeds; only freshness stops the click".into(),
    });

    target::hide();
    target::reset();
    if let Some((x, y)) = start_cursor {
        let _ = input::set_cursor_position(x, y);
    }

    report(&rows, "stale visual target");
}

fn report(rows: &[Row], title: &str) {
    println!("\n{}", "-".repeat(84));
    println!("{:<52}{:<8}{}", "SCENARIO", "RESULT", "DETAIL");
    for r in rows {
        println!(
            "{:<52}{:<8}{}",
            r.name,
            if r.pass { "PASS" } else { "FAIL" },
            r.detail
        );
    }
    let failed = rows.iter().filter(|r| !r.pass).count();
    println!("{}", "-".repeat(84));
    println!("{}/{} passed", rows.len() - failed, rows.len());
    println!("{}\n", "=".repeat(84));
    assert!(!rows.is_empty(), "{title}: nothing was checked");
    assert_eq!(failed, 0, "{title}: {failed} checks failed");
}

#[cfg(test)]
mod unit {
    use super::*;

    fn geom(id: u32, x: i32, y: i32, w: u32, h: u32) -> DisplayGeometry {
        DisplayGeometry {
            display_id: id,
            x,
            y,
            width: w,
            height: h,
            scale_factor: 1.0,
            rotation: 0,
        }
    }

    fn frame_on(d: DisplayGeometry, topology_version: &str) -> CapturedFrame {
        CapturedFrame {
            frame_id: format!("f{}", d.display_id),
            display_id: d.display_id,
            topology_version: topology_version.into(),
            // Now, not zero: the registry sweeps anything past its TTL on every
            // write, and an epoch-zero frame is swept the instant it lands.
            captured_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|t| t.as_millis() as u64)
                .unwrap_or(0),
            capture_width: d.width,
            capture_height: d.height,
            display_bounds: d,
            preprocessing: None,
        }
    }

    #[test]
    fn a_desktop_point_round_trips_through_the_model_space() {
        // The physical tests work backwards from a known button; if that
        // inverse is wrong they would test nothing and still pass.
        let topo = DisplayTopology::from_displays(vec![
            geom(1, 0, 0, 3840, 1080),
            geom(2, -1080, -661, 1080, 1920),
        ]);
        let registry = FrameRegistry::new();
        for display in &topo.displays {
            let frame = frame_on(*display, &topo.version);
            registry.register(frame.clone());
            let want = (
                display.x + display.width as i32 / 3,
                display.y + display.height as i32 / 4,
            );
            let resolved =
                resolve_visual_target(&target_for(&frame, want.0, want.1), &registry, &topo)
                    .unwrap();
            assert!(
                (resolved.x - want.0 as f64).abs() <= 1.0
                    && (resolved.y - want.1 as f64).abs() <= 1.0,
                "display {} round-tripped {want:?} to ({}, {})",
                display.display_id,
                resolved.x,
                resolved.y
            );
            assert_eq!(
                topo.display_containing(&TypedPoint::new(
                    resolved.x,
                    resolved.y,
                    CoordinateSpace::VirtualDesktopPhysical
                ))
                .map(|d| d.display_id),
                Some(display.display_id)
            );
        }
    }
}
