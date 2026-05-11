//! Sprite extraction and rendering for Tibia 12+/15.x sprite sheets.
//!
//! Sprite sheets in `assets/` are LZMA-compressed (xz2 or lzma-rs). This
//! crate handles decompression, decoding (BGRA → RGBA), and a lock-free
//! in-memory cache (DashMap) for repeated access from the UI.
//!
//! v0 is a placeholder.

#![forbid(unsafe_code)]

pub use atlas_core::AssetId;
