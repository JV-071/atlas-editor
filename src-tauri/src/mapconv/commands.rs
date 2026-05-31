//! IPC commands for the Map Converter tool.

use std::path::PathBuf;

use atlas_otb::Otb;
use atlas_otbm::{convert_file, read_file, Direction, IdMap};
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

/// Where the id translation table came from, surfaced to the UI so the
/// user knows whether the conversion is server-specific or the generic
/// community default.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MapSource {
    /// Derived from a user-supplied `items.otb`.
    Otb,
    /// Embedded community mapping table.
    Builtin,
}

/// Build the id map for `direction`, deriving it from `otb_path` when one
/// is given (the precise mapping for that server), otherwise falling back
/// to the embedded community table. Returns the map plus which source it
/// came from.
fn build_id_map(
    direction: ConvertDirection,
    otb_path: Option<&str>,
) -> Result<(IdMap, MapSource), String> {
    match otb_path {
        Some(path) if !path.is_empty() => {
            let otb = Otb::load_from_file(path).map_err(|e| e.to_string())?;
            // Each OTB item carries both ids; pair them in the requested
            // direction. Items missing either id can't contribute a
            // mapping and are skipped.
            let pairs = otb
                .items
                .iter()
                .filter_map(|i| match (i.server_id, i.client_id) {
                    (Some(server), Some(client)) => Some(match direction {
                        ConvertDirection::ServerToClient => (server, client),
                        ConvertDirection::ClientToServer => (client, server),
                    }),
                    _ => None,
                });
            Ok((IdMap::from_pairs(pairs), MapSource::Otb))
        }
        _ => Ok((IdMap::builtin(direction.into()), MapSource::Builtin)),
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
    /// Whether the table is OTB-derived or the built-in community default.
    pub source: MapSource,
}

/// Read an `.otbm` and report its header + how many ids the converter
/// would touch, without writing anything. `otb_path` is optional — when
/// supplied, the translation table is built from that server's items.otb.
#[tauri::command]
pub fn map_peek(
    path: String,
    direction: ConvertDirection,
    otb_path: Option<String>,
) -> Result<MapPeek, String> {
    let (id_map, source) = build_id_map(direction, otb_path.as_deref())?;
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
        table_entries: id_map.len(),
        source,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapConvertResult {
    pub output_path: String,
    pub ids_changed: u32,
    pub ids_scanned: u32,
    pub source: MapSource,
}

/// Convert `input` into `output` in the chosen direction. Paths may match
/// for an in-place convert; the crate writes via a temp file + rename so a
/// crash can't truncate the map. `otb_path` is optional (see [`map_peek`]).
#[tauri::command]
pub fn map_convert(
    input: String,
    output: String,
    direction: ConvertDirection,
    otb_path: Option<String>,
) -> Result<MapConvertResult, String> {
    let (id_map, source) = build_id_map(direction, otb_path.as_deref())?;
    let report = convert_file(&input, &output, &id_map).map_err(|e| e.to_string())?;
    Ok(MapConvertResult {
        output_path: PathBuf::from(&output).display().to_string(),
        ids_changed: report.ids_changed,
        ids_scanned: report.ids_scanned,
        source,
    })
}
