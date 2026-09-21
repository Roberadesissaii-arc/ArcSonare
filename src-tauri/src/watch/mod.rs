//! Watched applications: an authorized, structured, live context for the
//! specific applications the user chose.
//!
//! Watching is not screen recording. Nothing here captures the screen. It keeps
//! track of which applications the user asked ArcSonare to pay attention to,
//! which real instances of those are running right now, what may be read from
//! each one, and which actions genuinely exist — so a request like "press play"
//! can resolve to a real running Spotify instead of a plausible guess.

pub mod abilities;
pub mod adapters;
pub mod catalog;
pub mod commands;
pub mod scope;
pub mod discord;
pub mod instances;
pub mod media;
pub mod model;
pub mod resolve;
pub mod store;
pub mod uia;
pub mod vscode_bridge;

#[cfg(all(test, windows))]
mod live_test;
#[cfg(test)]
mod parity_test;
