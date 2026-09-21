//! One owner for every annotation on screen.
//!
//! Before this, "annotate something" meant `native_overlay::show_highlight`:
//! one global window, one hard-coded rounded rectangle, no identity. A border
//! and a circle could not coexist — the second call moved the first window —
//! and "make the circle red" had nothing to name, because nothing had a name.
//!
//! What this adds is identity and ownership. Every shape gets a stable id, an
//! owning conversation and request, the source window and monitor it belongs
//! to, and a lifecycle. Updates and removals address the id; nothing searches
//! by colour or position or the text of a sentence.
//!
//! The window pool is central on purpose. Windows overlays are the kind of
//! thing that leaks: `native_overlay::init` used to create three fresh windows
//! per call and orphan the previous set *while they were visible*, and nothing
//! could hide them afterwards because the only handles had been overwritten.
//! Here every window a shape uses is in one map, `census` asks Windows directly
//! rather than trusting that map, and the two are asserted to agree.

#![cfg(windows)]

pub mod shapes;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use shapes::{AnnotationStyle, ShapeBox, ShapeKind};

/// Where a shape sits, in desktop pixels.
///
/// Desktop coordinates, not client coordinates: the source window may be on a
/// monitor with a negative origin, and converting once at the boundary is how
/// that stays correct everywhere else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationGeometry {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl AnnotationGeometry {
    fn is_drawable(&self) -> bool {
        self.width > 0 && self.height > 0
    }

    fn translated(&self, dx: i32, dy: i32) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
            ..*self
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Lifecycle {
    /// On screen.
    Active,
    /// Deliberately not shown — the source window is minimised. Still owned,
    /// still addressable, comes back on restore.
    Hidden,
    /// The source moved or changed and the geometry has not been re-resolved.
    /// Distinct from `Hidden`: hidden is a decision, stale is an unknown.
    Stale,
    /// Gone. Kept briefly so a second remove says "already removed" rather than
    /// "no such annotation", which are different things to a user.
    Removed,
}

/// Everything that identifies an annotation and what it belongs to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub account_id: String,
    pub conversation_id: String,
    pub request_id: String,
    pub source_process_id: u32,
    pub source_window_id: String,
    pub monitor_id: String,
    /// The thing this points at — a person, a face, a control.
    pub target_id: String,
    /// For a face inside a person: the person's target id. Lets a follow-up
    /// resolve "their face" without re-detecting the person.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_target_id: Option<String>,
    pub shape: ShapeKind,
    pub geometry: AnnotationGeometry,
    pub style: AnnotationStyle,
    pub z_index: i32,
    pub lifecycle: Lifecycle,
    pub created_at: u64,
    pub updated_at: u64,
    /// Cleared when the conversation ends. A persistent annotation survives it.
    pub temporary: bool,
}

/// What a caller supplies to create one.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAnnotation {
    pub account_id: String,
    pub conversation_id: String,
    pub request_id: String,
    #[serde(default)]
    pub source_process_id: u32,
    #[serde(default)]
    pub source_window_id: String,
    pub monitor_id: String,
    pub target_id: String,
    #[serde(default)]
    pub parent_target_id: Option<String>,
    pub shape: ShapeKind,
    pub geometry: AnnotationGeometry,
    #[serde(default)]
    pub style: AnnotationStyle,
    #[serde(default = "yes")]
    pub temporary: bool,
}

fn yes() -> bool {
    true
}

/// A change to an existing annotation. Absent fields are left alone, so
/// "make it red" does not have to restate the geometry.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAnnotation {
    #[serde(default)]
    pub geometry: Option<AnnotationGeometry>,
    #[serde(default)]
    pub colour: Option<String>,
    #[serde(default)]
    pub thickness: Option<f32>,
    #[serde(default)]
    pub opacity: Option<f32>,
    #[serde(default)]
    pub lifecycle: Option<Lifecycle>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnnotationError {
    NotFound,
    AlreadyRemoved,
    /// The caller's account or conversation is not the one that owns it.
    NotYours,
    /// Zero or negative extent — nothing to draw.
    Undrawable,
    /// The overlay could not be shown. The annotation is not recorded when this
    /// happens: a record with nothing on screen is worse than no record.
    OverlayFailed,
}

impl AnnotationError {
    pub fn message(self) -> &'static str {
        match self {
            Self::NotFound => "I don't have that annotation any more.",
            Self::AlreadyRemoved => "That one's already gone.",
            Self::NotYours => "That annotation belongs to a different conversation.",
            Self::Undrawable => "That area is too small to draw around.",
            Self::OverlayFailed => "I couldn't draw on screen just now.",
        }
    }
}

/// Who is asking. Every mutating operation carries it, so an annotation from
/// one conversation cannot be changed from another.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub account_id: String,
    pub conversation_id: String,
}

/// What is on screen right now, counted two ways.
///
/// `native_windows` comes from Windows, `tracked_windows` from this module. A
/// difference between them is a leak, and the whole reason the census reports
/// both rather than one number it computed itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Census {
    pub annotations: usize,
    pub active: usize,
    pub hidden: usize,
    pub stale: usize,
    pub tracked_windows: usize,
    pub native_windows: usize,
    pub conversations: usize,
}

struct Entry {
    annotation: Annotation,
    /// The overlay window showing it, if any. `None` while hidden.
    hwnd: isize,
}

#[derive(Default)]
pub struct AnnotationManager {
    entries: Mutex<HashMap<String, Entry>>,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_Z: AtomicU64 = AtomicU64::new(1);

fn new_id() -> String {
    format!(
        "ann-{}-{}",
        now_ms(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl AnnotationManager {
    /// Draw a new shape and return its id.
    ///
    /// Repeating the same shape on the same target in the same request returns
    /// the *existing* id rather than drawing a second one. A model that emits
    /// its tool call twice — or a redelivered call — must not leave two borders
    /// stacked on one person.
    pub fn create(&self, request: CreateAnnotation) -> Result<Annotation, AnnotationError> {
        if !request.geometry.is_drawable() {
            return Err(AnnotationError::Undrawable);
        }
        let mut entries = self.entries.lock().unwrap();

        if let Some(existing) = entries.values().find(|e| {
            let a = &e.annotation;
            a.lifecycle != Lifecycle::Removed
                && a.request_id == request.request_id
                && a.target_id == request.target_id
                && a.shape == request.shape
        }) {
            return Ok(existing.annotation.clone());
        }

        let now = now_ms();
        let annotation = Annotation {
            id: new_id(),
            account_id: request.account_id,
            conversation_id: request.conversation_id,
            request_id: request.request_id,
            source_process_id: request.source_process_id,
            source_window_id: request.source_window_id,
            monitor_id: request.monitor_id,
            target_id: request.target_id,
            parent_target_id: request.parent_target_id,
            shape: request.shape,
            geometry: request.geometry,
            style: request.style,
            z_index: NEXT_Z.fetch_add(1, Ordering::Relaxed) as i32,
            lifecycle: Lifecycle::Active,
            created_at: now,
            updated_at: now,
            temporary: request.temporary,
        };

        let hwnd = paint_shape(0, &annotation).ok_or(AnnotationError::OverlayFailed)?;
        entries.insert(
            annotation.id.clone(),
            Entry {
                annotation: annotation.clone(),
                hwnd,
            },
        );
        Ok(annotation)
    }

    /// Change one annotation, by id.
    pub fn update(
        &self,
        id: &str,
        scope: &Scope,
        change: UpdateAnnotation,
    ) -> Result<Annotation, AnnotationError> {
        let mut entries = self.entries.lock().unwrap();
        let entry = entries.get_mut(id).ok_or(AnnotationError::NotFound)?;
        check_scope(&entry.annotation, scope)?;
        if entry.annotation.lifecycle == Lifecycle::Removed {
            return Err(AnnotationError::AlreadyRemoved);
        }

        if let Some(geometry) = change.geometry {
            if !geometry.is_drawable() {
                return Err(AnnotationError::Undrawable);
            }
            entry.annotation.geometry = geometry;
            // New geometry is by definition current, so it is no longer stale.
            if entry.annotation.lifecycle == Lifecycle::Stale {
                entry.annotation.lifecycle = Lifecycle::Active;
            }
        }
        if let Some(colour) = change.colour {
            // Refuse a colour we cannot render rather than silently keeping the
            // old one and reporting success.
            if shapes::parse_colour(&colour).is_none() {
                return Err(AnnotationError::NotFound);
            }
            entry.annotation.style.colour = colour;
        }
        if let Some(t) = change.thickness {
            entry.annotation.style.thickness = t;
        }
        if let Some(o) = change.opacity {
            entry.annotation.style.opacity = o;
        }
        if let Some(lifecycle) = change.lifecycle {
            entry.annotation.lifecycle = lifecycle;
        }
        entry.annotation.updated_at = now_ms();

        match entry.annotation.lifecycle {
            Lifecycle::Hidden | Lifecycle::Removed => {
                hide_window(entry.hwnd);
            }
            Lifecycle::Active | Lifecycle::Stale => {
                let hwnd =
                    paint_shape(entry.hwnd, &entry.annotation).ok_or(AnnotationError::OverlayFailed)?;
                entry.hwnd = hwnd;
            }
        }
        Ok(entry.annotation.clone())
    }

    /// Remove one, by id. Leaves every other annotation alone.
    pub fn remove(&self, id: &str, scope: &Scope) -> Result<(), AnnotationError> {
        let mut entries = self.entries.lock().unwrap();
        let entry = entries.get_mut(id).ok_or(AnnotationError::NotFound)?;
        check_scope(&entry.annotation, scope)?;
        if entry.annotation.lifecycle == Lifecycle::Removed {
            return Err(AnnotationError::AlreadyRemoved);
        }
        destroy_window(entry.hwnd);
        entry.hwnd = 0;
        entry.annotation.lifecycle = Lifecycle::Removed;
        entry.annotation.updated_at = now_ms();
        Ok(())
    }

    pub fn list(&self, scope: &Scope) -> Vec<Annotation> {
        let entries = self.entries.lock().unwrap();
        let mut list: Vec<Annotation> = entries
            .values()
            .map(|e| e.annotation.clone())
            .filter(|a| {
                a.lifecycle != Lifecycle::Removed
                    && a.account_id == scope.account_id
                    && a.conversation_id == scope.conversation_id
            })
            .collect();
        list.sort_by_key(|a| a.z_index);
        list
    }

    /// Every annotation belonging to a target, most recent first.
    ///
    /// How "the circle" resolves: the newest circle on the current target,
    /// rather than anything parsed out of the assistant's own sentence.
    pub fn by_target(&self, scope: &Scope, target_id: &str) -> Vec<Annotation> {
        let mut list: Vec<Annotation> = self
            .list(scope)
            .into_iter()
            .filter(|a| a.target_id == target_id)
            .collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    pub fn clear_request(&self, request_id: &str) -> usize {
        self.clear_where(|a| a.request_id == request_id)
    }

    pub fn clear_conversation(&self, conversation_id: &str) -> usize {
        self.clear_where(|a| a.conversation_id == conversation_id)
    }

    /// Everything temporary, everywhere. Used on voice close and app shutdown,
    /// where "whose was it" no longer matters and leaving one behind does.
    pub fn clear_all_temporary(&self) -> usize {
        self.clear_where(|a| a.temporary)
    }

    fn clear_where(&self, predicate: impl Fn(&Annotation) -> bool) -> usize {
        let mut entries = self.entries.lock().unwrap();
        let mut cleared = 0;
        for entry in entries.values_mut() {
            if entry.annotation.lifecycle != Lifecycle::Removed && predicate(&entry.annotation) {
                destroy_window(entry.hwnd);
                entry.hwnd = 0;
                entry.annotation.lifecycle = Lifecycle::Removed;
                cleared += 1;
            }
        }
        // Removed entries are dropped once nothing is left to report on, so the
        // map cannot grow forever across a long session.
        if entries.values().all(|e| e.annotation.lifecycle == Lifecycle::Removed) {
            entries.clear();
        }
        cleared
    }

    /// The source window moved: shift everything that belongs to it.
    ///
    /// Translation rather than re-detection, deliberately. A window drag moves
    /// every annotation in it by the same amount, and re-running person
    /// detection to discover that would be slower and less accurate than
    /// arithmetic.
    pub fn translate_window(&self, source_window_id: &str, dx: i32, dy: i32) -> usize {
        let mut entries = self.entries.lock().unwrap();
        let mut moved = 0;
        for entry in entries.values_mut() {
            if entry.annotation.source_window_id != source_window_id
                || entry.annotation.lifecycle == Lifecycle::Removed
            {
                continue;
            }
            entry.annotation.geometry = entry.annotation.geometry.translated(dx, dy);
            entry.annotation.updated_at = now_ms();
            if entry.annotation.lifecycle == Lifecycle::Active {
                if let Some(hwnd) = paint_shape(entry.hwnd, &entry.annotation) {
                    entry.hwnd = hwnd;
                }
            }
            moved += 1;
        }
        moved
    }

    /// The source window was minimised or restored.
    ///
    /// A restore marks annotations `Stale` rather than `Active`: the window may
    /// have come back somewhere else, and showing a shape at its old
    /// coordinates would put a border in the middle of nothing. The caller
    /// re-resolves and then updates the geometry, which clears the staleness.
    pub fn set_window_visible(&self, source_window_id: &str, visible: bool) -> usize {
        let mut entries = self.entries.lock().unwrap();
        let mut changed = 0;
        for entry in entries.values_mut() {
            if entry.annotation.source_window_id != source_window_id
                || entry.annotation.lifecycle == Lifecycle::Removed
            {
                continue;
            }
            if visible {
                if entry.annotation.lifecycle == Lifecycle::Hidden {
                    entry.annotation.lifecycle = Lifecycle::Stale;
                    changed += 1;
                }
            } else if entry.annotation.lifecycle != Lifecycle::Hidden {
                entry.annotation.lifecycle = Lifecycle::Hidden;
                hide_window(entry.hwnd);
                changed += 1;
            }
            entry.annotation.updated_at = now_ms();
        }
        changed
    }

    /// The source window closed: its annotations point at nothing.
    pub fn source_closed(&self, source_window_id: &str) -> usize {
        self.clear_where(|a| a.source_window_id == source_window_id)
    }

    pub fn census(&self) -> Census {
        let entries = self.entries.lock().unwrap();
        let live: Vec<&Annotation> = entries
            .values()
            .map(|e| &e.annotation)
            .filter(|a| a.lifecycle != Lifecycle::Removed)
            .collect();
        let conversations: std::collections::HashSet<&str> =
            live.iter().map(|a| a.conversation_id.as_str()).collect();
        Census {
            annotations: live.len(),
            active: live.iter().filter(|a| a.lifecycle == Lifecycle::Active).count(),
            hidden: live.iter().filter(|a| a.lifecycle == Lifecycle::Hidden).count(),
            stale: live.iter().filter(|a| a.lifecycle == Lifecycle::Stale).count(),
            tracked_windows: entries.values().filter(|e| e.hwnd != 0).count(),
            native_windows: crate::native_overlay::annotation_window_count(),
            conversations: conversations.len(),
        }
    }
}

fn check_scope(annotation: &Annotation, scope: &Scope) -> Result<(), AnnotationError> {
    if annotation.account_id != scope.account_id
        || annotation.conversation_id != scope.conversation_id
    {
        return Err(AnnotationError::NotYours);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Native side
//
// Thin wrappers so the manager's logic is testable: under `cfg(test)` these do
// nothing and return a fake handle, because a unit test must not open windows.
// ---------------------------------------------------------------------------

#[cfg(not(test))]
fn paint_shape(existing: isize, annotation: &Annotation) -> Option<isize> {
    crate::native_overlay::show_annotation(
        existing,
        annotation.geometry.x,
        annotation.geometry.y,
        annotation.geometry.width,
        annotation.geometry.height,
        annotation.shape,
        &annotation.style,
    )
}

#[cfg(test)]
fn paint_shape(existing: isize, _annotation: &Annotation) -> Option<isize> {
    Some(if existing == 0 { 1 } else { existing })
}

#[cfg(not(test))]
fn hide_window(hwnd: isize) {
    crate::native_overlay::hide_annotation(hwnd);
}

#[cfg(test)]
fn hide_window(_hwnd: isize) {}

#[cfg(not(test))]
fn destroy_window(hwnd: isize) {
    crate::native_overlay::destroy_annotation(hwnd);
}

#[cfg(test)]
fn destroy_window(_hwnd: isize) {}

#[cfg(test)]
mod tests;

mod commands;
pub use commands::*;
