//! Per-user SQLite database manager with guest isolation.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::migrations::run_migrations;

pub struct DatabaseManager {
    inner: Mutex<DatabaseInner>,
}

struct DatabaseInner {
    conn: Option<Connection>,
    path: Option<PathBuf>,
    mode: DatabaseMode,
    user_id: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DatabaseMode {
    Closed,
    Guest,
    User,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub open: bool,
    pub mode: String,
    pub path: Option<String>,
    pub user_id_hash: Option<String>,
}

impl Default for DatabaseManager {
    fn default() -> Self {
        Self {
            inner: Mutex::new(DatabaseInner {
                conn: None,
                path: None,
                mode: DatabaseMode::Closed,
                user_id: None,
            }),
        }
    }
}

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    let root = dir.join("arcsonare");
    fs::create_dir_all(&root).map_err(|e| format!("create data root: {e}"))?;
    Ok(root)
}

fn hash_user_id(user_id: &str) -> String {
    let digest = Sha256::digest(user_id.as_bytes());
    hex::encode(digest)[..32].to_string()
}

fn open_db_at(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create db dir: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("open sqlite: {e}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;",
    )
    .map_err(|e| format!("pragma: {e}"))?;
    run_migrations(&conn)?;
    Ok(conn)
}

impl DatabaseManager {
    pub fn sync_user_id(&self) -> Result<String, String> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        match guard.mode {
            DatabaseMode::Closed => Err("No local database is open".into()),
            DatabaseMode::Guest => Ok("guest".into()),
            DatabaseMode::User => guard
                .user_id
                .clone()
                .ok_or_else(|| "User database is open but user_id is missing".to_string()),
        }
    }

    pub fn with_conn_mut<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        let conn = guard
            .conn
            .as_mut()
            .ok_or_else(|| "No local database is open".to_string())?;
        f(conn)
    }

    fn status_from(inner: &DatabaseInner) -> DatabaseStatus {
        DatabaseStatus {
            open: inner.conn.is_some(),
            mode: match inner.mode {
                DatabaseMode::Closed => "closed",
                DatabaseMode::Guest => "guest",
                DatabaseMode::User => "user",
            }
            .into(),
            path: inner.path.as_ref().map(|p| p.display().to_string()),
            user_id_hash: inner.user_id.as_ref().map(|id| hash_user_id(id)),
        }
    }

    pub fn status(&self) -> DatabaseStatus {
        match self.inner.lock() {
            Ok(guard) => Self::status_from(&guard),
            Err(_) => DatabaseStatus {
                open: false,
                mode: "error".into(),
                path: None,
                user_id_hash: None,
            },
        }
    }

    fn close_locked(inner: &mut DatabaseInner) {
        if let Some(conn) = inner.conn.take() {
            let _ = conn.close();
        }
        inner.path = None;
        inner.mode = DatabaseMode::Closed;
        inner.user_id = None;
    }

    pub fn close(&self) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        Self::close_locked(&mut guard);
        Ok(())
    }

    pub fn open_guest(&self, app: &AppHandle) -> Result<DatabaseStatus, String> {
        let path = data_root(app)?.join("guest").join("arcsonare.db");
        let conn = open_db_at(&path)?;
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        Self::close_locked(&mut guard);
        guard.conn = Some(conn);
        guard.path = Some(path);
        guard.mode = DatabaseMode::Guest;
        guard.user_id = None;
        // Build status from the held lock — never call status() here (non-reentrant Mutex).
        Ok(Self::status_from(&guard))
    }

    pub fn open_for_user(&self, app: &AppHandle, user_id: &str) -> Result<DatabaseStatus, String> {
        if user_id.trim().is_empty() {
            return Err("user_id is required".into());
        }
        let hashed = hash_user_id(user_id);
        let path = data_root(app)?
            .join("users")
            .join(&hashed)
            .join("arcsonare.db");
        let conn = open_db_at(&path)?;
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        Self::close_locked(&mut guard);
        guard.conn = Some(conn);
        guard.path = Some(path);
        guard.mode = DatabaseMode::User;
        guard.user_id = Some(user_id.to_string());
        Ok(Self::status_from(&guard))
    }

    pub fn remove_current_user_files(&self, app: &AppHandle) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        let path = guard.path.clone();
        let mode = guard.mode;
        Self::close_locked(&mut guard);
        drop(guard);
        if mode == DatabaseMode::User {
            if let Some(path) = path {
                if let Some(dir) = path.parent() {
                    let _ = fs::remove_dir_all(dir);
                }
            }
        }
        let _ = self.open_guest(app);
        Ok(())
    }
}

#[tauri::command]
pub fn database_open_guest(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
) -> Result<DatabaseStatus, String> {
    state.open_guest(&app)
}

#[tauri::command]
pub fn database_open_for_user(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
    user_id: String,
) -> Result<DatabaseStatus, String> {
    state.open_for_user(&app, &user_id)
}

#[tauri::command]
pub fn database_close_current_user(state: State<'_, DatabaseManager>) -> Result<(), String> {
    state.close()
}

#[tauri::command]
pub fn database_status(state: State<'_, DatabaseManager>) -> DatabaseStatus {
    state.status()
}

#[tauri::command]
pub fn database_remove_current_user_files(
    app: AppHandle,
    state: State<'_, DatabaseManager>,
) -> Result<(), String> {
    state.remove_current_user_files(&app)
}
