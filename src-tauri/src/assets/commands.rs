//! Tauri IPC commands for the Assets Editor tool.
//!
//! Each command is a thin shim around an `atlas-*` crate function. The
//! parsed workspace lives in `tauri::State` as a `Mutex<WorkspaceState>`
//! so commands can mutate it without leaking lock guards across `.await`
//! points (parsing is synchronous and CPU-bound; Tauri runs each command
//! on its own task, so blocking the lock briefly is acceptable).
//!
//! Commands here all start with one of `open_*`, `list_*`, `get_*`,
//! `update_*`, `save_*`, `undo` / `redo`, `set_assets_dir`,
//! `create_*` — all scoped to the Assets Editor's workflow. The
//! Converter tool has its own module.

use std::path::PathBuf;
use std::sync::Mutex;

use atlas_appearances::{AppearanceInfo, Appearances, FixedFrameGroup};
use atlas_core::AppearanceCategory;
use atlas_otb::Otb;
use atlas_sprites::{safe_join, Atlas, PixelFormat, SheetInspection, SpriteDims};
use atlas_workspace::{CrossRef, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::edits::{self, AppearanceScope};

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
    /// Sprite ids the row thumbnail cycles through. For outfits this is
    /// the idle frame group looking south; for objects/effects/missiles
    /// the initial frame group walked through every animation phase.
    /// Empty when the appearance has no sprite payload at all.
    pub display_sprite_ids: Vec<u32>,
    /// Per-phase animation duration in milliseconds, indexed parallel to
    /// `display_sprite_ids`. Empty when the appearance is not animated;
    /// callers should pick a sensible default in that case.
    pub display_durations_ms: Vec<u32>,
    /// Bitmask of the boolean flags set on this appearance. Bit positions
    /// are defined in [`FlagBit`] and must stay in sync with the frontend
    /// `FLAG_BITS` table.
    pub flags_mask: u32,
    pub otb_server_id: Option<u16>,
    pub is_appearance_orphan: bool,
    pub has_otb_collision: bool,
}

/// Bit positions for the appearance boolean flags. The frontend mirrors
/// these as `FLAG_BITS` in `types.ts`; reordering or removing entries here
/// would silently break the filter UI, so prefer appending new bits.
#[repr(u32)]
#[derive(Clone, Copy)]
enum FlagBit {
    Container = 1 << 0,
    Cumulative = 1 << 1,
    Usable = 1 << 2,
    Forceuse = 1 << 3,
    Multiuse = 1 << 4,
    Unpass = 1 << 5,
    Unmove = 1 << 6,
    Unsight = 1 << 7,
    Avoid = 1 << 8,
    Take = 1 << 9,
    Liquidcontainer = 1 << 10,
    Liquidpool = 1 << 11,
    Hang = 1 << 12,
    Rotate = 1 << 13,
    IgnoreLook = 1 << 14,
    Ammo = 1 << 15,
    DualWielding = 1 << 16,
    ShowOffSocket = 1 << 17,
    Reportable = 1 << 18,
    Wrap = 1 << 19,
    Unwrap = 1 << 20,
    Corpse = 1 << 21,
    PlayerCorpse = 1 << 22,
    AnimateAlways = 1 << 23,
    Clip = 1 << 24,
    Bottom = 1 << 25,
    Top = 1 << 26,
    NoMovementAnimation = 1 << 27,
    Translucent = 1 << 28,
    LyingObject = 1 << 29,
    Fullbank = 1 << 30,
    Topeffect = 1 << 31,
}

fn appearance_flags_mask(app: &AppearanceInfo) -> u32 {
    let f = &app.flags;
    let mut mask = 0u32;
    let set = |bit: FlagBit, on: bool, mask: &mut u32| {
        if on {
            *mask |= bit as u32;
        }
    };
    set(FlagBit::Container, f.container, &mut mask);
    set(FlagBit::Cumulative, f.cumulative, &mut mask);
    set(FlagBit::Usable, f.usable, &mut mask);
    set(FlagBit::Forceuse, f.forceuse, &mut mask);
    set(FlagBit::Multiuse, f.multiuse, &mut mask);
    set(FlagBit::Unpass, f.unpass, &mut mask);
    set(FlagBit::Unmove, f.unmove, &mut mask);
    set(FlagBit::Unsight, f.unsight, &mut mask);
    set(FlagBit::Avoid, f.avoid, &mut mask);
    set(FlagBit::Take, f.take, &mut mask);
    set(FlagBit::Liquidcontainer, f.liquidcontainer, &mut mask);
    set(FlagBit::Liquidpool, f.liquidpool, &mut mask);
    set(FlagBit::Hang, f.hang, &mut mask);
    set(FlagBit::Rotate, f.rotate, &mut mask);
    set(FlagBit::IgnoreLook, f.ignore_look, &mut mask);
    set(FlagBit::Ammo, f.ammo, &mut mask);
    set(FlagBit::DualWielding, f.dual_wielding, &mut mask);
    set(FlagBit::ShowOffSocket, f.show_off_socket, &mut mask);
    set(FlagBit::Reportable, f.reportable, &mut mask);
    set(FlagBit::Wrap, f.wrap, &mut mask);
    set(FlagBit::Unwrap, f.unwrap, &mut mask);
    set(FlagBit::Corpse, f.corpse, &mut mask);
    set(FlagBit::PlayerCorpse, f.player_corpse, &mut mask);
    set(FlagBit::AnimateAlways, f.animate_always, &mut mask);
    set(FlagBit::Clip, f.clip, &mut mask);
    set(FlagBit::Bottom, f.bottom, &mut mask);
    set(FlagBit::Top, f.top, &mut mask);
    set(FlagBit::NoMovementAnimation, f.no_movement_animation, &mut mask);
    set(FlagBit::Translucent, f.translucent, &mut mask);
    set(FlagBit::LyingObject, f.lying_object, &mut mask);
    set(FlagBit::Fullbank, f.fullbank, &mut mask);
    set(FlagBit::Topeffect, f.topeffect, &mut mask);
    mask
}

/// Compute the sprite-id cycle the list thumbnail should display for a
/// given appearance. Picks the south-facing column for outfits (the front
/// of the creature) and the initial frame group for everything else, then
/// emits one sprite per animation phase so the thumbnail can cycle.
///
/// The proto carrying these appearances often omits the pattern dimension
/// fields entirely (e.g. files exported by editor tools that only round-trip
/// the sprite ids). When that happens we fall back to Tibia conventions for
/// the category — outfits get pattern_width=4 (NESW directions), everything
/// else is treated as a flat list of animation phases.
fn build_display_cycle(app: &AppearanceInfo) -> (Vec<u32>, Vec<u32>) {
    let Some(fg) = pick_frame_group(app) else {
        return (Vec::new(), Vec::new());
    };
    let Some(si) = fg.sprite_info.as_ref() else {
        return (Vec::new(), Vec::new());
    };
    if si.sprite_ids.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let (pw_default, target_direction_x) = match app.category {
        AppearanceCategory::Outfit => (4u32, 2u32),
        _ => (1u32, 0u32),
    };

    let dims = super::resolve_dims(si, pw_default, Some(12));
    let pw = dims.pw;
    let ph = dims.ph;
    let pd = dims.pd;
    let layers = dims.layers;
    let phases = dims.phases;

    let direction_x = target_direction_x.min(pw.saturating_sub(1));

    let mut ids = Vec::with_capacity(phases as usize);
    for phase in 0..phases {
        // Manual indexing rather than SpriteInfoData::sprite_at because
        // we want to honor the inferred dims, not the proto's `None`s.
        let idx = ((((phase * pd) * ph) * pw + direction_x) * layers) as usize;
        match si.sprite_ids.get(idx) {
            Some(&id) => ids.push(id),
            None => break,
        }
    }

    if ids.is_empty() {
        // Last-ditch fallback: at least show the first sprite of the
        // flat list so the row isn't an empty placeholder.
        return (app.sprite_ids.iter().copied().take(1).collect(), Vec::new());
    }

    let durations = si
        .animation
        .as_ref()
        .map(|a| {
            a.sprite_phases
                .iter()
                .map(|p| {
                    // Tibia client picks a value in [min, max]; we just
                    // average the two so the thumbnail loops at a stable
                    // pace without an RNG in the render path.
                    let lo = p.duration_min.unwrap_or(0);
                    let hi = p.duration_max.unwrap_or(lo);
                    (lo + hi) / 2
                })
                .collect()
        })
        .unwrap_or_default();
    (ids, durations)
}

/// Pick the frame group whose sprite_info should drive the list thumbnail.
/// Prefers the fixed-frame-group hint when the file sets it, otherwise the
/// first frame group that carries sprites.
fn pick_frame_group(app: &AppearanceInfo) -> Option<&atlas_appearances::FrameGroupInfo> {
    let preferred = match app.category {
        AppearanceCategory::Outfit => Some(FixedFrameGroup::OutfitIdle),
        AppearanceCategory::Object => Some(FixedFrameGroup::ObjectInitial),
        _ => None,
    };
    preferred
        .and_then(|target| {
            app.frame_groups
                .iter()
                .find(|fg| fg.fixed_frame_group == Some(target))
        })
        .or_else(|| app.frame_groups.iter().find(|fg| fg.sprite_info.is_some()))
}

/// Row shape for the OTB-only list view, used when the user loads an
/// `items.otb` without (or in parallel with) the appearance catalog.
/// Compared to AppearanceRow this carries the on-disk server_id as the
/// natural key and surfaces whether the item has a matching appearance
/// (for the editor to know when to enable the appearance section).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtbItemRow {
    pub server_id: u16,
    pub client_id: Option<u16>,
    pub name: Option<String>,
    /// Stringified `ItemGroup` (Ground, Weapon, ...). Mirrors the
    /// `serde(rename_all = "camelCase")` we apply on Rust enums.
    pub group: String,
    pub has_appearance_match: bool,
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

/// A named bundle bookmark. Unlike the recent-files MRU (which is just
/// a path list), a profile pins the assets directory together with the
/// pixel format that decodes its sheets correctly — so switching
/// between a live Tibia client and a custom OT server bundle is one
/// click instead of re-picking the folder and re-cycling the format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub assets_path: String,
    /// Stored as the lowercase string the `PixelFormat` enum
    /// serializes to (`bgra` / `rgba` / `argb` / `abgr`).
    pub pixel_format: String,
}

/// Persisted set of profiles. Same on-disk strategy as `RecentFiles`:
/// one pretty-printed JSON file in the platform app-config dir, loaded
/// once on startup and rewritten on every mutation. Avoids pulling in
/// `tauri-plugin-store` for what is a tiny flat list.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Profiles {
    pub items: Vec<Profile>,
}

impl Profiles {
    const FILE: &'static str = "profiles.json";

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

    fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = Self::config_path(app).ok_or("no app config dir")?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;
        }
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| format!("write {path:?}: {e}"))
    }

    /// Insert or replace by name (case-sensitive, exact match).
    fn upsert(&mut self, profile: Profile) {
        if let Some(slot) = self.items.iter_mut().find(|p| p.name == profile.name) {
            *slot = profile;
        } else {
            self.items.push(profile);
        }
    }
}

#[tauri::command]
pub fn list_profiles(app: AppHandle) -> Result<Vec<Profile>, String> {
    Ok(Profiles::load(&app).items)
}

#[tauri::command]
pub fn save_profile(app: AppHandle, profile: Profile) -> Result<Vec<Profile>, String> {
    if profile.name.trim().is_empty() {
        return Err("profile name cannot be empty".into());
    }
    let mut profiles = Profiles::load(&app);
    profiles.upsert(profile);
    profiles.save(&app)?;
    Ok(profiles.items)
}

#[tauri::command]
pub fn rename_profile(
    app: AppHandle,
    old_name: String,
    new_name: String,
) -> Result<Vec<Profile>, String> {
    if new_name.trim().is_empty() {
        return Err("profile name cannot be empty".into());
    }
    let mut profiles = Profiles::load(&app);
    let Some(slot) = profiles.items.iter_mut().find(|p| p.name == old_name) else {
        return Err(format!("profile {old_name:?} not found"));
    };
    slot.name = new_name;
    profiles.save(&app)?;
    Ok(profiles.items)
}

#[tauri::command]
pub fn delete_profile(app: AppHandle, name: String) -> Result<Vec<Profile>, String> {
    let mut profiles = Profiles::load(&app);
    profiles.items.retain(|p| p.name != name);
    profiles.save(&app)?;
    Ok(profiles.items)
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
    pub history: Vec<HistoryEntry>,
    pub future: Vec<HistoryEntry>,
    pub dirty: bool,
    /// Loaded sprite atlas, set by `set_assets_dir`. Optional because
    /// the editor is useful for attribute work even without sprites.
    pub atlas: Option<std::sync::Arc<Atlas>>,
    pub assets_dir: Option<PathBuf>,
    /// Memoized OTB↔appearance cross-reference. `None` means "rebuild
    /// on next `list_appearances`". Only structural changes (open,
    /// close, create, import, undo/redo) invalidate it — field edits
    /// touch flags/name only and can't change the id↔client_id graph
    /// `CrossRef` is built from, so the hot edit path never pays the
    /// O(objects+items) rebuild.
    pub crossref: Option<CrossRef>,
}

impl WorkspaceState {
    fn invalidate_crossref(&mut self) {
        self.crossref = None;
    }
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

/// Which single entity a history entry targets. Keeping the grain at
/// one appearance / one OTB item is the whole point: a snapshot is a
/// few KB instead of a full-catalog `Workspace` clone (tens of MB on a
/// real 15.x bundle, ×64 history slots).
#[derive(Clone)]
pub(crate) enum Entity {
    Appearance { scope: AppearanceScope, id: u32 },
    OtbItem { server_id: u16 },
}

/// The prior state of one entity. `before == None` means "this entity
/// should not exist" — that's how `create_*` becomes undoable without
/// special-casing: undoing an add restores the entity to *absent*.
#[derive(Clone)]
pub(crate) enum Snapshot {
    Appearance(Box<AppearanceInfo>),
    OtbItem(Box<atlas_otb::OtbItem>),
}

#[derive(Clone)]
pub(crate) struct HistoryEntry {
    entity: Entity,
    before: Option<Snapshot>,
}

/// Read the current state of `entity` (clone), or `None` when it
/// doesn't exist yet.
fn capture_entity(ws: &Workspace, entity: &Entity) -> Option<Snapshot> {
    match entity {
        Entity::Appearance { scope, id } => {
            let app = ws.appearances.as_ref()?;
            let list = appearance_list(app, *scope);
            list.iter()
                .find(|a| a.id.0 == *id)
                .map(|a| Snapshot::Appearance(Box::new(a.clone())))
        }
        Entity::OtbItem { server_id } => {
            let otb = ws.otb.as_ref()?;
            otb.items
                .iter()
                .find(|i| i.server_id == Some(*server_id))
                .map(|i| Snapshot::OtbItem(Box::new(i.clone())))
        }
    }
}

/// Force `entity` to `target` (replace if present, insert if absent,
/// remove when `target == None`).
fn restore_entity(ws: &mut Workspace, entity: &Entity, target: Option<Snapshot>) {
    match entity {
        Entity::Appearance { scope, id } => {
            let Some(app) = ws.appearances.as_mut() else {
                return;
            };
            let list = appearance_list_mut(app, *scope);
            match target {
                Some(Snapshot::Appearance(a)) => {
                    if let Some(slot) = list.iter_mut().find(|x| x.id.0 == *id) {
                        *slot = *a;
                    } else {
                        list.push(*a);
                    }
                }
                _ => list.retain(|x| x.id.0 != *id),
            }
        }
        Entity::OtbItem { server_id } => {
            let Some(otb) = ws.otb.as_mut() else {
                return;
            };
            match target {
                Some(Snapshot::OtbItem(i)) => {
                    if let Some(slot) = otb
                        .items
                        .iter_mut()
                        .find(|x| x.server_id == Some(*server_id))
                    {
                        *slot = *i;
                    } else {
                        otb.items.push(*i);
                    }
                }
                _ => otb.items.retain(|x| x.server_id != Some(*server_id)),
            }
        }
    }
}

fn appearance_list(app: &Appearances, scope: AppearanceScope) -> &[AppearanceInfo] {
    match scope {
        AppearanceScope::Object => &app.objects,
        AppearanceScope::Outfit => &app.outfits,
        AppearanceScope::Effect => &app.effects,
        AppearanceScope::Missile => &app.missiles,
    }
}

fn appearance_list_mut(app: &mut Appearances, scope: AppearanceScope) -> &mut Vec<AppearanceInfo> {
    match scope {
        AppearanceScope::Object => &mut app.objects,
        AppearanceScope::Outfit => &mut app.outfits,
        AppearanceScope::Effect => &mut app.effects,
        AppearanceScope::Missile => &mut app.missiles,
    }
}

/// Record the pre-edit state of `entity` for undo. Call **before**
/// mutating. Returns the entry to push once the edit succeeds (so a
/// failed validation doesn't pollute the stack).
fn snapshot_entity(ws: &Workspace, entity: Entity) -> HistoryEntry {
    let before = capture_entity(ws, &entity);
    HistoryEntry { entity, before }
}

/// Apply a history entry (undo or redo direction) and return the
/// inverse entry to push onto the opposite stack — same swap-and-return
/// shape the old full-`Workspace` mem::replace had, just per-entity.
fn apply_history(ws: &mut Workspace, entry: HistoryEntry) -> HistoryEntry {
    let inverse_before = capture_entity(ws, &entry.entity);
    restore_entity(ws, &entry.entity, entry.before);
    HistoryEntry {
        entity: entry.entity,
        before: inverse_before,
    }
}

/// Append `entry` to `history`, drop the oldest entries past the
/// limit. Kept as a free function so both edit commands can call it
/// without re-borrowing the same WorkspaceState mutably twice.
fn push_history(history: &mut Vec<HistoryEntry>, entry: HistoryEntry) {
    history.push(entry);
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
    guard.invalidate_crossref();
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
    guard.invalidate_crossref();
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
    let entry = snapshot_entity(&guard.workspace, Entity::Appearance { scope, id });
    let appearances = guard
        .workspace
        .appearances
        .as_mut()
        .ok_or("appearances.dat is not loaded")?;
    edits::update_appearance_field(appearances, scope, id, &field, value)?;
    // Only push the snapshot now that the edit succeeded — failed
    // validation should not pollute undo history.
    push_history(&mut guard.history, entry);
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
    let entry = snapshot_entity(&guard.workspace, Entity::OtbItem { server_id });
    let otb = guard
        .workspace
        .otb
        .as_mut()
        .ok_or("items.otb is not loaded")?;
    edits::update_otb_item_field(otb, server_id, &field, value)?;
    push_history(&mut guard.history, entry);
    guard.future.clear();
    guard.dirty = true;
    Ok(guard.summary())
}

#[tauri::command]
pub fn undo(state: State<'_, SharedWorkspace>) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let entry = guard.history.pop().ok_or("nothing to undo")?;
    let inverse = apply_history(&mut guard.workspace, entry);
    guard.future.push(inverse);
    // An undone create adds/removes an id, which can change the
    // cross-ref; cheaper to drop the memo than to prove invariance.
    guard.invalidate_crossref();
    guard.dirty = true;
    Ok(guard.summary())
}

#[tauri::command]
pub fn redo(state: State<'_, SharedWorkspace>) -> Result<WorkspaceSummary, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let entry = guard.future.pop().ok_or("nothing to redo")?;
    let inverse = apply_history(&mut guard.workspace, entry);
    guard.history.push(inverse);
    guard.invalidate_crossref();
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

/// Append a brand-new appearance with the next free id in the given
/// category and return its id. Auto-snapshots for undo. Frontend
/// should select the new id to drop the user into the attribute editor.
#[tauri::command]
pub fn create_appearance(
    scope: AppearanceScope,
    state: State<'_, SharedWorkspace>,
) -> Result<NewItemInfo, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let next_id = {
        let appearances = guard
            .workspace
            .appearances
            .as_ref()
            .ok_or("appearances.dat is not loaded")?;
        appearance_list(appearances, scope)
            .iter()
            .map(|a| a.id.0)
            .max()
            .unwrap_or(0)
            .saturating_add(1)
    };
    if next_id == u32::MAX {
        return Err("appearance id space exhausted".into());
    }
    let entry = snapshot_entity(
        &guard.workspace,
        Entity::Appearance {
            scope,
            id: next_id,
        },
    );
    let category = match scope {
        AppearanceScope::Object => atlas_core::AppearanceCategory::Object,
        AppearanceScope::Outfit => atlas_core::AppearanceCategory::Outfit,
        AppearanceScope::Effect => atlas_core::AppearanceCategory::Effect,
        AppearanceScope::Missile => atlas_core::AppearanceCategory::Missile,
    };
    let appearances = guard
        .workspace
        .appearances
        .as_mut()
        .ok_or("appearances.dat is not loaded")?;
    appearance_list_mut(appearances, scope).push(atlas_appearances::AppearanceInfo {
        id: atlas_appearances::AssetId(next_id),
        category,
        ..Default::default()
    });
    push_history(&mut guard.history, entry);
    guard.future.clear();
    guard.invalidate_crossref();
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
    let next_server_id = {
        let otb = guard
            .workspace
            .otb
            .as_ref()
            .ok_or("items.otb is not loaded")?;
        otb.items
            .iter()
            .filter_map(|i| i.server_id)
            .max()
            .unwrap_or(99)
            .saturating_add(1)
    };
    if next_server_id == u16::MAX {
        return Err("OTB server_id space exhausted".into());
    }
    let entry = snapshot_entity(
        &guard.workspace,
        Entity::OtbItem {
            server_id: next_server_id,
        },
    );
    let otb = guard
        .workspace
        .otb
        .as_mut()
        .ok_or("items.otb is not loaded")?;
    otb.items.push(atlas_otb::OtbItem {
        group: atlas_otb::ItemGroup::None,
        server_id: Some(next_server_id),
        client_id: Some(client_id),
        ..Default::default()
    });
    push_history(&mut guard.history, entry);
    guard.future.clear();
    guard.invalidate_crossref();
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
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.workspace.appearances.is_none() {
        return Ok(Vec::new());
    }
    // Build the cross-ref once and memoize it. Only the Object list
    // consumes it, and only structural changes invalidate the cache,
    // so repeated list calls (every refresh) reuse the same build
    // instead of re-allocating O(objects+items) Vecs each time.
    if matches!(category, Category::Object) && guard.crossref.is_none() {
        guard.crossref = guard.workspace.cross_ref();
    }

    let appearances = guard
        .workspace
        .appearances
        .as_ref()
        .expect("checked is_some above");
    let entries: &[AppearanceInfo] = match category {
        Category::Object => &appearances.objects,
        Category::Outfit => &appearances.outfits,
        Category::Effect => &appearances.effects,
        Category::Missile => &appearances.missiles,
    };

    let cross_ref: Option<&CrossRef> = match category {
        Category::Object => guard.crossref.as_ref(),
        _ => None,
    };

    let rows = entries
        .iter()
        .enumerate()
        .map(|(idx, app)| {
            let (otb_server_id, is_appearance_orphan, has_otb_collision) = match cross_ref {
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
            let (display_sprite_ids, display_durations_ms) = build_display_cycle(app);
            AppearanceRow {
                id: app.id.0,
                name: app.name.clone(),
                sprite_count: app.sprite_ids.len(),
                display_sprite_ids,
                display_durations_ms,
                flags_mask: appearance_flags_mask(app),
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

/// Project every loaded OTB item onto the lightweight row shape used
/// by the OTB-only list view. Items with `server_id == None` are
/// filtered out — they can't be addressed by the editor.
#[tauri::command]
pub fn list_otb_items(state: State<'_, SharedWorkspace>) -> Result<Vec<OtbItemRow>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(otb) = guard.workspace.otb.as_ref() else {
        return Ok(Vec::new());
    };

    // Build a set of appearance object ids once so the per-row
    // `has_appearance_match` check is O(1) instead of O(N).
    let appearance_ids: std::collections::HashSet<u32> = guard
        .workspace
        .appearances
        .as_ref()
        .map(|a| a.objects.iter().map(|o| o.id.0).collect())
        .unwrap_or_default();

    let rows = otb
        .items
        .iter()
        .filter_map(|item| {
            let server_id = item.server_id?;
            let has_appearance_match = item
                .client_id
                .filter(|cid| *cid != 0)
                .map(|cid| appearance_ids.contains(&(cid as u32)))
                .unwrap_or(false);
            Some(OtbItemRow {
                server_id,
                client_id: item.client_id,
                name: item.name.clone(),
                group: format!("{:?}", item.group),
                has_appearance_match,
            })
        })
        .collect();

    Ok(rows)
}

/// Per-sheet sprite range surfaced to the Sprite browser. The grid in
/// the frontend reconstructs the full id list by walking these ranges
/// in order (catalog entries are sorted by `firstspriteid` at load
/// time).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteRangeDto {
    pub firstspriteid: u32,
    pub lastspriteid: u32,
    pub spritetype: u32,
    pub width: u32,
    pub height: u32,
    pub sheet_file: String,
}

/// Diagnostic: read the raw `catalog-content.json` next to the current
/// assets dir and return:
/// - the first ~5 distinct `type` values present in the file
/// - the first entry of each type (so we can see the field shape)
/// - the total entry count
/// Used to debug parser mismatches when a client ships a catalog
/// schema we don't recognise (e.g. `"type": "appearance"` singular
/// instead of `"appearances"`).
#[tauri::command]
pub fn inspect_catalog(state: State<'_, SharedWorkspace>) -> Result<serde_json::Value, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let dir = guard
        .assets_dir
        .as_ref()
        .ok_or("assets dir not set")?
        .clone();
    drop(guard); // release the lock while we hit the disk
    let path = dir.join("catalog-content.json");
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path:?}: {e}"))?;
    let entries: Vec<serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse: {e}"))?;
    let total = entries.len();
    let mut by_type: std::collections::BTreeMap<String, serde_json::Value> =
        std::collections::BTreeMap::new();
    for entry in &entries {
        if let Some(t) = entry.get("type").and_then(|v| v.as_str()) {
            by_type
                .entry(t.to_string())
                .or_insert_with(|| entry.clone());
        } else {
            by_type
                .entry("(missing type)".into())
                .or_insert_with(|| entry.clone());
        }
        if by_type.len() >= 10 {
            break;
        }
    }
    Ok(serde_json::json!({
        "totalEntries": total,
        "firstByType": by_type,
    }))
}

/// Encode a single sprite sheet (by file name from `catalog-content.json`)
/// as a base64-encoded PNG data URL for the in-app sheet viewer. Cached
/// by file name so repeat opens are cheap.
#[tauri::command]
pub fn get_sheet_png_url(
    sheet_file: String,
    state: State<'_, SharedWorkspace>,
) -> Result<String, String> {
    let atlas = checkout_atlas(&state)?
        .ok_or("assets dir is not set — open assets first")?;
    let sheet = atlas.sheet_image(&sheet_file).map_err(|e| e.to_string())?;
    let png = atlas_sprites::encode_png_rgba(&sheet).map_err(|e| e.to_string())?;
    Ok(atlas_sprites::png_to_data_url(&png))
}

/// Write a full sprite sheet to disk as a PNG, decoded from its
/// in-memory `RgbaImage` representation. Caller picks the destination
/// path; we just write whatever they gave us.
#[tauri::command]
pub fn export_sheet_png_file(
    sheet_file: String,
    output_path: String,
    state: State<'_, SharedWorkspace>,
) -> Result<String, String> {
    let atlas = checkout_atlas(&state)?
        .ok_or("assets dir is not set — open assets first")?;
    let sheet = atlas.sheet_image(&sheet_file).map_err(|e| e.to_string())?;
    let png = atlas_sprites::encode_png_rgba(&sheet).map_err(|e| e.to_string())?;
    let path = std::path::PathBuf::from(&output_path);
    std::fs::write(&path, &png).map_err(|e| format!("write {path:?}: {e}"))?;
    Ok(output_path)
}

/// Write a single sprite to disk as a PNG. The cropped tile lives
/// inside the sheet it belongs to; `Atlas::sprite` already handles the
/// addressing.
#[tauri::command]
pub fn export_sprite_png_file(
    sprite_id: u32,
    output_path: String,
    state: State<'_, SharedWorkspace>,
) -> Result<String, String> {
    let atlas = checkout_atlas(&state)?
        .ok_or("assets dir is not set — open assets first")?;
    let img = atlas.sprite(sprite_id).map_err(|e| e.to_string())?;
    let png = atlas_sprites::encode_png_rgba(&img).map_err(|e| e.to_string())?;
    let path = std::path::PathBuf::from(&output_path);
    std::fs::write(&path, &png).map_err(|e| format!("write {path:?}: {e}"))?;
    Ok(output_path)
}

/// Replace the pixels of `sprite_id` with the contents of an image
/// file the user picked (PNG/BMP). The edit lands in the in-memory
/// sheet and stays dirty until `save_sprite_sheets` flushes it.
/// Bumps nothing on its own — the caller should bump `spriteCacheBust`
/// frontend-side so thumbnails refetch.
#[tauri::command]
pub fn replace_sprite_from_png(
    sprite_id: u32,
    image_path: String,
    state: State<'_, SharedWorkspace>,
) -> Result<(), String> {
    let atlas = checkout_atlas(&state)?
        .ok_or("assets dir is not set — open assets first")?;
    let bytes = std::fs::read(&image_path)
        .map_err(|e| format!("read {image_path}: {e}"))?;
    let img = atlas_sprites::decode_rgba(&bytes).map_err(|e| e.to_string())?;
    atlas.replace_sprite(sprite_id, &img).map_err(|e| e.to_string())
}

/// Flush every dirty sheet back to disk (preserving each sheet's
/// original Cipsoft prefix). Returns the file names written.
#[tauri::command]
pub fn save_sprite_sheets(
    state: State<'_, SharedWorkspace>,
) -> Result<Vec<String>, String> {
    let atlas = checkout_atlas(&state)?
        .ok_or("assets dir is not set — open assets first")?;
    atlas.save_dirty_sheets().map_err(|e| e.to_string())
}

/// `true` when at least one sheet has unsaved pixel edits, so the UI
/// can show an indicator next to the Save button.
#[tauri::command]
pub fn has_unsaved_sheets(state: State<'_, SharedWorkspace>) -> Result<bool, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard
        .atlas
        .as_ref()
        .map(|a| a.has_unsaved_sheets())
        .unwrap_or(false))
}

/// Create a new blank sheet for `spritetype`, append it to
/// `catalog-content.json`, and reload the atlas so the new sprite-id
/// range resolves. Returns the new sheet's `firstspriteid` so the UI
/// can jump to it.
#[tauri::command]
pub fn create_sprite_sheet(
    spritetype: u32,
    state: State<'_, SharedWorkspace>,
) -> Result<u32, String> {
    let (atlas, assets_dir) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        let atlas = guard
            .atlas
            .clone()
            .ok_or("assets dir is not set — open assets first")?;
        let dir = guard
            .assets_dir
            .clone()
            .ok_or("assets dir is not set — open assets first")?;
        (atlas, dir)
    };

    let entry = atlas.create_sheet(spritetype).map_err(|e| e.to_string())?;
    // `create_sheet` already registered the sheet in the atlas overlay
    // (resolvable + browsable immediately); just persist it to the
    // on-disk catalog. No reload → the decoded-sheet cache survives.
    append_sheet_to_catalog(&assets_dir, &entry)?;
    Ok(entry.firstspriteid)
}

/// Append one `sprite` entry to `catalog-content.json` (flat JSON array
/// of heterogeneous entries — we only add, never reorder) using an
/// atomic tmp+rename so a crash can't leave a half-written catalog.
fn append_sheet_to_catalog(
    assets_dir: &std::path::Path,
    entry: &atlas_sprites::SpriteSheetEntry,
) -> Result<(), String> {
    let catalog_path = assets_dir.join("catalog-content.json");
    let bytes = std::fs::read(&catalog_path)
        .map_err(|e| format!("read {catalog_path:?}: {e}"))?;
    let mut entries: Vec<serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse catalog: {e}"))?;
    entries.push(serde_json::json!({
        "type": "sprite",
        "file": entry.file,
        "spritetype": entry.spritetype,
        "firstspriteid": entry.firstspriteid,
        "lastspriteid": entry.lastspriteid,
        "area": entry.area,
    }));
    let serialized = serde_json::to_vec_pretty(&entries)
        .map_err(|e| format!("serialize catalog: {e}"))?;
    let tmp = catalog_path.with_extension("json.tmp");
    std::fs::write(&tmp, &serialized).map_err(|e| format!("write {tmp:?}: {e}"))?;
    std::fs::rename(&tmp, &catalog_path).map_err(|e| format!("rename catalog: {e}"))?;
    Ok(())
}


/// Map an OBD tile composition (`tile_w` × `tile_h`, in 32px units) to
/// the catalog `spritetype` whose tile size matches. Tibia only ships
/// the four 32/64 combinations.
fn spritetype_for_tiles(tile_w: u32, tile_h: u32) -> Result<u32, String> {
    match (tile_w, tile_h) {
        (1, 1) => Ok(0),
        (1, 2) => Ok(1),
        (2, 1) => Ok(2),
        (2, 2) => Ok(3),
        _ => Err(format!(
            "OBD tile composition {tile_w}×{tile_h} has no matching sheet type \
             (only 1×1, 1×2, 2×1, 2×2 are supported)"
        )),
    }
}

/// Parse a `.obd` without committing anything. Returns the category and
/// per-frame-group metadata plus base64 PNG previews of every composed
/// sprite so the import dialog can show what's inside.
#[tauri::command]
pub fn preview_obd(path: String) -> Result<serde_json::Value, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    let import = super::obd::parse_obd(&bytes)?;
    let groups: Vec<serde_json::Value> = import
        .frame_groups
        .iter()
        .map(|fg| {
            let sprites: Vec<String> = fg
                .sprites
                .iter()
                .map(|img| {
                    atlas_sprites::encode_png_rgba(img)
                        .map(|png| atlas_sprites::png_to_data_url(&png))
                        .unwrap_or_default()
                })
                .collect();
            serde_json::json!({
                "fixedFrameGroup": fg.fixed_frame_group.map(|f| format!("{f:?}")),
                "patternWidth": fg.pattern_width,
                "patternHeight": fg.pattern_height,
                "patternDepth": fg.pattern_depth,
                "layers": fg.layers,
                "frames": fg.frames,
                "tileW": fg.tile_w,
                "tileH": fg.tile_h,
                "sprites": sprites,
            })
        })
        .collect();
    Ok(serde_json::json!({
        "category": format!("{:?}", import.category).to_lowercase(),
        "frameGroups": groups,
    }))
}

/// Import a `.obd`: allocate a sheet for its sprites, write them, append
/// a new appearance to the proto, and persist everything. Returns the
/// new appearance id so the UI can select it.
#[tauri::command]
pub fn import_obd(path: String, state: State<'_, SharedWorkspace>) -> Result<u32, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    let import = super::obd::parse_obd(&bytes)?;

    // Every frame group of one appearance shares the same tile size.
    let (tile_w, tile_h) = import
        .frame_groups
        .first()
        .map(|f| (f.tile_w, f.tile_h))
        .ok_or("OBD has no frame groups")?;
    if import
        .frame_groups
        .iter()
        .any(|f| f.tile_w != tile_w || f.tile_h != tile_h)
    {
        return Err("OBD frame groups disagree on tile size".into());
    }
    let spritetype = spritetype_for_tiles(tile_w, tile_h)?;
    let total_sprites: usize = import.frame_groups.iter().map(|f| f.sprites.len()).sum();
    if total_sprites == 0 {
        return Err("OBD has no sprites".into());
    }

    let (atlas, assets_dir) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (
            guard
                .atlas
                .clone()
                .ok_or("assets dir is not set — open assets first")?,
            guard
                .assets_dir
                .clone()
                .ok_or("assets dir is not set — open assets first")?,
        )
    };

    let entry = atlas.create_sheet(spritetype).map_err(|e| e.to_string())?;
    let capacity = (entry.lastspriteid.saturating_sub(entry.firstspriteid) + 1) as usize;
    if total_sprites > capacity {
        return Err(format!(
            "OBD needs {total_sprites} sprites but a single {tile_w}×{tile_h} sheet \
             only holds {capacity} (multi-sheet import not supported yet)"
        ));
    }
    append_sheet_to_catalog(&assets_dir, &entry)?;

    // The new sheet is already registered in the atlas overlay, so
    // `replace_sprite` resolves the fresh ids on the *same* atlas —
    // no reload, the decoded-sheet cache stays warm.
    let mut sprite_ids_per_group: Vec<Vec<u32>> = Vec::new();
    let mut next_id = entry.firstspriteid;
    for fg in &import.frame_groups {
        let mut ids = Vec::with_capacity(fg.sprites.len());
        for img in &fg.sprites {
            atlas
                .replace_sprite(next_id, img)
                .map_err(|e| e.to_string())?;
            ids.push(next_id);
            next_id += 1;
        }
        sprite_ids_per_group.push(ids);
    }
    atlas.save_dirty_sheets().map_err(|e| e.to_string())?;

    // Append the appearance to the proto and persist appearances.dat.
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let appearances = guard
        .workspace
        .appearances
        .as_mut()
        .ok_or("appearances.dat is not loaded")?;
    let list = match import.category {
        AppearanceCategory::Object => &mut appearances.objects,
        AppearanceCategory::Outfit => &mut appearances.outfits,
        AppearanceCategory::Effect => &mut appearances.effects,
        AppearanceCategory::Missile => &mut appearances.missiles,
    };
    let new_id = list
        .iter()
        .map(|a| a.id.0)
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    let appearance = super::obd::build_appearance(&import, new_id, &sprite_ids_per_group);
    list.push(appearance);

    // An import writes sheets + catalog + appearances.dat to disk, so
    // it isn't a reversible in-memory delta — clearing the undo stack
    // (same as opening a file) keeps memory and disk in agreement.
    guard.history.clear();
    guard.future.clear();
    guard.invalidate_crossref();
    guard.dirty = true;

    // Persist appearances.dat right away so the import survives a crash.
    if let Some(path) = guard.appearances_path.clone() {
        if let Some(app) = guard.workspace.appearances.as_ref() {
            write_with_backup(&path, |dst| app.save_to_file(dst).map_err(|e| e.to_string()))?;
            guard.dirty = false;
        }
    }
    Ok(new_id)
}

/// Render the selected appearance to disk in the chosen format. For
/// `outfit_pngs` the path is treated as a directory and every cell of
/// every frame group is written as its own PNG; the other formats
/// write a single animated GIF.
#[tauri::command]
pub fn export_appearance(
    scope: AppearanceScope,
    id: u32,
    format: super::export::ExportFormat,
    output_path: String,
    state: State<'_, SharedWorkspace>,
) -> Result<super::export::ExportReport, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let atlas = guard
        .atlas
        .clone()
        .ok_or("assets dir is not set — open assets first")?;
    let appearances = guard
        .workspace
        .appearances
        .as_ref()
        .ok_or("appearances.dat is not loaded")?;
    let list: &[AppearanceInfo] = match scope {
        AppearanceScope::Object => &appearances.objects,
        AppearanceScope::Outfit => &appearances.outfits,
        AppearanceScope::Effect => &appearances.effects,
        AppearanceScope::Missile => &appearances.missiles,
    };
    let app = list
        .iter()
        .find(|a| a.id.0 == id)
        .ok_or_else(|| format!("appearance id {id} not found in {scope:?}"))?
        .clone();
    drop(guard);
    super::export::export_appearance(&atlas, &app, format, std::path::Path::new(&output_path))
}

/// Export all sprites of an appearance as individual PNGs into a
/// directory. Each file is named `{sprite_id}.png`.
#[tauri::command]
pub fn export_appearance_sprites(
    scope: AppearanceScope,
    id: u32,
    output_path: String,
    state: State<'_, SharedWorkspace>,
) -> Result<super::export::ExportReport, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let atlas = guard
        .atlas
        .clone()
        .ok_or("assets dir is not set — open assets first")?;
    let appearances = guard
        .workspace
        .appearances
        .as_ref()
        .ok_or("appearances.dat is not loaded")?;
    let list: &[AppearanceInfo] = match scope {
        AppearanceScope::Object => &appearances.objects,
        AppearanceScope::Outfit => &appearances.outfits,
        AppearanceScope::Effect => &appearances.effects,
        AppearanceScope::Missile => &appearances.missiles,
    };
    let app = list
        .iter()
        .find(|a| a.id.0 == id)
        .ok_or_else(|| format!("appearance id {id} not found in {scope:?}"))?
        .clone();
    drop(guard);
    super::export::export_all_sprites(&atlas, &app, std::path::Path::new(&output_path))
}

#[tauri::command]
pub fn list_sprite_ranges(
    state: State<'_, SharedWorkspace>,
) -> Result<Vec<SpriteRangeDto>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(atlas) = guard.atlas.as_ref() else {
        return Ok(Vec::new());
    };
    let rows = atlas
        .all_sheets()
        .into_iter()
        .filter_map(|s| {
            // Unknown sprite types are skipped — the renderer wouldn't
            // know how to crop tiles out of them anyway.
            let dims = SpriteDims::from_spritetype(s.spritetype).ok()?;
            Some(SpriteRangeDto {
                firstspriteid: s.firstspriteid,
                lastspriteid: s.lastspriteid,
                spritetype: s.spritetype,
                width: dims.width,
                height: dims.height,
                sheet_file: s.file,
            })
        })
        .collect();
    Ok(rows)
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
    let sheets = atlas.all_sheets();
    let info = AssetsDirInfo {
        path: path.clone(),
        sheet_count: sheets.len(),
        sprite_id_range: sheets
            .first()
            .map(|s| s.firstspriteid)
            .zip(sheets.last().map(|s| s.lastspriteid)),
    };
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.atlas = Some(std::sync::Arc::new(atlas));
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
        .map(|name| safe_join(&assets_path, name).map_err(|e| e.to_string()))
        .transpose()?;
    let appearances = match appearances_path.as_ref() {
        Some(p) => Some(Appearances::load_from_file(p).map_err(|e| e.to_string())?),
        None => None,
    };

    let sheets = atlas.all_sheets();
    let sheet_count = sheets.len();
    let sprite_id_range = sheets
        .first()
        .map(|s| s.firstspriteid)
        .zip(sheets.last().map(|s| s.lastspriteid));

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.atlas = Some(std::sync::Arc::new(atlas));
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
        guard.invalidate_crossref();
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
    let sheets = atlas.all_sheets();
    Ok(Some(AssetsDirInfo {
        path: guard
            .assets_dir
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        sheet_count: sheets.len(),
        sprite_id_range: sheets
            .first()
            .map(|s| s.firstspriteid)
            .zip(sheets.last().map(|s| s.lastspriteid)),
    }))
}

/// Helper: take a cloned `Arc<Atlas>` out of the workspace mutex
/// and drop the lock before doing any work. This is what unblocks
/// the IPC firehose during a fast scroll of the Sprites grid —
/// without it, every `get_sprite_png` would serialize through the
/// workspace-level mutex even though the actual sprite decode +
/// encode happens entirely inside the lock-free `Atlas`.
fn checkout_atlas(
    state: &State<'_, SharedWorkspace>,
) -> Result<Option<std::sync::Arc<Atlas>>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.atlas.clone())
}

/// Diagnostic dump of the sheet covering `sprite_id`. Returns the
/// sheet's catalog metadata plus the first bytes of the raw + decoded
/// streams so we can debug pixel-format mismatches without rebuilding.
#[tauri::command]
pub fn inspect_sprite(
    sprite_id: u32,
    state: State<'_, SharedWorkspace>,
) -> Result<SheetInspection, String> {
    let atlas = checkout_atlas(&state)?.ok_or("assets dir is not set — open assets first")?;
    atlas.inspect(sprite_id).map_err(|e| e.to_string())
}

/// Change the on-disk channel order the sprite atlas uses to decode
/// sheets. Returns the new format so the UI can reflect it. Clears
/// the sheet cache so the next `get_sprite_png` redecodes with the
/// fresh permutation. Takes `&self` on Atlas (interior mutability)
/// so it can share the same `Arc` as concurrent sprite reads.
#[tauri::command]
pub fn set_sprite_pixel_format(
    format: PixelFormat,
    state: State<'_, SharedWorkspace>,
) -> Result<PixelFormat, String> {
    let atlas = checkout_atlas(&state)?.ok_or("assets dir is not set — open assets first")?;
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

/// Return the requested sprite as raw PNG bytes over a **binary** IPC
/// channel (`tauri::ipc::Response`) — no base64 inflation, no JSON
/// re-encode. The frontend wraps the `ArrayBuffer` in a `Blob` +
/// object URL. An empty body means "assets dir not set" (the frontend
/// treats it as a soft miss); a hard error means the sprite id is
/// unknown or the sheet failed to decode.
///
/// The Atlas keeps a raw-PNG cache keyed by sprite_id, so the second
/// (and every subsequent) request for the same id is a DashMap
/// lookup — that's what keeps the Sprites grid responsive while
/// the user scrolls.
#[tauri::command]
pub fn get_sprite_png(
    sprite_id: u32,
    state: State<'_, SharedWorkspace>,
) -> Result<tauri::ipc::Response, String> {
    // The mutex is held just long enough to clone the Arc; everything
    // after — sheet load, crop, PNG encode — runs lock-free, sharing
    // the Atlas's internal `DashMap` caches with whatever other sprite
    // calls are in flight. Fast scroll through 100k tiles used to
    // freeze the app because each call had to wait on this mutex.
    let Some(atlas) = checkout_atlas(&state)? else {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    };
    let bytes = atlas
        .sprite_png_bytes(sprite_id)
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new((*bytes).clone()))
}

// ── Duplicate detection ────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub sprite_key: String,
    pub ids: Vec<u32>,
    pub category: String,
    pub display_sprite_ids: Vec<u32>,
}

#[tauri::command]
pub fn find_duplicates(
    scope: AppearanceScope,
    state: State<'_, SharedWorkspace>,
) -> Result<Vec<DuplicateGroup>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let appearances = guard
        .workspace
        .appearances
        .as_ref()
        .ok_or("appearances.dat is not loaded")?;
    let list = appearance_list(appearances, scope);

    let mut groups: std::collections::HashMap<Vec<u32>, Vec<u32>> =
        std::collections::HashMap::new();
    for entry in list {
        if entry.sprite_ids.is_empty() {
            continue;
        }
        groups
            .entry(entry.sprite_ids.clone())
            .or_default()
            .push(entry.id.0);
    }

    let cat_name = match scope {
        AppearanceScope::Object => "object",
        AppearanceScope::Outfit => "outfit",
        AppearanceScope::Effect => "effect",
        AppearanceScope::Missile => "missile",
    };

    let mut result: Vec<DuplicateGroup> = groups
        .into_iter()
        .filter(|(_, ids)| ids.len() > 1)
        .map(|(sprites, ids)| {
            let display: Vec<u32> = sprites.iter().copied().take(8).collect();
            let key = sprites
                .iter()
                .take(4)
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
                .join(",");
            DuplicateGroup {
                sprite_key: key,
                ids,
                category: cat_name.to_string(),
                display_sprite_ids: display,
            }
        })
        .collect();
    result.sort_by_key(|g| std::cmp::Reverse(g.ids.len()));
    Ok(result)
}

// ── Unmapped items ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmappedReport {
    pub appearance_orphan_ids: Vec<u32>,
    pub otb_orphan_server_ids: Vec<u16>,
    pub collision_ids: Vec<u32>,
}

#[tauri::command]
pub fn get_unmapped_report(
    state: State<'_, SharedWorkspace>,
) -> Result<UnmappedReport, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let appearances = guard
        .workspace
        .appearances
        .as_ref()
        .ok_or("appearances.dat is not loaded")?;
    let otb = guard
        .workspace
        .otb
        .as_ref()
        .ok_or("items.otb is not loaded")?;

    let xref = CrossRef::build(appearances, otb);

    let appearance_orphan_ids: Vec<u32> = xref
        .appearance_orphans()
        .iter()
        .filter_map(|&idx| appearances.objects.get(idx).map(|a| a.id.0))
        .collect();

    let otb_orphan_server_ids: Vec<u16> = xref
        .otb_orphans()
        .iter()
        .filter_map(|&idx| otb.items.get(idx).and_then(|i| i.server_id))
        .collect();

    let collision_ids: Vec<u32> = xref
        .collisions()
        .iter()
        .filter_map(|&idx| appearances.objects.get(idx).map(|a| a.id.0))
        .collect();

    Ok(UnmappedReport {
        appearance_orphan_ids,
        otb_orphan_server_ids,
        collision_ids,
    })
}

// ── Copy appearance to clipboard (JSON) ────────────────────────────

#[tauri::command]
pub fn copy_appearance_json(
    scope: AppearanceScope,
    id: u32,
    state: State<'_, SharedWorkspace>,
) -> Result<String, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let appearances = guard
        .workspace
        .appearances
        .as_ref()
        .ok_or("appearances.dat is not loaded")?;
    let list = appearance_list(appearances, scope);
    let entry = list
        .iter()
        .find(|a| a.id.0 == id)
        .ok_or_else(|| format!("appearance {id} not found"))?;
    serde_json::to_string_pretty(entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn paste_appearance_json(
    scope: AppearanceScope,
    target_id: u32,
    json: String,
    state: State<'_, SharedWorkspace>,
) -> Result<WorkspaceSummary, String> {
    let source: AppearanceInfo =
        serde_json::from_str(&json).map_err(|e| format!("invalid JSON: {e}"))?;

    let mut guard = state.lock().map_err(|e| e.to_string())?;

    let entry = snapshot_entity(
        &guard.workspace,
        Entity::Appearance {
            scope,
            id: target_id,
        },
    );

    let appearances = guard
        .workspace
        .appearances
        .as_mut()
        .ok_or("appearances.dat is not loaded")?;
    let list = appearance_list_mut(appearances, scope);
    let target = list
        .iter_mut()
        .find(|a| a.id.0 == target_id)
        .ok_or_else(|| format!("target appearance {target_id} not found"))?;

    target.name = source.name;
    target.description = source.description;
    target.flags = source.flags;
    target.frame_groups = source.frame_groups;
    target.sprite_ids = source.sprite_ids;

    push_history(&mut guard.history, entry);
    guard.future.clear();
    guard.dirty = true;
    Ok(guard.summary())
}
