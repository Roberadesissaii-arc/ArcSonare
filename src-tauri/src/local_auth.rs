//! Password hashing for the local-only account (no cloud, no plaintext at
//! rest). Argon2id with a fresh random salt per hash.

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;

#[tauri::command]
pub fn hash_local_password(password: String) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| format!("could not hash password: {e}"))
}

#[tauri::command]
pub fn verify_local_password(password: String, hash: String) -> Result<bool, String> {
    let parsed = PasswordHash::new(&hash).map_err(|e| format!("stored hash is invalid: {e}"))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}
