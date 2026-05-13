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
use atlas_workspace::Workspace;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Lightweight summary of what's currently loaded. Returned by every
/// `open_*` / `close_workspace` call so the frontend can refresh its
/// header without a second round-trip.
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
        let Some(path) = Self::config_path(app) else { return };
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
/// disk paths the user picked. Wrapped in `Mutex` so commands can take
/// `&Self` and still mutate.
#[derive(Default)]
pub struct WorkspaceState {
    pub workspace: Workspace,
    pub appearances_path: Option<PathBuf>,
    pub otb_path: Option<PathBuf>,
    pub recent: RecentFiles,
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
        }
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
