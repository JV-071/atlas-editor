//! Tauri IPC commands exposed to the frontend.
//!
//! Each command should be a thin shim around an `atlas-*` crate function.

/// Placeholder command to verify the IPC bridge works end-to-end.
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello {name}, from Atlas Assets Editor!")
}
