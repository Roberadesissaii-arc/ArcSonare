//! Managed Kyutai Pocket TTS runtime.
//!
//! ArcSonare owns a dedicated Python venv under app data, installs `pocket-tts`
//! with pip (not uvx), and keeps `pocket-tts serve` running for Voice Lab.
//! End users never run terminal install commands.

use serde::Serialize;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const BASE_URL: &str = "http://127.0.0.1:8000";
const PACKAGE_SPEC: &str = "pocket-tts>=2.0.0";
const INSTALL_MARKER: &str = ".arcsonare-pocket-tts-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PocketTtsRuntimeStatus {
    pub phase: String,
    pub message: String,
    pub online: bool,
    pub managed: bool,
    pub base_url: String,
    pub python_found: bool,
    pub package_installed: bool,
}

#[derive(Default)]
pub struct PocketTtsState {
    child: Mutex<Option<Child>>,
    phase: Mutex<String>,
    message: Mutex<String>,
    /// Serializes ensure so concurrent Voice Lab polls do not double-install.
    ensure_lock: Mutex<()>,
}

impl PocketTtsState {
    fn set_progress(&self, phase: &str, message: &str) {
        if let Ok(mut p) = self.phase.lock() {
            *p = phase.to_string();
        }
        if let Ok(mut m) = self.message.lock() {
            *m = message.to_string();
        }
        log::info!("pocket-tts: [{phase}] {message}");
    }
}

fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    let dir = data.join("voice").join("pocket-tts");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create pocket-tts dir: {e}"))?;
    Ok(dir)
}

fn venv_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_dir(app)?.join("venv"))
}

fn marker_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_dir(app)?.join(INSTALL_MARKER))
}

fn venv_python(venv: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        venv.join("Scripts").join("python.exe")
    }
    #[cfg(not(windows))]
    {
        venv.join("bin").join("python")
    }
}

fn venv_pocket_tts(venv: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        venv.join("Scripts").join("pocket-tts.exe")
    }
    #[cfg(not(windows))]
    {
        venv.join("bin").join("pocket-tts")
    }
}

fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn run_capture(mut cmd: Command) -> Result<(i32, String, String), String> {
    apply_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run command: {e}"))?;
    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((code, stdout, stderr))
}

/// Locate a system Python 3.10–3.14 suitable for pocket-tts.
fn find_system_python() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        // Prefer the Windows Python launcher for an explicit 3.x interpreter.
        for args in [
            vec!["-3.12", "-c", "import sys; print(sys.executable)"],
            vec!["-3.11", "-c", "import sys; print(sys.executable)"],
            vec!["-3.13", "-c", "import sys; print(sys.executable)"],
            vec!["-3.10", "-c", "import sys; print(sys.executable)"],
            vec!["-3.14", "-c", "import sys; print(sys.executable)"],
            vec!["-3", "-c", "import sys; print(sys.executable)"],
        ] {
            let mut cmd = Command::new("py");
            cmd.args(&args);
            if let Ok((0, stdout, _)) = run_capture(cmd) {
                let path = PathBuf::from(stdout.trim());
                if path.exists() && python_version_ok(&path) {
                    return Ok(path);
                }
            }
        }
    }

    for name in ["python", "python3"] {
        let mut cmd = Command::new(name);
        cmd.args(["-c", "import sys; print(sys.executable)"]);
        if let Ok((0, stdout, _)) = run_capture(cmd) {
            let path = PathBuf::from(stdout.trim());
            if path.exists() && python_version_ok(&path) {
                return Ok(path);
            }
        }
    }

    Err(
        "Python 3.10–3.14 was not found. Install Python from https://www.python.org/downloads/ \
         (check “Add python.exe to PATH”), then reopen Voice Lab. ArcSonare installs Pocket TTS \
         with pip into its own folder — you do not need uvx or a manual serve command."
            .into(),
    )
}

fn python_version_ok(python: &Path) -> bool {
    let mut cmd = Command::new(python);
    cmd.args([
        "-c",
        "import sys; v=sys.version_info; raise SystemExit(0 if (v.major==3 and 10<=v.minor<=14) else 1)",
    ]);
    matches!(run_capture(cmd), Ok((0, _, _)))
}

fn package_installed(app: &AppHandle) -> bool {
    let Ok(marker) = marker_path(app) else {
        return false;
    };
    if !marker.exists() {
        return false;
    }
    venv_python_exists(app)
}

fn verify_package_import(app: &AppHandle) -> Result<(), String> {
    let venv = venv_dir(app)?;
    let py = venv_python(&venv);
    let mut cmd = Command::new(&py);
    cmd.args(["-c", "import pocket_tts"]);
    let (c, _, err) = run_capture(cmd)?;
    if c != 0 {
        return Err(format!(
            "Pocket TTS installed but could not be imported.\n{err}"
        ));
    }
    Ok(())
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

/// True only when Pocket TTS (or a compatible /tts server) is actually up.
/// Do not treat arbitrary 4xx on GET / as online — that caused false "online"
/// then "Failed to fetch" from the webview.
fn http_online() -> bool {
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return false;
    };
    // Pocket TTS serve exposes POST /tts. A quick OPTIONS/GET on /tts is enough.
    match client.get(format!("{BASE_URL}/tts")).send() {
        Ok(res) => {
            let code = res.status().as_u16();
            // Method not allowed / unprocessable still means the route exists.
            code == 200 || code == 405 || code == 422 || code == 400
        }
        Err(_) => false,
    }
}

fn ensure_venv(app: &AppHandle, state: &PocketTtsState) -> Result<PathBuf, String> {
    let venv = venv_dir(app)?;
    let py = venv_python(&venv);
    if py.exists() {
        return Ok(venv);
    }

    state.set_progress(
        "installing",
        "Creating a private Python environment for Pocket TTS…",
    );
    let system_py = find_system_python()?;
    let mut cmd = Command::new(&system_py);
    cmd.args(["-m", "venv", &venv.to_string_lossy()]);
    let (code, stdout, stderr) = run_capture(cmd)?;
    if code != 0 || !venv_python(&venv).exists() {
        return Err(format!(
            "Could not create Pocket TTS venv.\n{stdout}\n{stderr}"
        ));
    }
    Ok(venv)
}

fn ensure_package(app: &AppHandle, state: &PocketTtsState) -> Result<(), String> {
    if package_installed(app) {
        return Ok(());
    }

    let venv = ensure_venv(app, state)?;
    let py = venv_python(&venv);

    state.set_progress(
        "installing",
        "Installing Pocket TTS with pip (first time can take several minutes; downloads the model)…",
    );

    // Keep pip current inside the managed venv only.
    let mut upgrade = Command::new(&py);
    upgrade.args(["-m", "pip", "install", "--upgrade", "pip"]);
    let _ = run_capture(upgrade);

    let mut install = Command::new(&py);
    install.args(["-m", "pip", "install", PACKAGE_SPEC]);
    let (code, stdout, stderr) = run_capture(install)?;
    if code != 0 {
        return Err(format!(
            "pip install {PACKAGE_SPEC} failed.\n{stdout}\n{stderr}"
        ));
    }

    // Confirm import before writing the marker.
    verify_package_import(app)?;

    fs::write(marker_path(app)?, PACKAGE_SPEC)
        .map_err(|e| format!("could not write install marker: {e}"))?;
    Ok(())
}

fn child_alive(child: &mut Child) -> bool {
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) => false,
        Err(_) => false,
    }
}

fn stop_child(state: &PocketTtsState) {
    let mut guard = match state.child.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        log::info!("pocket-tts: stopped managed serve process");
    }
}

fn spawn_serve(app: &AppHandle, state: &PocketTtsState) -> Result<(), String> {
    // Prefer an already-running server (manual or previous session).
    if http_online() {
        state.set_progress("ready", "Pocket TTS is online.");
        return Ok(());
    }

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "pocket-tts state lock poisoned".to_string())?;
        if let Some(child) = guard.as_mut() {
            if child_alive(child) {
                return Ok(());
            }
            let _ = guard.take();
        }
    }

    let venv = venv_dir(app)?;
    let cli = venv_pocket_tts(&venv);
    let py = venv_python(&venv);

    state.set_progress(
        "starting",
        "Starting Pocket TTS server (loading model into memory)…",
    );

    let mut cmd = if cli.exists() {
        let mut c = Command::new(&cli);
        c.args(["serve", "--host", "127.0.0.1", "--port", "8000"]);
        c
    } else {
        let mut c = Command::new(&py);
        c.args([
            "-m",
            "pocket_tts",
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ]);
        c
    };

    apply_no_window(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(runtime_dir(app)?);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start pocket-tts serve: {e}"))?;

    // Drain stdout/stderr so the pipe buffer never stalls the child.
    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                log::debug!("pocket-tts stdout: {line}");
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                log::info!("pocket-tts stderr: {line}");
            }
        });
    }

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "pocket-tts state lock poisoned".to_string())?;
        *guard = Some(child);
    }

    Ok(())
}

fn wait_until_online(state: &PocketTtsState, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if http_online() {
            state.set_progress("ready", "Pocket TTS is ready.");
            return Ok(());
        }

        // Surface early process death.
        {
            let mut guard = state
                .child
                .lock()
                .map_err(|_| "pocket-tts state lock poisoned".to_string())?;
            if let Some(child) = guard.as_mut() {
                if !child_alive(child) {
                    let _ = guard.take();
                    return Err(
                        "Pocket TTS exited before becoming ready. Check the ArcSonare log for details."
                            .into(),
                    );
                }
            }
        }

        thread::sleep(Duration::from_millis(500));
    }
    Err(
        "Pocket TTS started but did not become ready in time. Wait a moment and try Speak again."
            .into(),
    )
}

fn venv_python_exists(app: &AppHandle) -> bool {
    venv_dir(app)
        .ok()
        .map(|v| venv_python(&v).exists())
        .unwrap_or(false)
}

fn build_status(app: &AppHandle, state: &PocketTtsState) -> PocketTtsRuntimeStatus {
    let online = http_online();
    let phase = state
        .phase
        .lock()
        .map(|p| p.clone())
        .unwrap_or_else(|_| "idle".into());
    let message = state.message.lock().map(|m| m.clone()).unwrap_or_default();
    let managed = state.child.lock().map(|g| g.is_some()).unwrap_or(false);
    // Prefer the managed venv; avoid spawning system Python on every poll.
    let python_found = venv_python_exists(app);
    let installed = package_installed(app);

    let (phase, message) = if online {
        ("ready".into(), "Pocket TTS is online.".into())
    } else if phase.is_empty() {
        (
            "idle".into(),
            "Pocket TTS will install and start automatically when you open Voice Lab.".into(),
        )
    } else {
        (phase, message)
    };

    PocketTtsRuntimeStatus {
        phase,
        message,
        online,
        managed,
        base_url: BASE_URL.into(),
        python_found,
        package_installed: installed,
    }
}

/// Snapshot of the managed Pocket TTS runtime.
#[tauri::command]
pub fn pocket_tts_status(
    app: AppHandle,
    state: State<'_, PocketTtsState>,
) -> PocketTtsRuntimeStatus {
    build_status(&app, &state)
}

/// Ensure the package is installed (pip) and `serve` is running.
/// Safe to call repeatedly; first run may take several minutes.
#[tauri::command]
pub fn pocket_tts_ensure(
    app: AppHandle,
    state: State<'_, PocketTtsState>,
) -> Result<PocketTtsRuntimeStatus, String> {
    let _guard = state
        .ensure_lock
        .lock()
        .map_err(|_| "pocket-tts ensure lock poisoned".to_string())?;

    if http_online() {
        state.set_progress("ready", "Pocket TTS is online.");
        return Ok(build_status(&app, &state));
    }

    ensure_package(&app, &state)?;
    spawn_serve(&app, &state)?;
    // Model load can take a while on first boot after install.
    wait_until_online(&state, Duration::from_secs(180))?;
    Ok(build_status(&app, &state))
}

/// Synthesize speech via the local Pocket TTS server (Rust → localhost).
/// Avoids webview CORS/`Failed to fetch` when calling :8000 from the UI.
#[tauri::command]
pub fn pocket_tts_synthesize(text: String, voice: String) -> Result<String, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Nothing to speak.".into());
    }
    if !http_online() {
        return Err("Pocket TTS is offline. Open Voice Lab to start it, then try again.".into());
    }

    let voice = if voice.trim().is_empty() {
        "jane".to_string()
    } else {
        voice
    };

    let form = reqwest::blocking::multipart::Form::new()
        .text("text", trimmed)
        .text("voice_url", voice);

    let client = http_client()?;
    let res = client
        .post(format!("{BASE_URL}/tts"))
        .multipart(form)
        .send()
        .map_err(|e| format!("Could not reach Pocket TTS: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let detail = res.text().unwrap_or_default();
        return Err(format!(
            "Pocket TTS failed ({status}).{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(" {}", detail.chars().take(180).collect::<String>())
            }
        ));
    }

    let bytes = res
        .bytes()
        .map_err(|e| format!("Could not read Pocket TTS audio: {e}"))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &bytes,
    ))
}

/// Stop the managed serve process (app quit).
pub fn stop_all(app: &AppHandle) {
    if let Some(state) = app.try_state::<PocketTtsState>() {
        stop_child(&state);
        state.set_progress("idle", "Pocket TTS stopped.");
    }
}
