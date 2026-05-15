//! Assets Editor tool — read/write modern Tibia client assets bundles
//! (`appearances.dat`, sprite sheets) and the optional sibling
//! `items.otb` server catalog.

pub mod commands;
pub mod edits;
pub mod export;

pub use commands::{hydrate_recent_files, SharedWorkspace, WorkspaceState};
