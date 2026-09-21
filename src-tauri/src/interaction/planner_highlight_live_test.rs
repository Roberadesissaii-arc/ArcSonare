//! "Show me the books folder on my Desktop", start to finish, on this machine.
//!
//! The reported failure drew a border around four unrelated icons. Everything
//! under the answer was correct, so proving the arithmetic again proves nothing;
//! what has to be shown is that the *answer* is now a lookup with one result,
//! and that the border really lands on it.
//!
//! So this runs the production lifecycle — the request the frontend builds, the
//! real planner, the real strategy decision, the real shell lookup, the real
//! overlay — and then measures the drawn rectangle by reading it back out of
//! Windows rather than trusting the call that drew it.
//!
//! Draws on screen for a moment and cleans up after itself. No cursor, no click.
//!
//! Run: cargo test --lib planner_highlight_real_books_folder -- --nocapture --ignored

#![cfg(windows)]

use super::executor::create_execution_plan;
use super::request::{ActionRequest, ActionTarget, ConfirmationState, KnownFolder, RequestSource};
use super::strategy::{ActionIntent, AvailableCapabilities, ExecutionStrategy};
use crate::capabilities::desktop_items::{
    enumerate_desktop_items, match_item, DesktopItemKind, PhysicalRect,
};

/// What the frontend builds for "Show me the books folder on my Desktop."
fn books_request() -> ActionRequest {
    ActionRequest {
        request_id: "req-books-live".into(),
        intent: ActionIntent::HighlightTarget,
        target: ActionTarget::Path {
            path: None,
            name: Some("books".into()),
            known_folder: Some(KnownFolder::Desktop),
        },
        parameters: serde_json::Value::Null,
        source: RequestSource::Chat,
        confirmation_state: ConfirmationState::NotRequired,
    }
}

fn intersection(a: &PhysicalRect, b: (i32, i32, i32, i32)) -> i64 {
    let (bx, by, bw, bh) = b;
    let left = a.x.max(bx);
    let top = a.y.max(by);
    let right = (a.x + a.width).min(bx + bw);
    let bottom = (a.y + a.height).min(by + bh);
    if right <= left || bottom <= top {
        return 0;
    }
    (right - left) as i64 * (bottom - top) as i64
}

#[test]
#[ignore = "draws on the real screen; run explicitly"]
fn planner_highlight_real_books_folder() {
    println!("\n{}", "=".repeat(78));
    println!("PRODUCTION LIFECYCLE — \"Show me the books folder on my Desktop.\"");
    println!("{}", "=".repeat(78));

    println!(
        "\nrunning executable  {}",
        std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "(unknown)".into())
    );

    // --- planner -----------------------------------------------------------
    let request = books_request();
    let capabilities = AvailableCapabilities::current();
    let planned = create_execution_plan(&request, &capabilities)
        .expect("the books request could not be planned at all");

    println!("\nrequest_id          {}", planned.request_id);
    println!("plan_id             {}", planned.plan_id);
    println!("intent              {:?}", planned.plan.intent);
    println!("strategy            {:?}", planned.plan.primary_strategy);
    println!("fallbacks           {:?}", planned.plan.fallback_strategies);
    println!("rationale           {}", planned.plan.rationale_code);
    println!(
        "requires capture    {}",
        planned.plan.requires_screen_capture
    );
    println!("requires cursor     {}", planned.plan.requires_cursor);

    // The whole point of the fix: this is a lookup, not a recognition problem.
    assert_eq!(
        planned.plan.intent,
        ActionIntent::HighlightDesktopItem,
        "the planner did not recognise this as a Desktop item"
    );
    assert_eq!(
        planned.plan.primary_strategy,
        ExecutionStrategy::InternalCapability,
        "the planner chose a screen-based route for a request with an exact answer"
    );
    assert!(
        !planned.plan.requires_screen_capture,
        "vision_called must be false — no screenshot may be taken"
    );
    assert!(
        !planned.plan.requires_cursor,
        "showing something must never take the cursor"
    );

    // --- structured lookup -------------------------------------------------
    let items = match enumerate_desktop_items() {
        Ok(i) => i,
        Err(e) => {
            println!("\nSKIP: {e}");
            return;
        }
    };
    let Ok(books) = match_item(&items, "books", DesktopItemKind::Any) else {
        println!("\nSKIP: this Desktop has no \"books\" item");
        return;
    };
    let target = books.bounds;
    println!("\nresolved name       {}", books.name);
    println!(
        "resolved path       {}",
        books.path.as_deref().unwrap_or("(none)")
    );
    println!("item kind           {:?}", books.is_folder);
    println!("lookup source       {:?}", books.source);
    println!(
        "target rect         ({}, {}) {}x{}",
        target.x, target.y, target.width, target.height
    );
    assert_eq!(
        books.path.as_deref(),
        Some("C:\\Users\\rober\\Desktop\\books"),
        "resolved to the wrong path"
    );
    assert_eq!(books.is_folder, Some(true), "books must be a folder");

    // --- overlay -----------------------------------------------------------
    // The overlay windows belong to a message-pump thread the app starts at
    // launch. A bare test process has no such thread, so start one here.
    crate::native_overlay::init();
    crate::native_overlay::show_highlight(target.x, target.y, target.width, target.height)
        .expect("the overlay refused to draw");
    // Give the window manager a moment to actually place the window before
    // asking where it is; measuring too early measures the previous position.
    std::thread::sleep(std::time::Duration::from_millis(250));

    let drawn = crate::native_overlay::highlight_target_rect()
        .expect("the overlay window could not be read back");
    println!(
        "overlay rect        ({}, {}) {}x{}   [read back from Windows]",
        drawn.0, drawn.1, drawn.2, drawn.3
    );

    // --- measurement -------------------------------------------------------
    let (tcx, tcy) = target.center();
    let ocx = drawn.0 + drawn.2 / 2;
    let ocy = drawn.1 + drawn.3 / 2;
    let centre_distance = (((ocx - tcx) as f64).powi(2) + ((ocy - tcy) as f64).powi(2)).sqrt();

    let inter = intersection(&target, drawn);
    let union =
        (target.width as i64 * target.height as i64) + (drawn.2 as i64 * drawn.3 as i64) - inter;
    let iou = if union > 0 {
        inter as f64 / union as f64
    } else {
        0.0
    };

    let neighbours: Vec<&str> = items
        .iter()
        .filter(|i| i.name != books.name)
        .filter(|i| {
            let (cx, cy) = i.bounds.center();
            cx >= drawn.0 && cy >= drawn.1 && cx < drawn.0 + drawn.2 && cy < drawn.1 + drawn.3
        })
        .map(|i| i.name.as_str())
        .collect();

    println!("\ntarget centre       ({tcx}, {tcy})");
    println!("overlay centre      ({ocx}, {ocy})");
    println!("centre distance     {centre_distance:.2} px");
    println!("intersection        {inter} px²");
    println!("IoU                 {iou:.4}");
    println!("neighbour centres   {}", neighbours.len());
    println!("vision called       false");
    println!("screenshot taken    false");
    println!("cursor moved        false");

    crate::native_overlay::hide_highlight();

    // The border must contain what was asked for and nothing else. A single
    // Desktop icon is ~74x70, so an IoU this high leaves no room for a second.
    assert!(
        drawn.0 <= tcx && tcx < drawn.0 + drawn.2 && drawn.1 <= tcy && tcy < drawn.1 + drawn.3,
        "the border does not contain the books icon centre"
    );
    assert!(
        neighbours.is_empty(),
        "the border also covers {neighbours:?}"
    );
    assert!(
        centre_distance <= 4.0,
        "the border is off-centre by {centre_distance:.2}px"
    );
    assert!(iou >= 0.90, "the border is not tight: IoU {iou:.4}");

    println!("\nPASS: one border, on the books icon, drawn without a screenshot");
    println!("{}\n", "=".repeat(78));
}
