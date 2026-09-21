//! Browser work that does not depend on seeing the browser.
//!
//! ArcSonare could reach a website and find a button, and then stop — because
//! everything past "find the button" was a visual click, and a visual click
//! cannot tell two identical buttons apart, cannot know whether a download
//! started, and cannot say where the file went.
//!
//! The layers here replace the middle of that with structure:
//!
//!   `links`     — which link, decided from the page's own markup
//!   `download`  — the transfer, owned end to end so completion is a fact
//!   `installer` — what the downloaded file is, and whether running it is safe
//!
//! None of them needs a browser extension or a debugging port, which is the
//! point: the strategy ladder in the brief puts an adapter first, and there
//! isn't one, so the rung below it has to be genuinely capable rather than a
//! placeholder that falls straight through to pixels.

pub mod commands;
pub mod download;
pub mod installer;
pub mod links;

pub use download::DownloadStore;
