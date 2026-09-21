//! The IPC surface for annotations.
//!
//! Every operation names an annotation by id and carries the scope it is acting
//! in. Nothing here searches by label, colour or position — "make the circle
//! red" is resolved to an id by the caller, from conversation memory, before it
//! reaches this file.

#![cfg(windows)]

use serde::Serialize;
use tauri::State;

use super::{
    Annotation, AnnotationError, AnnotationManager, Census, CreateAnnotation, Scope,
    UpdateAnnotation,
};

/// One shape's result. `error` is a category with a sentence, never a raw
/// Windows message — those quote handles and paths.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotation: Option<Annotation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AnnotationError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl From<Result<Annotation, AnnotationError>> for AnnotationResult {
    fn from(result: Result<Annotation, AnnotationError>) -> Self {
        match result {
            Ok(annotation) => Self {
                ok: true,
                annotation: Some(annotation),
                error: None,
                message: None,
            },
            Err(error) => Self {
                ok: false,
                annotation: None,
                error: Some(error),
                message: Some(error.message().to_string()),
            },
        }
    }
}

#[tauri::command]
pub fn annotation_create(
    manager: State<AnnotationManager>,
    request: CreateAnnotation,
) -> AnnotationResult {
    manager.create(request).into()
}

#[tauri::command]
pub fn annotation_update(
    manager: State<AnnotationManager>,
    id: String,
    scope: Scope,
    change: UpdateAnnotation,
) -> AnnotationResult {
    manager.update(&id, &scope, change).into()
}

#[tauri::command]
pub fn annotation_remove(
    manager: State<AnnotationManager>,
    id: String,
    scope: Scope,
) -> AnnotationResult {
    match manager.remove(&id, &scope) {
        Ok(()) => AnnotationResult {
            ok: true,
            annotation: None,
            error: None,
            message: None,
        },
        Err(error) => AnnotationResult {
            ok: false,
            annotation: None,
            error: Some(error),
            message: Some(error.message().to_string()),
        },
    }
}

#[tauri::command]
pub fn annotation_list(manager: State<AnnotationManager>, scope: Scope) -> Vec<Annotation> {
    manager.list(&scope)
}

/// Annotations on one target, newest first — how "the circle" is resolved.
#[tauri::command]
pub fn annotation_by_target(
    manager: State<AnnotationManager>,
    scope: Scope,
    target_id: String,
) -> Vec<Annotation> {
    manager.by_target(&scope, &target_id)
}

#[tauri::command]
pub fn annotation_clear_request(manager: State<AnnotationManager>, request_id: String) -> usize {
    manager.clear_request(&request_id)
}

#[tauri::command]
pub fn annotation_clear_conversation(
    manager: State<AnnotationManager>,
    conversation_id: String,
) -> usize {
    manager.clear_conversation(&conversation_id)
}

#[tauri::command]
pub fn annotation_clear_all_temporary(manager: State<AnnotationManager>) -> usize {
    manager.clear_all_temporary()
}

#[tauri::command]
pub fn annotation_census(manager: State<AnnotationManager>) -> Census {
    manager.census()
}

/// The source window moved by this much; shift its annotations.
#[tauri::command]
pub fn annotation_window_moved(
    manager: State<AnnotationManager>,
    source_window_id: String,
    dx: i32,
    dy: i32,
) -> usize {
    manager.translate_window(&source_window_id, dx, dy)
}

/// The source window was minimised or restored.
#[tauri::command]
pub fn annotation_window_visibility(
    manager: State<AnnotationManager>,
    source_window_id: String,
    visible: bool,
) -> usize {
    manager.set_window_visible(&source_window_id, visible)
}

#[tauri::command]
pub fn annotation_source_closed(
    manager: State<AnnotationManager>,
    source_window_id: String,
) -> usize {
    manager.source_closed(&source_window_id)
}
