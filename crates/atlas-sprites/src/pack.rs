//! Sprite-sheet write-back: turn an in-memory `RgbaImage` back into the
//! exact on-disk container Tibia 12+/15.x ships.
//!
//! A sheet file is `[32-byte prefix][LZMA1 stream]`. The prefix is 24
//! zero bytes followed by an 8-byte Cipsoft content checksum; neither
//! our reader nor OT clients (OTClient/Canary) validate it, so callers
//! either preserve the original prefix verbatim (replace path) or pass
//! zeros (new sheet).
//!
//! The LZMA1 payload decompresses to a Windows BMP — and not a generic
//! one: it is specifically a 32-bpp `BITMAPV4HEADER` with explicit
//! channel masks (R=0x00ff0000, G=0x0000ff00, B=0x000000ff,
//! A=0xff000000) and bottom-up rows. The `image` crate's BMP *encoder*
//! drops alpha, so we hand-write the header to keep transparency.

use image::RgbaImage;

use crate::{Result, SpriteError};

/// Length of the Cipsoft prefix in front of the LZMA stream.
pub const SHEET_PREFIX_LEN: usize = 32;

const FILE_HEADER_LEN: usize = 14;
const V4_HEADER_LEN: usize = 108;
const PIXEL_OFFSET: usize = FILE_HEADER_LEN + V4_HEADER_LEN; // 122

/// Encode an `RgbaImage` as the exact `BITMAPV4HEADER` 32-bpp BMP the
/// Tibia client emits: bottom-up rows, on-disk byte order B,G,R,A.
pub fn encode_sheet_bmp(img: &RgbaImage) -> Vec<u8> {
    let w = img.width();
    let h = img.height();
    let pixel_bytes = (w as usize) * (h as usize) * 4;
    let file_size = PIXEL_OFFSET + pixel_bytes;

    let mut out = Vec::with_capacity(file_size);

    // ---- BITMAPFILEHEADER (14) ----
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(file_size as u32).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved1
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved2
    out.extend_from_slice(&(PIXEL_OFFSET as u32).to_le_bytes());

    // ---- BITMAPV4HEADER (108) ----
    out.extend_from_slice(&(V4_HEADER_LEN as u32).to_le_bytes()); // biSize
    out.extend_from_slice(&w.to_le_bytes()); // biWidth
    out.extend_from_slice(&h.to_le_bytes()); // biHeight (+ = bottom-up)
    out.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    out.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
    out.extend_from_slice(&3u32.to_le_bytes()); // biCompression = BI_BITFIELDS
    out.extend_from_slice(&0u32.to_le_bytes()); // biSizeImage (0 is what Cipsoft writes)
    out.extend_from_slice(&0u32.to_le_bytes()); // biXPelsPerMeter
    out.extend_from_slice(&0u32.to_le_bytes()); // biYPelsPerMeter
    out.extend_from_slice(&0u32.to_le_bytes()); // biClrUsed
    out.extend_from_slice(&0u32.to_le_bytes()); // biClrImportant
    out.extend_from_slice(&0x00ff_0000u32.to_le_bytes()); // red mask
    out.extend_from_slice(&0x0000_ff00u32.to_le_bytes()); // green mask
    out.extend_from_slice(&0x0000_00ffu32.to_le_bytes()); // blue mask
    out.extend_from_slice(&0xff00_0000u32.to_le_bytes()); // alpha mask
    out.extend_from_slice(&0u32.to_le_bytes()); // csType = LCS_CALIBRATED_RGB
    out.extend_from_slice(&[0u8; 36]); // bV4Endpoints (CIEXYZTRIPLE)
    out.extend_from_slice(&0u32.to_le_bytes()); // bV4GammaRed
    out.extend_from_slice(&0u32.to_le_bytes()); // bV4GammaGreen
    out.extend_from_slice(&0u32.to_le_bytes()); // bV4GammaBlue

    // ---- pixels: bottom-up, B,G,R,A ----
    for y in (0..h).rev() {
        for x in 0..w {
            let p = img.get_pixel(x, y).0;
            out.push(p[2]); // B
            out.push(p[1]); // G
            out.push(p[0]); // R
            out.push(p[3]); // A
        }
    }

    debug_assert_eq!(out.len(), file_size);
    out
}

/// Full sheet file bytes: BMP → LZMA1 → `prefix` in front. `prefix` is
/// the original 32 bytes for an existing sheet, or zeros for a new one.
pub fn encode_sheet_file(img: &RgbaImage, prefix: &[u8; SHEET_PREFIX_LEN]) -> Result<Vec<u8>> {
    let bmp = encode_sheet_bmp(img);
    let mut compressed = Vec::new();
    let mut reader = std::io::Cursor::new(&bmp);
    lzma_rs::lzma_compress(&mut reader, &mut compressed)
        .map_err(|e| SpriteError::Catalog(format!("lzma compress: {e}")))?;

    let mut out = Vec::with_capacity(SHEET_PREFIX_LEN + compressed.len());
    out.extend_from_slice(prefix);
    out.extend_from_slice(&compressed);
    Ok(out)
}

/// A blank fully-transparent sheet of `side`×`side` pixels.
pub fn blank_sheet(side: u32) -> RgbaImage {
    RgbaImage::new(side, side)
}

/// Decompress a standard LZMA1 "alone" stream (5-byte props + 8-byte
/// size + data). Tolerates a bogus declared size by reading to the end
/// of the stream — sheet files zero it out, OBD files set it honestly,
/// and this handles both.
pub fn lzma_decompress_alone(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut reader = std::io::Cursor::new(bytes);
    let options = lzma_rs::decompress::Options {
        unpacked_size: lzma_rs::decompress::UnpackedSize::ReadHeaderButUseProvided(None),
        ..Default::default()
    };
    lzma_rs::lzma_decompress_with_options(&mut reader, &mut out, &options)
        .map_err(|e| SpriteError::Catalog(format!("lzma decompress: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn sample(side: u32) -> RgbaImage {
        let mut img = RgbaImage::new(side, side);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = Rgba([
                (x % 256) as u8,
                (y % 256) as u8,
                ((x + y) % 256) as u8,
                if (x + y) % 3 == 0 { 0 } else { 255 },
            ]);
        }
        img
    }

    /// The BMP we hand-write must match the exact header the probe
    /// found on real sheets (V4, 32bpp, BI_BITFIELDS, bottom-up).
    #[test]
    fn bmp_header_matches_cipsoft_layout() {
        let img = sample(64);
        let bmp = encode_sheet_bmp(&img);
        assert_eq!(&bmp[0..2], b"BM");
        let u32le = |o: usize| u32::from_le_bytes(bmp[o..o + 4].try_into().unwrap());
        let u16le = |o: usize| u16::from_le_bytes(bmp[o..o + 2].try_into().unwrap());
        assert_eq!(u32le(2) as usize, bmp.len()); // bfSize
        assert_eq!(u32le(10), 122); // bfOffBits
        assert_eq!(u32le(14), 108); // biSize (V4)
        assert_eq!(u32le(18), 64); // biWidth
        assert_eq!(u32le(22), 64); // biHeight (+ = bottom-up)
        assert_eq!(u16le(28), 32); // biBitCount
        assert_eq!(u32le(30), 3); // BI_BITFIELDS
        assert_eq!(u32le(54), 0x00ff_0000); // red mask
        assert_eq!(u32le(58), 0x0000_ff00); // green mask
        assert_eq!(u32le(62), 0x0000_00ff); // blue mask
        assert_eq!(u32le(66), 0xff00_0000); // alpha mask
    }

    /// Round-trip through the same path `Atlas::load_sheet` uses: strip
    /// the 32-byte prefix, LZMA-decompress, BMP-decode. Pixels (incl.
    /// alpha) must survive exactly.
    #[test]
    fn round_trips_through_loader_path() {
        let img = sample(128);
        let prefix = [0u8; SHEET_PREFIX_LEN];
        let file = encode_sheet_file(&img, &prefix).expect("encode");

        let mut decoded = Vec::new();
        let mut reader = std::io::Cursor::new(&file[SHEET_PREFIX_LEN..]);
        let options = lzma_rs::decompress::Options {
            unpacked_size: lzma_rs::decompress::UnpackedSize::ReadHeaderButUseProvided(None),
            ..Default::default()
        };
        lzma_rs::lzma_decompress_with_options(&mut reader, &mut decoded, &options)
            .expect("decompress");
        assert_eq!(&decoded[0..2], b"BM");

        let back = image::load_from_memory_with_format(&decoded, image::ImageFormat::Bmp)
            .expect("bmp decode")
            .to_rgba8();
        assert_eq!(back.dimensions(), img.dimensions());
        assert_eq!(back.as_raw(), img.as_raw(), "pixels incl. alpha must match");
    }

    #[test]
    fn prefix_is_preserved_verbatim() {
        let img = sample(32);
        let mut prefix = [0u8; SHEET_PREFIX_LEN];
        prefix[24..32].copy_from_slice(&[0x70, 0x0a, 0xfa, 0x80, 0x24, 0xed, 0xf9, 0x01]);
        let file = encode_sheet_file(&img, &prefix).expect("encode");
        assert_eq!(&file[..SHEET_PREFIX_LEN], &prefix);
    }
}
