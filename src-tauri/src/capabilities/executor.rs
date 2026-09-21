//! Central dispatcher: one Tauri command executes any native capability.
//! Strict serde validation (unknown fields rejected), risk policy and
//! confirmation gates run here — the webview cannot bypass them.

use serde_json::json;
// `Manager` brings `AppHandle::state`, which the download capabilities need to
// reach the one `DownloadStore` — progress has to be pollable from the same
// store the transfer is writing to, or "is it done yet?" has nothing to read.
use tauri::{AppHandle, Manager, State};

use super::audit::{new_audit_id, AuditStore, CapabilityAuditRecord};
use super::confirmation::ConfirmationStore;
#[cfg(windows)]
use super::desktop_items;
use super::hardware;
use super::types::{invalid_args, ResultBuilder, ToolResult, ToolResultStatus};
use super::{
    applications, clipboard, file_edit, filesystem, input, screenshots, system, web, windows,
};
use crate::watch::adapters as watch_adapters;

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
        | "filesystem.read_for_edit"
        | "desktop.find_item"
        | "desktop.list_items"
        | "applications.resolve"
        | "applications.list"
        | "applications.refresh_index"
        | "windows.list"
        | "windows.get_active"
        | "screen.capture"
        | "screen.list_capture_targets"
        | "web.fetch_page"
        | "clipboard.read_text"
        // Watched-application reads. Read-only in the strict sense: they report
        // what an application is already doing and change nothing about it.
        | "spotify.get_playback"
        | "applications.get_window_context"
        | "vscode.get_context"
        | "vscode.get_diagnostics"
        | "vscode.list_tasks"
        | "vscode.bridge_status"
        | "discord_desktop.get_current_location"
        | "discord_desktop.get_visible_controls"
        | "discord_desktop.get_visible_messages"
        | "browser.get_page_context"
        // Reading a page's structure and inspecting a file already on disk.
        // Neither reaches the browser, changes anything, or runs anything.
        | "browser.find_link"
        | "browser.get_downloads"
        | "browser.wait_for_download"
        | "installer.inspect"
        | "installer.list_installed"
        | "installer.verify" => Risk::ReadOnly,
        "filesystem.create_directory"
        | "filesystem.create_file"
        | "filesystem.copy"
        | "filesystem.reveal_in_explorer"
        | "filesystem.open_item"
        | "applications.open"
        | "applications.open_with"
        | "system.set_volume"
        | "system.set_brightness"
        | "screen.record"
        | "applications.focus"
        | "windows.focus"
        | "windows.minimize"
        | "windows.maximize"
        | "windows.restore"
        | "windows.move_resize"
        | "web.open_url"
        | "web.search"
        | "web.activate_listed_item"
        | "input.click_at"
        | "input.type_text"
        | "input.press_keys"
        | "input.scroll"
        | "clipboard.write_text"
        // Transport commands and focus. Reversible by definition — the opposite
        // command exists and the user can see the result immediately.
        | "spotify.play"
        | "spotify.pause"
        | "spotify.next"
        | "spotify.previous"
        | "applications.focus_watched"
        // Running a task the workspace already declares is what the user asked
        // for; the gate that matters is that the name must exist, and that is
        // enforced by the extension rather than by a confirmation prompt.
        | "vscode.run_task"
        | "vscode.start_debug"
        | "vscode.stop_task"
        | "browser.navigate"
        // A download writes one new file into Downloads and runs nothing.
        // Installing is a separate capability at a separate risk level, which
        // is what lets the question sit at the elevation boundary instead of
        // in front of the download.
        | "browser.download" => Risk::Reversible,
        // Editing a file the user pointed at is the request, not a hazard to
        // gate: the confirmation belongs on destroying content, not on changing
        // it in the way that was asked for.
        "filesystem.modify_file"
        | "filesystem.read_text_file"
        | "filesystem.write_text_file"
        | "filesystem.rename"
        | "filesystem.move"
        | "applications.close"
        | "windows.close"
        // Preparing is safe; sending reaches another person and cannot be
        // taken back, which is what `Sensitive` means here.
        | "discord_desktop.prepare_message"
        | "discord_desktop.send_message" => Risk::Sensitive,
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
    run_id: Option<&str>,
) -> Result<(), ToolResult> {
    match confirmation_token {
        Some(token) => store
            .consume_for_run(token, capability_id, args, run_id)
            .map(|_| ())
            .map_err(|e| {
                ResultBuilder::new(capability_id).denied(e.message(), "confirmation-invalid")
            }),
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
    confirmations: &ConfirmationStore,
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
                Ok(a) => {
                    filesystem::create_or_write_file(capability_id, a, confirmed, confirmations)
                }
                Err(r) => r,
            }
        }
        "filesystem.read_text_file" => match parse(capability_id, &args) {
            Ok(a) => filesystem::read_text_file(a),
            Err(r) => r,
        },
        "filesystem.read_for_edit" => match parse(capability_id, &args) {
            Ok(a) => file_edit::read_for_edit(a),
            Err(r) => r,
        },
        #[cfg(windows)]
        "desktop.find_item" => match parse(capability_id, &args) {
            Ok(a) => desktop_items::find_item(a),
            Err(r) => r,
        },
        #[cfg(windows)]
        "desktop.list_items" => desktop_items::list_items(),
        "filesystem.modify_file" => match parse(capability_id, &args) {
            Ok(a) => file_edit::modify_file(a),
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
        "system.set_volume" => match parse(capability_id, &args) {
            Ok(a) => hardware::set_volume(a),
            Err(r) => r,
        },
        "system.set_brightness" => match parse(capability_id, &args) {
            Ok(a) => hardware::set_brightness(a),
            Err(r) => r,
        },
        "screen.record" => match parse(capability_id, &args) {
            Ok(a) => hardware::screen_record(a),
            Err(r) => r,
        },
        "applications.open_with" => match parse(capability_id, &args) {
            Ok(a) => applications::open_with(app, a),
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

        "input.click_at" => match parse(capability_id, &args) {
            Ok(a) => input::click_at(app, a),
            Err(r) => r,
        },
        "input.type_text" => match parse(capability_id, &args) {
            Ok(a) => input::type_text(app, a),
            Err(e) => e,
        },
        "input.press_keys" => match parse(capability_id, &args) {
            Ok(a) => input::press_keys(app, a),
            Err(e) => e,
        },
        "input.scroll" => match parse(capability_id, &args) {
            Ok(a) => input::scroll(app, a),
            Err(e) => e,
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
        "web.fetch_page" => match parse(capability_id, &args) {
            Ok(a) => web::fetch_page(a),
            Err(r) => r,
        },
        "web.activate_listed_item" => match parse(capability_id, &args) {
            Ok(a) => web::activate_listed_item(a),
            Err(r) => r,
        },

        // ---- watched applications -----------------------------------------
        "spotify.get_playback" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::get_playback(a),
            Err(r) => r,
        },
        "spotify.play" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::media_command(
                "spotify.play",
                crate::watch::media::MediaCommand::Play,
                a,
            ),
            Err(r) => r,
        },
        "spotify.pause" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::media_command(
                "spotify.pause",
                crate::watch::media::MediaCommand::Pause,
                a,
            ),
            Err(r) => r,
        },
        "spotify.next" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::media_command(
                "spotify.next",
                crate::watch::media::MediaCommand::Next,
                a,
            ),
            Err(r) => r,
        },
        "spotify.previous" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::media_command(
                "spotify.previous",
                crate::watch::media::MediaCommand::Previous,
                a,
            ),
            Err(r) => r,
        },
        "applications.focus_watched" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::focus_instance(a),
            Err(r) => r,
        },
        "applications.get_window_context" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::get_instance_context(app, a),
            Err(r) => r,
        },
        "vscode.get_context" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::vscode_get_context(a),
            Err(r) => r,
        },
        "vscode.get_diagnostics" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::vscode_get_diagnostics(a),
            Err(r) => r,
        },
        "vscode.list_tasks" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::vscode_list_tasks(a),
            Err(r) => r,
        },
        "vscode.run_task" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::vscode_run_task(a),
            Err(r) => r,
        },
        "vscode.start_debug" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::vscode_start_debug(a),
            Err(r) => r,
        },
        "vscode.stop_task" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::vscode_stop_task(a),
            Err(r) => r,
        },
        "vscode.bridge_status" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::vscode_bridge_status(a),
            Err(r) => r,
        },
        "discord_desktop.get_current_location" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::discord_get_location(app, a),
            Err(r) => r,
        },
        "discord_desktop.get_visible_controls" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::discord_get_controls(a),
            Err(r) => r,
        },
        "discord_desktop.get_visible_messages" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::discord_get_messages(app, a),
            Err(r) => r,
        },
        "discord_desktop.prepare_message" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::discord_prepare_message(a),
            Err(r) => r,
        },
        "discord_desktop.send_message" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::discord_send_message(a),
            Err(r) => r,
        },
        "browser.get_page_context" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::browser_get_context(app, a),
            Err(r) => r,
        },
        "browser.navigate" => match parse(capability_id, &args) {
            Ok(a) => watch_adapters::browser_navigate(a),
            Err(r) => r,
        },

        // The download-to-installer workflow. Routed through the same
        // dispatcher as everything else so the risk gate, the audit record and
        // the confirmation policy apply to it identically — a capability that
        // reached the frontend by its own route would be a capability outside
        // the permission system.
        "browser.find_link" => match parse(capability_id, &args) {
            Ok(a) => crate::browser::commands::find_link(a),
            Err(r) => r,
        },
        "browser.download" => match parse(capability_id, &args) {
            Ok(a) => {
                crate::browser::commands::start_download(&app.state::<crate::browser::DownloadStore>(), a)
            }
            Err(r) => r,
        },
        "browser.wait_for_download" => match parse(capability_id, &args) {
            Ok(a) => crate::browser::commands::download_progress(
                &app.state::<crate::browser::DownloadStore>(),
                a,
            ),
            Err(r) => r,
        },
        "browser.get_downloads" => {
            crate::browser::commands::list_downloads(&app.state::<crate::browser::DownloadStore>())
        }
        "installer.inspect" => match parse(capability_id, &args) {
            Ok(a) => crate::browser::commands::inspect_installer(a),
            Err(r) => r,
        },
        "installer.list_installed" => crate::browser::commands::list_installed(),
        "installer.verify" => match parse(capability_id, &args) {
            Ok(a) => crate::browser::commands::verify_install(a),
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
            run_id.as_deref(),
        ) {
            Ok(()) => confirmed = true,
            Err(result) => return result,
        }
    } else if let Some(token) = confirmation_token.as_deref() {
        // Non-destructive confirmations (e.g. overwrite) reuse the same store.
        // A grant issued for another run is refused outright rather than
        // ignored: silently continuing unconfirmed would ask the user again,
        // which is the loop this whole area exists to prevent.
        match confirmations.consume_for_run(token, &capability_id, &args, run_id.as_deref()) {
            Ok(_) => confirmed = true,
            Err(super::confirmation::GrantError::WrongRun) => {
                return ResultBuilder::new(&capability_id).denied(
                    super::confirmation::GrantError::WrongRun.message(),
                    "wrong-run",
                );
            }
            // A token that does not match is *said*, not swallowed.
            //
            // Swallowing it left `confirmed` false, which sent the call back
            // out as another `needs-confirmation` — identical to the one the
            // user had just approved. The user saw the same question again with
            // no explanation, answered it again, and got it a third time. An
            // approval that cannot be matched is a bug to surface, not a reason
            // to re-ask silently.
            Err(e @ super::confirmation::GrantError::ActionChanged)
            | Err(e @ super::confirmation::GrantError::Expired) => {
                return ResultBuilder::new(&capability_id)
                    .denied(e.message(), "confirmation-invalid");
            }
            // `Unknown` stays permissive: the frontend sends the sentinel
            // "user-approved" for capabilities it confirmed itself, which was
            // never issued here and has no fingerprint to check.
            Err(super::confirmation::GrantError::Unknown) => {}
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

    let result = dispatch(&app, &capability_id, args, confirmed, &confirmations);

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
