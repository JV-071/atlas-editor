//! Map Editor tool (M1: read-only viewer).
//!
//! Holds a parsed `.otbm` indexed by floor and renders a requested tile
//! region by compositing item sprites pulled from the assets workspace
//! (the same `appearances.dat` + sprite atlas the Assets Editor loads).
//! Map item ids are treated as client ids that index `appearances`
//! directly — the Atlas-standard bundle convention.

pub mod commands;

use std::collections::HashMap;
use std::sync::Mutex;

/// Parsed map + render caches. Empty until a map is opened.
#[derive(Default)]
pub struct MapEditorState {
    /// `z` → `(x, y)` → item-id stack (ground first).
    pub floors: HashMap<u8, HashMap<(u16, u16), Vec<u16>>>,
    /// Lazy `client_id → display sprite id`, built from the assets
    /// appearances the first time a region is rendered.
    pub sprite_index: Option<HashMap<u32, u32>>,
}

pub type SharedMapEditor = Mutex<MapEditorState>;
