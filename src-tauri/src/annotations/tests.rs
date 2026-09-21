//! The border-and-circle conversation, as assertions.
//!
//! The native side is stubbed under `cfg(test)` — these are about identity,
//! ownership and lifecycle, and opening real windows would make them slow,
//! order-dependent and impossible to run on a build machine. What the windows
//! themselves do is `shapes.rs`'s tests plus the physical run.

use super::shapes::{AnnotationStyle, ShapeKind};
use super::*;

const ACCOUNT: &str = "acct-A";
const CONVERSATION: &str = "conv-1";
const REQUEST: &str = "req-1";
const WINDOW: &str = "hwnd-4242";

fn scope() -> Scope {
    Scope {
        account_id: ACCOUNT.into(),
        conversation_id: CONVERSATION.into(),
    }
}

fn create(
    manager: &AnnotationManager,
    shape: ShapeKind,
    target: &str,
    parent: Option<&str>,
    geometry: AnnotationGeometry,
) -> Annotation {
    manager
        .create(CreateAnnotation {
            account_id: ACCOUNT.into(),
            conversation_id: CONVERSATION.into(),
            request_id: REQUEST.into(),
            source_process_id: 900,
            source_window_id: WINDOW.into(),
            monitor_id: "EDID-LEFT".into(),
            target_id: target.into(),
            parent_target_id: parent.map(str::to_string),
            shape,
            geometry,
            style: AnnotationStyle::default(),
            temporary: true,
        })
        .expect("create")
}

fn person_box() -> AnnotationGeometry {
    AnnotationGeometry {
        x: 120,
        y: 200,
        width: 180,
        height: 420,
    }
}

fn face_box() -> AnnotationGeometry {
    AnnotationGeometry {
        x: 168,
        y: 226,
        width: 78,
        height: 92,
    }
}

/// The whole conversation, in order. Everything else here pulls one step of it
/// apart; this asserts they compose.
#[test]
fn the_border_and_circle_conversation() {
    let manager = AnnotationManager::default();

    // "Draw a border around the person on the left."
    let border = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    assert_eq!(manager.census().active, 1);

    // "Circle their face." — a child of the person, its own id.
    let circle = create(
        &manager,
        ShapeKind::Circle,
        "face-of-person-left",
        Some("person-left"),
        face_box(),
    );
    assert_ne!(border.id, circle.id, "each shape needs its own identity");
    assert_eq!(circle.parent_target_id.as_deref(), Some("person-left"));
    assert_eq!(manager.census().active, 2, "the border must survive the circle");

    // "Make the circle red."
    let reddened = manager
        .update(
            &circle.id,
            &scope(),
            UpdateAnnotation {
                colour: Some("red".into()),
                ..Default::default()
            },
        )
        .expect("update");
    assert_eq!(reddened.style.colour, "red");
    assert_eq!(
        manager.list(&scope()).iter().find(|a| a.id == border.id).unwrap().style.colour,
        AnnotationStyle::default().colour,
        "recolouring the circle must not touch the border",
    );
    assert_eq!(reddened.geometry, face_box(), "recolouring must not move it");

    // "Remove the circle but keep the border."
    manager.remove(&circle.id, &scope()).expect("remove");
    let remaining = manager.list(&scope());
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, border.id);
    assert_eq!(manager.census().active, 1);

    // "Clear everything."
    assert_eq!(manager.clear_conversation(CONVERSATION), 1);
    let census = manager.census();
    assert_eq!(census.annotations, 0);
    assert_eq!(census.active, 0);
    assert_eq!(census.tracked_windows, 0, "a cleared annotation keeps no window");
}

// 1. Stable annotation IDs
#[test]
fn ids_are_stable_and_unique() {
    let manager = AnnotationManager::default();
    let a = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    let b = create(&manager, ShapeKind::Circle, "face", Some("person-left"), face_box());
    assert_ne!(a.id, b.id);
    // The id survives an update: "make it red" must not renumber it.
    let updated = manager
        .update(
            &a.id,
            &scope(),
            UpdateAnnotation {
                colour: Some("green".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(updated.id, a.id);
}

// 6. Duplicate create requests do not duplicate the same shape
#[test]
fn repeating_a_create_returns_the_same_annotation() {
    let manager = AnnotationManager::default();
    let first = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    let again = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    assert_eq!(first.id, again.id, "a redelivered call must not stack borders");
    assert_eq!(manager.census().active, 1);

    // A different shape on the same target is a different annotation.
    let circle = create(&manager, ShapeKind::Circle, "person-left", None, face_box());
    assert_ne!(circle.id, first.id);
    assert_eq!(manager.census().active, 2);
}

// 7. Wrong account cannot update
#[test]
fn another_account_cannot_touch_it() {
    let manager = AnnotationManager::default();
    let a = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    let intruder = Scope {
        account_id: "acct-B".into(),
        conversation_id: CONVERSATION.into(),
    };
    assert_eq!(
        manager.update(&a.id, &intruder, UpdateAnnotation::default()).err(),
        Some(AnnotationError::NotYours),
    );
    assert!(manager.list(&intruder).is_empty(), "and cannot even see it");
}

// 8. Wrong conversation cannot remove
#[test]
fn another_conversation_cannot_remove_it() {
    let manager = AnnotationManager::default();
    let a = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    let other = Scope {
        account_id: ACCOUNT.into(),
        conversation_id: "conv-2".into(),
    };
    assert_eq!(manager.remove(&a.id, &other), Err(AnnotationError::NotYours));
    assert_eq!(manager.census().active, 1);
}

// 9. Removed annotation cannot be updated
#[test]
fn a_removed_annotation_says_so_rather_than_vanishing() {
    let manager = AnnotationManager::default();
    let a = create(&manager, ShapeKind::Circle, "face", None, face_box());
    let b = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    manager.remove(&a.id, &scope()).unwrap();

    // "Already gone" and "never existed" are different answers.
    assert_eq!(
        manager.remove(&a.id, &scope()),
        Err(AnnotationError::AlreadyRemoved)
    );
    assert_eq!(
        manager.update(&a.id, &scope(), UpdateAnnotation::default()).err(),
        Some(AnnotationError::AlreadyRemoved),
    );
    assert_eq!(
        manager
            .update("ann-never-existed", &scope(), UpdateAnnotation::default())
            .err(),
        Some(AnnotationError::NotFound),
    );
    assert_eq!(manager.census().active, 1, "{} survived", b.id);
}

// 10. Source-window close cleans annotations
#[test]
fn closing_the_source_window_clears_its_annotations() {
    let manager = AnnotationManager::default();
    create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    create(&manager, ShapeKind::Circle, "face", Some("person-left"), face_box());

    // Something belonging to a different window must survive.
    manager
        .create(CreateAnnotation {
            source_window_id: "hwnd-other".into(),
            ..CreateAnnotation {
                account_id: ACCOUNT.into(),
                conversation_id: CONVERSATION.into(),
                request_id: REQUEST.into(),
                source_process_id: 901,
                source_window_id: "hwnd-other".into(),
                monitor_id: "EDID-LEFT".into(),
                target_id: "elsewhere".into(),
                parent_target_id: None,
                shape: ShapeKind::Highlight,
                geometry: person_box(),
                style: AnnotationStyle::default(),
                temporary: true,
            }
        })
        .unwrap();

    assert_eq!(manager.source_closed(WINDOW), 2);
    let left = manager.list(&scope());
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].target_id, "elsewhere");
}

// 11 & 12. Minimize hides, restore re-resolves
#[test]
fn minimising_hides_and_restoring_asks_to_re_resolve() {
    let manager = AnnotationManager::default();
    let a = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());

    assert_eq!(manager.set_window_visible(WINDOW, false), 1);
    let census = manager.census();
    assert_eq!(census.hidden, 1);
    assert_eq!(census.active, 0);
    assert_eq!(census.annotations, 1, "hidden is still owned");

    // Restoring marks it stale, not active: the window may have come back
    // somewhere else, and drawing at the old coordinates would put a border
    // around nothing.
    assert_eq!(manager.set_window_visible(WINDOW, true), 1);
    assert_eq!(manager.census().stale, 1);
    assert_eq!(manager.census().active, 0);

    // Re-resolution supplies new geometry, which clears the staleness.
    let moved = AnnotationGeometry { x: 400, y: 250, ..person_box() };
    let updated = manager
        .update(
            &a.id,
            &scope(),
            UpdateAnnotation {
                geometry: Some(moved),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(updated.lifecycle, Lifecycle::Active);
    assert_eq!(updated.geometry, moved);
}

// 13. Window movement updates geometry
#[test]
fn moving_the_window_moves_every_annotation_in_it_by_the_same_amount() {
    let manager = AnnotationManager::default();
    let border = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    let circle = create(&manager, ShapeKind::Circle, "face", Some("person-left"), face_box());

    assert_eq!(manager.translate_window(WINDOW, 60, -25), 2);
    let list = manager.list(&scope());
    let get = |id: &str| list.iter().find(|a| a.id == id).unwrap().geometry;
    assert_eq!(get(&border.id), person_box().translated(60, -25));
    assert_eq!(get(&circle.id), face_box().translated(60, -25));

    // The face stays inside the person, which is the property a user would
    // notice breaking.
    let (p, f) = (get(&border.id), get(&circle.id));
    assert!(
        f.x >= p.x && f.y >= p.y && f.x + f.width <= p.x + p.width,
        "the circle left the person it belongs to"
    );
    assert_eq!(manager.census().active, 2, "moving must not duplicate shapes");
}

// 14. Negative-origin monitor coordinates
#[test]
fn a_negative_origin_monitor_is_handled_like_any_other() {
    let manager = AnnotationManager::default();
    let portrait = AnnotationGeometry {
        x: -1080,
        y: -661,
        width: 200,
        height: 300,
    };
    let a = manager
        .create(CreateAnnotation {
            account_id: ACCOUNT.into(),
            conversation_id: CONVERSATION.into(),
            request_id: REQUEST.into(),
            source_process_id: 900,
            source_window_id: WINDOW.into(),
            monitor_id: "EDID-PORTRAIT".into(),
            target_id: "person-left".into(),
            parent_target_id: None,
            shape: ShapeKind::Rectangle,
            geometry: portrait,
            style: AnnotationStyle::default(),
            temporary: true,
        })
        .expect("a negative origin is a real coordinate, not an error");
    assert_eq!(a.geometry.x, -1080);

    manager.translate_window(WINDOW, -40, -10);
    assert_eq!(
        manager.list(&scope())[0].geometry,
        portrait.translated(-40, -10),
        "translation must not clamp at zero"
    );
}

// 15. Overlay census reaches zero
#[test]
fn the_census_agrees_with_itself_and_reaches_zero() {
    let manager = AnnotationManager::default();
    create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    create(&manager, ShapeKind::Circle, "face", Some("person-left"), face_box());
    let census = manager.census();
    assert_eq!(census.annotations, 2);
    assert_eq!(census.tracked_windows, 2, "every active shape holds a window");
    assert_eq!(census.conversations, 1);

    assert_eq!(manager.clear_all_temporary(), 2);
    let census = manager.census();
    assert_eq!(census.annotations, 0);
    assert_eq!(census.tracked_windows, 0);
    assert_eq!(census.conversations, 0);
}

#[test]
fn clearing_one_request_leaves_another_alone() {
    let manager = AnnotationManager::default();
    create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    manager
        .create(CreateAnnotation {
            account_id: ACCOUNT.into(),
            conversation_id: CONVERSATION.into(),
            request_id: "req-2".into(),
            source_process_id: 900,
            source_window_id: WINDOW.into(),
            monitor_id: "EDID-LEFT".into(),
            target_id: "person-right".into(),
            parent_target_id: None,
            shape: ShapeKind::Rectangle,
            geometry: person_box(),
            style: AnnotationStyle::default(),
            temporary: true,
        })
        .unwrap();

    assert_eq!(manager.clear_request(REQUEST), 1);
    let left = manager.list(&scope());
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].request_id, "req-2");
}

/// A persistent annotation is not swept by the temporary clear. Nothing creates
/// one yet; the distinction exists so that when something does, "clear
/// everything" does not quietly delete it.
#[test]
fn a_persistent_annotation_survives_the_temporary_sweep() {
    let manager = AnnotationManager::default();
    manager
        .create(CreateAnnotation {
            account_id: ACCOUNT.into(),
            conversation_id: CONVERSATION.into(),
            request_id: REQUEST.into(),
            source_process_id: 900,
            source_window_id: WINDOW.into(),
            monitor_id: "EDID-LEFT".into(),
            target_id: "pinned".into(),
            parent_target_id: None,
            shape: ShapeKind::Label,
            geometry: person_box(),
            style: AnnotationStyle::default(),
            temporary: false,
        })
        .unwrap();
    create(&manager, ShapeKind::Circle, "face", None, face_box());

    assert_eq!(manager.clear_all_temporary(), 1);
    assert_eq!(manager.census().annotations, 1);
    assert_eq!(manager.list(&scope())[0].target_id, "pinned");
}

// 18. Face search is constrained inside the selected person
#[test]
fn a_face_must_be_inside_the_person_it_belongs_to() {
    let person = person_box();
    let inside = face_box();
    assert!(
        contains(&person, &inside),
        "fixture is wrong: the face is not inside the person"
    );

    // A face box that strays into the neighbour is not a face of this person.
    let neighbour_face = AnnotationGeometry {
        x: person.x + person.width + 40,
        y: inside.y,
        width: inside.width,
        height: inside.height,
    };
    assert!(!contains(&person, &neighbour_face));
}

/// The containment rule the face flow relies on, kept next to its test so the
/// production caller and the assertion cannot drift.
pub fn contains(outer: &AnnotationGeometry, inner: &AnnotationGeometry) -> bool {
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height
}

// 20. Missing face does not create a guessed annotation
#[test]
fn nothing_is_drawn_for_a_target_with_no_extent() {
    let manager = AnnotationManager::default();
    for geometry in [
        AnnotationGeometry { x: 10, y: 10, width: 0, height: 40 },
        AnnotationGeometry { x: 10, y: 10, width: 40, height: 0 },
        AnnotationGeometry { x: 10, y: 10, width: -5, height: -5 },
    ] {
        assert_eq!(
            manager
                .create(CreateAnnotation {
                    account_id: ACCOUNT.into(),
                    conversation_id: CONVERSATION.into(),
                    request_id: REQUEST.into(),
                    source_process_id: 900,
                    source_window_id: WINDOW.into(),
                    monitor_id: "EDID-LEFT".into(),
                    target_id: "face-not-found".into(),
                    parent_target_id: Some("person-left".into()),
                    shape: ShapeKind::Circle,
                    geometry,
                    style: AnnotationStyle::default(),
                    temporary: true,
                })
                .err(),
            Some(AnnotationError::Undrawable),
        );
    }
    assert_eq!(manager.census().annotations, 0, "a guess was drawn anyway");
}

/// An unrenderable colour is refused rather than silently ignored.
#[test]
fn an_unknown_colour_is_refused_rather_than_reported_as_applied() {
    let manager = AnnotationManager::default();
    let a = create(&manager, ShapeKind::Circle, "face", None, face_box());
    assert!(manager
        .update(
            &a.id,
            &scope(),
            UpdateAnnotation {
                colour: Some("burgundy".into()),
                ..Default::default()
            },
        )
        .is_err());
    assert_eq!(
        manager.list(&scope())[0].style.colour,
        AnnotationStyle::default().colour,
        "the old colour is kept, and the caller was told"
    );
}

/// Newest first, so "the circle" means the one just drawn.
#[test]
fn annotations_on_a_target_come_back_newest_first() {
    let manager = AnnotationManager::default();
    let first = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    std::thread::sleep(std::time::Duration::from_millis(2));
    let second = create(&manager, ShapeKind::Circle, "person-left", None, face_box());

    let found = manager.by_target(&scope(), "person-left");
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].id, second.id);
    assert_eq!(found[1].id, first.id);
}

/// Z-order increases, so a face circle drawn after a person border sits above
/// it rather than behind.
#[test]
fn later_annotations_sit_above_earlier_ones() {
    let manager = AnnotationManager::default();
    let border = create(&manager, ShapeKind::Rectangle, "person-left", None, person_box());
    let circle = create(&manager, ShapeKind::Circle, "face", Some("person-left"), face_box());
    assert!(circle.z_index > border.z_index);
    // And `list` returns them in that order.
    let list = manager.list(&scope());
    assert_eq!(list[0].id, border.id);
    assert_eq!(list[1].id, circle.id);
}
