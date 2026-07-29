//! Google OAuth for Connect (Gmail / Calendar / Drive).
//!
//! Desktop loopback flow:
//! 1. Bind `http://127.0.0.1:8765/oauth/google`
//! 2. Open Google consent in the system browser (PKCE)
//! 3. Exchange the auth code for tokens
//! 4. Store tokens in Windows Credential Manager
//!
//! The OAuth Client ID identifies ArcSonare (the app), not a specific Gmail.
//! Any Google account can sign in (subject to consent-screen test-user rules).

use crate::credentials;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const REDIRECT_URI: &str = "http://127.0.0.1:8765/oauth/google";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const LISTEN_ADDR: &str = "127.0.0.1:8765";
const WAIT_TIMEOUT: Duration = Duration::from_secs(300);
const CLIENT_SECRET_KEY: &str = "oauth.google:client_secret";
/// One token bundle for Gmail + Calendar + Drive + Docs + Sheets.
const SHARED_ACCOUNT_ID: &str = "local:google";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOAuthResult {
    pub account_id: String,
    pub email: Option<String>,
    pub account_label: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOAuthStatus {
    pub connected: bool,
    pub email: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredGoogleTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
    scope: String,
    email: Option<String>,
    token_type: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    #[serde(default)]
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    scope: Option<String>,
    token_type: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserInfo {
    email: Option<String>,
    name: Option<String>,
}

fn token_storage_key(_account_id: &str) -> String {
    // All Google cards share one token vault entry.
    format!("oauth.google:{SHARED_ACCOUNT_ID}")
}

fn pkce_pair() -> (String, String) {
    // 64 hex chars from two UUIDs — valid PKCE verifier charset.
    let verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    (verifier, challenge)
}

fn build_auth_url(client_id: &str, scopes: &[String], state: &str, code_challenge: &str) -> String {
    // select_account lets the user pick any Gmail; consent ensures we get a refresh token.
    let query = urlencoding_pairs(&[
        ("client_id", client_id),
        ("redirect_uri", REDIRECT_URI),
        ("response_type", "code"),
        ("scope", &scopes.join(" ")),
        ("access_type", "offline"),
        ("prompt", "select_account consent"),
        ("include_granted_scopes", "true"),
        ("state", state),
        ("code_challenge", code_challenge),
        ("code_challenge_method", "S256"),
    ]);
    format!("{AUTH_URL}?{query}")
}

fn urlencoding_pairs(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| {
            format!(
                "{}={}",
                percent_encoding::utf8_percent_encode(k, percent_encoding::NON_ALPHANUMERIC),
                percent_encoding::utf8_percent_encode(v, percent_encoding::NON_ALPHANUMERIC)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for part in query.split('&') {
        if part.is_empty() {
            continue;
        }
        let mut it = part.splitn(2, '=');
        let key = it.next().unwrap_or("");
        let val = it.next().unwrap_or("");
        let key = percent_encoding::percent_decode_str(key)
            .decode_utf8_lossy()
            .into_owned();
        let val = percent_encoding::percent_decode_str(val)
            .decode_utf8_lossy()
            .into_owned();
        map.insert(key, val);
    }
    map
}

fn read_http_request(stream: &mut TcpStream) -> Result<String, String> {
    stream.set_read_timeout(Some(Duration::from_secs(15))).ok();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
                if buf.len() > 64_000 {
                    return Err("OAuth callback request too large.".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => break,
            Err(e) => return Err(format!("Failed to read OAuth callback: {e}")),
        }
    }
    String::from_utf8(buf).map_err(|_| "OAuth callback was not valid UTF-8.".into())
}

fn write_html(stream: &mut TcpStream, status: u16, title: &str, message: &str) {
    let body = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>{title}</title>\
         <style>body{{font-family:Segoe UI,system-ui,sans-serif;background:#111;color:#eee;\
         display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}}\
         main{{max-width:28rem;padding:2rem;text-align:center}}h1{{font-size:1.25rem}}\
         p{{opacity:.85;line-height:1.5}}</style></head><body><main>\
         <h1>{title}</h1><p>{message}</p></main></body></html>"
    );
    let status_text = if status == 200 { "OK" } else { "Bad Request" };
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("OAuth listener setup failed: {e}"))?;

    let started = Instant::now();
    loop {
        if started.elapsed() > WAIT_TIMEOUT {
            return Err(
                "Google sign-in timed out (5 minutes). Click Connect and try again.".into(),
            );
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let raw = match read_http_request(&mut stream) {
                    Ok(r) => r,
                    Err(e) => {
                        write_html(&mut stream, 400, "Sign-in failed", &e);
                        return Err(e);
                    }
                };
                let first_line = raw.lines().next().unwrap_or("");
                let path_q = first_line.split_whitespace().nth(1).unwrap_or("");
                let query = path_q.splitn(2, '?').nth(1).unwrap_or("");
                let params = parse_query(query);

                if let Some(err) = params.get("error") {
                    let desc = params
                        .get("error_description")
                        .cloned()
                        .unwrap_or_else(|| err.clone());
                    write_html(
                        &mut stream,
                        400,
                        "Sign-in cancelled",
                        &format!("Google returned: {desc}. You can close this tab."),
                    );
                    return Err(format!("Google OAuth error: {desc}"));
                }

                let state = params.get("state").cloned().unwrap_or_default();
                if state != expected_state {
                    write_html(
                        &mut stream,
                        400,
                        "Sign-in failed",
                        "Invalid OAuth state. Close this tab and try Connect again from ArcSonare.",
                    );
                    return Err("OAuth state mismatch — try Connect again.".into());
                }

                let code = params.get("code").cloned().unwrap_or_default();
                if code.is_empty() {
                    write_html(
                        &mut stream,
                        400,
                        "Sign-in failed",
                        "No authorization code received. Close this tab and try again.",
                    );
                    return Err("Google did not return an authorization code.".into());
                }

                write_html(
                    &mut stream,
                    200,
                    "Almost done",
                    "Google sign-in was received. Return to ArcSonare while it securely verifies the connection. If ArcSonare asks for a Client Secret, add it under Settings → Integrations.",
                );
                return Ok(code);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("OAuth listener error: {e}")),
        }
    }
}

async fn exchange_code(
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    code_verifier: &str,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let mut form = vec![
        ("client_id", client_id.to_string()),
        ("code", code.to_string()),
        ("code_verifier", code_verifier.to_string()),
        ("grant_type", "authorization_code".into()),
        ("redirect_uri", REDIRECT_URI.into()),
    ];
    if let Some(secret) = client_secret.filter(|s| !s.is_empty()) {
        form.push(("client_secret", secret.to_string()));
    }

    let res = client
        .post(TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {e}"))?;
    let response_status = res.status();

    let body: TokenResponse = res
        .json()
        .await
        .map_err(|e| format!("Invalid token response: {e}"))?;

    if let Some(err) = body.error {
        let desc = body.error_description.unwrap_or_else(|| err.clone());
        if err == "invalid_client" || desc.to_lowercase().contains("client secret") {
            return Err(
                "Google rejected the token exchange. Your Client ID is likely a Web application type — paste the Client Secret in Settings → Integrations (or create a Desktop OAuth client and use that Client ID)."
                    .into(),
            );
        }
        return Err(format!("Google token error: {desc}"));
    }
    if !response_status.is_success() {
        return Err(format!(
            "Google token exchange failed with HTTP {}. Check the OAuth Client ID and Client Secret in Settings → Integrations.",
            response_status.as_u16()
        ));
    }
    if body.access_token.is_empty() {
        return Err("Google returned an empty access token.".into());
    }
    Ok(body)
}

async fn fetch_email(access_token: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .ok()?;
    let info: UserInfo = client
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    info.email.or(info.name)
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn resolve_client_secret(passed: Option<String>) -> Option<String> {
    if let Some(s) = passed
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        return Some(s);
    }
    credentials::secure_storage_read(CLIENT_SECRET_KEY)
        .ok()
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Full Connect flow: listen → browser consent → exchange → store tokens.
#[tauri::command]
pub async fn google_oauth_connect(
    client_id: String,
    scopes: Vec<String>,
    account_id: String,
    client_secret: Option<String>,
) -> Result<GoogleOAuthResult, String> {
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("Google Client ID is missing. Add it in Settings → Integrations.".into());
    }
    if account_id.trim().is_empty() {
        return Err("Missing account id.".into());
    }
    if scopes.is_empty() {
        return Err("No OAuth scopes requested.".into());
    }

    let (verifier, challenge) = pkce_pair();
    let state = Uuid::new_v4().to_string();
    let auth_url = build_auth_url(&client_id, &scopes, &state, &challenge);

    // Bind first so Google’s redirect never hits a dead port.
    let listener = TcpListener::bind(LISTEN_ADDR).map_err(|e| {
        format!(
            "Could not listen on {LISTEN_ADDR} ({e}). Close anything using port 8765, then try Connect again."
        )
    })?;

    let expected_state = state.clone();
    let wait =
        tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &expected_state));

    open::that(&auth_url)
        .map_err(|e| format!("Could not open the Google sign-in page in your browser: {e}"))?;

    let code = wait
        .await
        .map_err(|e| format!("OAuth wait task failed: {e}"))??;

    let secret = resolve_client_secret(client_secret);
    let tokens = exchange_code(&client_id, secret.as_deref(), &code, &verifier).await?;
    let email = fetch_email(&tokens.access_token).await;
    let scope = tokens.scope.clone().unwrap_or_else(|| scopes.join(" "));
    let expires_at = now_epoch() + tokens.expires_in.unwrap_or(3600);

    let stored = StoredGoogleTokens {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at,
        scope: scope.clone(),
        email: email.clone(),
        token_type: tokens.token_type.unwrap_or_else(|| "Bearer".into()),
    };
    let json = serde_json::to_string(&stored).map_err(|e| e.to_string())?;
    credentials::secure_storage_write(&token_storage_key(SHARED_ACCOUNT_ID), &json)?;

    let granted: Vec<String> = scope
        .split_whitespace()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(GoogleOAuthResult {
        account_id: SHARED_ACCOUNT_ID.to_string(),
        email: email.clone(),
        account_label: email.unwrap_or_else(|| "Google account".into()),
        scopes: if granted.is_empty() { scopes } else { granted },
    })
}

#[tauri::command]
pub fn google_oauth_disconnect(_account_id: String) -> Result<(), String> {
    credentials::secure_storage_remove(token_storage_key(SHARED_ACCOUNT_ID))
}

#[tauri::command]
pub fn google_oauth_has_tokens(_account_id: String) -> bool {
    credentials::secure_storage_read(&token_storage_key(SHARED_ACCOUNT_ID))
        .ok()
        .flatten()
        .is_some()
}

#[tauri::command]
pub fn google_oauth_status() -> Result<GoogleOAuthStatus, String> {
    let Some(raw) = credentials::secure_storage_read(&token_storage_key(SHARED_ACCOUNT_ID))? else {
        return Ok(GoogleOAuthStatus {
            connected: false,
            email: None,
            scopes: vec![],
        });
    };
    let stored: StoredGoogleTokens =
        serde_json::from_str(&raw).map_err(|e| format!("Stored Google tokens are corrupt: {e}"))?;
    let scopes: Vec<String> = stored
        .scope
        .split_whitespace()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(GoogleOAuthStatus {
        connected: !stored.access_token.is_empty() || stored.refresh_token.is_some(),
        email: stored.email,
        scopes,
    })
}

#[tauri::command]
pub fn set_google_oauth_client_secret(secret: String) -> Result<(), String> {
    let secret = secret.trim();
    if secret.is_empty() {
        return credentials::secure_storage_remove(CLIENT_SECRET_KEY.to_string());
    }
    credentials::secure_storage_write(CLIENT_SECRET_KEY, secret)
}

#[tauri::command]
pub fn has_google_oauth_client_secret() -> bool {
    credentials::secure_storage_read(CLIENT_SECRET_KEY)
        .ok()
        .flatten()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}
