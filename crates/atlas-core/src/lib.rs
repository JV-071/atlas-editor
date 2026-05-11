//! Shared types and utilities used across the Atlas Assets Editor crates.
//!
//! This crate holds neutral domain types (item identifiers, weapon enums,
//! vocation enums, etc.) that both `atlas-appearances` and `atlas-otb` map
//! to and from their native formats.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors that can occur in any Atlas Assets Editor crate.
#[derive(Debug, Error)]
pub enum AtlasError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid format: {0}")]
    InvalidFormat(String),

    #[error("unsupported version: {0}")]
    UnsupportedVersion(String),
}

pub type Result<T> = std::result::Result<T, AtlasError>;

/// Stable identifier for an item, sprite, outfit, effect or missile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AssetId(pub u32);

impl std::fmt::Display for AssetId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Logical category of an appearance entry in `appearances.dat`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppearanceCategory {
    Object,
    Outfit,
    Effect,
    Missile,
}
