//! OBD (Object Builder Data) importer.
//!
//! `.obd` is the interchange format the legacy Object Builder / WPF
//! Assets-Editor uses to ship a single appearance plus its sprites.
//! Layout (after a standard LZMA1-alone decompress):
//!
//! ```text
//! u16 version            // 200 = V2, 300 = V3
//! u16 clientVersion
//! u8  category            // 1=object 2=outfit 3=effect 4=missile
//! u32 texturePos          // absolute offset where pattern data starts
//! ..  legacy 10.98 attr blob  // skipped: we seek straight to texturePos
//! [frame groups]
//! ```
//!
//! The attribute blob is the Tibia 10.98 opcode soup. We deliberately
//! don't parse it — the flags don't map cleanly onto the modern proto
//! anyway, and `texturePos` lets us jump straight to the sprite data.
//! Each embedded sprite is a 32×32 ARGB tile (alpha-first byte order).

use atlas_appearances::{
    AppearanceInfo, FixedFrameGroup, FrameGroupInfo, SpriteAnimationData, SpriteInfoData,
    SpritePhase,
};
use atlas_core::AppearanceCategory;
use atlas_sprites::RgbaImage;

const TILE: u32 = 32; // every OBD sprite tile is 32×32
const TILE_BYTES: usize = (TILE * TILE * 4) as usize; // 4096, ARGB

/// One decoded frame group: the pattern dims plus the composed sprite
/// tiles (already stitched up from the raw 32×32 ARGB tiles).
#[derive(Debug)]
pub struct ObdFrameGroup {
    pub fixed_frame_group: Option<FixedFrameGroup>,
    pub pattern_width: u32,
    pub pattern_height: u32,
    pub pattern_depth: u32,
    pub layers: u32,
    pub frames: u32,
    pub animation: Option<SpriteAnimationData>,
    /// Composed sprites in OBD file order. Each is `(32*tile_w)×(32*tile_h)`.
    pub sprites: Vec<RgbaImage>,
    pub tile_w: u32,
    pub tile_h: u32,
}

#[derive(Debug)]
pub struct ObdImport {
    pub category: AppearanceCategory,
    pub frame_groups: Vec<ObdFrameGroup>,
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }
    fn need(&self, n: usize) -> Result<(), String> {
        if self.pos + n > self.buf.len() {
            Err(format!(
                "OBD truncated: need {n} bytes at offset {} but only {} total",
                self.pos,
                self.buf.len()
            ))
        } else {
            Ok(())
        }
    }
    fn u8(&mut self) -> Result<u8, String> {
        self.need(1)?;
        let v = self.buf[self.pos];
        self.pos += 1;
        Ok(v)
    }
    fn u16(&mut self) -> Result<u16, String> {
        self.need(2)?;
        let v = u16::from_le_bytes([self.buf[self.pos], self.buf[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }
    fn u32(&mut self) -> Result<u32, String> {
        self.need(4)?;
        let v = u32::from_le_bytes([
            self.buf[self.pos],
            self.buf[self.pos + 1],
            self.buf[self.pos + 2],
            self.buf[self.pos + 3],
        ]);
        self.pos += 4;
        Ok(v)
    }
    fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        self.need(n)?;
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
    fn seek(&mut self, pos: usize) -> Result<(), String> {
        if pos > self.buf.len() {
            return Err(format!("OBD texturePos {pos} past EOF {}", self.buf.len()));
        }
        self.pos = pos;
        Ok(())
    }
}

fn category_from_byte(b: u8) -> Result<AppearanceCategory, String> {
    match b {
        1 => Ok(AppearanceCategory::Object),
        2 => Ok(AppearanceCategory::Outfit),
        3 => Ok(AppearanceCategory::Effect),
        4 => Ok(AppearanceCategory::Missile),
        other => Err(format!("OBD: unknown appearance category {other}")),
    }
}

fn fixed_frame_group_from_byte(b: u8) -> Option<FixedFrameGroup> {
    FixedFrameGroup::from_i32(b as i32)
}

/// Decode a raw 32×32 ARGB tile (alpha-first byte order, as the OBD /
/// reference `Sprite` class stores it) into an RGBA image.
fn decode_tile(raw: &[u8]) -> Result<RgbaImage, String> {
    if raw.len() != TILE_BYTES {
        return Err(format!(
            "OBD tile is {} bytes, expected {TILE_BYTES}",
            raw.len()
        ));
    }
    let mut img = RgbaImage::new(TILE, TILE);
    for (i, px) in raw.chunks_exact(4).enumerate() {
        let x = (i as u32) % TILE;
        let y = (i as u32) / TILE;
        // stored A,R,G,B → RgbaImage R,G,B,A
        img.put_pixel(x, y, image_rgba(px[1], px[2], px[3], px[0]));
    }
    Ok(img)
}

fn image_rgba(r: u8, g: u8, b: u8, a: u8) -> atlas_sprites::Rgba<u8> {
    atlas_sprites::Rgba([r, g, b, a])
}

/// Stitch a `tile_w × tile_h` grid of 32×32 tiles (file order: row by
/// row, left→right then top→bottom) into one composed sprite.
fn compose(tiles: &[RgbaImage], tile_w: u32, tile_h: u32) -> RgbaImage {
    if tile_w == 1 && tile_h == 1 {
        return tiles[0].clone();
    }
    let mut out = RgbaImage::new(tile_w * TILE, tile_h * TILE);
    for (idx, tile) in tiles.iter().enumerate() {
        let cx = (idx as u32) % tile_w;
        let cy = (idx as u32) / tile_w;
        for ty in 0..TILE {
            for tx in 0..TILE {
                out.put_pixel(cx * TILE + tx, cy * TILE + ty, *tile.get_pixel(tx, ty));
            }
        }
    }
    out
}

fn read_frame_group(
    r: &mut Reader,
    version: u16,
    is_outfit: bool,
) -> Result<ObdFrameGroup, String> {
    let fixed = if version == 300 && is_outfit {
        fixed_frame_group_from_byte(r.u8()?)
    } else {
        Some(FixedFrameGroup::OutfitIdle)
    };

    let tile_w = r.u8()? as u32; // patternWidth (tile composition, 32px units)
    let tile_h = r.u8()? as u32; // patternHeight
    if tile_w == 0 || tile_h == 0 {
        return Err("OBD: zero pattern width/height".into());
    }
    // patternSize byte only present when composed of >1 tile.
    if tile_w > 1 || tile_h > 1 {
        let _pattern_size = r.u8()?; // always 32; ignored
    }
    let layers = r.u8()?.max(1) as u32;
    let px = r.u8()?.max(1) as u32; // patternX  → proto pattern_width
    let py = r.u8()?.max(1) as u32; // patternY  → proto pattern_height
    let pz = r.u8()?.max(1) as u32; // patternZ  → proto pattern_depth
    let frames = r.u8()?.max(1) as u32; // animation phases

    let animation = if frames > 1 {
        let _mode = r.u8()?;
        let loop_count = r.u32()?;
        let default_start_phase = r.u8()?;
        let mut phases = Vec::with_capacity(frames as usize);
        for _ in 0..frames {
            let dmin = r.u32()?;
            let dmax = r.u32()?;
            phases.push(SpritePhase {
                duration_min: Some(dmin),
                duration_max: Some(dmax),
            });
        }
        Some(SpriteAnimationData {
            default_start_phase: Some(default_start_phase as u32),
            synchronized: None,
            random_start_phase: None,
            loop_type: None,
            loop_count: Some(loop_count),
            sprite_phases: phases,
        })
    } else {
        None
    };

    let num_tiles: usize = (tile_w as u64)
        .checked_mul(tile_h as u64)
        .and_then(|v| v.checked_mul(layers as u64))
        .and_then(|v| v.checked_mul(px as u64))
        .and_then(|v| v.checked_mul(py as u64))
        .and_then(|v| v.checked_mul(pz as u64))
        .and_then(|v| v.checked_mul(frames as u64))
        .and_then(|v| usize::try_from(v).ok())
        .ok_or("OBD: tile count overflow")?;
    let mut tiles: Vec<RgbaImage> = Vec::with_capacity(num_tiles);
    for _ in 0..num_tiles {
        let _sprite_id = r.u32()?; // source id — discarded, we reallocate
        let data = if version == 300 {
            let size = r.u32()? as usize;
            if size != TILE_BYTES {
                return Err(format!(
                    "OBD V3 tile size {size}, expected {TILE_BYTES} (non-32×32 tiles unsupported)"
                ));
            }
            r.bytes(size)?
        } else {
            r.bytes(TILE_BYTES)?
        };
        tiles.push(decode_tile(data)?);
    }

    // Collapse the (tile_w × tile_h) tile grid of every cell into one
    // composed sprite, preserving cell order.
    let tiles_per_cell = (tile_w * tile_h) as usize;
    let cells = num_tiles / tiles_per_cell;
    let mut sprites = Vec::with_capacity(cells);
    for c in 0..cells {
        let start = c * tiles_per_cell;
        sprites.push(compose(
            &tiles[start..start + tiles_per_cell],
            tile_w,
            tile_h,
        ));
    }

    Ok(ObdFrameGroup {
        fixed_frame_group: fixed,
        pattern_width: px,
        pattern_height: py,
        pattern_depth: pz,
        layers,
        frames,
        animation,
        sprites,
        tile_w,
        tile_h,
    })
}

/// Parse a `.obd` file's raw bytes (still LZMA-compressed) into a
/// neutral import payload.
pub fn parse_obd(file_bytes: &[u8]) -> Result<ObdImport, String> {
    let decompressed =
        atlas_sprites::lzma_decompress_alone(file_bytes).map_err(|e| e.to_string())?;
    let mut r = Reader::new(&decompressed);

    let version = r.u16()?;
    if version != 200 && version != 300 {
        return Err(format!(
            "OBD: unsupported version {version} (expected 200 or 300)"
        ));
    }
    let _client_version = r.u16()?;
    let category = category_from_byte(r.u8()?)?;
    let texture_pos = r.u32()? as usize;
    // Skip the legacy 10.98 attribute blob entirely.
    r.seek(texture_pos)?;

    let is_outfit = category == AppearanceCategory::Outfit;
    let group_count = if version == 300 && is_outfit {
        r.u8()? as usize
    } else {
        1
    };

    let mut frame_groups = Vec::with_capacity(group_count);
    for _ in 0..group_count {
        frame_groups.push(read_frame_group(&mut r, version, is_outfit)?);
    }

    Ok(ObdImport {
        category,
        frame_groups,
    })
}

/// Build the neutral `AppearanceInfo` for an imported OBD given the
/// sprite ids we already allocated for each frame group's composed
/// sprites (parallel to `ObdFrameGroup::sprites`, same order).
pub fn build_appearance(
    import: &ObdImport,
    id: u32,
    sprite_ids_per_group: &[Vec<u32>],
) -> AppearanceInfo {
    let mut frame_groups = Vec::with_capacity(import.frame_groups.len());
    for (i, fg) in import.frame_groups.iter().enumerate() {
        let sprite_ids = sprite_ids_per_group[i].clone();
        frame_groups.push(FrameGroupInfo {
            fixed_frame_group: fg.fixed_frame_group,
            id: Some(i as u32),
            sprite_info: Some(SpriteInfoData {
                pattern_width: Some(fg.pattern_width),
                pattern_height: Some(fg.pattern_height),
                pattern_depth: Some(fg.pattern_depth),
                layers: Some(fg.layers),
                sprite_ids,
                animation: fg.animation.clone(),
                bounding_square: None,
                is_opaque: None,
                bounding_box_per_direction: Vec::new(),
            }),
        });
    }
    let flat: Vec<u32> = frame_groups
        .iter()
        .filter_map(|f| f.sprite_info.as_ref())
        .flat_map(|si| si.sprite_ids.iter().copied())
        .collect();

    AppearanceInfo {
        id: atlas_appearances::AssetId(id),
        category: import.category,
        name: None,
        description: None,
        flags: Default::default(),
        frame_groups,
        sprite_ids: flat,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reader_u8_u16_u32() {
        let data = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];
        let mut r = Reader::new(&data);
        assert_eq!(r.u8().unwrap(), 0x01);
        assert_eq!(r.u16().unwrap(), 0x0302);
        assert_eq!(r.u32().unwrap(), 0x07060504);
    }

    #[test]
    fn reader_rejects_read_past_end() {
        let data = [0x01, 0x02];
        let mut r = Reader::new(&data);
        r.u16().unwrap();
        assert!(r.u8().is_err());
    }

    #[test]
    fn reader_seek_validates_bounds() {
        let data = [0; 4];
        let mut r = Reader::new(&data);
        assert!(r.seek(4).is_ok());
        assert!(r.seek(5).is_err());
    }

    #[test]
    fn reader_bytes_returns_slice() {
        let data = [10, 20, 30, 40];
        let mut r = Reader::new(&data);
        let s = r.bytes(3).unwrap();
        assert_eq!(s, &[10, 20, 30]);
        assert_eq!(r.pos, 3);
    }

    #[test]
    fn category_from_byte_maps_all_valid() {
        assert_eq!(category_from_byte(1).unwrap(), AppearanceCategory::Object);
        assert_eq!(category_from_byte(2).unwrap(), AppearanceCategory::Outfit);
        assert_eq!(category_from_byte(3).unwrap(), AppearanceCategory::Effect);
        assert_eq!(category_from_byte(4).unwrap(), AppearanceCategory::Missile);
    }

    #[test]
    fn category_from_byte_rejects_invalid() {
        assert!(category_from_byte(0).is_err());
        assert!(category_from_byte(5).is_err());
        assert!(category_from_byte(255).is_err());
    }

    #[test]
    fn decode_tile_converts_argb_to_rgba() {
        let mut raw = vec![0u8; TILE_BYTES];
        raw[0] = 0xFF;
        raw[1] = 0x10;
        raw[2] = 0x20;
        raw[3] = 0x30;
        let img = decode_tile(&raw).unwrap();
        let px = img.get_pixel(0, 0);
        assert_eq!(px.0, [0x10, 0x20, 0x30, 0xFF]);
    }

    #[test]
    fn decode_tile_rejects_wrong_size() {
        assert!(decode_tile(&[0u8; 100]).is_err());
        assert!(decode_tile(&[0u8; TILE_BYTES + 1]).is_err());
    }

    #[test]
    fn compose_single_tile_passthrough() {
        let tile = RgbaImage::new(TILE, TILE);
        let out = compose(&[tile], 1, 1);
        assert_eq!(out.width(), TILE);
        assert_eq!(out.height(), TILE);
    }

    #[test]
    fn compose_2x2_grid_dimensions() {
        let tiles: Vec<RgbaImage> = (0..4).map(|_| RgbaImage::new(TILE, TILE)).collect();
        let out = compose(&tiles, 2, 2);
        assert_eq!(out.width(), TILE * 2);
        assert_eq!(out.height(), TILE * 2);
    }

    fn make_minimal_obd_v200(category: u8, frames: u32) -> Vec<u8> {
        let texture_pos: u32 = 9;
        let mut raw = Vec::new();
        raw.extend_from_slice(&200u16.to_le_bytes());
        raw.extend_from_slice(&1200u16.to_le_bytes());
        raw.push(category);
        raw.extend_from_slice(&texture_pos.to_le_bytes());
        raw.push(1); // tile_w
        raw.push(1); // tile_h
        raw.push(1); // layers
        raw.push(1); // px
        raw.push(1); // py
        raw.push(1); // pz
        raw.push(frames as u8);
        if frames > 1 {
            raw.push(0);
            raw.extend_from_slice(&0u32.to_le_bytes());
            raw.push(0);
            for _ in 0..frames {
                raw.extend_from_slice(&100u32.to_le_bytes());
                raw.extend_from_slice(&200u32.to_le_bytes());
            }
        }
        for i in 0..frames {
            raw.extend_from_slice(&(i + 1).to_le_bytes());
            raw.extend_from_slice(&vec![0u8; TILE_BYTES]);
        }
        let mut compressed = Vec::new();
        lzma_rs::lzma_compress(&mut &raw[..], &mut compressed).unwrap();
        compressed
    }

    #[test]
    fn parse_obd_minimal_object() {
        let data = make_minimal_obd_v200(1, 1);
        let import = parse_obd(&data).unwrap();
        assert_eq!(import.category, AppearanceCategory::Object);
        assert_eq!(import.frame_groups.len(), 1);
        assert_eq!(import.frame_groups[0].sprites.len(), 1);
        assert_eq!(import.frame_groups[0].sprites[0].width(), TILE);
    }

    #[test]
    fn parse_obd_rejects_bad_version() {
        let mut raw = Vec::new();
        raw.extend_from_slice(&999u16.to_le_bytes());
        raw.extend_from_slice(&1200u16.to_le_bytes());
        raw.push(1);
        raw.extend_from_slice(&9u32.to_le_bytes());
        let mut compressed = Vec::new();
        lzma_rs::lzma_compress(&mut &raw[..], &mut compressed).unwrap();
        assert!(parse_obd(&compressed)
            .unwrap_err()
            .contains("unsupported version 999"));
    }

    #[test]
    fn parse_obd_rejects_bad_category() {
        let mut raw = Vec::new();
        raw.extend_from_slice(&200u16.to_le_bytes());
        raw.extend_from_slice(&1200u16.to_le_bytes());
        raw.push(99);
        raw.extend_from_slice(&9u32.to_le_bytes());
        raw.push(1); raw.push(1);
        raw.push(1); raw.push(1); raw.push(1); raw.push(1); raw.push(1);
        let mut compressed = Vec::new();
        lzma_rs::lzma_compress(&mut &raw[..], &mut compressed).unwrap();
        assert!(parse_obd(&compressed)
            .unwrap_err()
            .contains("unknown appearance category"));
    }

    #[test]
    fn parse_obd_rejects_truncated_data() {
        assert!(parse_obd(&[]).is_err());
        assert!(parse_obd(&[0x5d, 0x00]).is_err());
    }

    #[test]
    fn parse_obd_multiple_frames() {
        let data = make_minimal_obd_v200(1, 3);
        let import = parse_obd(&data).unwrap();
        assert_eq!(import.frame_groups[0].frames, 3);
        assert_eq!(import.frame_groups[0].sprites.len(), 3);
    }

    #[test]
    fn build_appearance_maps_sprite_ids() {
        let data = make_minimal_obd_v200(1, 2);
        let import = parse_obd(&data).unwrap();
        let ids = vec![vec![100, 101]];
        let app = build_appearance(&import, 42, &ids);
        assert_eq!(app.id.0, 42);
        assert_eq!(app.category, AppearanceCategory::Object);
        assert_eq!(app.sprite_ids, vec![100, 101]);
    }
}
