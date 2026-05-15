//! Appearance export pipeline.
//!
//! Mirrors the legacy WPF reference's image export behaviors:
//!
//! - **Item GIF** — animated, cycles every animation phase at frame
//!   (z=0, y=0, x=0, layer=0).
//! - **Outfit PNG bundle** — every (framegroup × addon × direction ×
//!   phase × layer) combination written as a separate PNG. Names follow
//!   the Gesior convention `{fg}_{y+1}_{z+1}_{x+1}_{phase+1}{_template}.png`
//!   so they slot into the existing forum/community tooling.
//! - **Effect GIF** — single direction, all phases.
//! - **Missile GIF** — 8 directions in clockwise order starting from
//!   North, drawn from the 3×3 pattern grid the proto uses for missiles.
//!
//! The orchestrator only knows how to compose appearance metadata with
//! `Atlas::sprite`; the encoder primitives live in `atlas_sprites::export`.

use std::path::{Path, PathBuf};

use atlas_appearances::{AppearanceInfo, FrameGroupInfo, SpriteInfoData};
use atlas_core::AppearanceCategory;
use atlas_sprites::{encode_animated_gif, encode_png_rgba, Atlas, RgbaImage};
use serde::{Deserialize, Serialize};

/// Format the caller wants the appearance saved as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    /// Animated GIF with one frame per animation phase.
    ItemGif,
    /// One PNG per (framegroup, direction, addon, phase, layer) cell,
    /// named with the Gesior convention.
    OutfitPngs,
    /// Animated GIF with one frame per phase.
    EffectGif,
    /// Animated GIF cycling 8 directions in clockwise order (N, NE, E, SE, S, SW, W, NW).
    MissileGif,
}

impl ExportFormat {
    /// Pick the format that best matches the appearance's category.
    /// Useful when the frontend wants a sensible default without asking.
    #[allow(dead_code)] // Mirrored on the frontend; kept here for parity.
    pub fn default_for(category: AppearanceCategory) -> Self {
        match category {
            AppearanceCategory::Object => Self::ItemGif,
            AppearanceCategory::Outfit => Self::OutfitPngs,
            AppearanceCategory::Effect => Self::EffectGif,
            AppearanceCategory::Missile => Self::MissileGif,
        }
    }
}

/// Outcome of a successful export, surfaced to the UI so it can show
/// "wrote N files at <path>".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub format: ExportFormat,
    pub files: Vec<PathBuf>,
}

/// Top-level entry point. `output_path` is treated as a directory for
/// `OutfitPngs` (we drop many files into it) and as the destination
/// file path for the GIF variants. Returns the list of files actually
/// written.
pub fn export_appearance(
    atlas: &Atlas,
    appearance: &AppearanceInfo,
    format: ExportFormat,
    output_path: &Path,
) -> Result<ExportReport, String> {
    let files = match format {
        ExportFormat::ItemGif | ExportFormat::EffectGif => {
            let bytes = encode_phase_gif(atlas, appearance, format == ExportFormat::EffectGif)?;
            write_file(output_path, &bytes)?;
            vec![output_path.to_path_buf()]
        }
        ExportFormat::MissileGif => {
            let bytes = encode_missile_gif(atlas, appearance)?;
            write_file(output_path, &bytes)?;
            vec![output_path.to_path_buf()]
        }
        ExportFormat::OutfitPngs => write_outfit_pngs(atlas, appearance, output_path)?,
    };
    Ok(ExportReport { format, files })
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
        }
    }
    std::fs::write(path, bytes).map_err(|e| format!("write {path:?}: {e}"))
}

/// Pick the first frame group that has sprites and return its
/// `SpriteInfoData` together with the resolved dimensions (using the
/// same Tibia-convention inference the list thumbnails use).
fn first_sprite_info(app: &AppearanceInfo) -> Result<(&SpriteInfoData, ResolvedDims), String> {
    let fg: &FrameGroupInfo = app
        .frame_groups
        .iter()
        .find(|fg| fg.sprite_info.is_some())
        .ok_or_else(|| format!("appearance {} has no sprite payload", app.id.0))?;
    let si = fg.sprite_info.as_ref().expect("filter guarantees presence");
    Ok((si, resolve_dims(app.category, si)))
}

/// Pattern dimensions after applying Tibia-convention fallbacks.
#[derive(Debug, Clone, Copy)]
struct ResolvedDims {
    pw: u32,
    ph: u32,
    pd: u32,
    layers: u32,
    phases: u32,
}

fn resolve_dims(category: AppearanceCategory, si: &SpriteInfoData) -> ResolvedDims {
    // Same heuristic as the list-row thumbnail builder: outfits default
    // to four directions, others to a flat list. Real proto values
    // always win when present.
    let pw_default = match category {
        AppearanceCategory::Outfit | AppearanceCategory::Missile => 4,
        _ => 1,
    };
    let pw = si.pattern_width.unwrap_or(pw_default).max(1);
    let ph = si.pattern_height.unwrap_or(1).max(1);
    let pd = si.pattern_depth.unwrap_or(1).max(1);
    let layers = si.layers.unwrap_or(1).max(1);
    let cells_per_phase = (pw as usize) * (ph as usize) * (pd as usize) * (layers as usize);
    let phases = if let Some(anim) = si.animation.as_ref() {
        anim.sprite_phases.len().max(1) as u32
    } else if cells_per_phase > 0 && si.sprite_ids.len() >= cells_per_phase {
        ((si.sprite_ids.len() / cells_per_phase) as u32).max(1)
    } else {
        1
    };
    ResolvedDims { pw, ph, pd, layers, phases }
}

/// Compute the flat sprite-id index for a (phase, z, y, x, layer) cell.
fn sprite_index(dims: &ResolvedDims, phase: u32, z: u32, y: u32, x: u32, layer: u32) -> u32 {
    ((((phase * dims.pd + z) * dims.ph + y) * dims.pw + x) * dims.layers) + layer
}

fn sprite_at(
    atlas: &Atlas,
    si: &SpriteInfoData,
    dims: &ResolvedDims,
    phase: u32,
    z: u32,
    y: u32,
    x: u32,
    layer: u32,
) -> Result<RgbaImage, String> {
    let idx = sprite_index(dims, phase, z, y, x, layer) as usize;
    let id = si
        .sprite_ids
        .get(idx)
        .copied()
        .ok_or_else(|| format!("sprite index {idx} out of bounds"))?;
    atlas.sprite(id).map_err(|e| e.to_string())
}

/// Build a per-phase GIF using the south-facing column (or x=0 when no
/// direction info is available). Used for objects and effects.
fn encode_phase_gif(
    atlas: &Atlas,
    appearance: &AppearanceInfo,
    loop_forever: bool,
) -> Result<Vec<u8>, String> {
    let (si, dims) = first_sprite_info(appearance)?;
    let x = if appearance.category == AppearanceCategory::Outfit {
        2.min(dims.pw.saturating_sub(1))
    } else {
        0
    };

    let mut frames: Vec<RgbaImage> = Vec::with_capacity(dims.phases as usize);
    for phase in 0..dims.phases {
        frames.push(sprite_at(atlas, si, &dims, phase, 0, 0, x, 0)?);
    }
    let delays = phase_durations(si, dims.phases);
    let refs: Vec<&RgbaImage> = frames.iter().collect();
    encode_animated_gif(&refs, &delays, loop_forever).map_err(|e| e.to_string())
}

/// Per-phase delays in ms, defaulting to 100 ms when the proto omits
/// timings. Length always matches `phases` so the GIF encoder can index
/// by frame number safely.
fn phase_durations(si: &SpriteInfoData, phases: u32) -> Vec<u32> {
    let from_proto: Vec<u32> = si
        .animation
        .as_ref()
        .map(|a| {
            a.sprite_phases
                .iter()
                .map(|p| {
                    let lo = p.duration_min.unwrap_or(0);
                    let hi = p.duration_max.unwrap_or(lo);
                    (lo + hi) / 2
                })
                .collect()
        })
        .unwrap_or_default();
    (0..phases as usize)
        .map(|i| {
            let d = from_proto.get(i).copied().unwrap_or(100);
            if d == 0 { 100 } else { d }
        })
        .collect()
}

/// Encode a missile as an animated GIF cycling 8 directions in
/// clockwise order. When pattern_width × pattern_height < 9 we fall
/// back to whatever the appearance ships with — partial missiles still
/// produce something playable rather than erroring out.
fn encode_missile_gif(atlas: &Atlas, appearance: &AppearanceInfo) -> Result<Vec<u8>, String> {
    let (si, dims) = first_sprite_info(appearance)?;
    // Clockwise from N over a 3×3 pattern grid laid out as
    //   pos = y*pw + x  (0..9, center = 4 is "still" / unused).
    // The Tibia missiles ship pattern_width=3 and pattern_height=3.
    const MISSILE_POSITIONS: [u32; 8] = [1, 2, 5, 8, 7, 6, 3, 0];

    let pw = dims.pw.max(1);
    let mut frames: Vec<RgbaImage> = Vec::with_capacity(MISSILE_POSITIONS.len());
    for pos in MISSILE_POSITIONS {
        let x = pos % pw;
        let y = pos / pw;
        if x >= dims.pw || y >= dims.ph {
            // Pattern doesn't include this slot; skip rather than fail.
            continue;
        }
        frames.push(sprite_at(atlas, si, &dims, 0, 0, y, x, 0)?);
    }
    if frames.is_empty() {
        return Err("missile has no usable directional sprites".into());
    }
    let delays: Vec<u32> = vec![100; frames.len()];
    let refs: Vec<&RgbaImage> = frames.iter().collect();
    encode_animated_gif(&refs, &delays, true).map_err(|e| e.to_string())
}

/// Dump every (framegroup × addon × direction × phase × layer) cell as
/// a separate PNG, Gesior naming. Returns the absolute paths written.
fn write_outfit_pngs(
    atlas: &Atlas,
    appearance: &AppearanceInfo,
    out_dir: &Path,
) -> Result<Vec<PathBuf>, String> {
    std::fs::create_dir_all(out_dir).map_err(|e| format!("mkdir {out_dir:?}: {e}"))?;

    let mut files = Vec::new();
    for (fg_idx, fg) in appearance.frame_groups.iter().enumerate() {
        let Some(si) = fg.sprite_info.as_ref() else {
            continue;
        };
        let dims = resolve_dims(appearance.category, si);

        for layer in 0..dims.layers {
            for z in 0..dims.pd {
                for y in 0..dims.ph {
                    for x in 0..dims.pw {
                        for phase in 0..dims.phases {
                            let idx =
                                sprite_index(&dims, phase, z, y, x, layer) as usize;
                            let Some(&id) = si.sprite_ids.get(idx) else {
                                continue;
                            };
                            let img = atlas.sprite(id).map_err(|e| e.to_string())?;
                            let bytes =
                                encode_png_rgba(&img).map_err(|e| e.to_string())?;
                            let suffix = if layer > 0 { "_template" } else { "" };
                            let name = format!(
                                "{}_{}_{}_{}_{}{}.png",
                                fg_idx,
                                y + 1,
                                z + 1,
                                x + 1,
                                phase + 1,
                                suffix,
                            );
                            let path = out_dir.join(name);
                            std::fs::write(&path, &bytes)
                                .map_err(|e| format!("write {path:?}: {e}"))?;
                            files.push(path);
                        }
                    }
                }
            }
        }
    }
    if files.is_empty() {
        return Err("no sprites to export".into());
    }
    Ok(files)
}
