//! Capability activity audit — operational summaries only. Never stores model
//! reasoning, secrets, clipboard bodies, file contents, or raw screenshots.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const MAX_RECORDS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityAuditRecord {
    pub id: String,
    pub run_id: String,
    pub capability_id: String,
    pub user_request_summary: String,
    pub action_summary: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_resource: Option<String>,
    pub confirmation_used: bool,
    pub started_at: String,
    pub completed_at: String,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Default)]
pub struct AuditStore(Mutex<Option<Vec<CapabilityAuditRecord>>>);

fn audit_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?
        .join("capabilities");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create audit dir: {e}"))?;
    Ok(dir.join("audit.json"))
}

fn load(app: &AppHandle) -> Vec<CapabilityAuditRecord> {
    let Ok(path) = audit_path(app) else {
        return Vec::new();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, records: &[CapabilityAuditRecord]) {
    if let Ok(path) = audit_path(app) {
        if let Ok(json) = serde_json::to_string(records) {
            let _ = std::fs::write(path, json);
        }
    }
}

impl AuditStore {
    fn with<R>(&self, app: &AppHandle, f: impl FnOnce(&mut Vec<CapabilityAuditRecord>) -> R) -> R {
        let mut guard = self.0.lock().unwrap();
        if guard.is_none() {
            *guard = Some(load(app));
        }
        let records = guard.as_mut().expect("initialized above");
        let out = f(records);
        save(app, records);
        out
    }

    pub fn record(&self, app: &AppHandle, record: CapabilityAuditRecord) {
        self.with(app, |records| {
            records.insert(0, record);
            records.truncate(MAX_RECORDS);
        });
    }

    pub fn list(&self, app: &AppHandle, limit: usize) -> Vec<CapabilityAuditRecord> {
        self.with(app, |records| {
            records
                .iter()
                .take(limit.clamp(1, MAX_RECORDS))
                .cloned()
                .collect()
        })
    }

    pub fn clear(&self, app: &AppHandle) {
        self.with(app, |records| records.clear());
    }
}

pub fn new_audit_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!(
        "audit-{}-{}",
        chrono::Local::now().timestamp_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}
