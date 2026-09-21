//! Eleven things that change the screen, and what each one should mean.
//!
//! Every one of them used to produce the same sentence: "The screen changed
//! after I looked at it." Cursor movement, our own highlight, a window nudged
//! twenty pixels, a target that had genuinely gone — one message, one outcome,
//! request failed.
//!
//! These assert the decision for each case separately, through
//! `target_recovery::classify` and `target_search::search_in` — the two
//! functions production calls. They are decision-level, not physical: what a
//! real screen does is the restart regression's job, and what the code
//! *concludes* is this one's.

#![cfg(all(windows, test))]

use super::target_recovery::{classify, RegionChange, Resolution, TargetIdentity, TargetOutcome};
use super::target_search::{search_in, SearchResult, MATCH_THRESHOLD};
use xcap::image::{Rgba, RgbaImage};

fn identity() -> TargetIdentity {
    TargetIdentity {
        window_id: Some(7),
        process_id: Some(900),
        monitor_key: "EDID-TEST".into(),
        control_id: None,
        label: Some("the Next button".into()),
        capture_generation: 1,
    }
}

fn change(similarity: f32) -> RegionChange {
    RegionChange {
        similarity,
        threshold: 0.12,
        overlay_present: false,
        cursor_inside: false,
    }
}

/// Asserts the outcome and that the message is neither generic nor empty when
/// the user is being asked something.
fn expect(outcome: TargetOutcome, expected: TargetOutcome) {
    assert_eq!(outcome, expected);
    let message = outcome.message(Some("the Next button"));
    assert!(
        !message.to_lowercase().contains("the screen moved"),
        "{outcome:?} fell back to the generic message"
    );
    if outcome.needs_user() {
        assert!(!message.is_empty(), "{outcome:?} asks but says nothing");
    } else {
        assert!(
            message.is_empty(),
            "{outcome:?} proceeds but reports something: {message:?}"
        );
    }
}

// ── 1. The cursor moves over the target ───────────────────────────────────
#[test]
fn a_cursor_over_the_target_continues_silently() {
    let mut c = change(0.5);
    c.cursor_inside = true;
    let (outcome, _) = classify(&identity(), c, false, |_| {
        panic!("a cursor must not even trigger a search")
    });
    expect(outcome, TargetOutcome::IgnorableChange);
    assert!(outcome.proceeds());
}

// ── 2 & 3. Our own border, then our own circle ────────────────────────────
#[test]
fn our_own_annotations_continue_silently() {
    // Drawing a border and then being asked to circle a face inside it is the
    // exact sequence that failed: the border was in the compared region.
    for _shape in ["border", "circle"] {
        let mut c = change(0.35);
        c.overlay_present = true;
        let (outcome, _) = classify(&identity(), c, false, |_| {
            panic!("our own overlay must not trigger a search")
        });
        expect(outcome, TargetOutcome::IgnorableChange);
    }
}

// ── 4. An image finishes decoding ─────────────────────────────────────────
#[test]
fn a_late_decode_is_recovered_not_failed() {
    // The pixels settle into something slightly different; the target is still
    // there, so the search finds it in place.
    let (outcome, found) = classify(&identity(), change(0.6), false, |_| {
        Resolution::Found(identity())
    });
    expect(outcome, TargetOutcome::Recovered);
    assert!(found.is_some());
}

// ── 5 & 6. The window moves slightly, then resizes ────────────────────────
#[test]
fn a_moved_or_resized_window_is_re_resolved_and_continues() {
    for generation in [2u64, 3] {
        let mut after = identity();
        after.capture_generation = generation;
        let (outcome, found) = classify(&identity(), change(0.3), false, |_| {
            Resolution::Found(after.clone())
        });
        expect(outcome, TargetOutcome::Recovered);
        assert_eq!(found.unwrap().capture_generation, generation);
    }
}

/// And the search itself produces the offset the caller needs.
#[test]
fn a_moved_target_yields_its_new_position() {
    let needle = marker(40);
    let mut hay = field(240, 240);
    place(&mut hay, &needle, 118, 138);
    match search_in(&hay, &needle, 100, 100) {
        SearchResult::Found { dx, dy, score } => {
            assert_eq!((dx, dy), (18, 38));
            assert!(score >= MATCH_THRESHOLD);
        }
        other => panic!("expected Found, got {other:?}"),
    }
}

// ── 7. Unrelated pixels animate ───────────────────────────────────────────
#[test]
fn animation_elsewhere_does_not_reach_the_target() {
    // The compared region is around the target, so unrelated animation does not
    // enter it at all — the region still matches and nothing is re-resolved.
    let (outcome, _) = classify(&identity(), change(0.97), false, |_| {
        panic!("a fresh region must not trigger a search")
    });
    expect(outcome, TargetOutcome::Fresh);
}

// ── 8. The target moves inside the same window ────────────────────────────
#[test]
fn a_target_moving_within_its_window_keeps_its_identity() {
    let mut moved = identity();
    moved.capture_generation = 4;
    let (outcome, found) = classify(&identity(), change(0.2), false, |_| {
        Resolution::Found(moved.clone())
    });
    expect(outcome, TargetOutcome::Recovered);
    assert!(found.unwrap().same_as(&identity()), "same window, same label");
}

// ── 9. The target disappears ──────────────────────────────────────────────
#[test]
fn a_vanished_target_says_so_specifically() {
    let (outcome, _) = classify(&identity(), change(0.1), false, |_| Resolution::None);
    expect(outcome, TargetOutcome::TargetGone);
    assert!(outcome
        .message(Some("the Next button"))
        .contains("can't see the Next button"));
}

// ── 10. Two similar targets appear ────────────────────────────────────────
#[test]
fn two_similar_targets_produce_a_question() {
    let (outcome, _) = classify(&identity(), change(0.3), false, |_| Resolution::Multiple(2));
    expect(outcome, TargetOutcome::Ambiguous);
    assert!(outcome.message(None).contains("Which one"));

    // And the search agrees, rather than picking one.
    let needle = marker(36);
    let mut hay = field(260, 200);
    place(&mut hay, &needle, 40, 80);
    place(&mut hay, &needle, 180, 80);
    assert!(matches!(
        search_in(&hay, &needle, 100, 80),
        SearchResult::Ambiguous { .. }
    ));
}

// ── 11. The display topology changes ──────────────────────────────────────
#[test]
fn a_topology_change_is_its_own_message() {
    let (outcome, _) = classify(&identity(), change(1.0), true, |_| Resolution::None);
    expect(outcome, TargetOutcome::TopologyChanged);
    assert!(outcome.message(None).contains("display layout"));
}

// ── The source window closing ─────────────────────────────────────────────
#[test]
fn a_closed_source_window_is_named_as_such() {
    let (outcome, _) = classify(&identity(), change(0.2), false, |_| Resolution::WindowClosed);
    expect(outcome, TargetOutcome::SourceWindowClosed);
    assert!(outcome.message(None).contains("has closed"));
}

/// Nothing in the vocabulary is allowed to be the old generic sentence.
#[test]
fn no_outcome_can_say_only_that_the_screen_moved() {
    for outcome in [
        TargetOutcome::Fresh,
        TargetOutcome::Recovered,
        TargetOutcome::IgnorableChange,
        TargetOutcome::TargetGone,
        TargetOutcome::Ambiguous,
        TargetOutcome::SourceWindowClosed,
        TargetOutcome::TopologyChanged,
        TargetOutcome::CouldNotCheck,
    ] {
        let m = outcome.message(Some("it")).to_lowercase();
        assert!(!m.contains("screen moved"), "{outcome:?}: {m}");
        assert!(!m.contains("screen changed"), "{outcome:?}: {m}");
    }
}

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

fn marker(size: u32) -> RgbaImage {
    let mut img = RgbaImage::from_pixel(size, size, Rgba([22, 22, 28, 255]));
    for i in 0..size {
        img.put_pixel(i, size / 2, Rgba([250, 240, 120, 255]));
        img.put_pixel(size / 2, i, Rgba([250, 240, 120, 255]));
    }
    img
}

fn field(w: u32, h: u32) -> RgbaImage {
    RgbaImage::from_fn(w, h, |x, y| {
        Rgba([
            (18 + (x % 7)) as u8,
            (20 + (y % 5)) as u8,
            (26 + ((x + y) % 9)) as u8,
            255,
        ])
    })
}

fn place(base: &mut RgbaImage, patch: &RgbaImage, at_x: u32, at_y: u32) {
    for y in 0..patch.height() {
        for x in 0..patch.width() {
            base.put_pixel(at_x + x, at_y + y, *patch.get_pixel(x, y));
        }
    }
}
