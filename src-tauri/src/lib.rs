//! Tauri 2 entry point for Atlas Assets Editor.
//!
//! The backend is intentionally thin: it forwards work to the `atlas-*`
//! crates and exposes them to the frontend through Tauri commands.

mod commands;
mod edits;

use commands::{SharedWorkspace, WorkspaceState};
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
            commands::hydrate_recent_files(&handle, &state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_appearances,
            commands::open_otb,
            commands::close_workspace,
            commands::get_workspace_summary,
            commands::get_recent_files,
            commands::list_appearances,
            commands::get_appearance,
            commands::get_otb_item,
            commands::update_appearance_field,
            commands::update_otb_item_field,
            commands::undo,
            commands::redo,
            commands::save_appearances,
            commands::save_otb,
            commands::set_assets_dir,
            commands::get_assets_dir_info,
            commands::get_sprite_png,
            commands::set_sprite_pixel_format,
            commands::get_sprite_pixel_format,
            commands::inspect_sprite,
            commands::create_object_appearance,
            commands::create_otb_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
