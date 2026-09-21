//! The real commands, on the real screen.
//!
//! Everything physical so far has re-implemented the production sequence rather
//! than run it: `click_test` resolves a target and then calls
//! `input::set_cursor_position` and `input::click_at_point` by hand, and
//! `native_backend_test` calls `NativeSideEffects` directly. Both skip
//! `execute_visual_target` entirely — and with it the profile gate, the
//! correction, the freshness check, the ownership re-check and the verifier.
//! A green result there says nothing about whether the command a user's words
//! actually reach still works.
//!
//! So this calls the `#[tauri::command]` functions themselves, on a Tauri app
//! built with the real configuration, against both physical monitors:
//!
//!   screen.capture  →  frame registered  →  VisualTargetRequest
//!                   →  execute_visual_target  →  a real click
//!
//! Nothing is stubbed but the window backend. The profile store is the real
//! one on disk and is only ever read.
//!
//! Only ArcSonare's own test window is ever clicked.
//!
//! Run:
//!   cargo test --lib visual_target_production_path -- --nocapture --ignored
//!   cargo test --lib input_click_at_production_path -- --nocapture --ignored

#![cfg(windows)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::test::{mock_builder, MockRuntime};
use tauri::{App, Manager};

use super::authority::{AuthorizedPoint, AuthorizedRect, VisualExecutionAuthority};
use super::side_effects::{DesktopPoint, MouseButton, NativeSideEffects, VisualSideEffects};

use super::verification::VisualExpectedOutcome;
use super::visual_commands::VisualTargetRequest;
use crate::capabilities::screenshots::{self, CaptureArgs};
use crate::visual_test_target as target;

/// Ask the loader for Common Controls v6, the way the shipped executable does.
///
/// Referencing the Tauri app builder pulls `SetWindowSubclass`, `DefSubclassProc`,
/// `RemoveWindowSubclass` and `TaskDialogIndirect` into the test binary's import
/// table. Those exist only in comctl32 **v6**, and without a manifest saying so
/// Windows binds v5.82 and the process dies at load with
/// STATUS_ENTRYPOINT_NOT_FOUND — before a single test runs.
///
/// The shipped binary gets this from the manifest `tauri-build` embeds. A
/// `cargo test` binary has no manifest, so it asks the linker directly. Confined
/// to this `#[cfg(test)]` module, so nothing about the release build changes.
#[cfg(target_env = "msvc")]
#[link_section = ".drectve"]
#[used]
static COMMON_CONTROLS_V6: [u8; 167] = *br#" /manifestdependency:"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'""#;

// ---------------------------------------------------------------------------
// Counting the real thing
// ---------------------------------------------------------------------------

/// Forwards every call to Win32 and counts it on the way through.
///
/// `RecordingSideEffects` answers identically whether production is wired up or
/// not; `NativeSideEffects` really acts but cannot be asked how many times. This
/// is both: the click that lands is the production one, and the count is exact.
struct CountingNative {
    inner: NativeSideEffects,
    cursor_moves: AtomicUsize,
    clicks: AtomicUsize,
    overlays: AtomicUsize,
    click_points: Mutex<Vec<(i32, i32)>>,
    cursor_points: Mutex<Vec<(i32, i32)>>,
}

impl CountingNative {
    fn new() -> Self {
        Self {
            inner: NativeSideEffects,
            cursor_moves: AtomicUsize::new(0),
            clicks: AtomicUsize::new(0),
            overlays: AtomicUsize::new(0),
            click_points: Mutex::new(Vec::new()),
            cursor_points: Mutex::new(Vec::new()),
        }
    }

    fn reset(&self) {
        self.cursor_moves.store(0, Ordering::SeqCst);
        self.clicks.store(0, Ordering::SeqCst);
        self.overlays.store(0, Ordering::SeqCst);
        self.click_points.lock().unwrap().clear();
        self.cursor_points.lock().unwrap().clear();
    }
}

impl VisualSideEffects for CountingNative {
    fn show_overlay(&self, rect: AuthorizedRect) -> Result<(), String> {
        self.overlays.fetch_add(1, Ordering::SeqCst);
        self.inner.show_overlay(rect)
    }
    fn hide_overlay(&self) {
        self.inner.hide_overlay();
    }
    fn move_cursor(&self, point: AuthorizedPoint) -> Result<(), String> {
        self.cursor_moves.fetch_add(1, Ordering::SeqCst);
        self.cursor_points
            .lock()
            .unwrap()
            .push((point.x(), point.y()));
        self.inner.move_cursor(point)
    }
    fn read_cursor(&self) -> Option<DesktopPoint> {
        self.inner.read_cursor()
    }
    fn click(&self, point: AuthorizedPoint, button: MouseButton) -> Result<(), String> {
        self.clicks.fetch_add(1, Ordering::SeqCst);
        self.click_points
            .lock()
            .unwrap()
            .push((point.x(), point.y()));
        self.inner.click(point, button)
    }
}

// ---------------------------------------------------------------------------
// A real app, with the real configuration
// ---------------------------------------------------------------------------

/// Build the application with the mock window backend.
///
/// The identifier comes from the real `tauri.conf.json`, so `app_config_dir`
/// and `app_data_dir` resolve to the same folders the installed build uses —
/// which is the point: the profile the gate consults is the one the wizard
/// actually wrote, not a fixture.
fn production_app() -> App<MockRuntime> {
    mock_builder()
        .manage(crate::settings::SettingsState::default())
        .manage(crate::capabilities::ApplicationIndexState::default())
        .manage(super::runtime::VisualRuntime::new())
        .build(tauri::generate_context!())
        .expect("the application must build with the mock window backend")
}

/// Where the capture command says the frame came from.
struct Frame {
    id: String,
    display_id: String,
    topology_version: String,
    bounds: (i32, i32, u32, u32),
}

/// Run the real `screen.capture` capability and read the frame it registered.
fn capture_display_via_production(
    app: &tauri::AppHandle<MockRuntime>,
    display_id: u32,
) -> Result<Frame, String> {
    let result = screenshots::capture(
        app,
        CaptureArgs {
            target: "display".into(),
            display_id: Some(display_id.to_string()),
            window_id: None,
            application_query: None,
            region: None,
            portion: None,
        },
    );
    let data = result
        .data
        .ok_or_else(|| format!("capture returned no data: {}", result.summary))?;
    let bounds = data
        .get("display_bounds")
        .ok_or("capture reported no display bounds")?;
    let num = |v: &serde_json::Value, k: &str| -> i64 {
        v.get(k).and_then(|n| n.as_i64()).unwrap_or_default()
    };
    Ok(Frame {
        id: data
            .get("frame_id")
            .and_then(|v| v.as_str())
            .ok_or("capture reported no frame id")?
            .to_string(),
        display_id: data
            .get("display_id")
            .and_then(|v| v.as_str())
            .ok_or("capture reported no display id")?
            .to_string(),
        topology_version: data
            .get("topology_version")
            .and_then(|v| v.as_str())
            .ok_or("capture reported no topology version")?
            .to_string(),
        bounds: (
            num(bounds, "x") as i32,
            num(bounds, "y") as i32,
            num(bounds, "width") as u32,
            num(bounds, "height") as u32,
        ),
    })
}

/// A desktop point, expressed the way a vision model would have answered.
///
/// The whole chain is only exercised if the request entering the command is in
/// the model's space — handing it desktop pixels would skip the mapping that is
/// under test.
fn normalized_in(frame: &Frame, x: i32, y: i32) -> (f64, f64) {
    let (bx, by, bw, bh) = frame.bounds;
    (
        (x - bx) as f64 / bw as f64 * 1000.0,
        (y - by) as f64 / bh as f64 * 1000.0,
    )
}

/// Put the pointer back where the test found it.
///
/// Even tidying up goes through an authority now — there is no other way to
/// reach the backend, which is the point of the type.
fn restore_cursor(topo: &super::topology::DisplayTopology, p: DesktopPoint) {
    let Some(d) = topo.displays.iter().find(|d| {
        p.x >= d.x && p.y >= d.y && p.x < d.x + d.width as i32 && p.y < d.y + d.height as i32
    }) else {
        return;
    };
    let authority =
        VisualExecutionAuthority::covering_for_test(d.display_id, d.x, d.y, d.width, d.height);
    let _ = NativeSideEffects.move_cursor(authority.vouch_for_test(p.x, p.y));
}

struct Row {
    name: String,
    pass: bool,
    detail: String,
}

fn report(rows: &[Row], title: &str) {
    println!("\n{}", "-".repeat(92));
    println!("{:<58}{:<8}{}", "CHECK", "RESULT", "DETAIL");
    for r in rows {
        println!(
            "{:<58}{:<8}{}",
            r.name,
            if r.pass { "PASS" } else { "FAIL" },
            r.detail
        );
    }
    let failed = rows.iter().filter(|r| !r.pass).count();
    println!("{}", "-".repeat(92));
    println!("{}/{} passed", rows.len() - failed, rows.len());
    println!("{}\n", "=".repeat(92));
    assert!(!rows.is_empty(), "{title}: nothing was checked");
    assert_eq!(failed, 0, "{title}: {failed} checks failed");
}

// ---------------------------------------------------------------------------
// Objective 1 — the whole VisualTarget path
// ---------------------------------------------------------------------------

#[test]
#[ignore = "runs the real commands, moves the pointer and clicks; run explicitly"]
fn visual_target_production_path() {
    println!("\n{}", "=".repeat(92));
    println!("VISUAL TARGET — the production command, end to end, on every monitor");
    println!("{}", "=".repeat(92));

    let app = production_app();
    let handle = app.handle().clone();
    let topo = match super::topology::read_topology() {
        Ok(t) => t,
        Err(e) => {
            println!("SKIP: no readable topology: {e}");
            return;
        }
    };
    let identities = super::identity::enumerate_monitor_identities().unwrap_or_default();

    crate::native_overlay::init();
    target::init();
    std::thread::sleep(std::time::Duration::from_millis(300));

    let counter = Arc::new(CountingNative::new());
    super::visual_commands::install_test_side_effects(counter.clone());

    let start_cursor = counter.read_cursor();
    let mut rows: Vec<Row> = Vec::new();

    for display in &topo.displays {
        let label = format!("display {}", display.display_id);
        println!("\n{}", "-".repeat(92));
        println!(
            "{label}  {}x{} at ({}, {})",
            display.width, display.height, display.x, display.y
        );
        let identity = identities
            .iter()
            .find(|i| i.x == display.x && i.y == display.y);
        println!(
            "  stable identity   {}",
            identity
                .map(|i| i.stable_key())
                .unwrap_or_else(|| "<unresolved>".into())
        );

        target::reset();
        let state =
            match target::show_centered_on(display.x, display.y, display.width, display.height) {
                Ok(s) => s,
                Err(e) => {
                    rows.push(Row {
                        name: format!("{label}: test window opens"),
                        pass: false,
                        detail: e,
                    });
                    continue;
                }
            };
        let Some(button) = state.button else {
            rows.push(Row {
                name: format!("{label}: test window reports its button"),
                pass: false,
                detail: "no button rectangle".into(),
            });
            target::hide();
            continue;
        };
        // Let the window finish painting before it is photographed, or the
        // freshness check compares a half-drawn frame against a finished one.
        std::thread::sleep(std::time::Duration::from_millis(350));

        let frame = match capture_display_via_production(&handle, display.display_id) {
            Ok(f) => f,
            Err(e) => {
                rows.push(Row {
                    name: format!("{label}: screen.capture registers a frame"),
                    pass: false,
                    detail: e,
                });
                target::hide();
                continue;
            }
        };
        rows.push(Row {
            name: format!("{label}: screen.capture registers a frame"),
            pass: frame.display_id == display.display_id.to_string(),
            detail: format!("{} on display {}", frame.id, frame.display_id),
        });

        let centre = (button.x + button.width / 2, button.y + button.height / 2);
        let (nx, ny) = normalized_in(&frame, centre.0, centre.1);

        println!("  frame_id          {}", frame.id);
        println!("  topology_version  {}", frame.topology_version);
        println!(
            "  button centre     ({}, {})  virtual-desktop physical",
            centre.0, centre.1
        );
        println!("  as the model saw it ({nx:.1}, {ny:.1}) of 1000");

        let request = VisualTargetRequest {
            frame_id: frame.id.clone(),
            display_id: frame.display_id.clone(),
            topology_version: frame.topology_version.clone(),
            x: nx,
            y: ny,
            normalized_max: 1000.0,
            box_x: Some(normalized_in(&frame, button.x, button.y).0),
            box_y: Some(normalized_in(&frame, button.x, button.y).1),
            box_width: Some(button.width as f64 / frame.bounds.2 as f64 * 1000.0),
            box_height: Some(button.height as f64 / frame.bounds.3 as f64 * 1000.0),
            confidence: Some(0.99),
            label: Some("ArcSonare test button".into()),
            correlation_id: Some(format!("production-path-{}", display.display_id)),
            // The one verifier that can be certain rather than confident.
            expected_outcome: Some(VisualExpectedOutcome::TestTargetClicked {
                expected_increment: 1,
            }),
            skip_freshness: false,
        };

        counter.reset();
        let clicks_before = target::state().clicks;

        let outcome = super::visual_commands::execute_visual_target(
            handle.clone(),
            handle.state::<super::runtime::VisualRuntime>(),
            request,
            Some("left".into()),
        );
        // The test window's message loop runs on its own thread.
        std::thread::sleep(std::time::Duration::from_millis(300));
        let clicks_after = target::state().clicks;

        let cursor_moves = counter.cursor_moves.load(Ordering::SeqCst);
        let click_calls = counter.clicks.load(Ordering::SeqCst);
        let click_points = counter.click_points.lock().unwrap().clone();

        match outcome {
            Ok(result) => {
                let cursor = result.cursor.as_ref();
                println!("  resolved point    {:?}", result.point);
                println!(
                    "  correction        {}",
                    if result.point == centre {
                        "identity (no shift)".to_string()
                    } else {
                        format!(
                            "applied: {:+}, {:+} px",
                            result.point.0 - centre.0,
                            result.point.1 - centre.1
                        )
                    }
                );
                println!(
                    "  freshness         {}",
                    result
                        .freshness
                        .as_ref()
                        .map(|f| format!("fresh={} score={:.3}", f.is_fresh, f.similarity_score))
                        .unwrap_or_else(|| "skipped".into())
                );
                println!(
                    "  cursor            requested {:?}  actual {:?}  error {:.2} px",
                    cursor.map(|c| c.requested),
                    cursor.and_then(|c| c.actual),
                    cursor.and_then(|c| c.error_distance_px).unwrap_or(-1.0)
                );
                println!("  native move calls {cursor_moves}");
                println!("  native click calls {click_calls}  at {click_points:?}");
                println!("  clicks            {clicks_before} -> {clicks_after}");
                println!("  status            {:?}", result.status);
                println!("  summary           {}", result.summary);

                let on_button = result.point.0 >= button.x
                    && result.point.0 < button.x + button.width
                    && result.point.1 >= button.y
                    && result.point.1 < button.y + button.height;
                rows.push(Row {
                    name: format!("{label}: resolved point lands on the button"),
                    pass: on_button,
                    detail: format!(
                        "{:?} in {:?}",
                        result.point,
                        (button.x, button.y, button.width, button.height)
                    ),
                });
                rows.push(Row {
                    name: format!("{label}: frame ownership preserved"),
                    pass: result.frame_id == frame.id && result.display_id == display.display_id,
                    detail: format!("{} / display {}", result.frame_id, result.display_id),
                });
                rows.push(Row {
                    name: format!("{label}: screen read as fresh"),
                    pass: result
                        .freshness
                        .as_ref()
                        .map(|f| f.is_fresh)
                        .unwrap_or(false),
                    detail: result
                        .freshness
                        .as_ref()
                        .map(|f| format!("{:.3}", f.similarity_score))
                        .unwrap_or_else(|| "no freshness result".into()),
                });
                rows.push(Row {
                    name: format!("{label}: cursor arrived where it was sent"),
                    pass: cursor.map(|c| c.success).unwrap_or(false),
                    detail: format!(
                        "{:.2} px",
                        cursor.and_then(|c| c.error_distance_px).unwrap_or(-1.0)
                    ),
                });
                rows.push(Row {
                    name: format!("{label}: exactly one native cursor move"),
                    pass: cursor_moves == 1,
                    detail: format!("{cursor_moves}"),
                });
                rows.push(Row {
                    name: format!("{label}: exactly one native click"),
                    pass: click_calls == 1,
                    detail: format!("{click_calls} at {click_points:?}"),
                });
                rows.push(Row {
                    name: format!("{label}: counter increments by exactly one"),
                    pass: clicks_after == clicks_before + 1,
                    detail: format!("{clicks_before} -> {clicks_after}"),
                });
                rows.push(Row {
                    name: format!("{label}: production verifier confirmed it"),
                    pass: matches!(
                        result.status,
                        super::visual_commands::VisualAttemptStatus::VerifiedSucceeded
                    ),
                    detail: format!("{:?}", result.status),
                });
                rows.push(Row {
                    name: format!("{label}: nothing landed off-target"),
                    pass: target::state().off_target_clicks == 0,
                    detail: format!("{} off-target", target::state().off_target_clicks),
                });
                if display.x < 0 || display.y < 0 {
                    rows.push(Row {
                        name: format!("{label}: negative origin preserved"),
                        pass: result.point.0 < 0 || result.point.1 < 0,
                        detail: format!(
                            "{:?} on a display at ({}, {})",
                            result.point, display.x, display.y
                        ),
                    });
                }
            }
            Err(e) => {
                println!("  REFUSED           {} — {}", e.code, e.message);
                println!("  native move calls {cursor_moves}");
                println!("  native click calls {click_calls}");
                rows.push(Row {
                    name: format!("{label}: execute_visual_target succeeds"),
                    pass: false,
                    detail: format!("{}: {}", e.code, e.message),
                });
                rows.push(Row {
                    name: format!("{label}: a refusal reached no native input"),
                    pass: cursor_moves == 0 && click_calls == 0 && clicks_after == clicks_before,
                    detail: format!("{cursor_moves} moves, {click_calls} clicks"),
                });
            }
        }

        target::hide();
        target::reset();
        std::thread::sleep(std::time::Duration::from_millis(150));
    }

    super::visual_commands::clear_test_side_effects();
    if let Some(p) = start_cursor {
        restore_cursor(&topo, p);
    }
    crate::native_overlay::hide_highlight();
    crate::native_overlay::hide_pointer();
    target::hide();

    report(&rows, "visual target production path");
}

// ---------------------------------------------------------------------------
// Objective 2 — the public input.click_at capability
// ---------------------------------------------------------------------------

/// The capability as the planner reaches it: JSON in, schema deserialisation,
/// gate, native input.
///
/// Calling the Rust helper directly would skip `deny_unknown_fields`, the
/// mandatory coordinate space and the enum check — the three things that make
/// a forged call fail — so the arguments go in as a `serde_json::Value`.
fn run_click_at(
    app: &tauri::AppHandle<MockRuntime>,
    args: serde_json::Value,
) -> crate::capabilities::types::ToolResult {
    let parsed: Result<crate::capabilities::input::ClickAtArgs, _> = serde_json::from_value(args);
    match parsed {
        Ok(a) => crate::capabilities::input::click_at(app, a),
        Err(e) => crate::capabilities::types::ResultBuilder::new("input.click_at").error(
            "invalid-arguments",
            format!("{e}"),
            false,
        ),
    }
}

#[test]
#[ignore = "moves the pointer and clicks ArcSonare's own test window; run explicitly"]
fn input_click_at_production_path() {
    println!("\n{}", "=".repeat(92));
    println!("input.click_at — the public capability, through its real schema");
    println!("{}", "=".repeat(92));

    let app = production_app();
    let handle = app.handle().clone();
    let topo = match super::topology::read_topology() {
        Ok(t) => t,
        Err(e) => {
            println!("SKIP: no readable topology: {e}");
            return;
        }
    };
    target::init();
    crate::native_overlay::init();
    std::thread::sleep(std::time::Duration::from_millis(300));

    let start_cursor = NativeSideEffects.read_cursor();
    let mut rows: Vec<Row> = Vec::new();

    // -- positive path, on every monitor ------------------------------------
    for display in &topo.displays {
        let label = format!("display {}", display.display_id);
        target::reset();
        let Ok(state) =
            target::show_centered_on(display.x, display.y, display.width, display.height)
        else {
            rows.push(Row {
                name: format!("{label}: test window opens"),
                pass: false,
                detail: "could not show the test window".into(),
            });
            continue;
        };
        let Some(button) = state.button else {
            rows.push(Row {
                name: format!("{label}: test window reports its button"),
                pass: false,
                detail: "no button rectangle".into(),
            });
            target::hide();
            continue;
        };
        std::thread::sleep(std::time::Duration::from_millis(250));

        let (x, y) = (button.x + button.width / 2, button.y + button.height / 2);
        let before = target::state().clicks;
        let result = run_click_at(
            &handle,
            json!({
                "x": x,
                "y": y,
                "coordinate_space": "physical-virtual-desktop",
                "button": "left"
            }),
        );
        std::thread::sleep(std::time::Duration::from_millis(300));
        let after = target::state().clicks;

        println!("\n{label}");
        println!("  point             ({x}, {y})  physical-virtual-desktop");
        println!("  status            {:?}", result.status);
        println!("  summary           {}", result.summary);
        println!("  clicks            {before} -> {after}");

        rows.push(Row {
            name: format!("{label}: input.click_at succeeds"),
            pass: matches!(
                result.status,
                crate::capabilities::types::ToolResultStatus::Success
            ),
            detail: result
                .error
                .as_ref()
                .map(|e| format!("{}: {}", e.code, e.message))
                .unwrap_or_else(|| result.summary.clone()),
        });
        rows.push(Row {
            name: format!("{label}: counter increments by exactly one"),
            pass: after == before + 1,
            detail: format!("{before} -> {after}"),
        });
        rows.push(Row {
            name: format!("{label}: nothing landed off-target"),
            pass: target::state().off_target_clicks == 0,
            detail: format!("{} off-target", target::state().off_target_clicks),
        });

        target::hide();
        target::reset();
        std::thread::sleep(std::time::Duration::from_millis(150));
    }

    // -- a call with no coordinate space is not a call ----------------------
    let cursor_before = NativeSideEffects.read_cursor();
    let clicks_before = target::state().clicks;
    let no_space = run_click_at(&handle, json!({ "x": 100, "y": 100, "button": "left" }));
    std::thread::sleep(std::time::Duration::from_millis(150));

    println!("\nmissing coordinate_space");
    println!("  status            {:?}", no_space.status);
    println!(
        "  error             {}",
        no_space
            .error
            .as_ref()
            .map(|e| e.code.clone())
            .unwrap_or_default()
    );
    rows.push(Row {
        name: "a request without coordinate_space is rejected".into(),
        pass: matches!(
            no_space.status,
            crate::capabilities::types::ToolResultStatus::Error
        ),
        detail: format!("{:?}", no_space.status),
    });
    rows.push(Row {
        name: "the rejected request reached no native input".into(),
        pass: NativeSideEffects.read_cursor() == cursor_before
            && target::state().clicks == clicks_before,
        detail: format!("cursor {cursor_before:?}, clicks {clicks_before}"),
    });

    // -- a point on no monitor -----------------------------------------------
    let cursor_before = NativeSideEffects.read_cursor();
    let clicks_before = target::state().clicks;
    let outside = run_click_at(
        &handle,
        json!({
            "x": 100_000,
            "y": 100_000,
            "coordinate_space": "physical-virtual-desktop",
            "button": "left"
        }),
    );
    std::thread::sleep(std::time::Duration::from_millis(150));

    println!("\noutside every display (100000, 100000)");
    println!("  status            {:?}", outside.status);
    println!(
        "  error             {}",
        outside
            .error
            .as_ref()
            .map(|e| e.code.clone())
            .unwrap_or_default()
    );
    rows.push(Row {
        name: "a point on no display is refused".into(),
        pass: matches!(
            outside.status,
            crate::capabilities::types::ToolResultStatus::Error
        ),
        detail: outside
            .error
            .as_ref()
            .map(|e| e.code.clone())
            .unwrap_or_else(|| "no error code".into()),
    });
    rows.push(Row {
        name: "the refused point reached no native input".into(),
        pass: NativeSideEffects.read_cursor() == cursor_before
            && target::state().clicks == clicks_before,
        detail: format!(
            "cursor {cursor_before:?} -> {:?}, clicks {clicks_before} -> {}",
            NativeSideEffects.read_cursor(),
            target::state().clicks
        ),
    });

    target::hide();
    target::reset();
    if let Some(p) = start_cursor {
        restore_cursor(&topo, p);
    }

    report(&rows, "input.click_at production path");
}
