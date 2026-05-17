//! Tauri 2 entry point for Atlas Editor.
//!
//! Atlas Editor is a suite of three tools that share infrastructure:
//!
//! - **Assets Editor** ([`assets`]) — opens modern Tibia client
//!   asset bundles, edits attributes, saves with undo/redo.
//! - **Converter** ([`converter`]) — turns a legacy server bundle
//!   (`items.otb` + Tibia 7.x–10.x `.dat`/`.spr`) into a modern
//!   assets folder. Currently stubbed.
//! - **Map Editor** — not yet implemented; the UI shows a "coming
//!   soon" placeholder.
//!
//! The backend stays intentionally thin: each tool exposes IPC
//! commands that wrap the relevant `atlas-*` crate functions; the UI
//! routes between tools client-side.

mod assets;
mod converter;

use assets::{SharedWorkspace, WorkspaceState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(SharedWorkspace::new(WorkspaceState::default()))
        .setup(|app| {
            // app_config_dir requires the runtime AppHandle, so MRU
            // hydration cannot happen at `manage()` time.
            let handle = app.handle().clone();
            let state = app.state::<SharedWorkspace>();
            assets::hydrate_recent_files(&handle, &state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Assets Editor
            assets::commands::open_appearances,
            assets::commands::open_otb,
            assets::commands::close_workspace,
            assets::commands::get_workspace_summary,
            assets::commands::get_recent_files,
            assets::commands::list_appearances,
            assets::commands::list_otb_items,
            assets::commands::list_sprite_ranges,
            assets::commands::inspect_catalog,
            assets::commands::get_appearance,
            assets::commands::get_otb_item,
            assets::commands::update_appearance_field,
            assets::commands::update_otb_item_field,
            assets::commands::undo,
            assets::commands::redo,
            assets::commands::save_appearances,
            assets::commands::save_otb,
            assets::commands::set_assets_dir,
            assets::commands::open_assets_bundle,
            assets::commands::get_assets_dir_info,
            assets::commands::get_sprite_png,
            assets::commands::set_sprite_pixel_format,
            assets::commands::get_sprite_pixel_format,
            assets::commands::inspect_sprite,
            assets::commands::create_object_appearance,
            assets::commands::create_otb_item,
            assets::commands::export_appearance,
            assets::commands::export_appearance_sprites,
            assets::commands::get_sheet_png_url,
            assets::commands::export_sheet_png_file,
            assets::commands::export_sprite_png_file,
            assets::commands::replace_sprite_from_png,
            assets::commands::save_sprite_sheets,
            assets::commands::has_unsaved_sheets,
            assets::commands::create_sprite_sheet,
            assets::commands::preview_obd,
            assets::commands::import_obd,
            assets::commands::list_profiles,
            assets::commands::save_profile,
            assets::commands::rename_profile,
            assets::commands::delete_profile,
            // Converter
            converter::commands::converter_peek,
            converter::commands::converter_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
