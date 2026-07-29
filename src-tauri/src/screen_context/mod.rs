//! Shared screenshot capture: native capture + temporary local storage.
//! Backs the generic `screen.capture` agent capability and the Data &
//! Privacy screen-capture usage/cleanup — not tied to any standing feature.

pub mod capture;
pub mod monitors;
pub mod storage;
