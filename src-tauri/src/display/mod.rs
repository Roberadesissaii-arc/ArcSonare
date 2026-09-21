//! Rust owns the geometry.
//!
//! The model's job is to say *what* it found inside an image. Turning that into
//! a place on the desktop is arithmetic over monitor bounds, capture sizes and
//! DPI, and it belongs here ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â in one place, typed, and tested ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â rather than
//! spread across capture code, overlay code and the frontend.

#[cfg(windows)]
pub mod authority;
#[cfg(all(test, windows))]
mod click_test;
pub mod coordinates;
#[cfg(windows)]
pub mod dpi;
#[cfg(all(test, windows))]
mod enforcement_test;
pub mod frame;
#[cfg(windows)]
pub mod freshness;
#[cfg(windows)]
pub mod gate;
#[cfg(windows)]
pub mod identity;
#[cfg(all(test, windows))]
mod identity_live_test;
#[cfg(windows)]
pub mod interaction_error;
#[cfg(windows)]
pub mod live_capture;
pub mod mapping;
#[cfg(all(test, windows))]
mod mapping_live_test;
#[cfg(windows)]
#[cfg(all(test, windows))]
mod native_backend_test;
#[cfg(all(test, windows))]
mod no_bypass_test;
#[cfg(all(test, windows))]
mod physical_test;
#[cfg(windows)]
pub mod production_capture;
#[cfg(all(test, windows))]
mod production_path_test;
pub mod profile;
pub mod profile_store;
#[cfg(all(test, windows))]
mod refusal_policy_test;
#[cfg(all(test, windows))]
mod replay_test;
pub mod runtime;
pub mod side_effects;
#[cfg(test)]
mod screen_change_test;
pub mod target_recovery;
pub mod target_search;
pub mod topology;
#[cfg(all(test, windows))]
mod topology_cancellation_test;
#[cfg(windows)]
pub mod verification;
#[cfg(windows)]
pub mod visual_commands;
#[cfg(windows)]
pub mod wizard;
