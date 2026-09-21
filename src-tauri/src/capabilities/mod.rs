//! ArcSonare local capability engine — native Windows tools with structured
//! results, postcondition verification, risk policy and auditing.
//!
//! The model never controls Windows directly: the webview calls
//! `capability_execute` with a capability id + validated arguments, and this
//! module enforces path security, confirmation gates and honest statuses.

pub mod applications;
pub mod approval;
pub mod approval_plan;
pub mod audit;
pub mod clipboard;
pub mod confirmation;
#[cfg(windows)]
pub mod desktop_items;
#[cfg(all(test, windows))]
mod desktop_items_live_test;
pub mod executor;
pub mod file_edit;
#[cfg(test)]
mod file_edit_live_test;
pub mod filesystem;
#[cfg(test)]
mod filesystem_live_test;
pub mod hardware;
pub mod input;
pub mod pending;
pub mod permissions;
#[cfg(test)]
mod screenshot_live_test;
pub mod screenshots;
pub mod system;
pub mod types;
pub mod web;
pub mod windows;

pub use applications::ApplicationIndexState;
pub use approval::ApprovalStore;
pub use approval_plan::PlanStore;
pub use audit::AuditStore;
pub use confirmation::ConfirmationStore;
pub use pending::PendingActionStore;
