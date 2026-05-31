//! OTBM (OpenTibia binary map) reader/writer and server↔client item-id
//! converter.
//!
//! The headline feature is [`convert_file`]: read an `.otbm`, translate
//! every item id between server and client numbering using the community
//! mapping tables, and write the result out. Parsing is loss-free — see
//! [`otbm`] — so anything we don't explicitly convert survives untouched.

#![forbid(unsafe_code)]

use std::path::Path;

mod error;
mod idmap;
mod otbm;

pub use error::{OtbmError, Result};
pub use idmap::{Direction, IdMap};
pub use otbm::{MapBounds, MapHeader, MapTile, OtbmMap};

/// Summary of a single file conversion, returned to callers (the Tauri
/// command surfaces this to the UI).
#[derive(Debug, Clone, Copy)]
pub struct ConversionReport {
    /// Item ids whose value actually changed.
    pub ids_changed: u32,
    /// Item ids the converter walked (inline item ids + tile ground ids).
    pub ids_scanned: u32,
}

/// Parse an OTBM file from disk.
pub fn read_file(path: impl AsRef<Path>) -> Result<OtbmMap> {
    let path = path.as_ref();
    let bytes = std::fs::read(path).map_err(|source| OtbmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    OtbmMap::parse(&bytes)
}

/// Read `input`, translate every item id through `id_map`, and write the
/// result to `output`. `input` and `output` may be the same path.
pub fn convert_file(
    input: impl AsRef<Path>,
    output: impl AsRef<Path>,
    id_map: &IdMap,
) -> Result<ConversionReport> {
    let mut map = read_file(input)?;
    let ids_scanned = map.count_ids();
    let ids_changed = map.convert_ids(id_map);

    let output = output.as_ref();
    let bytes = map.to_bytes();
    // Write atomically-ish via a sibling temp file so a crash mid-write
    // can't leave a half-written map (especially important when input ==
    // output, an in-place convert).
    let tmp = output.with_extension("otbm.tmp");
    std::fs::write(&tmp, &bytes).map_err(|source| OtbmError::Io {
        path: tmp.clone(),
        source,
    })?;
    std::fs::rename(&tmp, output).map_err(|source| OtbmError::Io {
        path: output.to_path_buf(),
        source,
    })?;

    Ok(ConversionReport {
        ids_changed,
        ids_scanned,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_map_is_reexported() {
        // Smoke test that the public surface is wired up.
        assert_eq!(IdMap::builtin(Direction::ServerToClient).convert(371), 373);
    }
}
