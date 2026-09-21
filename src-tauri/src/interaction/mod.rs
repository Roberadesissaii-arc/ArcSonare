//! Deciding how to act, not just acting.

pub mod commands;
pub mod executor;
#[cfg(all(test, windows))]
mod planner_highlight_live_test;
pub mod request;
pub mod strategy;
