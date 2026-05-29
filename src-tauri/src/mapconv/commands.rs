//! IPC commands for the Map Converter tool.

use std::path::PathBuf;

use atlas_otbm::{convert_file, read_file, table_len, Direction};
use serde::{Deserialize, Serialize};

/// Translation direction chosen in the UI. Serialized as
/// `"serverToClient"` / `"clientToServer"`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConvertDirection {
    ServerToClient,
    ClientToServer,
}

impl From<ConvertDirection> for Direction {
    fn from(d: ConvertDirection) -> Self {
        match d {
            ConvertDirection::ServerToClient => Direction::ServerToClient,
            ConvertDirection::ClientToServer => Direction::ClientToServer,
        }
    }
}

/// Header + scan info shown before the user commits to a conversion.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPeek {
    pub path: String,
    pub otbm_version: u32,
    pub width: u16,
    pub height: u16,
    pub items_major: u32,
    pub items_minor: u32,
    /// Item ids the converter would walk (inline items + tile grounds).
    pub ids_scanned: u32,
    /// Size of the active translation table for the chosen direction.
    pub table_entries: usize,
}

/// Read an `.otbm` and report its header + how many ids the converter
/// would touch, without writing anything.
#[tauri::command]
pub fn map_peek(path: String, direction: ConvertDirection) -> Result<MapPeek, String> {
    let map = read_file(&path).map_err(|e| e.to_string())?;
    let header = map.header().unwrap_or_default();
    Ok(MapPeek {
        path,
        otbm_version: header.version,
        width: header.width,
        height: header.height,
        items_major: header.items_major,
        items_minor: header.items_minor,
        ids_scanned: map.count_ids(),
        table_entries: table_len(direction.into()),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapConvertResult {
    pub output_path: String,
    pub ids_changed: u32,
    pub ids_scanned: u32,
}

/// Convert `input` into `output` in the chosen direction. Paths may match
/// for an in-place convert; the crate writes via a temp file + rename so a
/// crash can't truncate the map.
#[tauri::command]
pub fn map_convert(
    input: String,
    output: String,
    direction: ConvertDirection,
) -> Result<MapConvertResult, String> {
    let report = convert_file(&input, &output, direction.into()).map_err(|e| e.to_string())?;
    Ok(MapConvertResult {
        output_path: PathBuf::from(&output).display().to_string(),
        ids_changed: report.ids_changed,
        ids_scanned: report.ids_scanned,
    })
}
