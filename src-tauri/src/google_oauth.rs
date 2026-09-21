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
/// Stored separately from the token bundle so a connection made before the
/// bundle carried a client id can still be refreshed (no reconnect needed).
const CLIENT_ID_KEY: &str = "oauth.google:client_id";
/// Id of the single-account bundle written by versions before multi-account
/// support. Kept so `ensure_legacy_account_migrated` can adopt it in place.
const SHARED_ACCOUNT_ID: &str = "local:google";
/// Index of every connected Google account: `[{accountId, email}, ...]`.
const ACCOUNT_INDEX_KEY: &str = "oauth.google:index";
/// Id of the account whose tokens `valid_access_token` currently borrows.
const ACTIVE_ACCOUNT_KEY: &str = "oauth.google:active";

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
    pub account_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleAccountEntry {
    account_id: String,
    email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAccountSummary {
    pub account_id: String,
    pub email: Option<String>,
    pub active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredGoogleTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
    scope: String,
    email: Option<String>,
    token_type: String,
    /// Needed to refresh without a round-trip to the frontend.
    /// `default` keeps token bundles written before this field existed readable.
    #[serde(default)]
    client_id: Option<String>,
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

fn token_storage_key(account_id: &str) -> String {
    format!("oauth.google:{account_id}")
}

fn read_account_index() -> Vec<GoogleAccountEntry> {
    credentials::secure_storage_read(ACCOUNT_INDEX_KEY)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_account_index(entries: &[GoogleAccountEntry]) -> Result<(), String> {
    let json = serde_json::to_string(entries).map_err(|e| e.to_string())?;
    credentials::secure_storage_write(ACCOUNT_INDEX_KEY, &json)
}

fn read_active_account_id() -> Option<String> {
    credentials::secure_storage_read(ACTIVE_ACCOUNT_KEY)
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
}

fn write_active_account_id(account_id: &str) -> Result<(), String> {
    credentials::secure_storage_write(ACTIVE_ACCOUNT_KEY, account_id)
}

/// Adopts a pre-multi-account token bundle in place. Before this feature, one
/// bundle lived at `token_storage_key(SHARED_ACCOUNT_ID)` with no index and no
/// active pointer; that key layout is unchanged, so this only needs to write
/// the index + active pointer the first time, never move the token bundle.
fn ensure_legacy_account_migrated() {
    if read_active_account_id().is_some() || !read_account_index().is_empty() {
        return;
    }
    let Ok(Some(raw)) = credentials::secure_storage_read(&token_storage_key(SHARED_ACCOUNT_ID))
    else {
        return;
    };
    let email = serde_json::from_str::<StoredGoogleTokens>(&raw)
        .ok()
        .and_then(|t| t.email);
    let _ = write_account_index(&[GoogleAccountEntry {
        account_id: SHARED_ACCOUNT_ID.to_string(),
        email,
    }]);
    let _ = write_active_account_id(SHARED_ACCOUNT_ID);
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

/// Return a usable access token, refreshing it first when it is expired or
/// within 60s of expiring. Refreshed tokens are written back to the vault so
/// the next call is a cheap read.
///
/// `Ok(None)` means "not connected" — callers should report that, not an error.
pub(crate) async fn valid_access_token() -> Result<Option<String>, String> {
    ensure_legacy_account_migrated();
    let Some(active_id) = read_active_account_id() else {
        return Ok(None);
    };
    let key = token_storage_key(&active_id);
    let Some(raw) = credentials::secure_storage_read(&key)? else {
        return Ok(None);
    };
    let mut stored: StoredGoogleTokens =
        serde_json::from_str(&raw).map_err(|e| format!("Stored Google tokens are corrupt: {e}"))?;

    // Still fresh — 60s of headroom so a token can't expire mid-request.
    if !stored.access_token.is_empty() && now_epoch() + 60 < stored.expires_at {
        return Ok(Some(stored.access_token));
    }

    // Fall back to the standalone client-id entry: bundles written before the
    // struct carried `client_id` would otherwise be permanently unrefreshable
    // and every API call would 401.
    let client_id = stored.client_id.clone().or_else(|| {
        credentials::secure_storage_read(CLIENT_ID_KEY)
            .ok()
            .flatten()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    });

    let (Some(refresh_token), Some(client_id)) = (stored.refresh_token.clone(), client_id) else {
        return Err(
            "Your Google sign-in needs to be renewed. Open Connect and reconnect Google.".into(),
        );
    };
    let secret = resolve_client_secret(None);

    let mut form = vec![
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
    ];
    if let Some(s) = secret {
        form.push(("client_secret", s));
    }

    let res = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Could not prepare the Google connection: {e}"))?
        .post(TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Could not reach Google to refresh the session: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        log::error!("google token refresh failed ({status}): {body}");
        return Err(
            "Your Google session expired and could not be renewed. Reconnect Google in Connect."
                .into(),
        );
    }

    let refreshed: TokenResponse = res
        .json()
        .await
        .map_err(|e| format!("Google returned an unreadable refresh response: {e}"))?;
    if refreshed.access_token.is_empty() {
        return Err(
            "Google did not return a new access token. Reconnect Google in Connect.".into(),
        );
    }

    stored.expires_at = now_epoch() + refreshed.expires_in.unwrap_or(3600);
    stored.access_token = refreshed.access_token.clone();
    // A refresh response usually omits refresh_token — keep the existing one.
    if let Some(new_refresh) = refreshed.refresh_token {
        stored.refresh_token = Some(new_refresh);
    }
    if let Ok(json) = serde_json::to_string(&stored) {
        let _ = credentials::secure_storage_write(&key, &json);
    }
    Ok(Some(refreshed.access_token))
}

/// Full Connect flow: listen → browser consent → exchange → store tokens.
#[tauri::command]
pub async fn google_oauth_connect(
    client_id: String,
    scopes: Vec<String>,
    // Legacy parameter: the real account id is resolved from the signed-in
    // email after the OAuth round trip, so any value here is ignored.
    account_id: String,
    client_secret: Option<String>,
) -> Result<GoogleOAuthResult, String> {
    let _ = account_id;
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("Google Client ID is missing. Add it in Settings → Integrations.".into());
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
    // Kept alongside the tokens so refresh works even if the bundle is ever
    // rewritten by an older build.
    let _ = credentials::secure_storage_write(CLIENT_ID_KEY, &client_id);
    let tokens = exchange_code(&client_id, secret.as_deref(), &code, &verifier).await?;
    let email = fetch_email(&tokens.access_token).await;
    let scope = tokens.scope.clone().unwrap_or_else(|| scopes.join(" "));
    let expires_at = now_epoch() + tokens.expires_in.unwrap_or(3600);

    // Reuse the existing account entry when this email is already connected
    // (a plain reconnect), otherwise mint a new one so multiple Google
    // accounts can be signed in at once.
    let mut index = read_account_index();
    let resolved_id = email
        .as_deref()
        .and_then(|addr| {
            index
                .iter()
                .find(|e| e.email.as_deref() == Some(addr))
                .map(|e| e.account_id.clone())
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let stored = StoredGoogleTokens {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at,
        scope: scope.clone(),
        email: email.clone(),
        token_type: tokens.token_type.unwrap_or_else(|| "Bearer".into()),
        client_id: Some(client_id.clone()),
    };
    let json = serde_json::to_string(&stored).map_err(|e| e.to_string())?;
    credentials::secure_storage_write(&token_storage_key(&resolved_id), &json)?;

    match index.iter_mut().find(|e| e.account_id == resolved_id) {
        Some(entry) => entry.email = email.clone(),
        None => index.push(GoogleAccountEntry {
            account_id: resolved_id.clone(),
            email: email.clone(),
        }),
    }
    write_account_index(&index)?;
    write_active_account_id(&resolved_id)?;

    let granted: Vec<String> = scope
        .split_whitespace()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(GoogleOAuthResult {
        account_id: resolved_id,
        email: email.clone(),
        account_label: email.unwrap_or_else(|| "Google account".into()),
        scopes: if granted.is_empty() { scopes } else { granted },
    })
}

#[tauri::command]
pub fn google_oauth_disconnect(account_id: String) -> Result<(), String> {
    ensure_legacy_account_migrated();
    let account_id = account_id.trim();
    if account_id.is_empty() {
        return Err("Missing account id.".into());
    }
    credentials::secure_storage_remove(token_storage_key(account_id))?;

    let mut index = read_account_index();
    index.retain(|e| e.account_id != account_id);
    write_account_index(&index)?;

    if read_active_account_id().as_deref() == Some(account_id) {
        match index.first() {
            Some(next) => write_active_account_id(&next.account_id)?,
            None => credentials::secure_storage_remove(ACTIVE_ACCOUNT_KEY.to_string())?,
        }
    }
    Ok(())
}

#[tauri::command]
pub fn google_oauth_has_tokens(account_id: String) -> bool {
    credentials::secure_storage_read(&token_storage_key(&account_id))
        .ok()
        .flatten()
        .is_some()
}

#[tauri::command]
pub fn google_oauth_list_accounts() -> Vec<GoogleAccountSummary> {
    ensure_legacy_account_migrated();
    let active = read_active_account_id();
    read_account_index()
        .into_iter()
        .map(|entry| GoogleAccountSummary {
            active: active.as_deref() == Some(entry.account_id.as_str()),
            account_id: entry.account_id,
            email: entry.email,
        })
        .collect()
}

#[tauri::command]
pub fn google_oauth_set_active_account(account_id: String) -> Result<(), String> {
    ensure_legacy_account_migrated();
    let exists = read_account_index()
        .iter()
        .any(|e| e.account_id == account_id);
    if !exists {
        return Err("Unknown Google account.".into());
    }
    write_active_account_id(&account_id)
}

#[tauri::command]
pub fn google_oauth_status() -> Result<GoogleOAuthStatus, String> {
    ensure_legacy_account_migrated();
    let account_count = read_account_index().len();
    let Some(active_id) = read_active_account_id() else {
        return Ok(GoogleOAuthStatus {
            connected: false,
            email: None,
            scopes: vec![],
            account_count,
        });
    };
    let Some(raw) = credentials::secure_storage_read(&token_storage_key(&active_id))? else {
        return Ok(GoogleOAuthStatus {
            connected: false,
            email: None,
            scopes: vec![],
            account_count,
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
        account_count,
    })
}

/// Backfills the client id for a connection made before it was persisted.
/// Cheap and idempotent — the frontend calls it on startup.
#[tauri::command]
pub fn set_google_oauth_client_id(client_id: String) -> Result<(), String> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        return Ok(());
    }
    credentials::secure_storage_write(CLIENT_ID_KEY, client_id)
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
