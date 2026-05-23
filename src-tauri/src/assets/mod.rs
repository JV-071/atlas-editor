//! Assets Editor tool — read/write modern Tibia client assets bundles
//! (`appearances.dat`, sprite sheets) and the optional sibling
//! `items.otb` server catalog.

pub mod commands;
pub mod edits;
pub mod export;
pub mod obd;

pub use commands::{hydrate_recent_files, SharedWorkspace, WorkspaceState};

use atlas_appearances::SpriteInfoData;

#[derive(Debug, Clone, Copy)]
pub(crate) struct ResolvedDims {
    pub pw: u32,
    pub ph: u32,
    pub pd: u32,
    pub layers: u32,
    pub phases: u32,
}

pub(crate) fn resolve_dims(
    si: &SpriteInfoData,
    pw_default: u32,
    max_inferred_phases: Option<u32>,
) -> ResolvedDims {
    let pw = si.pattern_width.unwrap_or(pw_default).max(1);
    let ph = si.pattern_height.unwrap_or(1).max(1);
    let pd = si.pattern_depth.unwrap_or(1).max(1);
    let layers = si.layers.unwrap_or(1).max(1);
    let cells_per_phase = (pw as usize)
        .saturating_mul(ph as usize)
        .saturating_mul(pd as usize)
        .saturating_mul(layers as usize);
    let phases = if let Some(anim) = si.animation.as_ref() {
        anim.sprite_phases.len().max(1) as u32
    } else if cells_per_phase > 0 && si.sprite_ids.len() >= cells_per_phase {
        let inferred = (si.sprite_ids.len() / cells_per_phase) as u32;
        match max_inferred_phases {
            Some(cap) => inferred.clamp(1, cap),
            None => inferred.max(1),
        }
    } else {
        1
    };
    ResolvedDims {
        pw,
        ph,
        pd,
        layers,
        phases,
    }
}
