use std::{fs, path::Path};

/// Provider keys the app can compile in. Names match `.env.example`.
const BUNDLED: &[&str] = &[
    "ARCSONARE_OPENAI_API_KEY",
    "ARCSONARE_DEEPSEEK_API_KEY",
    "ARCSONARE_GEMINI_API_KEY",
];

/// Bridge the project's `.env` into cargo's compile-time environment.
///
/// Vite reads `.env` for the frontend, but cargo does not — so `option_env!` in
/// Rust would always be empty. Read the file here and forward the few keys we
/// bundle. A real environment variable, when set, wins over the file, which is
/// what lets CI inject keys without writing them to disk.
fn forward_env_file() {
    // `.env` lives at the project root, one level above src-tauri/.
    println!("cargo:rerun-if-changed=../.env");
    let contents = fs::read_to_string(Path::new("..").join(".env")).unwrap_or_default();

    for name in BUNDLED {
        println!("cargo:rerun-if-env-changed={name}");

        if let Ok(value) = std::env::var(name) {
            if !value.trim().is_empty() {
                println!("cargo:rustc-env={name}={}", value.trim());
                continue;
            }
        }

        let from_file = contents.lines().find_map(|line| {
            let line = line.trim();
            if line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            (key.trim() == *name).then(|| value.trim().trim_matches('"').to_string())
        });

        if let Some(value) = from_file {
            if !value.is_empty() {
                println!("cargo:rustc-env={name}={value}");
            }
        }
    }
}

/// Stamp the binary with what it was built from.
///
/// Without this, "is the running app the one I just compiled?" can only be
/// answered by comparing file timestamps by hand — which is how a targeting bug
/// came to be reported against an executable built hours before the fix for it.
fn stamp_build_identity() {
    let sha = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(sha) = sha {
        println!("cargo:rustc-env=ARCSONARE_GIT_SHA={sha}");
    }
    println!(
        "cargo:rustc-env=ARCSONARE_BUILD_TIME={}",
        chrono_now_rfc3339()
    );
    // Re-stamp whenever HEAD moves, so the recorded sha cannot go stale.
    println!("cargo:rerun-if-changed=../.git/HEAD");
}

/// RFC3339 without pulling chrono into the build script.
fn chrono_now_rfc3339() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Seconds since the epoch is unambiguous and trivially comparable; a
    // human-readable form is the frontend's job.
    format!("epoch:{secs}")
}

fn main() {
    forward_env_file();
    stamp_build_identity();
    tauri_build::build()
}
