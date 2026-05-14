//! Tauri IPC commands exposed to the frontend.
//!
//! Each command is a thin shim around an `atlas-*` crate function. The
//! parsed workspace lives in `tauri::State` as a `Mutex<WorkspaceState>`
//! so commands can mutate it without leaking lock guards across `.await`
//! points (parsing is synchronous and CPU-bound; Tauri runs each command
//! on its own task, so blocking the lock briefly is acceptable).

use std::path::PathBuf;
use std::sync::Mutex;

use atlas_appearances::{AppearanceInfo, Appearances};
use atlas_otb::Otb;
use atlas_sprites::{Atlas, PixelFormat, SheetInspection};
use atlas_workspace::Workspace;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::edits::{self, AppearanceScope};

/// Maximum number of snapshots kept in undo history. Each snapshot is a
/// full `Workspace` clone (~few MB for a real catalog), so the cap is
/// what keeps memory bounded under heavy editing sessions.
const HISTORY_LIMIT: usize = 64;

/// Lightweight summary of what's currently loaded. Returned by every
/// `open_*` / `close_workspace` / mutation call so the frontend can
/// refresh its header without a second round-trip.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub appearances_path: Option<String>,
    pub otb_path: Option<String>,
    pub object_count: usize,
    pub outfit_count: usize,
    pub effect_count: usize,
    pub missile_count: usize,
    pub otb_item_count: usize,
    pub otb_version: Option<OtbVersion>,
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Header metadata surfaced from a loaded `items.otb`. Mirrors
/// `atlas_otb::OtbHeader` minus the 128-byte CSD blob (we surface the
/// human-readable bits separately).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtbVersion {
    pub major: u32,
    pub minor: u32,
    pub build: u32,
    pub atlas_extended: bool,
}

/// Row shape for the virtualized item list. Kept deliberately small —
/// detailed editing lives in the attribute editor (Phase 3) and uses
/// separate commands.
///
/// `otbServerId`, `isAppearanceOrphan`, and `hasOtbCollision` are only
/// meaningful for the `Object` category and only when an OTB is loaded;
/// the other categories never participate in cross-ref.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceRow {
    pub id: u32,
    pub name: Option<String>,
    pub sprite_count: usize,
    pub otb_server_id: Option<u16>,
    pub is_appearance_orphan: bool,
    pub has_otb_collision: bool,
}

/// Which appearance category the frontend is asking for. Mirrors the
/// proto top-level lists 1:1.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Object,
    Outfit,
    Effect,
    Missile,
}

/// Persistent MRU lists. Stored as one JSON file under the platform's
/// app-config dir so reopening the editor surfaces previously-used files
/// without forcing the user back through the file picker.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFiles {
    pub appearances: Vec<String>,
    pub otb: Vec<String>,
}

impl RecentFiles {
    const MAX: usize = 8;
    const FILE: &'static str = "recent_files.json";

    fn config_path(app: &AppHandle) -> Option<PathBuf> {
        app.path().app_config_dir().ok().map(|d| d.join(Self::FILE))
    }

    fn load(app: &AppHandle) -> Self {
        let Some(path) = Self::config_path(app) else {
            return Self::default();
        };
        std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(&self, app: &AppHandle) {
        let Some(path) = Self::config_path(app) else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(self) {
            let _ = std::fs::write(&path, bytes);
        }
    }

    fn record_appearances(&mut self, path: String) {
        Self::push(&mut self.appearances, path);
    }

    fn record_otb(&mut self, path: String) {
        Self::push(&mut self.otb, path);
    }

    fn push(list: &mut Vec<String>, path: String) {
        list.retain(|p| p != &path);
        list.insert(0, path);
        list.truncate(Self::MAX);
    }
}

/// Server-side state container. Holds the parsed `Workspace` plus the
/// disk paths the user picked, MRU list, and the undo/redo snapshot
/// stacks. Wrapped in `Mutex` so commands can take `&Self` and still
/// mutate.
#[derive(Default)]
pub struct WorkspaceState {
    pub workspace: Workspace,
    pub appearances_path: Option<PathBuf>,
    pub otb_path: Option<PathBuf>,
    pub recent: RecentFiles,
    pub history: Vec<Workspace>,
    pub future: Vec<Workspace>,
    pub dirty: bool,
    /// Loaded sprite atlas, set by `set_assets_dir`. Optional because
    /// the editor is useful for attribute work even without sprites.
    pub atlas: Option<Atlas>,
    pub assets_dir: Option<PathBuf>,
}

impl WorkspaceState {
    fn summary(&self) -> WorkspaceSummary {
        let (object_count, outfit_count, effect_count, missile_count) =
            match &self.workspace.appearances {
                Some(a) => (
                    a.objects.len(),
                    a.outfits.len(),
                    a.effects.len(),
                    a.missiles.len(),
                ),
                None => (0, 0, 0, 0),
            };
        let otb_item_count = self
            .workspace
            .otb
            .as_ref()
            .map(|o| o.items.len())
            .unwrap_or(0);
        let otb_version = self.workspace.otb.as_ref().map(|o| OtbVersion {
            major: o.header.major,
            minor: o.header.minor,
            build: o.header.build,
            atlas_extended: o.header.is_atlas_extended(),
        });

        WorkspaceSummary {
            appearances_path: self
                .appearances_path
                .as_ref()
                .map(|p| p.display().to_string()),
            otb_path: self.otb_path.as_ref().map(|p| p.display().to_string()),
            object_count,
            outfit_count,
            effect_count,
            missile_count,
            otb_item_count,
            otb_version,
            dirty: self.dirty,
            can_undo: !self.history.is_empty(),
            can_redo: !self.future.is_empty(),
        }
    }
}

/// Append `snapshot` to `history`, drop the oldest entries past the
/// limit. Kept as a free function so both edit commands can call it
/// without re-borrowing the same WorkspaceState mutably twice.
fn push_history(history: &mut Vec<Workspace>, snapshot: Workspace) {
    history.push(snapshot);
    if history.len() > HISTORY_LIMIT {
        let excess = history.len() - HISTORY_LIMIT;
        history.drain(0..excess);
    }
}

pub type SharedWorkspace = Mutex<WorkspaceState>;

#[tauri::command]
pub fn open_appearances(
    path: String,
    app: AppHandle,
    state: State<'_, SharedWorkspace>,
) -> Result<WorkspaceSummary, String> {
    let parsed = Appearances::load_from_file(&path).map_err(|e| e.to_string())?;
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.workspace.appearances = Some(parsed);
    guard.appearances_path = Some(PathBuf::from(&path));
    guard.recent.record_appearances(path);
    guard.recent.save(&app);
    // Loading new content invalidates undo history.
    guard.history.clear();
    guard.future.clear();
    guard.dirty = false;
    Ok(guard.summary())
}

#[tauri::command]
pub fn open_otb(
    path: String,
    app: AppHandle,
    state: State<'_, SharedWorkspace>,
) -> Result<WorkspaceSummary, String> {
    let parsed = Otb::load_from_file(&path).map_err(|e| e.to_string())?;
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.workspace.otb = Some(parsed);
    guard.otb_path = Some(PathBuf::from(&path));
    guard.recent.record_otb(path);
    guard.recent.save(&app);
    guard.history.clear();
    guard.future.clear();
    guard.dirty = false;
    Ok(guard.summary())
}

#[tauri::command]
pub fn close_workspace(state: State<'_, SharedWorkspace>) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    // Preserve recent_files across close — only the loaded models reset.
    let recent = std::mem::take(&mut guard.recent);
    *guard = WorkspaceState {
        recent,
        ..WorkspaceState::default()
    };
    Ok(guard.summary())
}

#[tauri::command]
pub fn update_appearance_field(
    scope: AppearanceScope,
    id: u32,
    field: String,
    value: Value,
    state: State<'_, SharedWorkspace>,
) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let snapshot = guard.workspace.clone();
    let appearances = guard
        .workspace
        .appearances
        .as_mut()
        .ok_or("appearances.dat is not loaded")?;
    edits::update_appearance_field(appearances, scope, id, &field, value)?;
    // Only push the snapshot now that the edit succeeded — failed
    // validation should not pollute undo history.
    push_history(&mut guard.history, snapshot);
    guard.future.clear();
    guard.dirty = true;
    Ok(guard.summary())
}

#[tauri::command]
pub fn update_otb_item_field(
    server_id: u16,
    field: String,
    value: Value,
    state: State<'_, SharedWorkspace>,
) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let snapshot = guard.workspace.clone();
    let otb = guard
        .workspace
        .otb
        .as_mut()
        .ok_or("items.otb is not loaded")?;
    edits::update_otb_item_field(otb, server_id, &field, value)?;
    push_history(&mut guard.history, snapshot);
    guard.future.clear();
    guard.dirty = true;
    Ok(guard.summary())
}

#[tauri::command]
pub fn undo(state: State<'_, SharedWorkspace>) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let prev = guard.history.pop().ok_or("nothing to undo")?;
    let current = std::mem::replace(&mut guard.workspace, prev);
    guard.future.push(current);
    guard.dirty = true;
    Ok(guard.summary())
}

#[tauri::command]
pub fn redo(state: State<'_, SharedWorkspace>) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let next = guard.future.pop().ok_or("nothing to redo")?;
    let current = std::mem::replace(&mut guard.workspace, next);
    guard.history.push(current);
    guard.dirty = true;
    Ok(guard.summary())
}

#[tauri::command]
pub fn save_appearances(state: State<'_, SharedWorkspace>) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let path = guard
        .appearances_path
        .clone()
        .ok_or("no appearances.dat path on record — load one first")?;
    let appearances = guard
        .workspace
        .appearances
        .as_ref()
        .ok_or("appearances.dat is not loaded")?;
    write_with_backup(&path, |dst| {
        appearances.save_to_file(dst).map_err(|e| e.to_string())
    })?;
    guard.dirty = false;
    Ok(guard.summary())
}

/// Append a brand-new object appearance with the next free id and
/// return its id. Auto-snapshots for undo. Frontend should select the
/// new id to drop the user into the attribute editor.
#[tauri::command]
pub fn create_object_appearance(state: State<'_, SharedWorkspace>) -> Result<NewItemInfo, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let snapshot = guard.workspace.clone();
    let appearances = guard
        .workspace
        .appearances
        .as_mut()
        .ok_or("appearances.dat is not loaded")?;
    let next_id = appearances
        .objects
        .iter()
        .map(|a| a.id.0)
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    if next_id == u32::MAX {
        return Err("appearance id space exhausted".into());
    }
    let new_appearance = atlas_appearances::AppearanceInfo {
        id: atlas_appearances::AssetId(next_id),
        category: atlas_core::AppearanceCategory::Object,
        ..Default::default()
    };
    appearances.objects.push(new_appearance);
    push_history(&mut guard.history, snapshot);
    guard.future.clear();
    guard.dirty = true;
    Ok(NewItemInfo {
        appearance_id: next_id,
        otb_server_id: None,
    })
}

/// Append a new OTB item linked to an existing appearance by client_id.
/// Server_id is auto-allocated as max(existing)+1. Returns both ids so
/// the frontend can refresh + select the row.
#[tauri::command]
pub fn create_otb_item(
    client_id: u16,
    state: State<'_, SharedWorkspace>,
) -> Result<NewItemInfo, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let snapshot = guard.workspace.clone();
    let otb = guard
        .workspace
        .otb
        .as_mut()
        .ok_or("items.otb is not loaded")?;
    let next_server_id = otb
        .items
        .iter()
        .filter_map(|i| i.server_id)
        .max()
        .unwrap_or(99)
        .saturating_add(1);
    if next_server_id == u16::MAX {
        return Err("OTB server_id space exhausted".into());
    }
    let new_item = atlas_otb::OtbItem {
        group: atlas_otb::ItemGroup::None,
        server_id: Some(next_server_id),
        client_id: Some(client_id),
        ..Default::default()
    };
    otb.items.push(new_item);
    push_history(&mut guard.history, snapshot);
    guard.future.clear();
    guard.dirty = true;
    Ok(NewItemInfo {
        appearance_id: client_id as u32,
        otb_server_id: Some(next_server_id),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewItemInfo {
    pub appearance_id: u32,
    pub otb_server_id: Option<u16>,
}

#[tauri::command]
pub fn save_otb(state: State<'_, SharedWorkspace>) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let path = guard
        .otb_path
        .clone()
        .ok_or("no items.otb path on record — load one first")?;
    let otb = guard
        .workspace
        .otb
        .as_ref()
        .ok_or("items.otb is not loaded")?;
    write_with_backup(&path, |dst| {
        otb.save_to_file(dst).map_err(|e| e.to_string())
    })?;
    guard.dirty = false;
    Ok(guard.summary())
}

/// Copy the existing file to `<path>.bak` (overwriting any previous bak)
/// before invoking the writer. Skips the backup step silently if the
/// source file does not exist yet.
fn write_with_backup<F>(path: &PathBuf, writer: F) -> Result<(), String>
where
    F: FnOnce(&PathBuf) -> Result<(), String>,
{
    if path.exists() {
        let bak = path.with_extension(
            path.extension()
                .map(|e| format!("{}.bak", e.to_string_lossy()))
                .unwrap_or_else(|| "bak".into()),
        );
        std::fs::copy(path, &bak).map_err(|e| format!("backup failed: {e}"))?;
    }
    writer(path)
}

#[tauri::command]
pub fn get_workspace_summary(
    state: State<'_, SharedWorkspace>,
) -> Result<WorkspaceSummary, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.summary())
}

#[tauri::command]
pub fn get_recent_files(state: State<'_, SharedWorkspace>) -> Result<RecentFiles, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.recent.clone())
}

/// Project the requested appearance category onto the lightweight row
/// shape the virtualized list consumes. Only the `Object` category
/// participates in the OTB cross-reference; the other three never carry
/// a `server_id` or orphan/collision flags.
#[tauri::command]
pub fn list_appearances(
    category: Category,
    state: State<'_, SharedWorkspace>,
) -> Result<Vec<AppearanceRow>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(appearances) = guard.workspace.appearances.as_ref() else {
        return Ok(Vec::new());
    };

    let entries: &[AppearanceInfo] = match category {
        Category::Object => &appearances.objects,
        Category::Outfit => &appearances.outfits,
        Category::Effect => &appearances.effects,
        Category::Missile => &appearances.missiles,
    };

    let cross_ref = match category {
        Category::Object => guard.workspace.cross_ref(),
        _ => None,
    };

    let rows = entries
        .iter()
        .enumerate()
        .map(|(idx, app)| {
            let (otb_server_id, is_appearance_orphan, has_otb_collision) = match cross_ref.as_ref()
            {
                Some(xr) => {
                    let matches = xr.otb_items_for(idx);
                    let server_id = matches.first().copied().and_then(|otb_idx| {
                        guard
                            .workspace
                            .otb
                            .as_ref()
                            .and_then(|o| o.items.get(otb_idx))
                            .and_then(|i| i.server_id)
                    });
                    (server_id, matches.is_empty(), matches.len() > 1)
                }
                None => (None, false, false),
            };
            AppearanceRow {
                id: app.id.0,
                name: app.name.clone(),
                sprite_count: app.sprite_ids.len(),
                otb_server_id,
                is_appearance_orphan,
                has_otb_collision,
            }
        })
        .collect();

    Ok(rows)
}

/// Called from the setup hook so recent_files survives restart. Cannot
/// happen earlier because the path API needs an `AppHandle`.
pub fn hydrate_recent_files(app: &AppHandle, state: &SharedWorkspace) {
    let recent = RecentFiles::load(app);
    if let Ok(mut guard) = state.lock() {
        guard.recent = recent;
    }
}

/// Full appearance payload for the attribute editor. Returns `None` if
/// no appearance with that id exists in the given category.
#[tauri::command]
pub fn get_appearance(
    scope: AppearanceScope,
    id: u32,
    state: State<'_, SharedWorkspace>,
) -> Result<Option<AppearanceInfo>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(app) = guard.workspace.appearances.as_ref() else {
        return Ok(None);
    };
    let list: &[AppearanceInfo] = match scope {
        AppearanceScope::Object => &app.objects,
        AppearanceScope::Outfit => &app.outfits,
        AppearanceScope::Effect => &app.effects,
        AppearanceScope::Missile => &app.missiles,
    };
    Ok(list.iter().find(|a| a.id.0 == id).cloned())
}

/// Full OTB item payload for the attribute editor. Returns `None` when
/// no item has the given server_id.
#[tauri::command]
pub fn get_otb_item(
    server_id: u16,
    state: State<'_, SharedWorkspace>,
) -> Result<Option<atlas_otb::OtbItem>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(otb) = guard.workspace.otb.as_ref() else {
        return Ok(None);
    };
    Ok(otb
        .items
        .iter()
        .find(|i| i.server_id == Some(server_id))
        .cloned())
}

/// Point the sprite atlas at the Tibia client's `assets/` directory
/// (the one with `catalog-content.json`). Returns the number of sprite
/// sheets discovered so the UI can confirm the directory was right.
#[tauri::command]
pub fn set_assets_dir(
    path: String,
    state: State<'_, SharedWorkspace>,
) -> Result<AssetsDirInfo, String> {
    let atlas = Atlas::from_assets_dir(&path).map_err(|e| e.to_string())?;
    let info = AssetsDirInfo {
        path: path.clone(),
        sheet_count: atlas.catalog().sheets.len(),
        sprite_id_range: atlas
            .catalog()
            .sheets
            .first()
            .map(|s| s.firstspriteid)
            .zip(atlas.catalog().sheets.last().map(|s| s.lastspriteid)),
    };
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.atlas = Some(atlas);
    guard.assets_dir = Some(PathBuf::from(path));
    Ok(info)
}

/// One-shot launcher action: pick an assets directory, load both the
/// sprite atlas and the appearances.dat referenced in
/// `catalog-content.json`. Returns the resulting workspace summary +
/// assets info so the UI can transition straight into the editor.
#[tauri::command]
pub fn open_assets_bundle(
    path: String,
    app: AppHandle,
    state: State<'_, SharedWorkspace>,
) -> Result<AssetsBundleResult, String> {
    let atlas = Atlas::from_assets_dir(&path).map_err(|e| e.to_string())?;
    let appearances_file = atlas.catalog().appearances_file.clone();
    let assets_path = PathBuf::from(&path);

    let appearances_path = appearances_file
        .as_ref()
        .map(|name| assets_path.join(name));
    let appearances = match appearances_path.as_ref() {
        Some(p) => Some(Appearances::load_from_file(p).map_err(|e| e.to_string())?),
        None => None,
    };

    let sheet_count = atlas.catalog().sheets.len();
    let sprite_id_range = atlas
        .catalog()
        .sheets
        .first()
        .map(|s| s.firstspriteid)
        .zip(atlas.catalog().sheets.last().map(|s| s.lastspriteid));

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.atlas = Some(atlas);
    guard.assets_dir = Some(assets_path);
    if let Some(parsed) = appearances {
        guard.workspace.appearances = Some(parsed);
        if let Some(p) = appearances_path {
            let path_str = p.display().to_string();
            guard.appearances_path = Some(p);
            guard.recent.record_appearances(path_str);
            guard.recent.save(&app);
        }
        guard.history.clear();
        guard.future.clear();
        guard.dirty = false;
    }

    let assets_path_buf = std::path::PathBuf::from(&path);
    let version_hint = extract_version_hint(&assets_path_buf);
    let assets = AssetsDirInfo {
        path,
        sheet_count,
        sprite_id_range,
    };
    Ok(AssetsBundleResult {
        summary: guard.summary(),
        assets,
        appearances_loaded: appearances_file.is_some(),
        version_hint,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetsBundleResult {
    pub summary: WorkspaceSummary,
    pub assets: AssetsDirInfo,
    pub appearances_loaded: bool,
    /// Best-effort client version string extracted from the path. Look
    /// at the assets directory and its parent for a name matching
    /// `Tibia<major>.<minor>(.<build>)?`. Returns `None` when the path
    /// gives no hint.
    pub version_hint: Option<String>,
}

fn extract_version_hint(path: &std::path::Path) -> Option<String> {
    // Walk up to the path itself + 2 ancestors. The Tibia installer
    // typically puts the assets folder inside `Tibia<version>\assets`,
    // so the immediate parent is the candidate that usually pays off.
    let candidates = std::iter::once(path)
        .chain(path.ancestors().take(3))
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()))
        .collect::<Vec<_>>();
    for name in candidates {
        if let Some(rest) = name.strip_prefix("Tibia") {
            // Must start with a digit to be a real version pin.
            if rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                return Some(rest.to_string());
            }
        }
    }
    None
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetsDirInfo {
    pub path: String,
    pub sheet_count: usize,
    pub sprite_id_range: Option<(u32, u32)>,
}

#[tauri::command]
pub fn get_assets_dir_info(
    state: State<'_, SharedWorkspace>,
) -> Result<Option<AssetsDirInfo>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(atlas) = guard.atlas.as_ref() else {
        return Ok(None);
    };
    Ok(Some(AssetsDirInfo {
        path: guard
            .assets_dir
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        sheet_count: atlas.catalog().sheets.len(),
        sprite_id_range: atlas
            .catalog()
            .sheets
            .first()
            .map(|s| s.firstspriteid)
            .zip(atlas.catalog().sheets.last().map(|s| s.lastspriteid)),
    }))
}

/// Diagnostic dump of the sheet covering `sprite_id`. Returns the
/// sheet's catalog metadata plus the first bytes of the raw + decoded
/// streams so we can debug pixel-format mismatches without rebuilding.
#[tauri::command]
pub fn inspect_sprite(
    sprite_id: u32,
    state: State<'_, SharedWorkspace>,
) -> Result<SheetInspection, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let atlas = guard
        .atlas
        .as_ref()
        .ok_or("assets dir is not set — open assets first")?;
    atlas.inspect(sprite_id).map_err(|e| e.to_string())
}

/// Change the on-disk channel order the sprite atlas uses to decode
/// sheets. Returns the new format so the UI can reflect it. Clears
/// the sheet cache so the next `get_sprite_png` redecodes with the
/// fresh permutation.
#[tauri::command]
pub fn set_sprite_pixel_format(
    format: PixelFormat,
    state: State<'_, SharedWorkspace>,
) -> Result<PixelFormat, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let atlas = guard
        .atlas
        .as_mut()
        .ok_or("assets dir is not set — open assets first")?;
    atlas.set_pixel_format(format);
    Ok(atlas.pixel_format())
}

#[tauri::command]
pub fn get_sprite_pixel_format(
    state: State<'_, SharedWorkspace>,
) -> Result<Option<PixelFormat>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.atlas.as_ref().map(|a| a.pixel_format()))
}

/// Encode the requested sprite as a `data:image/png;base64,...` string
/// so the frontend can drop it directly into an `<img src>`. Returns
/// `None` when the assets dir is not set; returns an error when the
/// sprite id cannot be located or the sheet fails to decode.
#[tauri::command]
pub fn get_sprite_png(
    sprite_id: u32,
    state: State<'_, SharedWorkspace>,
) -> Result<Option<String>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(atlas) = guard.atlas.as_ref() else {
        return Ok(None);
    };
    let img = atlas.sprite(sprite_id).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new(&mut buf),
        img.as_raw(),
        img.width(),
        img.height(),
        image::ColorType::Rgba8.into(),
    )
    .map_err(|e| format!("png encode: {e}"))?;
    let encoded = BASE64.encode(&buf);
    Ok(Some(format!("data:image/png;base64,{encoded}")))
}
