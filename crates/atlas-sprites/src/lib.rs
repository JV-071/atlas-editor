//! Sprite extraction and rendering for Tibia 12+/15.x sprite sheets.
//!
//! Tibia 12+ ships assets as:
//!
//! - `catalog-content.json`: a JSON array describing every file in the
//!   bundle. Sprite sheet entries carry `{ type: "sprite", file, sprite
//!   type, firstspriteid, lastspriteid, area }`.
//! - One LZMA-compressed file per sheet covering a contiguous sprite id
//!   range. Each sheet is a fixed-size bitmap (384×384) packed with
//!   sprites of the sprite-type's dimensions.
//!
//! This crate parses the catalog, finds the sheet that owns a given
//! sprite id, decompresses + decodes it, and crops the sprite tile.
//! A DashMap cache keeps decoded sheets in memory across requests so
//! the UI does not pay LZMA cost per sprite.
//!
//! ## Caveats
//!
//! - The exact sheet header layout has shifted across client versions.
//!   This crate assumes the modern (≥12) Tibia layout:
//!   - Bytes 0..32: Cipsoft custom header (signature/checksum), skipped.
//!   - Bytes 32..: LZMA1 stream. The uncompressed-size field inside the
//!     LZMA header is bogus on Tibia sheets, so we tell `lzma-rs` to
//!     ignore it and read until the end of the stream.
//!   - Decompressed output is raw BGRA pixel data for a 384×384 sheet.
//!   If your client uses BMP-wrapped sheets, set
//!   `Atlas::with_bmp_wrap(true)`.
//! - The crate is **read-only** for now. Writing new sprite sheets is a
//!   Phase 7 concern and will live in a separate module.

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

use dashmap::DashMap;
use image::RgbaImage;
use serde::Deserialize;
use thiserror::Error;

pub use atlas_core::AssetId;

/// On-disk channel order for sprite sheet pixels. The Tibia 12+ format
/// nominally uses BGRA, but the layout has shifted across client builds.
/// Expose this as a runtime knob so the user can pick the right one
/// without rebuilding when colors come out wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PixelFormat {
    /// Bytes on disk are B, G, R, A. Swap to R, G, B, A on read.
    Bgra,
    /// Bytes on disk are R, G, B, A. No swap.
    Rgba,
    /// Bytes on disk are A, R, G, B (Windows/GDI native). Reorder to RGBA.
    Argb,
    /// Bytes on disk are A, B, G, R. Reorder to RGBA.
    Abgr,
}

impl Default for PixelFormat {
    fn default() -> Self {
        // Tibia 12+ documents RGBA8888 — see docs/spr-legacy.md, last
        // section. Earlier hand-coded BGRA was a hold-over from the
        // legacy `.spr` reverse-engineering.
        Self::Rgba
    }
}

impl PixelFormat {
    /// Permute a 4-byte input chunk into a [R, G, B, A] output chunk.
    fn to_rgba(self, c: &[u8]) -> [u8; 4] {
        match self {
            Self::Bgra => [c[2], c[1], c[0], c[3]],
            Self::Rgba => [c[0], c[1], c[2], c[3]],
            Self::Argb => [c[1], c[2], c[3], c[0]],
            Self::Abgr => [c[3], c[2], c[1], c[0]],
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetInspection {
    pub sprite_id: u32,
    pub sheet_file: String,
    pub firstspriteid: u32,
    pub lastspriteid: u32,
    pub spritetype: u32,
    pub area: u32,
    pub raw_len: usize,
    pub decoded_len: usize,
    pub raw_head_hex: String,
    pub decoded_head_hex: String,
    /// Sheet side length auto-detected from `decoded_len`. `None` means
    /// the decompressed bitmap isn't one of the known sizes — likely a
    /// format we don't recognise yet.
    pub detected_sheet_side: Option<u32>,
}

fn bytes_to_hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for &byte in b {
        use std::fmt::Write;
        let _ = write!(s, "{byte:02x}");
    }
    s
}

#[derive(Debug, Error)]
pub enum SpriteError {
    #[error("I/O error reading {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("catalog parse failed: {0}")]
    Catalog(String),

    #[error("sprite id {0} is outside the catalog's covered range")]
    UnknownSprite(u32),

    #[error("LZMA decompression failed for {path}: {source}")]
    Lzma {
        path: PathBuf,
        #[source]
        source: lzma_rs::error::Error,
    },

    #[error("decoded sheet {path} is {actual} bytes; expected at least {expected}")]
    SheetTooSmall {
        path: PathBuf,
        actual: usize,
        expected: usize,
    },

    #[error("unsupported spritetype id {0}")]
    UnsupportedSpriteType(u32),
}

pub type Result<T> = std::result::Result<T, SpriteError>;

/// One entry in `catalog-content.json`. Only the fields we care about
/// are typed; everything else is captured into `extra` so the catalog
/// parser is forward-compatible with new entry kinds added by Cipsoft.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "type")]
pub enum CatalogEntry {
    Sprite(SpriteSheetEntry),
    Appearances(AppearancesEntry),
    Map(MapEntry),
    Staticdata(StaticdataEntry),
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub struct SpriteSheetEntry {
    pub file: String,
    pub spritetype: u32,
    pub firstspriteid: u32,
    pub lastspriteid: u32,
    pub area: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppearancesEntry {
    pub file: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MapEntry {
    pub file: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StaticdataEntry {
    pub file: Option<String>,
}

/// Sprite layout inside a 384×384 sheet. Mirrors the `spritetype` field
/// in catalog-content.json: 0 = 1×1, 1 = 1×2 (tall), 2 = 2×1 (wide),
/// 3 = 2×2 (large).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpriteDims {
    pub width: u32,
    pub height: u32,
}

impl SpriteDims {
    pub fn from_spritetype(spritetype: u32) -> Result<Self> {
        match spritetype {
            0 => Ok(Self {
                width: 32,
                height: 32,
            }),
            1 => Ok(Self {
                width: 32,
                height: 64,
            }),
            2 => Ok(Self {
                width: 64,
                height: 32,
            }),
            3 => Ok(Self {
                width: 64,
                height: 64,
            }),
            other => Err(SpriteError::UnsupportedSpriteType(other)),
        }
    }
}

/// Cipsoft has shipped two sheet sizes across the modern client:
/// 384×384 (Tibia 12.x) and 512×512 (Tibia 14+/15.x). The decoder
/// auto-detects which one a given sheet uses from the decompressed
/// byte count.
const SHEET_SIDES: &[u32] = &[384, 512];
const SHEET_HEADER_LEN: usize = 32;
const BYTES_PER_PIXEL: usize = 4;

/// Pick the sheet side that matches `decoded_len` exactly, or `None`
/// when no candidate fits.
fn detect_sheet_side(decoded_len: usize) -> Option<u32> {
    for &side in SHEET_SIDES {
        let expected = (side as usize) * (side as usize) * BYTES_PER_PIXEL;
        if decoded_len == expected {
            return Some(side);
        }
    }
    None
}

/// In-memory catalog. Cheap to clone — just paths and small structs.
#[derive(Debug, Clone)]
pub struct Catalog {
    /// Directory the sheet files live in. Sheet file names in catalog
    /// entries are resolved relative to this.
    pub assets_dir: PathBuf,
    pub sheets: Vec<SpriteSheetEntry>,
    pub appearances_file: Option<String>,
}

impl Catalog {
    /// Load `catalog-content.json` from `dir/catalog-content.json` and
    /// return the parsed catalog.
    pub fn load(assets_dir: impl AsRef<Path>) -> Result<Self> {
        let dir = assets_dir.as_ref().to_path_buf();
        let path = dir.join("catalog-content.json");
        let bytes = std::fs::read(&path).map_err(|e| SpriteError::Io {
            path: path.clone(),
            source: e,
        })?;
        let entries: Vec<CatalogEntry> = serde_json::from_slice(&bytes)
            .map_err(|e| SpriteError::Catalog(format!("{path:?}: {e}")))?;

        let mut sheets = Vec::new();
        let mut appearances_file = None;
        for entry in entries {
            match entry {
                CatalogEntry::Sprite(s) => sheets.push(s),
                CatalogEntry::Appearances(a) => appearances_file = Some(a.file),
                _ => {}
            }
        }
        sheets.sort_by_key(|s| s.firstspriteid);

        Ok(Self {
            assets_dir: dir,
            sheets,
            appearances_file,
        })
    }

    /// Locate the sheet covering `sprite_id`, if any.
    pub fn sheet_for(&self, sprite_id: u32) -> Option<&SpriteSheetEntry> {
        self.sheets
            .binary_search_by(|s| {
                if sprite_id < s.firstspriteid {
                    std::cmp::Ordering::Greater
                } else if sprite_id > s.lastspriteid {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .ok()
            .map(|idx| &self.sheets[idx])
    }
}

/// Caching sprite atlas. Wraps a `Catalog` plus a lock-free cache of
/// fully decoded sheet images. Decoded sheets are kept in memory until
/// the `Atlas` is dropped — for editor use cases this is fine since
/// the user opens one client tree at a time.
pub struct Atlas {
    catalog: Catalog,
    /// Cache of decoded sheets keyed by file name relative to `assets_dir`.
    cache: DashMap<String, std::sync::Arc<RgbaImage>>,
    /// Some client builds wrap each sheet in a BMP container after
    /// LZMA decompression; others write raw BGRA. Default is `false`
    /// (raw BGRA after a 32-byte header) which matches the modern
    /// Tibia 12+ format.
    bmp_wrap: bool,
    /// Channel order of the on-disk pixel data. Exposed so the UI can
    /// flip between candidates when colors come out wrong.
    pixel_format: PixelFormat,
}

impl Atlas {
    pub fn new(catalog: Catalog) -> Self {
        Self {
            catalog,
            cache: DashMap::new(),
            bmp_wrap: false,
            pixel_format: PixelFormat::default(),
        }
    }

    pub fn from_assets_dir(dir: impl AsRef<Path>) -> Result<Self> {
        let catalog = Catalog::load(dir)?;
        Ok(Self::new(catalog))
    }

    pub fn with_bmp_wrap(mut self, on: bool) -> Self {
        self.bmp_wrap = on;
        self
    }

    pub fn with_pixel_format(mut self, pf: PixelFormat) -> Self {
        self.pixel_format = pf;
        self.cache.clear();
        self
    }

    pub fn set_pixel_format(&mut self, pf: PixelFormat) {
        if self.pixel_format != pf {
            self.pixel_format = pf;
            self.cache.clear();
        }
    }

    pub fn pixel_format(&self) -> PixelFormat {
        self.pixel_format
    }

    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    /// Diagnostic: load the sheet covering `sprite_id` and report its
    /// raw + decoded sizes plus the first 32 bytes of decompressed
    /// data. Useful when sprite colors come out wrong and we need to
    /// inspect the on-disk layout without rebuilding.
    pub fn inspect(&self, sprite_id: u32) -> Result<SheetInspection> {
        let sheet = self
            .catalog
            .sheet_for(sprite_id)
            .ok_or(SpriteError::UnknownSprite(sprite_id))?;
        let path = self.catalog.assets_dir.join(&sheet.file);
        let raw = std::fs::read(&path).map_err(|e| SpriteError::Io {
            path: path.clone(),
            source: e,
        })?;
        let raw_len = raw.len();
        let raw_head = bytes_to_hex(&raw[..raw.len().min(48)]);

        let mut decoded = Vec::new();
        if raw.len() > SHEET_HEADER_LEN {
            let mut reader = std::io::Cursor::new(&raw[SHEET_HEADER_LEN..]);
            let options = lzma_rs::decompress::Options {
                unpacked_size: lzma_rs::decompress::UnpackedSize::ReadHeaderButUseProvided(None),
                ..Default::default()
            };
            // Swallow errors during inspection — we want the partial
            // output (if any) and the head bytes to debug with.
            let _ = lzma_rs::lzma_decompress_with_options(&mut reader, &mut decoded, &options);
        }
        let decoded_len = decoded.len();
        let decoded_head = bytes_to_hex(&decoded[..decoded.len().min(64)]);

        Ok(SheetInspection {
            sprite_id,
            sheet_file: sheet.file.clone(),
            firstspriteid: sheet.firstspriteid,
            lastspriteid: sheet.lastspriteid,
            spritetype: sheet.spritetype,
            area: sheet.area,
            raw_len,
            decoded_len,
            raw_head_hex: raw_head,
            decoded_head_hex: decoded_head,
            detected_sheet_side: detect_sheet_side(decoded_len),
        })
    }

    /// Return the RGBA-decoded sprite tile for `sprite_id`. Errors if
    /// no sheet covers the id, or if the sheet fails to decompress.
    pub fn sprite(&self, sprite_id: u32) -> Result<RgbaImage> {
        let sheet = self
            .catalog
            .sheet_for(sprite_id)
            .ok_or(SpriteError::UnknownSprite(sprite_id))?;
        let sheet_image = self.load_sheet(&sheet.file)?;
        let dims = SpriteDims::from_spritetype(sheet.spritetype)?;
        let sheet_side = sheet_image.width(); // square sheet (height == width)
        let index_in_sheet = sprite_id - sheet.firstspriteid;
        let cols = sheet_side / dims.width;
        let col = index_in_sheet % cols;
        let row = index_in_sheet / cols;
        let x = col * dims.width;
        let y = row * dims.height;
        let mut out = RgbaImage::new(dims.width, dims.height);
        for sy in 0..dims.height {
            for sx in 0..dims.width {
                let p = sheet_image.get_pixel(x + sx, y + sy);
                out.put_pixel(sx, sy, *p);
            }
        }
        Ok(out)
    }

    fn load_sheet(&self, file: &str) -> Result<std::sync::Arc<RgbaImage>> {
        if let Some(hit) = self.cache.get(file) {
            return Ok(hit.clone());
        }
        let path = self.catalog.assets_dir.join(file);
        let raw = std::fs::read(&path).map_err(|e| SpriteError::Io {
            path: path.clone(),
            source: e,
        })?;

        // Tibia 12+ layout: 32 bytes of Cipsoft custom header (signature
        // + checksum) followed by an LZMA1 stream. The LZMA header's
        // uncompressed-size field is zeroed out on Tibia sheets, so we
        // tell `lzma-rs` to ignore it and read until the end of the
        // stream — otherwise it stops immediately and produces 0 bytes.
        if raw.len() < SHEET_HEADER_LEN {
            return Err(SpriteError::SheetTooSmall {
                path,
                actual: raw.len(),
                expected: SHEET_HEADER_LEN,
            });
        }
        let mut decoded = Vec::new();
        let mut reader = std::io::Cursor::new(&raw[SHEET_HEADER_LEN..]);
        let options = lzma_rs::decompress::Options {
            unpacked_size: lzma_rs::decompress::UnpackedSize::ReadHeaderButUseProvided(None),
            ..Default::default()
        };
        lzma_rs::lzma_decompress_with_options(&mut reader, &mut decoded, &options).map_err(
            |e| SpriteError::Lzma {
                path: path.clone(),
                source: e,
            },
        )?;

        // Auto-detect BMP-wrapped sheets by their "BM" magic. Real
        // Tibia 12+ clients ship sheets as a Windows BMP (file header +
        // BITMAPV4HEADER + bottom-up BGRA pixels) embedded in the LZMA
        // stream — exactly 14 + 108 + W*H*4 bytes. The `image` crate
        // handles BGR↔RGBA and the bottom-up row order for us.
        let is_bmp = decoded.len() >= 2 && &decoded[..2] == b"BM";
        let image = if is_bmp || self.bmp_wrap {
            image::load_from_memory_with_format(&decoded, image::ImageFormat::Bmp)
                .map_err(|e| SpriteError::Catalog(format!("BMP decode for {path:?}: {e}")))?
                .to_rgba8()
        } else {
            let sheet_side = detect_sheet_side(decoded.len()).ok_or_else(|| {
                let expected =
                    (SHEET_SIDES[0] as usize) * (SHEET_SIDES[0] as usize) * BYTES_PER_PIXEL;
                SpriteError::SheetTooSmall {
                    path: path.clone(),
                    actual: decoded.len(),
                    expected,
                }
            })?;
            let expected = (sheet_side as usize) * (sheet_side as usize) * BYTES_PER_PIXEL;
            // Permute the on-disk channels into RGBA per the configured
            // `pixel_format`.
            let mut rgba = Vec::with_capacity(expected);
            for chunk in decoded[..expected].chunks_exact(4) {
                rgba.extend_from_slice(&self.pixel_format.to_rgba(chunk));
            }
            RgbaImage::from_raw(sheet_side, sheet_side, rgba).expect("pre-validated buffer dims")
        };

        let arc = std::sync::Arc::new(image);
        self.cache.insert(file.to_string(), arc.clone());
        Ok(arc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_parses_sprite_and_appearances_entries() {
        let json = br#"
            [
              { "type": "sprite", "file": "sheet-0-143.bmp.lzma", "spritetype": 0, "firstspriteid": 0, "lastspriteid": 143, "area": 32 },
              { "type": "sprite", "file": "sheet-144-179.bmp.lzma", "spritetype": 3, "firstspriteid": 144, "lastspriteid": 179, "area": 128 },
              { "type": "appearances", "file": "appearances.dat", "version": 7 },
              { "type": "map", "file": null },
              { "type": "newkind", "blob": "ignored" }
            ]
        "#;
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("catalog-content.json"), json).unwrap();
        let catalog = Catalog::load(dir.path()).expect("catalog should parse");
        assert_eq!(catalog.sheets.len(), 2);
        assert_eq!(catalog.appearances_file.as_deref(), Some("appearances.dat"));

        let sheet = catalog.sheet_for(50).expect("50 covered by first sheet");
        assert_eq!(sheet.firstspriteid, 0);
        assert_eq!(sheet.lastspriteid, 143);

        let sheet = catalog.sheet_for(150).expect("150 covered by second sheet");
        assert_eq!(sheet.spritetype, 3);

        assert!(catalog.sheet_for(9999).is_none());
    }

    #[test]
    fn sprite_dims_reject_unsupported_types() {
        assert_eq!(
            SpriteDims::from_spritetype(0).unwrap(),
            SpriteDims {
                width: 32,
                height: 32
            }
        );
        assert_eq!(
            SpriteDims::from_spritetype(3).unwrap(),
            SpriteDims {
                width: 64,
                height: 64
            }
        );
        assert!(matches!(
            SpriteDims::from_spritetype(99),
            Err(SpriteError::UnsupportedSpriteType(99))
        ));
    }
}
