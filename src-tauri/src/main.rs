// Prevent the second console window from showing up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    atlas_assets_editor_lib::run();
}
