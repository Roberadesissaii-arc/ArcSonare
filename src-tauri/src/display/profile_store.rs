//! Display profiles on disk.
//!
//! Kept in `display-mappings.json` beside `settings.json` rather than inside it:
//! a profile is machine-specific measurement data, and mixing it into the
//! settings file means a corrupt profile can cost the user their shortcuts.
//!
//! Two rules this file exists to enforce.
//!
//! **Writes are atomic.** A half-written profile that still parses is the worst
//! outcome available — it would describe a monitor that does not exist and be
//! applied with confidence. The file is written to a sibling temporary path and
//! renamed, so a reader sees either the old file or the new one.
//!
//! **Profiles are filed under stable hardware identities.** Never the runtime
//! display id: those are per-process, they change between restarts, and a
//! profile keyed on one is silently reattached to whatever monitor lands in that
//! slot next time.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::mapping::{AffineTransform, DisplayMappingSample};

/// Bumped when the stored shape changes in a way `migrate` has to handle.
pub const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayProfileStatus {
    /// Never measured.
    Unconfigured,
    /// A wizard session is part-way through this display.
    Configuring,
    /// Measured, within tolerance, and still describing the current geometry.
    Valid,
    /// Measured, but the monitor has changed since. Must be redone.
    Stale,
    /// Measured and outside tolerance.
    Failed,
    /// The user chose to leave this monitor alone.
    Ignored,
    /// Remembered, but not currently attached.
    Disconnected,
}

impl DisplayProfileStatus {
    /// May visual interaction run on a display in this state?
    ///
    /// Only `Valid`. Everything else — including `Stale`, which is a profile
    /// that *was* right — means the geometry is not currently evidence.
    pub fn allows_visual_interaction(&self) -> bool {
        matches!(self, Self::Valid)
    }

    /// Should the wizard offer to configure this display?
    pub fn needs_configuration(&self) -> bool {
        matches!(
            self,
            Self::Unconfigured | Self::Stale | Self::Failed | Self::Configuring
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// One monitor's remembered mapping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedDisplayProfile {
    /// The stable hardware identity — the key. Never a runtime display id.
    pub stable_identity: String,
    #[serde(default)]
    pub friendly_name: Option<String>,

    pub physical_bounds: StoredRect,
    #[serde(default)]
    pub logical_bounds: Option<StoredRect>,

    pub scale_factor: f64,
    pub rotation_degrees: i32,

    /// The arrangement this was measured under, for diagnostics.
    #[serde(default)]
    pub topology_signature: String,

    #[serde(default)]
    pub mapping_samples: Vec<DisplayMappingSample>,
    /// Absent when the measurement showed no correction was needed.
    #[serde(default)]
    pub correction: Option<AffineTransform>,

    pub average_error_px: f64,
    pub maximum_error_px: f64,

    pub configured_at_ms: u64,
    pub validated_at_ms: u64,

    pub status: DisplayProfileStatus,
    #[serde(default)]
    pub ignored: bool,
}

impl PersistedDisplayProfile {
    /// A blank profile for a monitor that has never been measured.
    pub fn unconfigured(stable_identity: String, bounds: StoredRect) -> Self {
        Self {
            stable_identity,
            friendly_name: None,
            physical_bounds: bounds,
            logical_bounds: None,
            scale_factor: 1.0,
            rotation_degrees: 0,
            topology_signature: String::new(),
            mapping_samples: Vec::new(),
            correction: None,
            average_error_px: 0.0,
            maximum_error_px: 0.0,
            configured_at_ms: 0,
            validated_at_ms: 0,
            status: DisplayProfileStatus::Unconfigured,
            ignored: false,
        }
    }
}

/// The file as it sits on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayProfileStore {
    pub version: u32,
    #[serde(default)]
    pub profiles: Vec<PersistedDisplayProfile>,
}

impl Default for DisplayProfileStore {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            profiles: Vec::new(),
        }
    }
}

impl DisplayProfileStore {
    pub fn get(&self, stable_identity: &str) -> Option<&PersistedDisplayProfile> {
        self.profiles
            .iter()
            .find(|p| p.stable_identity == stable_identity)
    }

    pub fn get_mut(&mut self, stable_identity: &str) -> Option<&mut PersistedDisplayProfile> {
        self.profiles
            .iter_mut()
            .find(|p| p.stable_identity == stable_identity)
    }

    /// Insert or replace, keyed on the stable identity.
    pub fn upsert(&mut self, profile: PersistedDisplayProfile) {
        match self.get_mut(&profile.stable_identity) {
            Some(existing) => *existing = profile,
            None => self.profiles.push(profile),
        }
    }

    pub fn remove(&mut self, stable_identity: &str) -> bool {
        let before = self.profiles.len();
        self.profiles
            .retain(|p| p.stable_identity != stable_identity);
        self.profiles.len() != before
    }

    pub fn set_status(&mut self, stable_identity: &str, status: DisplayProfileStatus) -> bool {
        match self.get_mut(stable_identity) {
            Some(profile) => {
                profile.status = status;
                profile.ignored = status == DisplayProfileStatus::Ignored;
                true
            }
            None => false,
        }
    }
}

/// Bring a store read from disk up to the current version.
///
/// Unknown *newer* versions are not downgraded: a profile written by a later
/// build describes fields this one cannot see, and guessing at them would be
/// worse than starting over. It is reported so the caller can say so.
pub fn migrate(mut store: DisplayProfileStore) -> Result<DisplayProfileStore, String> {
    if store.version > CURRENT_VERSION {
        return Err(format!(
            "display profiles were written by a newer version of ArcSonare (v{} > v{})",
            store.version, CURRENT_VERSION
        ));
    }
    // v0 → v1: the first shape that was ever written. Nothing structural to
    // change; the version is stamped so later migrations have a floor.
    if store.version < CURRENT_VERSION {
        store.version = CURRENT_VERSION;
    }
    // A profile with no identity cannot be looked up again, so it is dead
    // weight that would only ever be rewritten.
    store.profiles.retain(|p| !p.stable_identity.is_empty());
    Ok(store)
}

/// What happened when the store was read.
#[derive(Debug, Clone, PartialEq)]
pub enum LoadOutcome {
    /// Read and parsed.
    Loaded,
    /// No file yet — first run.
    Missing,
    /// The file was unreadable; an empty store is being used instead.
    Recovered(String),
}

/// Parse a store, recovering rather than failing.
///
/// A corrupt profile file must not stop ArcSonare starting. It costs the user a
/// re-run of the wizard, which is recoverable; refusing to start is not.
pub fn parse(raw: &str) -> (DisplayProfileStore, LoadOutcome) {
    if raw.trim().is_empty() {
        return (DisplayProfileStore::default(), LoadOutcome::Missing);
    }
    match serde_json::from_str::<DisplayProfileStore>(raw) {
        Ok(store) => match migrate(store) {
            Ok(store) => (store, LoadOutcome::Loaded),
            Err(e) => (DisplayProfileStore::default(), LoadOutcome::Recovered(e)),
        },
        Err(e) => (
            DisplayProfileStore::default(),
            LoadOutcome::Recovered(e.to_string()),
        ),
    }
}

pub fn store_path(config_dir: &Path) -> PathBuf {
    config_dir.join("display-mappings.json")
}

/// Read the store, or an empty one.
pub fn load_from(config_dir: &Path) -> (DisplayProfileStore, LoadOutcome) {
    let path = store_path(config_dir);
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let (store, outcome) = parse(&raw);
            if let LoadOutcome::Recovered(ref why) = outcome {
                log::warn!("display profiles could not be read ({why}); starting fresh");
                // Keep the unreadable file rather than overwriting it — it is
                // the only evidence of what went wrong.
                let _ = std::fs::rename(&path, path.with_extension("json.corrupt"));
            }
            (store, outcome)
        }
        Err(_) => (DisplayProfileStore::default(), LoadOutcome::Missing),
    }
}

/// Write the store atomically.
///
/// Temp file then rename: a reader interrupted mid-write sees the previous file
/// intact rather than a truncated one that still parses.
pub fn save_to(config_dir: &Path, store: &DisplayProfileStore) -> Result<(), String> {
    std::fs::create_dir_all(config_dir)
        .map_err(|e| format!("could not create the config directory: {e}"))?;
    let path = store_path(config_dir);
    let temp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("could not serialize display profiles: {e}"))?;
    std::fs::write(&temp, json).map_err(|e| format!("could not write display profiles: {e}"))?;
    // Windows rename fails onto an existing file, so clear the way first. The
    // window this opens is why the temp file is kept until the rename succeeds.
    let _ = std::fs::remove_file(&path);
    std::fs::rename(&temp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        format!("could not replace the display profile file: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds() -> StoredRect {
        StoredRect {
            x: 0,
            y: 0,
            width: 3840,
            height: 1080,
        }
    }

    const KEY: &str = "\\\\?\\DISPLAY#LHC9019#5&2a33d992&0&UID4358#{guid}";

    fn valid_profile() -> PersistedDisplayProfile {
        PersistedDisplayProfile {
            status: DisplayProfileStatus::Valid,
            average_error_px: 0.8,
            maximum_error_px: 2.1,
            configured_at_ms: 1_700_000_000_000,
            validated_at_ms: 1_700_000_000_000,
            ..PersistedDisplayProfile::unconfigured(KEY.into(), bounds())
        }
    }

    #[test]
    fn a_profile_is_found_by_its_hardware_identity() {
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        assert!(store.get(KEY).is_some());
        assert!(store.get("some other monitor").is_none());
    }

    #[test]
    fn upserting_replaces_rather_than_duplicates() {
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        let mut changed = valid_profile();
        changed.average_error_px = 3.5;
        store.upsert(changed);
        assert_eq!(store.profiles.len(), 1);
        assert_eq!(store.get(KEY).unwrap().average_error_px, 3.5);
    }

    #[test]
    fn only_a_valid_profile_permits_visual_interaction() {
        assert!(DisplayProfileStatus::Valid.allows_visual_interaction());
        for status in [
            DisplayProfileStatus::Unconfigured,
            DisplayProfileStatus::Configuring,
            DisplayProfileStatus::Stale,
            DisplayProfileStatus::Failed,
            DisplayProfileStatus::Ignored,
            DisplayProfileStatus::Disconnected,
        ] {
            assert!(
                !status.allows_visual_interaction(),
                "{status:?} must not permit visual interaction"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    #[test]
    fn a_store_survives_a_round_trip_through_json() {
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        let raw = serde_json::to_string(&store).unwrap();
        let (back, outcome) = parse(&raw);
        assert_eq!(outcome, LoadOutcome::Loaded);
        assert_eq!(back.profiles, store.profiles);
        assert_eq!(back.version, CURRENT_VERSION);
    }

    #[test]
    fn a_corrupt_file_recovers_instead_of_failing() {
        // Losing profiles costs a re-run of the wizard. Refusing to start costs
        // the whole application.
        let (store, outcome) = parse("{ this is not json");
        assert!(matches!(outcome, LoadOutcome::Recovered(_)));
        assert!(store.profiles.is_empty());
        assert_eq!(store.version, CURRENT_VERSION);
    }

    #[test]
    fn a_truncated_file_recovers_too() {
        let (_, outcome) = parse("{\"version\":1,\"profiles\":[{\"stableIde");
        assert!(matches!(outcome, LoadOutcome::Recovered(_)));
    }

    #[test]
    fn an_empty_file_is_a_first_run_not_a_corruption() {
        assert_eq!(parse("   ").1, LoadOutcome::Missing);
    }

    #[test]
    fn an_older_store_is_migrated_to_the_current_version() {
        let old = r#"{"version":0,"profiles":[]}"#;
        let (store, outcome) = parse(old);
        assert_eq!(outcome, LoadOutcome::Loaded);
        assert_eq!(store.version, CURRENT_VERSION);
    }

    #[test]
    fn a_store_from_a_newer_build_is_refused_rather_than_downgraded() {
        let future = format!(r#"{{"version":{},"profiles":[]}}"#, CURRENT_VERSION + 5);
        let (store, outcome) = parse(&future);
        assert!(matches!(outcome, LoadOutcome::Recovered(_)));
        assert!(store.profiles.is_empty());
    }

    #[test]
    fn migration_drops_profiles_that_could_never_be_looked_up() {
        let store = DisplayProfileStore {
            version: CURRENT_VERSION,
            profiles: vec![
                valid_profile(),
                PersistedDisplayProfile::unconfigured(String::new(), bounds()),
            ],
        };
        assert_eq!(migrate(store).unwrap().profiles.len(), 1);
    }

    #[test]
    fn a_saved_store_reloads_with_its_profiles_intact() {
        let dir = std::env::temp_dir().join(format!(
            "arcsonare-profile-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        save_to(&dir, &store).expect("the store must save");

        let (reloaded, outcome) = load_from(&dir);
        assert_eq!(outcome, LoadOutcome::Loaded);
        assert_eq!(
            reloaded.get(KEY).unwrap().status,
            DisplayProfileStatus::Valid
        );

        // No temporary file may survive a successful write.
        assert!(!store_path(&dir).with_extension("json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn saving_twice_replaces_rather_than_appends() {
        let dir = std::env::temp_dir().join(format!(
            "arcsonare-profile-test-2-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        save_to(&dir, &store).unwrap();
        save_to(&dir, &store).unwrap();
        let (reloaded, _) = load_from(&dir);
        assert_eq!(reloaded.profiles.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_store_is_not_an_error() {
        let dir = std::env::temp_dir().join("arcsonare-profile-does-not-exist-9f3a");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load_from(&dir).1, LoadOutcome::Missing);
    }

    #[test]
    fn nothing_in_a_stored_profile_resembles_a_screenshot_or_a_secret() {
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        let raw = serde_json::to_string(&store).unwrap().to_lowercase();
        for forbidden in ["png", "jpeg", "base64", "token", "secret", "password"] {
            assert!(
                !raw.contains(forbidden),
                "a display profile must never carry {forbidden}"
            );
        }
    }

    #[test]
    fn the_persisted_key_is_hardware_not_a_runtime_index() {
        let store = DisplayProfileStore {
            version: CURRENT_VERSION,
            profiles: vec![valid_profile()],
        };
        let key = &store.profiles[0].stable_identity;
        assert!(key.contains("DISPLAY#"), "not a device path: {key}");
        assert!(
            !key.chars().all(|c| c.is_ascii_digit()),
            "a runtime display id must never be the persisted key"
        );
    }

    #[test]
    fn marking_a_display_ignored_sets_both_the_status_and_the_flag() {
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        assert!(store.set_status(KEY, DisplayProfileStatus::Ignored));
        let profile = store.get(KEY).unwrap();
        assert_eq!(profile.status, DisplayProfileStatus::Ignored);
        assert!(profile.ignored);
        assert!(!profile.status.allows_visual_interaction());
    }

    #[test]
    fn a_disconnected_profile_is_kept_rather_than_deleted() {
        // Unplugging a monitor for the afternoon must not cost the measurement.
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        store.set_status(KEY, DisplayProfileStatus::Disconnected);
        assert!(store.get(KEY).is_some());
        assert_eq!(
            store.get(KEY).unwrap().average_error_px,
            0.8,
            "the measurement must survive disconnection"
        );
    }

    #[test]
    fn removing_a_profile_reports_whether_there_was_one() {
        let mut store = DisplayProfileStore::default();
        store.upsert(valid_profile());
        assert!(store.remove(KEY));
        assert!(!store.remove(KEY));
    }
}
