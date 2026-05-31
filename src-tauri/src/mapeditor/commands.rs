//! IPC commands for the Map Editor (M1 read-only viewer).

use std::collections::HashMap;

use atlas_appearances::{AppearanceInfo, FixedFrameGroup};
use image::{imageops, RgbaImage};
use serde::Serialize;
use tauri::{Emitter, State, Window};

use super::{MapEditorState, SharedMapEditor};
use crate::assets::SharedWorkspace;

/// Progress event payload emitted on `mapOpenProgress` during a slow
/// [`map_open`]. `percent` is 0–100; `phase` is a stable key the UI can
/// localize.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenProgress {
    phase: &'static str,
    percent: u8,
}

fn emit_progress(window: &Window, phase: &'static str, percent: u8) {
    let _ = window.emit("mapOpenProgress", OpenProgress { phase, percent });
}

/// One tile = 32×32 px in the rendered region.
const TILE_PX: u32 = 32;
/// Cap a single render request so a runaway region can't allocate a
/// gigantic buffer. 64×64 tiles = 2048×2048 px.
const MAX_REGION_TILES: u32 = 64;

/// Map summary returned on open.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapInfo {
    pub path: String,
    pub width: u16,
    pub height: u16,
    pub otbm_version: u32,
    /// Tight tile bounds.
    pub min_x: u16,
    pub min_y: u16,
    pub max_x: u16,
    pub max_y: u16,
    /// Populated floors (z), sorted; 0 = top, 15 = bottom.
    pub floors: Vec<u8>,
    pub tile_count: u32,
}

/// Parse an `.otbm` and index its tiles by floor. Replaces any
/// previously-open map. Emits `mapOpenProgress` events (0–100%) so the UI
/// can show a progress bar, since parsing a large world takes a moment.
#[tauri::command]
pub fn map_open(
    path: String,
    window: Window,
    state: State<'_, SharedMapEditor>,
) -> Result<MapInfo, String> {
    emit_progress(&window, "read", 5);
    // read_file does the I/O + the recursive node-tree parse — the bulk of
    // the cost on a big map.
    let map = atlas_otbm::read_file(&path).map_err(|e| e.to_string())?;
    let header = map.header().unwrap_or_default();
    emit_progress(&window, "parsed", 45);

    // Decode tiles ONCE, then derive both the floor index and the bounds
    // from the same Vec (the old code walked the tree twice — once for
    // tiles, once for bounds).
    let tiles = map.tiles();
    emit_progress(&window, "decoded", 60);

    let total = tiles.len().max(1);
    let step = (total / 20).max(1); // ~20 progress ticks across 60→95%
    let mut floors: HashMap<u8, HashMap<(u16, u16), Vec<u16>>> = HashMap::new();
    let mut floor_set = std::collections::BTreeSet::new();
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (u16::MAX, u16::MAX, 0u16, 0u16);
    for (i, tile) in tiles.into_iter().enumerate() {
        min_x = min_x.min(tile.x);
        min_y = min_y.min(tile.y);
        max_x = max_x.max(tile.x);
        max_y = max_y.max(tile.y);
        floor_set.insert(tile.z);
        floors
            .entry(tile.z)
            .or_default()
            .insert((tile.x, tile.y), tile.items);
        if i % step == 0 {
            emit_progress(&window, "index", 60 + (i * 35 / total) as u8);
        }
    }
    let tile_count = total as u32;
    if floors.is_empty() {
        // No tiles: keep bounds at a sane zero.
        min_x = 0;
        min_y = 0;
    }

    let info = MapInfo {
        path: path.clone(),
        width: header.width,
        height: header.height,
        otbm_version: header.version,
        min_x,
        min_y,
        max_x,
        max_y,
        floors: floor_set.into_iter().collect(),
        tile_count,
    };

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        *guard = MapEditorState {
            floors,
            sprite_index: None,
        };
    }
    emit_progress(&window, "done", 100);

    Ok(info)
}

/// Pick the display sprite id for an item appearance: the first sprite of
/// its initial/first populated frame group.
fn display_sprite_of(app: &AppearanceInfo) -> Option<u32> {
    let fg = app
        .frame_groups
        .iter()
        .find(|fg| fg.fixed_frame_group == Some(FixedFrameGroup::ObjectInitial))
        .or_else(|| app.frame_groups.iter().find(|fg| fg.sprite_info.is_some()))?;
    fg.sprite_info.as_ref()?.sprite_ids.first().copied()
}

/// Render a `w_tiles × h_tiles` region of floor `z`, top-left tile at
/// `(x0, y0)`, into a PNG. Item sprites come from the assets workspace
/// (appearances + atlas); the map must be opened and an assets bundle
/// loaded. Returns raw PNG bytes over binary IPC.
#[tauri::command]
pub fn map_render_region(
    z: u8,
    x0: u16,
    y0: u16,
    w_tiles: u32,
    h_tiles: u32,
    map_state: State<'_, SharedMapEditor>,
    assets_state: State<'_, SharedWorkspace>,
) -> Result<tauri::ipc::Response, String> {
    let w = w_tiles.clamp(1, MAX_REGION_TILES);
    let h = h_tiles.clamp(1, MAX_REGION_TILES);

    // 1. Ensure the client_id → sprite index is built (needs appearances).
    //    Lock order is always map-then-assets to avoid deadlock with other
    //    commands (which lock at most one of the two).
    {
        let mut mg = map_state.lock().map_err(|e| e.to_string())?;
        if mg.sprite_index.is_none() {
            let ag = assets_state.lock().map_err(|e| e.to_string())?;
            let app = ag
                .workspace
                .appearances
                .as_ref()
                .ok_or("no appearances loaded — open an assets bundle first")?;
            let mut idx = HashMap::with_capacity(app.objects.len());
            for obj in &app.objects {
                if let Some(sid) = display_sprite_of(obj) {
                    idx.insert(obj.id.0, sid);
                }
            }
            mg.sprite_index = Some(idx);
        }
    }

    // 2. Clone out the per-tile sprite-id stacks for the region, then drop
    //    the map lock before the (potentially slow) decode + composite.
    let region_stacks: Vec<((u32, u32), Vec<u32>)> = {
        let mg = map_state.lock().map_err(|e| e.to_string())?;
        let index = mg.sprite_index.as_ref().expect("built above");
        let floor = mg.floors.get(&z);
        let mut out = Vec::new();
        if let Some(floor) = floor {
            for ty in 0..h {
                for tx in 0..w {
                    let x = x0.wrapping_add(tx as u16);
                    let y = y0.wrapping_add(ty as u16);
                    let Some(stack) = floor.get(&(x, y)) else {
                        continue;
                    };
                    let sprites: Vec<u32> = stack
                        .iter()
                        .filter_map(|id| index.get(&(*id as u32)).copied())
                        .collect();
                    if !sprites.is_empty() {
                        out.push(((tx, ty), sprites));
                    }
                }
            }
        }
        out
    };

    // 3. Grab the atlas (lock-free decode afterwards).
    let atlas = {
        let ag = assets_state.lock().map_err(|e| e.to_string())?;
        ag.atlas.clone()
    };
    let Some(atlas) = atlas else {
        return Err("no sprite atlas loaded — open an assets bundle first".into());
    };

    // 4. Composite. Sprites are anchored bottom-right within their tile so
    //    a 64×64 sprite overhangs up/left like the Tibia client draws it.
    let mut canvas = RgbaImage::new(w * TILE_PX, h * TILE_PX);
    for ((tx, ty), sprites) in region_stacks {
        for sprite_id in sprites {
            let Ok(sprite) = atlas.sprite(sprite_id) else {
                continue;
            };
            let cell_right = (tx + 1) * TILE_PX;
            let cell_bottom = (ty + 1) * TILE_PX;
            let dx = cell_right.saturating_sub(sprite.width());
            let dy = cell_bottom.saturating_sub(sprite.height());
            imageops::overlay(&mut canvas, &sprite, dx as i64, dy as i64);
        }
    }

    // 5. Encode PNG.
    let mut bytes = std::io::Cursor::new(Vec::new());
    canvas
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes.into_inner()))
}

/// Drop the cached `client_id → sprite` index so the next render rebuilds
/// it. Call this after the assets bundle changes (a new bundle means new
/// appearances, so the cached sprite ids are stale).
#[tauri::command]
pub fn map_invalidate_sprites(state: State<'_, SharedMapEditor>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.sprite_index = None;
    Ok(())
}

/// Inspect the item-id stack on a single tile (for the click-to-inspect
/// panel). Empty when the tile has no items or no map is open.
#[tauri::command]
pub fn map_tile_items(
    z: u8,
    x: u16,
    y: u16,
    state: State<'_, SharedMapEditor>,
) -> Result<Vec<u16>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard
        .floors
        .get(&z)
        .and_then(|floor| floor.get(&(x, y)))
        .cloned()
        .unwrap_or_default())
}
