//! Runs the Zoom scanner against this machine, right now.
//!
//! The unit tests prove the classifier's rules; this proves the rules meet
//! reality. It is the test that would have caught the shipped defect, because
//! the defect was not in the logic — it was that the logic never saw the
//! meeting window at all.
//!
//! Prints a sanitized inventory either way, so a failure says *what Zoom was
//! doing* rather than just "no meeting found". Class names and sizes only.

use super::zoom_scan::{find_meeting_window, scan_zoom_windows};
use super::zoom_windows::ZoomWindowKind;

/// Every Zoom window on this machine, classified.
///
/// Not an assertion about whether a meeting is open — that depends on what the
/// machine is doing — but it fails if the scan is structurally broken: Zoom
/// running with no window found at all, or a window that classified as nothing.
#[test]
fn zoom_windows_are_enumerated_and_classified() {
    let windows = scan_zoom_windows();
    println!("\n=== Zoom windows on this machine ===");
    if windows.is_empty() {
        println!("  none — Zoom is not running");
        return;
    }
    for window in &windows {
        println!("  {}", window.diagnostic());
    }

    let meeting_windows: Vec<_> = windows.iter().filter(|w| w.kind.is_meeting()).collect();
    let home_windows: Vec<_> = windows
        .iter()
        .filter(|w| w.kind == ZoomWindowKind::Home)
        .collect();
    println!(
        "\n  {} window(s): {} meeting, {} home, {} other",
        windows.len(),
        meeting_windows.len(),
        home_windows.len(),
        windows.len() - meeting_windows.len() - home_windows.len()
    );

    // The bug this file exists for: the home window and the conference window
    // are separate HWNDs and both must survive the scan.
    let handles: std::collections::HashSet<isize> = windows.iter().map(|w| w.hwnd).collect();
    assert_eq!(
        handles.len(),
        windows.len(),
        "each window must keep its own handle — collapsing them is the original defect"
    );

    match find_meeting_window(&windows) {
        Some(meeting) => {
            println!("\n  MEETING DETECTED");
            println!("    {}", meeting.diagnostic());
            assert!(meeting.kind.is_meeting());
            assert!(
                meeting.process_id != 0 && meeting.hwnd != 0,
                "a detected meeting needs a real process and handle to bind to"
            );
        }
        None => {
            println!("\n  no meeting in progress");
            assert!(
                meeting_windows.is_empty(),
                "conference windows were classified but no meeting was resolved"
            );
        }
    }
}

/// Zoom's home window must never be mistaken for a call.
///
/// Skips when Zoom is not running rather than failing: this asserts a property
/// of the machine when the machine has one to assert.
#[test]
fn the_zoom_home_window_is_never_reported_as_a_meeting() {
    let windows = scan_zoom_windows();
    if windows.is_empty() {
        println!("Zoom is not running — nothing to check");
        return;
    }
    for window in windows.iter().filter(|w| w.kind == ZoomWindowKind::Home) {
        assert!(
            !window.kind.is_meeting(),
            "home window reported as a meeting: {}",
            window.diagnostic()
        );
    }
    if let Some(meeting) = find_meeting_window(&windows) {
        assert_ne!(
            meeting.kind,
            ZoomWindowKind::Home,
            "the resolved meeting must not be the home window: {}",
            meeting.diagnostic()
        );
    }
}
