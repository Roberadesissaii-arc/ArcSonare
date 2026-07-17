//! Central dispatcher: one Tauri command executes any native capability.
//! Strict serde validation (unknown fields rejected), risk policy and
//! confirmation gates run here — the webview cannot bypass them.

use serde_json::json;
use tauri::{AppHandle, State};

use super::audit::{new_audit_id, AuditStore, CapabilityAuditRecord};
use super::confirmation::ConfirmationStore;
use super::types::{invalid_args, ResultBuilder, ToolResult, ToolResultStatus};
use super::{applications, clipboard, filesystem, screenshots, system, web, windows};

/// Risk levels enforced natively regardless of frontend behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Risk {
    ReadOnly,
    Reversible,
    Sensitive,
    Destructive,
}

pub fn risk_for(capability_id: &str) -> Option<Risk> {
    Some(match capability_id {
        "system.get_local_datetime"
        | "system.get_environment_summary"
        | "system.get_running_processes"
        | "system.get_active_window"
        | "system.list_displays"
        | "system.get_battery_status"
        | "system.get_audio_status"
        | "filesystem.resolve_known_folder"
        | "filesystem.list_directory"
        | "filesystem.list_known_folder"
        | "filesystem.get_metadata"
        | "filesystem.get_directory_summary"
        | "filesystem.get_disk_space"
        | "filesystem.find"
        | "applications.resolve"
        | "applications.list"
        | "applications.refresh_index"
        | "windows.list"
        | "windows.get_active"
        | "screen.capture"
        | "screen.list_capture_targets"
        | "clipboard.read_text" => Risk::ReadOnly,
        "filesystem.create_directory"
        | "filesystem.create_file"
        | "filesystem.copy"
        | "filesystem.reveal_in_explorer"
        | "filesystem.open_item"
        | "applications.open"
        | "applications.focus"
        | "windows.focus"
        | "windows.minimize"
        | "windows.maximize"
        | "windows.restore"
        | "windows.move_resize"
        | "web.open_url"
        | "web.search"
        | "clipboard.write_text" => Risk::Reversible,
        "filesystem.read_text_file"
        | "filesystem.write_text_file"
        | "filesystem.rename"
        | "filesystem.move"
        | "applications.close"
        | "windows.close" => Risk::Sensitive,
        "filesystem.delete" => Risk::Destructive,
        _ => return None,
    })
}

fn parse<T: serde::de::DeserializeOwned>(
    capability_id: &str,
    args: &serde_json::Value,
) -> Result<T, ToolResult> {
    serde_json::from_value(args.clone()).map_err(|e| invalid_args(capability_id, &e.to_string()))
}

/// Destructive gate: without a valid token, return the confirmation request.
fn destructive_gate(
    store: &ConfirmationStore,
    capability_id: &str,
    args: &serde_json::Value,
    confirmation_token: Option<&str>,
) -> Result<(), ToolResult> {
    match confirmation_token {
        Some(token) => store
            .consume(token, capability_id, args)
            .map_err(|e| ResultBuilder::new(capability_id).denied(e, "confirmation-invalid")),
        None => {
            // Build the confirmation payload (delete is the only destructive op).
            let rb = ResultBuilder::new(capability_id);
            if capability_id == "filesystem.delete" {
                let delete_args: filesystem::DeleteArgs = match parse(capability_id, args) {
                    Ok(a) => a,
                    Err(r) => return Err(r),
                };
                let permanent = delete_args.mode.as_deref() == Some("permanent");
                let affected = match filesystem::describe_delete(&delete_args) {
                    Ok(items) => items,
                    Err(e) => {
                        return Err(ResultBuilder::new(capability_id).error(
                            "delete-preflight-failed",
                            e,
                            true,
                        ))
                    }
                };
                let (token, expires_at) = store.issue(capability_id, args);
                let title = if permanent {
                    "Permanently delete?"
                } else {
                    "Move to the Recycle Bin?"
                };
                let consequence = if permanent {
                    "These items will be permanently deleted and cannot be recovered."
                } else {
                    "Items go to the Recycle Bin and can be restored from there."
                };
                return Err(rb.needs_confirmation(
                    format!(
                        "Confirmation required before deleting {} item{}.",
                        affected.len(),
                        if affected.len() == 1 { "" } else { "s" }
                    ),
                    json!({
                        "confirmation": {
                            "token": token,
                            "capabilityId": capability_id,
                            "title": title,
                            "description": "ArcSonare will not delete anything until you approve.",
                            "riskLevel": "destructive",
                            "affectedItems": affected,
                            "reversible": !permanent,
                            "consequence": consequence,
                            "expiresAt": expires_at,
                        }
                    }),
                ));
            }
            Err(rb.denied(
                "This destructive capability requires confirmation.",
                "confirmation-required",
            ))
        }
    }
}

fn dispatch(
    app: &AppHandle,
    capability_id: &str,
    args: serde_json::Value,
    confirmed: bool,
) -> ToolResult {
    match capability_id {
        "system.get_local_datetime" => match parse(capability_id, &args) {
            Ok(a) => system::get_local_datetime(a),
            Err(r) => r,
        },
        "system.get_environment_summary" => system::get_environment_summary(app),
        "system.get_running_processes" => system::get_running_processes(),
        "system.get_active_window" => system::get_active_window(),
        "system.list_displays" => system::list_displays(),
        "system.get_battery_status" => system::get_battery_status(),
        "system.get_audio_status" => system::get_audio_status(),

        "filesystem.resolve_known_folder" => match parse(capability_id, &args) {
            Ok(a) => filesystem::resolve_known_folder(a),
            Err(r) => r,
        },
        "filesystem.list_directory" => match parse(capability_id, &args) {
            Ok(a) => filesystem::list_directory(a),
            Err(r) => r,
        },
        "filesystem.list_known_folder" => match parse(capability_id, &args) {
            Ok(a) => filesystem::list_known_folder(a),
            Err(r) => r,
        },
        "filesystem.get_metadata" => match parse(capability_id, &args) {
            Ok(a) => filesystem::get_metadata(a),
            Err(r) => r,
        },
        "filesystem.get_directory_summary" => match parse(capability_id, &args) {
            Ok(a) => filesystem::get_directory_summary(a),
            Err(r) => r,
        },
        "filesystem.get_disk_space" => match parse(capability_id, &args) {
            Ok(a) => filesystem::get_disk_space(a),
            Err(r) => r,
        },
        "filesystem.find" => match parse(capability_id, &args) {
            Ok(a) => filesystem::find(a),
            Err(r) => r,
        },
        "filesystem.create_directory" => match parse(capability_id, &args) {
            Ok(a) => filesystem::create_directory(a),
            Err(r) => r,
        },
        "filesystem.create_file" | "filesystem.write_text_file" => {
            match parse(capability_id, &args) {
                Ok(a) => filesystem::create_or_write_file(capability_id, a, confirmed),
                Err(r) => r,
            }
        }
        "filesystem.read_text_file" => match parse(capability_id, &args) {
            Ok(a) => filesystem::read_text_file(a),
            Err(r) => r,
        },
        "filesystem.rename" => match parse(capability_id, &args) {
            Ok(a) => filesystem::rename(a),
            Err(r) => r,
        },
        "filesystem.move" => match parse(capability_id, &args) {
            Ok(a) => filesystem::move_item(a),
            Err(r) => r,
        },
        "filesystem.copy" => match parse(capability_id, &args) {
            Ok(a) => filesystem::copy_item(a),
            Err(r) => r,
        },
        "filesystem.delete" => match parse(capability_id, &args) {
            Ok(a) => filesystem::delete(a),
            Err(r) => r,
        },
        "filesystem.reveal_in_explorer" => match parse(capability_id, &args) {
            Ok(a) => filesystem::reveal_in_explorer(a),
            Err(r) => r,
        },
        "filesystem.open_item" => match parse(capability_id, &args) {
            Ok(a) => filesystem::open_item(a),
            Err(r) => r,
        },

        "applications.resolve" => match parse(capability_id, &args) {
            Ok(a) => applications::resolve(app, a),
            Err(r) => r,
        },
        "applications.open" => match parse(capability_id, &args) {
            Ok(a) => applications::open_application(app, a),
            Err(r) => r,
        },
        "applications.list" => match parse(capability_id, &args) {
            Ok(a) => applications::list_applications(app, a),
            Err(r) => r,
        },
        "applications.refresh_index" => match parse(capability_id, &args) {
            Ok(a) => applications::refresh_index(app, a),
            Err(r) => r,
        },
        "applications.focus" => match parse(capability_id, &args) {
            Ok(a) => applications::focus_application(app, a),
            Err(r) => r,
        },
        "applications.close" => match parse(capability_id, &args) {
            Ok(a) => applications::close_application(app, a),
            Err(r) => r,
        },

        "windows.list" => match parse(capability_id, &args) {
            Ok(a) => windows::list_windows(a),
            Err(r) => r,
        },
        "windows.get_active" => system::get_active_window(),
        "windows.focus" => match parse(capability_id, &args) {
            Ok(a) => windows::focus_window(a),
            Err(r) => r,
        },
        "windows.minimize" => match parse(capability_id, &args) {
            Ok(a) => windows::minimize_window(a),
            Err(r) => r,
        },
        "windows.maximize" => match parse(capability_id, &args) {
            Ok(a) => windows::maximize_window(a),
            Err(r) => r,
        },
        "windows.restore" => match parse(capability_id, &args) {
            Ok(a) => windows::restore_window(a),
            Err(r) => r,
        },
        "windows.move_resize" => match parse(capability_id, &args) {
            Ok(a) => windows::move_resize_window(a),
            Err(r) => r,
        },
        "windows.close" => match parse(capability_id, &args) {
            Ok(a) => windows::close_window(a),
            Err(r) => r,
        },

        "screen.capture" => match parse(capability_id, &args) {
            Ok(a) => screenshots::capture(app, a),
            Err(r) => r,
        },
        "screen.list_capture_targets" => match parse(capability_id, &args) {
            Ok(a) => screenshots::list_capture_targets(a),
            Err(r) => r,
        },

        "clipboard.read_text" => match parse(capability_id, &args) {
            Ok(a) => clipboard::read_text(a),
            Err(r) => r,
        },
        "clipboard.write_text" => match parse(capability_id, &args) {
            Ok(a) => clipboard::write_text(a),
            Err(r) => r,
        },

        "web.open_url" => match parse(capability_id, &args) {
            Ok(a) => web::open_url(a),
            Err(r) => r,
        },
        "web.search" => match parse(capability_id, &args) {
            Ok(a) => web::search(a),
            Err(r) => r,
        },

        other => ResultBuilder::new(other).error(
            "unknown-capability",
            format!("\"{other}\" is not a native capability."),
            false,
        ),
    }
}

fn status_label(status: ToolResultStatus) -> &'static str {
    match status {
        ToolResultStatus::Success => "success",
        ToolResultStatus::Partial => "partial",
        ToolResultStatus::NeedsConfirmation => "needs-confirmation",
        ToolResultStatus::Cancelled => "cancelled",
        ToolResultStatus::Denied => "denied",
        ToolResultStatus::NotFound => "not-found",
        ToolResultStatus::Unsupported => "unsupported",
        ToolResultStatus::Timeout => "timeout",
        ToolResultStatus::Error => "error",
    }
}

#[tauri::command]
pub fn capability_execute(
    app: AppHandle,
    confirmations: State<ConfirmationStore>,
    audit: State<AuditStore>,
    capability_id: String,
    args: serde_json::Value,
    run_id: Option<String>,
    user_request_summary: Option<String>,
    confirmation_token: Option<String>,
) -> ToolResult {
    let Some(risk) = risk_for(&capability_id) else {
        return ResultBuilder::new(&capability_id).error(
            "unknown-capability",
            format!("\"{capability_id}\" is not a native capability."),
            false,
        );
    };

    let mut confirmed = false;
    if risk == Risk::Destructive {
        match destructive_gate(
            &confirmations,
            &capability_id,
            &args,
            confirmation_token.as_deref(),
        ) {
            Ok(()) => confirmed = true,
            Err(result) => return result,
        }
    } else if let Some(token) = confirmation_token.as_deref() {
        // Non-destructive confirmations (e.g. overwrite) reuse the same store.
        if confirmations.consume(token, &capability_id, &args).is_ok() {
            confirmed = true;
        }
    }
    // Overwrite-style confirmations arrive as an if_exists escalation from the
    // frontend after its own confirm dialog; treat presence of a token OR the
    // frontend confirm flag in args handled per-capability.
    if let Some(flag) = args.get("confirmed").and_then(|v| v.as_bool()) {
        // "confirmed" is not a real capability argument; reject it to prevent
        // the model from self-approving.
        let _ = flag;
        return ResultBuilder::new(&capability_id).error(
            "invalid-arguments",
            "\"confirmed\" is not an accepted argument.",
            true,
        );
    }

    let result = dispatch(&app, &capability_id, args, confirmed);

    // Audit every execution (operational summary only).
    audit.record(
        &app,
        CapabilityAuditRecord {
            id: new_audit_id(),
            run_id: run_id.unwrap_or_else(|| "adhoc".into()),
            capability_id: capability_id.clone(),
            user_request_summary: user_request_summary
                .unwrap_or_default()
                .chars()
                .take(200)
                .collect(),
            action_summary: result.summary.chars().take(300).collect(),
            status: status_label(result.status).into(),
            affected_resource: result
                .artifacts
                .as_ref()
                .and_then(|a| a.first())
                .and_then(|a| a.path.clone()),
            confirmation_used: confirmed,
            started_at: result.started_at.clone(),
            completed_at: result.completed_at.clone(),
            duration_ms: result.duration_ms,
            error_code: result.error.as_ref().map(|e| e.code.clone()),
        },
    );
    result
}

/// Issue a confirmation token for a non-destructive confirm flow (overwrite).
#[tauri::command]
pub fn capability_confirm_prepare(
    confirmations: State<ConfirmationStore>,
    capability_id: String,
    args: serde_json::Value,
) -> serde_json::Value {
    let (token, expires_at) = confirmations.issue(&capability_id, &args);
    json!({ "token": token, "expiresAt": expires_at })
}

#[tauri::command]
pub fn capability_audit_list(
    app: AppHandle,
    audit: State<AuditStore>,
    limit: Option<usize>,
) -> Vec<CapabilityAuditRecord> {
    audit.list(&app, limit.unwrap_or(100))
}

#[tauri::command]
pub fn capability_audit_clear(app: AppHandle, audit: State<AuditStore>) {
    audit.clear(&app);
}

/// Health snapshot for the native capability surface.
#[tauri::command]
pub fn capability_health(app: AppHandle) -> serde_json::Value {
    let mut checks = Vec::new();
    let now = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    // Clock is healthy when the OS returns a plausible year.
    let clock_ok = chrono::Local::now().timestamp() > 1_600_000_000;
    checks.push(json!({
        "capabilityId": "system.get_local_datetime",
        "status": if clock_ok { "healthy" } else { "degraded" },
        "checkedAt": now,
    }));

    let desktop_ok = dirs::desktop_dir().map(|p| p.is_dir()).unwrap_or(false);
    checks.push(json!({
        "capabilityId": "filesystem.list_known_folder",
        "status": if desktop_ok { "healthy" } else { "degraded" },
        "checkedAt": now,
        "message": if desktop_ok { serde_json::Value::Null } else { json!("Desktop known folder did not resolve") },
    }));

    let displays_ok = xcap::Monitor::all().map(|m| !m.is_empty()).unwrap_or(false);
    checks.push(json!({
        "capabilityId": "screen.capture",
        "status": if displays_ok { "healthy" } else { "unavailable" },
        "checkedAt": now,
        "message": if displays_ok { serde_json::Value::Null } else { json!("No capturable displays detected") },
    }));

    let index = applications::get_index(&app, false);
    let installed = index.iter().filter(|e| e.installed).count();
    checks.push(json!({
        "capabilityId": "applications.open",
        "status": if installed > 0 { "healthy" } else { "degraded" },
        "checkedAt": now,
        "message": if installed > 0 { serde_json::Value::Null } else { json!("Application index is empty — try refreshing") },
    }));

    let clipboard_ok = arboard::Clipboard::new().is_ok();
    checks.push(json!({
        "capabilityId": "clipboard.read_text",
        "status": if clipboard_ok { "healthy" } else { "unavailable" },
        "checkedAt": now,
    }));

    checks.push(json!({
        "capabilityId": "system.get_audio_status",
        "status": "unavailable",
        "checkedAt": now,
        "message": "Audio status is not implemented in this build",
    }));

    json!({ "checks": checks, "checkedAt": now })
}
