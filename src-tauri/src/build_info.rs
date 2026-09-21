//! Which binary is actually running.
//!
//! ArcSonare is single-instance, so `npm run tauri dev` on a machine that
//! already has the installed build open hands off to it and exits. The new code
//! compiles, the window is right there, and every test is against an executable
//! from hours ago. That happened: a targeting bug was reported against a binary
//! built before the fix for it existed.
//!
//! So the running process states its own identity, and a report that does not
//! name the executable it tested is not a report.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub version: String,
    /// Debug or release. A debug build is the one a dev session produces;
    /// seeing "release" here during development means the installed copy won.
    pub profile: &'static str,
    pub executable_path: String,
    /// When that executable was written — the single most useful field, because
    /// it is comparable against the last build without any embedded metadata.
    pub executable_modified: Option<String>,
    pub process_id: u32,
    pub started_at: Option<String>,
    /// Set at compile time when the environment provides it.
    pub git_sha: Option<String>,
    pub build_timestamp: Option<String>,
}

fn iso(time: std::time::SystemTime) -> String {
    chrono::DateTime::<chrono::Local>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn current() -> BuildInfo {
    let exe = std::env::current_exe().unwrap_or_default();
    let modified = std::fs::metadata(&exe).ok().and_then(|m| m.modified().ok());
    BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        executable_path: exe.to_string_lossy().into_owned(),
        executable_modified: modified.map(iso),
        process_id: std::process::id(),
        started_at: process_start_time(),
        // Injected by build.rs when the information is available; absent is
        // honest rather than a placeholder that looks like a real commit.
        git_sha: option_env!("ARCSONARE_GIT_SHA").map(str::to_string),
        build_timestamp: option_env!("ARCSONARE_BUILD_TIME").map(str::to_string),
    }
}

#[cfg(windows)]
fn process_start_time() -> Option<String> {
    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn GetProcessTimes(
            process: isize,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
    }
    let mut creation = FileTime::default();
    let (mut exit, mut kernel, mut user) = (
        FileTime::default(),
        FileTime::default(),
        FileTime::default(),
    );
    let ok = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };
    if ok == 0 {
        return None;
    }
    // FILETIME counts 100ns intervals since 1601-01-01; the Unix epoch is
    // 11644473600 seconds later.
    let ticks = ((creation.high as u64) << 32) | creation.low as u64;
    let unix_secs = (ticks / 10_000_000).checked_sub(11_644_473_600)?;
    let when = std::time::UNIX_EPOCH + std::time::Duration::from_secs(unix_secs);
    Some(iso(when))
}

#[cfg(not(windows))]
fn process_start_time() -> Option<String> {
    None
}

/// One line naming the running binary, for a diagnostic header or a log.
pub fn summary() -> String {
    let b = current();
    format!(
        "ArcSonare {} ({}) pid {} — {} (built {})",
        b.version,
        b.profile,
        b.process_id,
        b.executable_path,
        b.executable_modified.as_deref().unwrap_or("unknown"),
    )
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_running_binary_can_name_itself() {
        let b = current();
        assert!(!b.executable_path.is_empty());
        assert!(b.process_id > 0);
        // The test harness is a debug build; if this ever says release, the
        // thing being tested is not the thing that was just compiled.
        assert_eq!(b.profile, "debug");
    }

    #[test]
    fn the_executable_timestamp_is_readable() {
        // This is the field that catches a stale process: comparing it against
        // the last build time needs no embedded metadata at all.
        assert!(current().executable_modified.is_some());
    }

    #[test]
    fn the_summary_names_the_path_and_the_pid() {
        let s = summary();
        assert!(s.contains("pid "));
        assert!(s.contains(".exe") || s.contains("arcsonare"));
    }
}
