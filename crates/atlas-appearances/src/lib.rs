//! Parser and writer for Tibia 12+/15.x `appearances.dat` (Protocol Buffers).
//!
//! The schema lives at [`proto/appearances.proto`] and is compiled by
//! `build.rs` at build time. The generated Rust module is exposed below as
//! [`proto`].
//!
//! This crate is intentionally thin in v0: it just compiles the proto and
//! exposes the generated types. Higher-level parsers (load from file,
//! iterate per-category, etc.) will be added in upcoming phases.

#![forbid(unsafe_code)]

/// Generated protobuf types from `appearances.proto`.
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/atlas.protobuf.appearances.rs"));
}

pub use atlas_core::{AppearanceCategory, AssetId};

#[cfg(test)]
mod tests {
    #[test]
    fn proto_compiles() {
        // Sanity check: the generated module exists and can be constructed.
        let _msg = super::proto::Appearances::default();
    }
}
