//! The display mapping wizard's state, and the commands that drive it.
//!
//! The wizard checks one thing: that a point ArcSonare calculates is the point
//! the user's mouse actually reaches. That is a claim about geometry only.
//! Passing it says nothing about whether a vision model can identify what is at
//! that point — the two are reported separately and must never be conflated,
//! because a verified mapping applied to a misidentified target is exactly the
//! confident wrong answer this codebase keeps having to design out.
//!
//! Every coordinate here is produced by Rust. The webview renders instructions
//! and progress; it never computes a physical point, and the sampled position
//! comes from `GetCursorPos` rather than from a browser event, because a browser
//! event is in CSS pixels inside a window that may be on another monitor.

#![cfg(windows)]

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use super::identity::{enumerate_monitor_identities, MonitorIdentity};
use super::mapping::{
    choose_correction, fit_affine, nine_point_targets, random_validation_targets, reject_outliers,
    summarise, to_desktop, AffineTransform, CorrectionDecision, DisplayMappingSample,
    PhysicalPoint, TargetPosition, ValidationSummary, RANDOM_VALIDATION_POINTS,
};
use super::profile_store::{
    load_from, save_to, DisplayProfileStatus, DisplayProfileStore, PersistedDisplayProfile,
    StoredRect,
};

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("could not resolve the config directory: {e}"))
}

// ---------------------------------------------------------------------------
// What the UI is shown
// ---------------------------------------------------------------------------

/// One monitor, as the settings page and wizard list it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfigurationSummary {
    /// The stable hardware identity. This is the id every command takes.
    pub display_id: String,
    pub friendly_name: String,
    /// Shown to the user as "Display A", "Display B" — position in the list.
    pub label: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub rotation_degrees: i32,
    pub primary: bool,
    pub orientation: &'static str,
    /// Present only while the display is attached.
    pub connected: bool,
    pub status: DisplayProfileStatus,
    pub average_error_px: f64,
    pub maximum_error_px: f64,
    pub sample_count: usize,
    pub configured_at_ms: u64,
    pub validated_at_ms: u64,
    pub needs_configuration: bool,
    pub allows_visual_interaction: bool,
    /// Diagnostics only — never persisted, changes every run.
    pub runtime_display_id: Option<u32>,
}

fn orientation_of(width: u32, height: u32) -> &'static str {
    if height > width {
        "Portrait"
    } else {
        "Landscape"
    }
}

fn letter_for(index: usize) -> String {
    // A, B, C … then AA if someone really has 27 monitors.
    let mut label = String::new();
    let mut n = index;
    loop {
        label.insert(0, (b'A' + (n % 26) as u8) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    format!("Display {label}")
}

/// Scale is a float, so it is compared with a tolerance rather than exactly.
///
/// Windows reports 125% as 1.25 and 150% as 1.5, so anything under half a
/// percent is representation noise and not a real change. Wide enough to never
/// fire spuriously, far narrower than the smallest step Windows offers.
const SCALE_EPSILON: f64 = 0.005;

fn resolution_changed(profile: &PersistedDisplayProfile, identity: &MonitorIdentity) -> bool {
    profile.physical_bounds.width != identity.width
        || profile.physical_bounds.height != identity.height
}

fn scale_changed(profile: &PersistedDisplayProfile, identity: &MonitorIdentity) -> bool {
    (profile.scale_factor - identity.scale_factor).abs() > SCALE_EPSILON
}

fn rotation_changed(profile: &PersistedDisplayProfile, identity: &MonitorIdentity) -> bool {
    profile.rotation_degrees != identity.rotation_degrees
}

/// Which properties differ, for showing the user what changed.
///
/// Reads from the same three comparisons `reconcile` uses, so what Settings
/// displays and what the gate enforces cannot disagree.
pub fn changed_properties(
    profile: &PersistedDisplayProfile,
    identity: &MonitorIdentity,
) -> Vec<String> {
    let mut changed = Vec::new();
    if resolution_changed(profile, identity) {
        changed.push("resolution".to_string());
    }
    if scale_changed(profile, identity) {
        changed.push("scale".to_string());
    }
    if rotation_changed(profile, identity) {
        changed.push("rotation".to_string());
    }
    changed
}

/// Compare what is plugged in against what was measured.
///
/// A stored profile stops being evidence when the thing it describes changes.
/// Position deliberately does not count: everything downstream reads live
/// bounds, so dragging a monitor in Windows Display Settings invalidates
/// nothing the nine-point run measured, and re-asking would train the user to
/// click through the wizard — which is how a real failure gets clicked through.
fn reconcile(
    identity: &MonitorIdentity,
    stored: Option<&PersistedDisplayProfile>,
) -> DisplayProfileStatus {
    let Some(profile) = stored else {
        return DisplayProfileStatus::Unconfigured;
    };
    if profile.ignored || profile.status == DisplayProfileStatus::Ignored {
        return DisplayProfileStatus::Ignored;
    }
    if profile.status == DisplayProfileStatus::Failed {
        return DisplayProfileStatus::Failed;
    }
    // Anything that changes where a coordinate lands makes the measurement no
    // longer a description of this screen.
    //
    // Scale counts. A profile measured at 100% and used at 125% is wrong by a
    // quarter of the distance from the origin — on the 3840-wide monitor that is
    // hundreds of pixels at the right-hand edge, which is exactly the confident
    // wrong click this subsystem exists to prevent. The saved value is never
    // quietly updated to match; the user is asked to re-check, because only a
    // measurement can say whether the correction is still right.
    if resolution_changed(profile, identity)
        || scale_changed(profile, identity)
        || rotation_changed(profile, identity)
    {
        return DisplayProfileStatus::Stale;
    }
    if profile.status == DisplayProfileStatus::Valid {
        DisplayProfileStatus::Valid
    } else {
        DisplayProfileStatus::Unconfigured
    }
}

/// Every attached monitor plus every remembered one that is not.
pub fn configuration_summary<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<DisplayConfigurationSummary>, String> {
    let identities = enumerate_monitor_identities()?;
    let store = load_from(&config_dir(app)?).0;
    let topology = super::topology::read_topology().ok();
    let pairs = topology
        .as_ref()
        .map(|t| super::identity::pair_with_topology(&identities, t))
        .unwrap_or_default();

    let mut summaries: Vec<DisplayConfigurationSummary> = identities
        .iter()
        .enumerate()
        .map(|(index, identity)| {
            let key = identity.stable_key();
            let stored = store.get(&key);
            let status = reconcile(identity, stored);
            let scale = topology
                .as_ref()
                .and_then(|t| {
                    t.displays
                        .iter()
                        .find(|d| d.x == identity.x && d.y == identity.y)
                        .map(|d| d.scale_factor)
                })
                .unwrap_or(1.0);
            let rotation = topology
                .as_ref()
                .and_then(|t| {
                    t.displays
                        .iter()
                        .find(|d| d.x == identity.x && d.y == identity.y)
                        .map(|d| d.rotation as i32)
                })
                .unwrap_or(0);
            DisplayConfigurationSummary {
                display_id: key.clone(),
                friendly_name: if identity.friendly_name.is_empty() {
                    "Display".to_string()
                } else {
                    identity.friendly_name.clone()
                },
                label: letter_for(index),
                x: identity.x,
                y: identity.y,
                width: identity.width,
                height: identity.height,
                scale_factor: scale,
                rotation_degrees: rotation,
                primary: identity.primary,
                orientation: orientation_of(identity.width, identity.height),
                connected: true,
                status,
                average_error_px: stored.map(|p| p.average_error_px).unwrap_or(0.0),
                maximum_error_px: stored.map(|p| p.maximum_error_px).unwrap_or(0.0),
                sample_count: stored.map(|p| p.mapping_samples.len()).unwrap_or(0),
                configured_at_ms: stored.map(|p| p.configured_at_ms).unwrap_or(0),
                validated_at_ms: stored.map(|p| p.validated_at_ms).unwrap_or(0),
                needs_configuration: status.needs_configuration(),
                allows_visual_interaction: status.allows_visual_interaction(),
                runtime_display_id: pairs.iter().find(|(k, _)| *k == key).map(|(_, id)| *id),
            }
        })
        .collect();

    // Remembered monitors that are not plugged in right now. Kept and shown
    // rather than deleted: unplugging a screen for the afternoon must not cost
    // the measurement.
    let attached: Vec<String> = identities.iter().map(|i| i.stable_key()).collect();
    for profile in store.profiles.iter() {
        if attached.contains(&profile.stable_identity) {
            continue;
        }
        summaries.push(DisplayConfigurationSummary {
            display_id: profile.stable_identity.clone(),
            friendly_name: profile
                .friendly_name
                .clone()
                .unwrap_or_else(|| "Disconnected display".into()),
            label: "Disconnected".into(),
            x: profile.physical_bounds.x,
            y: profile.physical_bounds.y,
            width: profile.physical_bounds.width,
            height: profile.physical_bounds.height,
            scale_factor: profile.scale_factor,
            rotation_degrees: profile.rotation_degrees,
            primary: false,
            orientation: orientation_of(
                profile.physical_bounds.width,
                profile.physical_bounds.height,
            ),
            connected: false,
            status: DisplayProfileStatus::Disconnected,
            average_error_px: profile.average_error_px,
            maximum_error_px: profile.maximum_error_px,
            sample_count: profile.mapping_samples.len(),
            configured_at_ms: profile.configured_at_ms,
            validated_at_ms: profile.validated_at_ms,
            needs_configuration: false,
            allows_visual_interaction: false,
            runtime_display_id: None,
        });
    }
    Ok(summaries)
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WizardPhase {
    Identify,
    NinePoint,
    RandomValidation,
    Result,
}

/// One target the user is being asked to click.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTarget {
    pub index: usize,
    pub total: usize,
    pub label: String,
    pub phase: WizardPhase,
    /// Virtual-desktop physical pixels — where the overlay is drawn.
    pub desktop_x: f64,
    pub desktop_y: f64,
    /// Display-local physical pixels, for diagnostics.
    pub display_x: f64,
    pub display_y: f64,
}

pub struct WizardSession {
    pub session_id: String,
    pub display_id: String,
    pub bounds: StoredRect,
    pub scale_factor: f64,
    pub rotation_degrees: i32,
    pub friendly_name: String,
    pub topology_signature: String,
    pub phase: WizardPhase,
    /// Display-local targets for the phase in progress.
    pub targets: Vec<(String, PhysicalPoint)>,
    pub current_index: usize,
    pub nine_point_samples: Vec<DisplayMappingSample>,
    pub validation_samples: Vec<DisplayMappingSample>,
    pub correction: Option<AffineTransform>,
    /// Fitted from calibration, kept only if it beats identity on validation.
    pub candidate_correction: Option<AffineTransform>,
    /// Why identity was kept, or why the candidate replaced it.
    pub correction_decision: Option<CorrectionDecision>,
    /// Every refused attempt, for the diagnostics table. Never fitted.
    pub rejected: Vec<RejectedSample>,
    /// Where the last accepted sample was taken, to catch a pointer that has
    /// not moved between presses.
    pub last_accepted_at: Option<PhysicalPoint>,
    /// How many samples were dropped as outliers before fitting.
    pub outliers_removed: usize,
}

#[derive(Default)]
pub struct WizardState {
    session: Mutex<Option<WizardSession>>,
}

impl WizardSession {
    fn active_target(&self) -> Option<ActiveTarget> {
        let (label, local) = self.targets.get(self.current_index)?;
        let desktop = to_desktop(*local, self.bounds.x, self.bounds.y);
        Some(ActiveTarget {
            index: self.current_index,
            total: self.targets.len(),
            label: label.clone(),
            phase: self.phase,
            desktop_x: desktop.x,
            desktop_y: desktop.y,
            display_x: local.x,
            display_y: local.y,
        })
    }

    /// Is a desktop point inside this display?
    fn contains(&self, p: PhysicalPoint) -> bool {
        p.x >= self.bounds.x as f64
            && p.y >= self.bounds.y as f64
            && p.x < (self.bounds.x + self.bounds.width as i32) as f64
            && p.y < (self.bounds.y + self.bounds.height as i32) as f64
    }
}

/// What the frontend gets back after each step.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WizardStatus {
    pub session_id: String,
    pub display_id: String,
    pub phase: WizardPhase,
    pub target: Option<ActiveTarget>,
    pub nine_point_count: usize,
    pub validation_count: usize,
    /// Refused attempts so far. Reported so "5 samples" is never the whole story.
    pub rejected_count: usize,
    pub outliers_removed: usize,
    /// Average residual of the calibration fit — a different number from the
    /// validation error, and conflating the two is how a result screen shows
    /// five samples after a fourteen-point run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration_residual_px: Option<f64>,
    /// Whether the fitted correction was kept, and why.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correction_decision: Option<CorrectionDecision>,
    /// What just happened to the most recent press.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sample: Option<SampleFeedback>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<ValidationSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correction_applied: Option<bool>,
    pub finished: bool,
}

/// Immediate feedback for one press, so a bad point is visible when it happens
/// rather than as a number on a summary screen fourteen presses later.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleFeedback {
    pub accepted: bool,
    pub distance_px: f64,
    pub message: String,
}

/// Clear a display's measurements before a fresh run.
///
/// Keeps the profile row and its `configured_at_ms` — the display has been
/// through setup before, and that history is worth showing — but discards every
/// sample, the fitted correction and the error figures, so nothing from the
/// previous attempt can be mistaken for evidence about this one.
fn reset_profile_measurements<R: Runtime>(
    app: &AppHandle<R>,
    display_id: &str,
) -> Result<(), String> {
    let dir = config_dir(app)?;
    let mut store = load_from(&dir).0;
    let Some(profile) = store.get_mut(display_id) else {
        return Ok(()); // never configured; there is nothing to clear
    };
    profile.mapping_samples.clear();
    profile.correction = None;
    profile.average_error_px = 0.0;
    profile.maximum_error_px = 0.0;
    profile.validated_at_ms = 0;
    profile.status = DisplayProfileStatus::Configuring;
    profile.ignored = false;
    save_to(&dir, &store)
}

/// How far from the target a sample may land before it is refused outright.
///
/// Separate from the 4 px / 8 px acceptance thresholds on purpose, and much
/// looser: this is not a quality bar, it is a "that cannot be what you meant"
/// bar. A miss this large is a mis-press, not aim, and letting one into the
/// affine fit spreads it across the whole display — which is exactly what
/// happened on the first run, where two 1800–3700 px samples were fitted.
const GROSS_ERROR_PX: f64 = 100.0;

/// How close to the previous accepted sample counts as "the pointer never moved".
///
/// The first run recorded three samples at the *previous* target's position:
/// Space fired twice before the pointer moved on. Nothing downstream can tell
/// that from a genuine reading, so it is caught here, where the previous
/// position is still known.
const UNMOVED_PX: f64 = 3.0;

/// Why a sample was refused. Recorded for diagnostics, never fitted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedSample {
    pub target_label: String,
    pub stage: &'static str,
    pub expected_desktop: PhysicalPoint,
    pub actual_desktop: PhysicalPoint,
    pub distance_px: f64,
    pub reason: &'static str,
    pub message: String,
    pub captured_at_ms: u64,
}

/// Draw the current target on the display itself.
///
/// It has to be a native overlay rather than something in the webview. The main
/// window covers a fraction of the screen, so a target positioned inside it sits
/// wherever that fraction happens to fall — which measured a 443 px average
/// error on the first real run, all of it the wizard's own fault rather than the
/// mapping's. The point being verified is a desktop coordinate, so the thing the
/// user aims at has to be drawn at that desktop coordinate.
/// How long a target holds its accepted/rejected colour before moving on.
///
/// Long enough to register as feedback, short enough not to feel like a wait.
/// Owned here rather than in React so there is exactly one thing scheduling the
/// next target — two timers racing is how a target ends up on screen twice.
const FEEDBACK_MS: u64 = 300;

/// Flash the target that was just pressed, then leave the screen clear.
///
/// Blocking for 300 ms is deliberate: the caller is a key press, the next target
/// must not appear until this one has been seen, and doing it on a background
/// thread would let `draw_target` overtake it.
fn flash_target(x: i32, y: i32, state: crate::native_overlay::CalibrationTargetState) {
    let _ = crate::native_overlay::show_calibration_target_in(x, y, state);
    std::thread::sleep(std::time::Duration::from_millis(FEEDBACK_MS));
}

fn draw_target(session: &WizardSession) {
    let Some(target) = session.active_target() else {
        crate::native_overlay::hide_highlight();
        return;
    };
    crate::native_overlay::init();
    // Centre-based, so nothing can introduce an offset between the point being
    // verified and the thing the user aims at.
    let _ = crate::native_overlay::show_calibration_target(
        target.desktop_x.round() as i32,
        target.desktop_y.round() as i32,
    );
}

fn status_of(session: &WizardSession, summary: Option<ValidationSummary>) -> WizardStatus {
    // How well the fit reproduces the points it was fitted from. Distinct from
    // the validation error, which is measured on points the fit never saw.
    let calibration_residual_px = session.correction.map(|t| {
        let total: f64 = session
            .nine_point_samples
            .iter()
            .map(|s| {
                t.apply(s.expected_desktop_point)
                    .distance_to(&s.actual_desktop_point)
            })
            .sum();
        total / session.nine_point_samples.len().max(1) as f64
    });
    WizardStatus {
        session_id: session.session_id.clone(),
        display_id: session.display_id.clone(),
        phase: session.phase,
        target: session.active_target(),
        nine_point_count: session.nine_point_samples.len(),
        validation_count: session.validation_samples.len(),
        rejected_count: session.rejected.len(),
        outliers_removed: session.outliers_removed,
        calibration_residual_px,
        correction_decision: session.correction_decision,
        last_sample: None,
        summary,
        correction_applied: session.correction.map(|c| !c.is_effectively_identity()),
        finished: session.phase == WizardPhase::Result,
    }
}

fn locked<'a>(state: &'a State<WizardState>) -> std::sync::MutexGuard<'a, Option<WizardSession>> {
    state.session.lock().unwrap_or_else(|e| e.into_inner())
}

/// Refuse to act on a session id that is not the running one.
fn with_session<'a>(
    guard: &'a mut Option<WizardSession>,
    session_id: &str,
) -> Result<&'a mut WizardSession, String> {
    match guard.as_mut() {
        Some(session) if session.session_id == session_id => Ok(session),
        Some(_) => Err("That display mapping session is no longer the active one.".into()),
        None => Err("No display mapping session is running.".into()),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_display_configuration_summary(
    app: AppHandle,
) -> Result<Vec<DisplayConfigurationSummary>, String> {
    configuration_summary(&app)
}

/// Does anything need the wizard right now?
#[tauri::command]
pub fn display_mapping_needs_attention(app: AppHandle) -> Result<serde_json::Value, String> {
    let summaries = configuration_summary(&app)?;
    let pending: Vec<&DisplayConfigurationSummary> = summaries
        .iter()
        .filter(|s| s.connected && s.needs_configuration)
        .collect();
    Ok(serde_json::json!({
        "displayCount": summaries.iter().filter(|s| s.connected).count(),
        "pendingCount": pending.len(),
        "pendingDisplayIds": pending.iter().map(|s| &s.display_id).collect::<Vec<_>>(),
        "anyConfigured": summaries.iter().any(|s| s.status == DisplayProfileStatus::Valid),
    }))
}

#[tauri::command]
pub fn start_display_mapping_session(
    app: AppHandle,
    state: State<WizardState>,
    display_id: String,
) -> Result<WizardStatus, String> {
    let identities = enumerate_monitor_identities()?;
    let identity = identities
        .iter()
        .find(|i| i.stable_key() == display_id)
        .ok_or("That display is not attached.")?;

    // Start from nothing measured. A retry usually follows a run that went
    // wrong, and the samples from that run describe whatever was wrong with it —
    // letting them survive means the next affine fit is partly derived from the
    // failure it is meant to replace.
    reset_profile_measurements(&app, &display_id)?;

    let topology = super::topology::read_topology().ok();
    let (scale, rotation, signature) = topology
        .as_ref()
        .map(|t| {
            let d = t
                .displays
                .iter()
                .find(|d| d.x == identity.x && d.y == identity.y);
            (
                d.map(|d| d.scale_factor).unwrap_or(1.0),
                d.map(|d| d.rotation as i32).unwrap_or(0),
                t.version.clone(),
            )
        })
        .unwrap_or((1.0, 0, String::new()));

    let targets = nine_point_targets(identity.width as f64, identity.height as f64)
        .into_iter()
        .map(|(position, point)| (position.label().to_string(), point))
        .collect();

    let session = WizardSession {
        session_id: format!("dmw-{}", now_ms()),
        display_id: display_id.clone(),
        bounds: StoredRect {
            x: identity.x,
            y: identity.y,
            width: identity.width,
            height: identity.height,
        },
        scale_factor: scale,
        rotation_degrees: rotation,
        friendly_name: identity.friendly_name.clone(),
        topology_signature: signature,
        phase: WizardPhase::Identify,
        targets,
        current_index: 0,
        nine_point_samples: Vec::new(),
        validation_samples: Vec::new(),
        correction: None,
        candidate_correction: None,
        correction_decision: None,
        rejected: Vec::new(),
        last_accepted_at: None,
        outliers_removed: 0,
    };
    let status = status_of(&session, None);
    *locked(&state) = Some(session);
    Ok(status)
}

/// Outline one whole display so the user can confirm which screen is meant.
#[tauri::command]
pub fn identify_display(
    state: State<WizardState>,
    session_id: String,
    seconds: Option<f64>,
) -> Result<WizardStatus, String> {
    let mut guard = locked(&state);
    let session = with_session(&mut guard, &session_id)?;
    // Inset so the border is visible rather than clipped at the screen edge.
    const INSET: i32 = 8;
    crate::native_overlay::init();
    crate::native_overlay::show_highlight(
        session.bounds.x + INSET,
        session.bounds.y + INSET,
        session.bounds.width as i32 - INSET * 2,
        session.bounds.height as i32 - INSET * 2,
    )?;
    let hold = seconds.unwrap_or(0.0);
    if hold > 0.0 {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs_f64(hold));
            crate::native_overlay::hide_highlight();
        });
    }
    Ok(status_of(session, None))
}

/// Move past identification into the nine-point run.
#[tauri::command]
pub fn begin_nine_point(
    app: AppHandle,
    state: State<WizardState>,
    session_id: String,
) -> Result<WizardStatus, String> {
    let mut guard = locked(&state);
    let session = with_session(&mut guard, &session_id)?;
    crate::native_overlay::hide_highlight();
    session.phase = WizardPhase::NinePoint;
    session.current_index = 0;
    session.nine_point_samples.clear();
    draw_target(session);
    register_sample_key(&app);
    Ok(status_of(session, None))
}

/// Where the current target is. Rust owns this; the webview only draws it.
#[tauri::command]
pub fn show_mapping_target(
    state: State<WizardState>,
    session_id: String,
) -> Result<WizardStatus, String> {
    let mut guard = locked(&state);
    let session = with_session(&mut guard, &session_id)?;
    Ok(status_of(session, None))
}

/// Record where the cursor actually was when the user clicked the target.
///
/// The position is read from Windows here rather than taken from the caller: a
/// browser event carries CSS pixels inside a window that may be on another
/// monitor, and trusting it would measure the webview's arithmetic instead of
/// the mapping the wizard exists to check.
#[tauri::command]
pub fn record_mapping_click(
    app: AppHandle,
    state: State<WizardState>,
    session_id: String,
) -> Result<WizardStatus, String> {
    record_sample_internal(&app, &state, &session_id)
}

/// The one place a sample is taken, whichever input triggered it.
///
/// Both the global Space shortcut and the in-app command land here, so there is
/// a single set of refusal rules rather than two that can drift apart.
fn record_sample_internal<R: Runtime>(
    _app: &AppHandle<R>,
    state: &State<WizardState>,
    session_id: &str,
) -> Result<WizardStatus, String> {
    let mut guard = locked(state);
    let session = with_session(&mut guard, session_id)?;

    if !matches!(
        session.phase,
        WizardPhase::NinePoint | WizardPhase::RandomValidation
    ) {
        return Err("This session is not collecting samples.".into());
    }
    let (cx, cy) = crate::agent_pointer::agent_cursor_pos()?;
    let actual = PhysicalPoint::new(cx as f64, cy as f64);
    let Some((label, local)) = session.targets.get(session.current_index).cloned() else {
        return Err("There is no target to record.".into());
    };
    let expected = to_desktop(local, session.bounds.x, session.bounds.y);
    let out_of_bounds = !session.contains(actual);
    let distance = actual.distance_to(&expected);
    let stage = match session.phase {
        WizardPhase::RandomValidation => "validation",
        _ => "calibration",
    };

    // Refuse anything that cannot be an attempt at this target, before it can
    // reach the fit. Each of these was seen in the first physical run.
    let refusal = if out_of_bounds {
        Some((
            "out-of-bounds",
            format!(
                "The pointer was on another display, {:.0} px from the target.",
                distance
            ),
        ))
    } else if session
        .last_accepted_at
        .map(|p| p.distance_to(&actual) <= UNMOVED_PX)
        .unwrap_or(false)
    {
        Some((
            "pointer-did-not-move",
            "That recorded the same spot as the last point. Move to the new target, then press Space.".to_string(),
        ))
    } else if distance > GROSS_ERROR_PX {
        Some((
            "too-far-from-target",
            format!(
                "The pointer was {:.0} px from the target. Move to the centre and press Space again.",
                distance
            ),
        ))
    } else {
        None
    };

    if let Some((reason, message)) = refusal {
        session.rejected.push(RejectedSample {
            target_label: label,
            stage,
            expected_desktop: expected,
            actual_desktop: actual,
            distance_px: distance,
            reason,
            message: message.clone(),
            captured_at_ms: now_ms(),
        });
        // Deliberately does not advance. Amber first so the press is visibly
        // acknowledged, then back to active on the same point.
        flash_target(
            expected.x.round() as i32,
            expected.y.round() as i32,
            crate::native_overlay::CalibrationTargetState::Rejected,
        );
        draw_target(session);
        let mut status = status_of(session, None);
        status.last_sample = Some(SampleFeedback {
            accepted: false,
            distance_px: distance,
            message,
        });
        return Ok(status);
    }

    let sample = DisplayMappingSample::new(
        format!("{}-{}-{}", session.session_id, label, session.current_index),
        local,
        expected,
        actual,
        now_ms(),
        false,
        false,
    );
    match session.phase {
        WizardPhase::NinePoint => session.nine_point_samples.push(sample),
        _ => session.validation_samples.push(sample),
    }
    session.last_accepted_at = Some(actual);
    flash_target(
        expected.x.round() as i32,
        expected.y.round() as i32,
        crate::native_overlay::CalibrationTargetState::Accepted,
    );
    session.current_index += 1;
    draw_target(session);
    let mut status = status_of(session, None);
    status.last_sample = Some(SampleFeedback {
        accepted: true,
        distance_px: distance,
        message: format!("Recorded — {distance:.1} px from the centre."),
    });
    Ok(status)
}

/// Discard the most recent sample so the user can retry an obvious misclick.
#[tauri::command]
pub fn retry_mapping_sample(
    state: State<WizardState>,
    session_id: String,
) -> Result<WizardStatus, String> {
    let mut guard = locked(&state);
    let session = with_session(&mut guard, &session_id)?;
    let removed = match session.phase {
        WizardPhase::NinePoint => session.nine_point_samples.pop().is_some(),
        WizardPhase::RandomValidation => session.validation_samples.pop().is_some(),
        _ => false,
    };
    if removed && session.current_index > 0 {
        session.current_index -= 1;
    }
    draw_target(session);
    Ok(status_of(session, None))
}

/// Fit the correction and move on to fresh points.
#[tauri::command]
pub fn run_random_validation(
    state: State<WizardState>,
    session_id: String,
) -> Result<WizardStatus, String> {
    let mut guard = locked(&state);
    let session = with_session(&mut guard, &session_id)?;
    if session.nine_point_samples.len() < 3 {
        return Err("Not enough calibration points to fit a correction.".into());
    }

    // Drop clear misclicks before fitting: one would otherwise spread across the
    // whole display as a correction nobody asked for.
    let rejected = reject_outliers(&session.nine_point_samples);
    session.outliers_removed = rejected.len();
    let pairs: Vec<(PhysicalPoint, PhysicalPoint)> = session
        .nine_point_samples
        .iter()
        .enumerate()
        .filter(|(i, _)| !rejected.contains(i))
        .map(|(_, s)| (s.expected_desktop_point, s.actual_desktop_point))
        .collect();

    // A fit that fails (collinear or too few points) leaves the OS topology in
    // charge, which is the right default — the wizard corrects, it does not
    // replace.
    // Fitted, but not adopted yet. Whether it is worth keeping is judged
    // against the five validation points, which this fit has not seen — see
    // `complete_display_mapping`.
    session.candidate_correction = fit_affine(&pairs).filter(|t| !t.is_effectively_identity());
    session.correction = None;

    let targets = random_validation_targets(
        session.bounds.width as f64,
        session.bounds.height as f64,
        RANDOM_VALIDATION_POINTS,
        now_ms(),
    );
    session.targets = targets
        .into_iter()
        .enumerate()
        .map(|(i, p)| (format!("Random point {}", i + 1), p))
        .collect();
    session.phase = WizardPhase::RandomValidation;
    session.current_index = 0;
    session.validation_samples.clear();
    draw_target(session);
    Ok(status_of(session, None))
}

/// Score the run and write the profile.
#[tauri::command]
pub fn complete_display_mapping(
    app: AppHandle,
    state: State<WizardState>,
    session_id: String,
) -> Result<WizardStatus, String> {
    let mut guard = locked(&state);
    let session = with_session(&mut guard, &session_id)?;
    let summary = summarise(&session.validation_samples);
    // Identity unless the fitted candidate demonstrably beats it on the five
    // points it never saw. A correction fitted from someone's cursor-tip bias
    // would otherwise be written into the coordinate system permanently.
    let decision = choose_correction(session.candidate_correction, &session.validation_samples);
    session.correction = decision.applied;
    session.correction_decision = Some(decision);
    session.phase = WizardPhase::Result;
    crate::native_overlay::hide_highlight();

    let dir = config_dir(&app)?;
    let mut store = load_from(&dir).0;
    let existing = store.get(&session.display_id).cloned();
    let now = now_ms();

    let mut samples = session.nine_point_samples.clone();
    samples.extend(session.validation_samples.iter().cloned());

    let profile = PersistedDisplayProfile {
        stable_identity: session.display_id.clone(),
        friendly_name: Some(session.friendly_name.clone()),
        physical_bounds: session.bounds,
        logical_bounds: None,
        scale_factor: session.scale_factor,
        rotation_degrees: session.rotation_degrees,
        topology_signature: session.topology_signature.clone(),
        mapping_samples: samples,
        correction: session.correction,
        average_error_px: summary.average_error_px,
        maximum_error_px: summary.maximum_error_px,
        configured_at_ms: existing
            .as_ref()
            .filter(|p| p.configured_at_ms > 0)
            .map(|p| p.configured_at_ms)
            .unwrap_or(now),
        validated_at_ms: now,
        // A failed run is recorded as failed. Saving it as Valid because the
        // wizard reached the end would defeat the entire exercise.
        status: if summary.passed {
            DisplayProfileStatus::Valid
        } else {
            DisplayProfileStatus::Failed
        },
        ignored: false,
    };
    store.upsert(profile);
    save_to(&dir, &store)?;

    let status = status_of(session, Some(summary));
    // Terminal state: nothing may stay on screen and Space goes back to the user.
    drop(guard);
    cleanup_display_mapping_session(&app, &state);
    Ok(status)
}

/// Take a session down completely. Safe to call twice, or with nothing running.
///
/// One function rather than cleanup at each exit path, because the first
/// physical run left a target on screen after Finish — the success path had its
/// own tidy-up and the others did not. Every terminal state now goes through
/// here, so a new exit path cannot forget a piece.
pub fn cleanup_display_mapping_session<R: Runtime>(app: &AppHandle<R>, state: &State<WizardState>) {
    // Overlays first: if anything below fails, the user is not left looking at
    // a target they cannot dismiss.
    crate::native_overlay::hide_highlight();
    unregister_sample_key(app);
    *locked(state) = None;
}

/// The key that records a point, while calibration is running.
///
/// A bare `Space` global shortcut rather than a webview key handler. The webview
/// only receives keys while it has focus, and calibration deliberately sends the
/// user's pointer to the far corners of another monitor — one stray click on the
/// desktop and Space stops arriving, with no indication that it has.
const SAMPLE_ACCELERATOR: &str = "Space";

/// Where a globally-triggered sample is announced, since no caller is waiting.
pub const SAMPLE_EVENT: &str = "arcsonare://display-mapping-sample";

fn register_sample_key<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};
    let shortcut = Shortcut::new(None, Code::Space);
    let handle = app.clone();
    let result = app
        .global_shortcut()
        .on_shortcut(shortcut, move |_, _, event| {
            // Press only. Windows repeats a held key, and a repeat must not record
            // a second point — the first run captured three samples that way.
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let state = handle.state::<WizardState>();
            let mut guard = locked(&state);
            let Some(session) = guard.as_mut() else {
                return;
            };
            let session_id = session.session_id.clone();
            drop(guard);
            // The result has to be pushed, not returned. Nothing called this —
            // the key was pressed while another window had focus — so an event
            // is the only way the wizard's progress reaches the screen. Without
            // it the samples record correctly and the interface silently stops
            // moving, which looks exactly like Space doing nothing.
            if let Ok(status) = record_sample_internal(&handle, &state, &session_id) {
                let _ = handle.emit(SAMPLE_EVENT, &status);
            }
        });
    if let Err(e) = result {
        // Not fatal: the in-app key handler still works while ArcSonare is
        // focused, and saying so is better than failing the session outright.
        log::warn!("could not take over Space for calibration: {e}");
    }
}

fn unregister_sample_key<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};
    if let Err(e) = app
        .global_shortcut()
        .unregister(Shortcut::new(None, Code::Space))
    {
        log::debug!("Space was not registered for calibration: {e}");
    }
}

#[tauri::command]
pub fn cancel_display_mapping(app: AppHandle, state: State<WizardState>) -> Result<(), String> {
    cleanup_display_mapping_session(&app, &state);
    Ok(())
}

/// Draw a border round a display without starting a session.
#[tauri::command]
pub fn test_display_overlay(display_id: String, seconds: Option<f64>) -> Result<(), String> {
    let identities = enumerate_monitor_identities()?;
    let identity = identities
        .iter()
        .find(|i| i.stable_key() == display_id)
        .ok_or("That display is not attached.")?;
    const INSET: i32 = 8;
    crate::native_overlay::init();
    crate::native_overlay::show_highlight(
        identity.x + INSET,
        identity.y + INSET,
        identity.width as i32 - INSET * 2,
        identity.height as i32 - INSET * 2,
    )?;
    let hold = seconds.unwrap_or(3.0);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs_f64(hold));
        crate::native_overlay::hide_highlight();
    });
    Ok(())
}

/// Send the cursor to the centre of a display and report where it landed.
#[tauri::command]
pub fn test_display_cursor(display_id: String) -> Result<serde_json::Value, String> {
    let identities = enumerate_monitor_identities()?;
    let identity = identities
        .iter()
        .find(|i| i.stable_key() == display_id)
        .ok_or("That display is not attached.")?;
    let target_x = identity.x + identity.width as i32 / 2;
    let target_y = identity.y + identity.height as i32 / 2;
    crate::agent_pointer::agent_set_cursor_pos(target_x, target_y)?;
    std::thread::sleep(std::time::Duration::from_millis(60));
    let (actual_x, actual_y) = crate::agent_pointer::agent_cursor_pos()?;
    let error = PhysicalPoint::new(actual_x as f64, actual_y as f64)
        .distance_to(&PhysicalPoint::new(target_x as f64, target_y as f64));
    Ok(serde_json::json!({
        "expected": [target_x, target_y],
        "actual": [actual_x, actual_y],
        "errorPx": error,
        "onIntendedDisplay": actual_x >= identity.x
            && actual_y >= identity.y
            && actual_x < identity.x + identity.width as i32
            && actual_y < identity.y + identity.height as i32,
    }))
}

fn update_status<R: Runtime>(
    app: &AppHandle<R>,
    display_id: &str,
    status: DisplayProfileStatus,
) -> Result<(), String> {
    let dir = config_dir(app)?;
    let mut store = load_from(&dir).0;
    if store.get(display_id).is_none() {
        // Ignoring a display that was never measured still has to be recorded,
        // or the first-run prompt keeps asking about it.
        let identities = enumerate_monitor_identities().unwrap_or_default();
        let identity = identities.iter().find(|i| i.stable_key() == display_id);
        let bounds = identity
            .map(|i| StoredRect {
                x: i.x,
                y: i.y,
                width: i.width,
                height: i.height,
            })
            .unwrap_or(StoredRect {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            });
        let mut profile = PersistedDisplayProfile::unconfigured(display_id.to_string(), bounds);
        profile.friendly_name = identity.map(|i| i.friendly_name.clone());
        store.upsert(profile);
    }
    store.set_status(display_id, status);
    save_to(&dir, &store)
}

#[tauri::command]
pub fn ignore_display(app: AppHandle, display_id: String) -> Result<(), String> {
    update_status(&app, &display_id, DisplayProfileStatus::Ignored)
}

#[tauri::command]
pub fn enable_display(app: AppHandle, display_id: String) -> Result<(), String> {
    // Re-enabling does not restore a measurement — it restores the question.
    update_status(&app, &display_id, DisplayProfileStatus::Unconfigured)
}

#[tauri::command]
pub fn remove_display_profile(app: AppHandle, display_id: String) -> Result<bool, String> {
    let dir = config_dir(&app)?;
    let mut store = load_from(&dir).0;
    let removed = store.remove(&display_id);
    save_to(&dir, &store)?;
    Ok(removed)
}

/// Everything needed to explain a mapping decision, with no image data.
#[tauri::command]
pub fn get_display_mapping_diagnostics(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = config_dir(&app)?;
    let (store, outcome) = load_from(&dir);
    let identities = enumerate_monitor_identities().unwrap_or_default();
    let topology = super::topology::read_topology().ok();
    Ok(serde_json::json!({
        "storePath": super::profile_store::store_path(&dir).to_string_lossy(),
        "storeVersion": store.version,
        "loadOutcome": format!("{outcome:?}"),
        "profileCount": store.profiles.len(),
        "attached": identities.iter().map(|i| serde_json::json!({
            "stableIdentity": i.stable_key(),
            "friendlyName": i.friendly_name,
            "adapterSlot": i.adapter_slot,
            "bounds": [i.x, i.y, i.width, i.height],
            "primary": i.primary,
        })).collect::<Vec<_>>(),
        "topologyVersion": topology.as_ref().map(|t| t.version.clone()),
        // Diagnostics only — this changes every run and is never persisted.
        "runtimePairing": topology.as_ref()
            .map(|t| super::identity::pair_with_topology(&identities, t))
            .unwrap_or_default(),
        "thresholds": {
            "maxAverageErrorPx": super::mapping::MAX_AVERAGE_ERROR_PX,
            "maxSingleErrorPx": super::mapping::MAX_SINGLE_ERROR_PX,
        },
    }))
}

/// The profile for the monitor at these desktop coordinates, if it may be used.
///
/// Returns the correction to apply — `None` meaning identity, which is the
/// normal answer — or a typed refusal code. Position identifies the monitor
/// because that is what the topology and the identity enumeration agree on.
pub fn profile_for_bounds<R: Runtime>(
    app: &AppHandle<R>,
    x: i32,
    y: i32,
) -> Result<Option<AffineTransform>, String> {
    let identities =
        enumerate_monitor_identities().map_err(|_| "DISPLAY_IDENTITY_MISMATCH".to_string())?;
    let identity = identities
        .iter()
        .find(|i| i.x == x && i.y == y)
        .ok_or_else(|| "DISPLAY_IDENTITY_MISMATCH".to_string())?;

    let dir = config_dir(app).map_err(|_| "DISPLAY_NOT_CONFIGURED".to_string())?;
    let raw = std::fs::read_to_string(super::profile_store::store_path(&dir)).ok();
    evaluate_profile_gate(raw.as_deref(), identity).map_err(|c| c.to_string())
}

/// Decide whether a display may be acted on, from the stored file and the
/// monitor as it is right now.
///
/// Takes the raw file rather than an `AppHandle` so every refusal can be tested
/// against a constructed store, without touching the user's real profiles or
/// mutating global state that parallel tests would race on. `None` means the
/// file does not exist.
///
/// Fails closed at every step: anything it cannot positively confirm is a
/// refusal, because the cost of wrongly allowing is a click on the wrong screen
/// and the cost of wrongly refusing is a message.
pub fn evaluate_profile_gate(
    raw: Option<&str>,
    identity: &MonitorIdentity,
) -> Result<Option<AffineTransform>, &'static str> {
    let Some(raw) = raw else {
        // No file at all is a first run, not a corruption.
        return Err("DISPLAY_NOT_CONFIGURED");
    };
    if raw.trim().is_empty() {
        return Err("DISPLAY_NOT_CONFIGURED");
    }

    // Read the version before anything else. `migrate` reports a
    // newer-than-supported store as unreadable, which is true but not useful —
    // "written by a newer ArcSonare" and "the bytes are damaged" need different
    // advice, and only one of them is fixed by re-checking the display.
    if let Ok(peek) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(version) = peek.get("version").and_then(|v| v.as_u64()) {
            if version > super::profile_store::CURRENT_VERSION as u64 {
                return Err("DISPLAY_PROFILE_VERSION_UNSUPPORTED");
            }
        }
    }

    let (store, outcome) = super::profile_store::parse(raw);
    if let super::profile_store::LoadOutcome::Recovered(_) = outcome {
        return Err("DISPLAY_PROFILE_CORRUPT");
    }

    let key = identity.stable_key();
    let stored = store.get(&key);
    // Reuse the same reconciliation the settings page shows, so what the user
    // is told and what the executor enforces can never disagree.
    match reconcile(identity, stored) {
        DisplayProfileStatus::Valid => Ok(stored.and_then(|p| p.correction)),
        DisplayProfileStatus::Stale => Err("DISPLAY_PROFILE_STALE"),
        DisplayProfileStatus::Failed => Err("DISPLAY_PROFILE_FAILED"),
        DisplayProfileStatus::Ignored => Err("DISPLAY_IGNORED"),
        DisplayProfileStatus::Disconnected => Err("DISPLAY_IDENTITY_MISMATCH"),
        _ => Err("DISPLAY_NOT_CONFIGURED"),
    }
}

/// The config directory, for `gate.rs`. Same resolution the wizard itself uses,
/// exposed so the gate reads exactly the store the wizard writes.
pub(super) fn config_dir_for_gate<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    config_dir(app)
}

/// The profile gate for a monitor already identified.
///
/// `profile_for_bounds` finds the monitor by origin; callers that have already
/// located it by *containment* must not look it up again by origin, because a
/// rectangle's containing monitor and a monitor sharing its origin are not the
/// same question. One gate, two ways in.
pub(super) fn profile_gate_for_identity<R: Runtime>(
    app: &AppHandle<R>,
    identity: &MonitorIdentity,
) -> Result<Option<AffineTransform>, &'static str> {
    let dir = config_dir(app).map_err(|_| "DISPLAY_NOT_CONFIGURED")?;
    let raw = std::fs::read_to_string(super::profile_store::store_path(&dir)).ok();
    evaluate_profile_gate(raw.as_deref(), identity)
}

/// Test-only: does any monitor contain this point?
///
/// The public gate now lives in `display::gate`, which needs an `AppHandle` a
/// unit test cannot build. This reaches the containment half of the same
/// decision without one, and is `#[cfg(test)]` so nothing in the running
/// application can use it to skip the profile half.
///
/// A point on no monitor is refused before any profile is loaded, so this
/// reaches the same conclusion without needing an `AppHandle` that a unit test
/// cannot build. It is `#[cfg(test)]` so nothing in the running application can
/// use it to skip the profile half.
#[cfg(test)]
pub(crate) fn require_verified_display_at_for_test(x: i32, y: i32) -> Result<(), String> {
    let identities = enumerate_monitor_identities()
        .map_err(|_| describe_profile_refusal("DISPLAY_IDENTITY_MISMATCH"))?;
    identities
        .iter()
        .find(|i| x >= i.x && y >= i.y && x < i.x + i.width as i32 && y < i.y + i.height as i32)
        .map(|_| ())
        .ok_or_else(|| describe_profile_refusal("TARGET_OUTSIDE_CONNECTED_DISPLAY"))
}

/// Plain English for a refusal code, for the interface to show instead of a
/// generic capability failure.
pub fn describe_profile_refusal(code: &str) -> String {
    match code {
        "DISPLAY_NOT_CONFIGURED" => {
            "Visual actions are unavailable on this display because it has not been checked yet."
        }
        "DISPLAY_PROFILE_STALE" => {
            "Visual actions are unavailable on this display because it changed since it was checked."
        }
        "DISPLAY_PROFILE_FAILED" => {
            "Visual actions are unavailable on this display because its last check was outside tolerance."
        }
        "DISPLAY_IGNORED" => {
            "Visual actions are unavailable on this display because you asked ArcSonare to ignore it."
        }
        "DISPLAY_IDENTITY_MISMATCH" => {
            "That display is no longer the one ArcSonare measured."
        }
        "TARGET_OUTSIDE_CONNECTED_DISPLAY" => {
            "That point is not on any connected display, so there is nothing there to act on."
        }
        "DISPLAY_PROFILE_CORRUPT" => {
            "The stored display measurements could not be read. Check the display again."
        }
        "DISPLAY_PROFILE_VERSION_UNSUPPORTED" => {
            "The stored display measurements were written by a newer version of ArcSonare."
        }
        _ => "Visual actions are unavailable on this display.",
    }
    .to_string()
}

/// May a visual action run on this display right now?
///
/// Native routes never ask this. Opening a folder, launching an application or
/// editing a file works on an unconfigured machine, because none of them depend
/// on knowing where a pixel is.
pub fn visual_interaction_error<R: Runtime>(
    app: &AppHandle<R>,
    display_bounds: (i32, i32),
) -> Option<String> {
    let identities = enumerate_monitor_identities().ok()?;
    let identity = identities
        .iter()
        .find(|i| i.x == display_bounds.0 && i.y == display_bounds.1)?;
    let store = load_from(&config_dir(app).ok()?).0;
    let status = reconcile(identity, store.get(&identity.stable_key()));
    if status.allows_visual_interaction() {
        return None;
    }
    Some(
        match status {
            DisplayProfileStatus::Unconfigured => "DISPLAY_NOT_CONFIGURED",
            DisplayProfileStatus::Stale => "DISPLAY_PROFILE_STALE",
            DisplayProfileStatus::Failed => "DISPLAY_PROFILE_FAILED",
            DisplayProfileStatus::Ignored => "DISPLAY_IGNORED",
            DisplayProfileStatus::Disconnected => "DISPLAY_IDENTITY_MISMATCH",
            _ => "DISPLAY_NOT_CONFIGURED",
        }
        .to_string(),
    )
}

/// Test-only: drive one sample from a position the caller sets first.
///
/// Exists so the whole state machine — draw, sample, advance, fit, validate,
/// save, clean up — can be exercised without a person at the keyboard. It is
/// `#[cfg(test)]` rather than a command, so nothing in the running application
/// can move the cursor and then record it as if the user had.
#[cfg(test)]
pub(crate) fn test_record_at<R: Runtime>(
    app: &AppHandle<R>,
    state: &State<WizardState>,
    session_id: &str,
    x: i32,
    y: i32,
) -> Result<WizardStatus, String> {
    crate::agent_pointer::agent_set_cursor_pos(x, y)?;
    std::thread::sleep(std::time::Duration::from_millis(20));
    record_sample_internal(app, state, session_id)
}

/// Test-only: where the wizard currently wants the pointer.
#[cfg(test)]
pub(crate) fn test_active_target(state: &State<WizardState>) -> Option<ActiveTarget> {
    locked(state).as_ref().and_then(|s| s.active_target())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(width: u32, height: u32) -> MonitorIdentity {
        MonitorIdentity {
            scale_factor: 1.0,
            rotation_degrees: 0,
            device_path: "\\\\?\\DISPLAY#TEST#UID1#{g}".into(),
            friendly_name: "Test".into(),
            adapter_slot: "\\\\.\\DISPLAY1".into(),
            x: 0,
            y: 0,
            width,
            height,
            primary: true,
        }
    }

    fn stored(width: u32, height: u32, status: DisplayProfileStatus) -> PersistedDisplayProfile {
        PersistedDisplayProfile {
            status,
            ..PersistedDisplayProfile::unconfigured(
                "\\\\?\\DISPLAY#TEST#UID1#{g}".into(),
                StoredRect {
                    x: 0,
                    y: 0,
                    width,
                    height,
                },
            )
        }
    }

    #[test]
    fn a_monitor_with_no_profile_needs_configuring() {
        assert_eq!(
            reconcile(&identity(3840, 1080), None),
            DisplayProfileStatus::Unconfigured
        );
    }

    #[test]
    fn a_matching_valid_profile_is_left_alone() {
        let profile = stored(3840, 1080, DisplayProfileStatus::Valid);
        let status = reconcile(&identity(3840, 1080), Some(&profile));
        assert_eq!(status, DisplayProfileStatus::Valid);
        assert!(!status.needs_configuration());
        assert!(status.allows_visual_interaction());
    }

    #[test]
    fn a_resolution_change_makes_a_profile_stale() {
        let profile = stored(3840, 1080, DisplayProfileStatus::Valid);
        let status = reconcile(&identity(2560, 1080), Some(&profile));
        assert_eq!(status, DisplayProfileStatus::Stale);
        assert!(!status.allows_visual_interaction());
        assert!(status.needs_configuration());
    }

    #[test]
    fn moving_a_monitor_does_not_invalidate_its_profile() {
        // Everything downstream reads live bounds, so a move changes nothing the
        // nine-point run measured. Re-asking would teach the user to click
        // through the wizard, and then through a real failure.
        let profile = stored(3840, 1080, DisplayProfileStatus::Valid);
        let mut moved = identity(3840, 1080);
        moved.x = -3840;
        moved.y = -200;
        assert_eq!(
            reconcile(&moved, Some(&profile)),
            DisplayProfileStatus::Valid
        );
    }

    #[test]
    fn an_ignored_monitor_stays_ignored_and_is_not_asked_about() {
        let mut profile = stored(3840, 1080, DisplayProfileStatus::Ignored);
        profile.ignored = true;
        let status = reconcile(&identity(3840, 1080), Some(&profile));
        assert_eq!(status, DisplayProfileStatus::Ignored);
        assert!(!status.needs_configuration());
        assert!(!status.allows_visual_interaction());
    }

    #[test]
    fn a_failed_profile_keeps_visual_interaction_blocked() {
        let profile = stored(3840, 1080, DisplayProfileStatus::Failed);
        let status = reconcile(&identity(3840, 1080), Some(&profile));
        assert_eq!(status, DisplayProfileStatus::Failed);
        assert!(!status.allows_visual_interaction());
        assert!(status.needs_configuration());
    }

    #[test]
    fn displays_are_labelled_in_order() {
        assert_eq!(letter_for(0), "Display A");
        assert_eq!(letter_for(1), "Display B");
        assert_eq!(letter_for(25), "Display Z");
    }

    #[test]
    fn orientation_follows_the_longer_axis() {
        assert_eq!(orientation_of(3840, 1080), "Landscape");
        assert_eq!(orientation_of(1080, 1920), "Portrait");
    }

    #[test]
    fn a_session_only_answers_to_its_own_id() {
        let mut guard = Some(WizardSession {
            session_id: "dmw-1".into(),
            display_id: "d".into(),
            bounds: StoredRect {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
            scale_factor: 1.0,
            rotation_degrees: 0,
            friendly_name: "Test".into(),
            topology_signature: String::new(),
            phase: WizardPhase::NinePoint,
            targets: Vec::new(),
            current_index: 0,
            nine_point_samples: Vec::new(),
            validation_samples: Vec::new(),
            correction: None,
            candidate_correction: None,
            correction_decision: None,
            rejected: Vec::new(),
            last_accepted_at: None,
            outliers_removed: 0,
        });
        assert!(with_session(&mut guard, "dmw-1").is_ok());
        assert!(
            with_session(&mut guard, "dmw-2").is_err(),
            "a stale session id must not drive the running session"
        );
        let mut empty: Option<WizardSession> = None;
        assert!(with_session(&mut empty, "dmw-1").is_err());
    }

    /// The three samples that ruined the first physical run, as data.
    ///
    /// Each recorded the cursor at the *previous* target's position — Space
    /// fired twice before the pointer moved on. Two of them landed in the
    /// calibration set and were fitted, which is why a correction was applied to
    /// a display that needed none.
    #[test]
    fn the_samples_that_ruined_the_first_run_are_now_refusable() {
        // Sample 4: aiming at Middle left, recorded at Top right's position.
        let expected = PhysicalPoint::new(64.0, 540.0);
        let actual = PhysicalPoint::new(3773.0, 60.0);
        assert!(
            actual.distance_to(&expected) > GROSS_ERROR_PX,
            "a 3739px miss must be refused outright"
        );

        // Sample 9: aiming at Bottom right, recorded at Bottom centre's spot.
        let previous = PhysicalPoint::new(1916.0, 1009.0);
        let repeat = PhysicalPoint::new(1915.0, 1009.0);
        assert!(
            previous.distance_to(&repeat) <= UNMOVED_PX,
            "a press without moving the pointer must be recognisable"
        );

        // Sample 14: validation, recorded at an earlier validation point.
        let expected = PhysicalPoint::new(165.0, 838.0);
        let actual = PhysicalPoint::new(926.0, 146.0);
        assert!(actual.distance_to(&expected) > GROSS_ERROR_PX);
    }

    /// Human aiming error must still be accepted — the gross-error bar is not a
    /// quality bar, and using it as one would silently loosen 4 px / 8 px.
    #[test]
    fn ordinary_aiming_error_is_not_refused() {
        let expected = PhysicalPoint::new(1920.0, 540.0);
        for (dx, dy) in [(-3.0, -8.0), (1.0, -4.0), (-5.0, -7.0), (12.0, 9.0)] {
            let actual = PhysicalPoint::new(expected.x + dx, expected.y + dy);
            assert!(
                actual.distance_to(&expected) <= GROSS_ERROR_PX,
                "({dx}, {dy}) is ordinary aim and must reach the summary"
            );
        }
    }

    #[test]
    fn the_gross_error_bar_is_far_looser_than_the_acceptance_bar() {
        use super::super::mapping::{MAX_AVERAGE_ERROR_PX, MAX_SINGLE_ERROR_PX};
        assert!(
            GROSS_ERROR_PX > MAX_SINGLE_ERROR_PX * 5.0,
            "refusing at the acceptance threshold would hide real failures \
             by never letting them be measured"
        );
        assert!(GROSS_ERROR_PX > MAX_AVERAGE_ERROR_PX * 10.0);
    }

    #[test]
    fn a_click_outside_the_display_is_marked_out_of_bounds() {
        let session = WizardSession {
            session_id: "s".into(),
            display_id: "d".into(),
            bounds: StoredRect {
                x: -1080,
                y: -661,
                width: 1080,
                height: 1920,
            },
            scale_factor: 1.0,
            rotation_degrees: 0,
            friendly_name: "Portrait".into(),
            topology_signature: String::new(),
            phase: WizardPhase::NinePoint,
            targets: Vec::new(),
            current_index: 0,
            nine_point_samples: Vec::new(),
            validation_samples: Vec::new(),
            correction: None,
            candidate_correction: None,
            correction_decision: None,
            rejected: Vec::new(),
            last_accepted_at: None,
            outliers_removed: 0,
        };
        // Inside a negative-origin portrait monitor.
        assert!(session.contains(PhysicalPoint::new(-1000.0, -600.0)));
        // On the primary monitor instead.
        assert!(!session.contains(PhysicalPoint::new(100.0, 100.0)));
    }
}
