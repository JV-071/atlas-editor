//! Tauri IPC commands for the Converter tool.
//!
//! Today every command returns `Err("not implemented")` — the UI is
//! wired against the final signatures so the logic can land without
//! breaking the frontend.

use serde::{Deserialize, Serialize};

/// User-picked inputs for a legacy-to-modern conversion. Paths are
/// optional so the converter can validate them one by one and surface
/// per-input errors. The frontend stages them through the file picker
/// and only enables "Run conversion" once at least the OTB is set.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConverterInputs {
    pub otb_path: Option<String>,
    pub dat_path: Option<String>,
    pub spr_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConverterPreview {
    pub otb_item_count: usize,
    pub dat_appearance_count: usize,
    pub spr_sprite_count: usize,
    /// Items in OTB whose `client_id` is missing from the legacy `.dat`.
    /// These would have to either map to an existing modern appearance
    /// or be supplied with imported PNGs.
    pub unmapped_otb_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertOptions {
    /// Directory the converter writes the modern bundle into. Must be
    /// empty or non-existent to avoid clobbering an existing client.
    pub output_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    pub output_dir: String,
    pub appearances_written: usize,
    pub sheets_written: usize,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn converter_peek(_inputs: ConverterInputs) -> Result<ConverterPreview, String> {
    Err("converter not implemented yet".into())
}

#[tauri::command]
pub fn converter_run(
    _inputs: ConverterInputs,
    _options: ConvertOptions,
) -> Result<ConvertResult, String> {
    Err("converter not implemented yet".into())
}
