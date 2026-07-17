//! ArcSonare local capability engine — native Windows tools with structured
//! results, postcondition verification, risk policy and auditing.
//!
//! The model never controls Windows directly: the webview calls
//! `capability_execute` with a capability id + validated arguments, and this
//! module enforces path security, confirmation gates and honest statuses.

pub mod applications;
pub mod audit;
pub mod clipboard;
pub mod confirmation;
pub mod executor;
pub mod filesystem;
pub mod permissions;
pub mod screenshots;
pub mod system;
pub mod types;
pub mod web;
pub mod windows;

pub use applications::ApplicationIndexState;
pub use audit::AuditStore;
pub use confirmation::ConfirmationStore;
