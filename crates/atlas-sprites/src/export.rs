//! Encoder primitives used by the appearance export pipeline.
//!
//! These intentionally don't know anything about appearances or frame
//! groups — they take raw `RgbaImage`s and produce PNG/GIF byte
//! streams. The caller (`src-tauri/src/assets/commands.rs`) is the one
//! that walks the proto, picks the right sprites per (phase, addon,
//! direction, layer) and feeds them in here.

use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{ImageEncoder, RgbaImage};

use crate::{Result, SpriteError};

/// Wrap an already-encoded PNG byte buffer in a browser-ready
/// `data:image/png;base64,...` URL. Pulled out so the sheet viewer
/// can reuse it without each Tauri command pulling base64 in.
pub fn png_to_data_url(png_bytes: &[u8]) -> String {
    let encoded = BASE64.encode(png_bytes);
    format!("data:image/png;base64,{encoded}")
}

/// Decode an arbitrary image byte buffer (PNG, BMP, …) into RGBA8.
/// Used by the sprite-replace path to ingest user-picked files.
pub fn decode_rgba(bytes: &[u8]) -> Result<RgbaImage> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| SpriteError::Catalog(format!("image decode: {e}")))?;
    Ok(img.to_rgba8())
}

/// PNG-encode a single RGBA frame. Always preserves the alpha channel —
/// "non-transparent" export means the source sprite happens to be fully
/// opaque, not that we force-bake a background here.
pub fn encode_png_rgba(img: &RgbaImage) -> Result<Vec<u8>> {
    let mut buf = Vec::with_capacity((img.width() as usize * img.height() as usize * 4) + 1024);
    image::codecs::png::PngEncoder::new(&mut buf)
        .write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| SpriteError::Catalog(format!("png encode: {e}")))?;
    Ok(buf)
}

/// Encode a sequence of RGBA frames into an animated GIF. Each delay
/// is in milliseconds and is rounded into GIF's centisecond resolution
/// (so 10 ms is the practical minimum).
///
/// `loop_forever = true` writes the Netscape "loop forever" extension;
/// otherwise the GIF plays once and stops on the last frame, matching
/// the reference editor's behavior for non-looping effects.
pub fn encode_animated_gif(
    frames: &[&RgbaImage],
    delays_ms: &[u32],
    loop_forever: bool,
) -> Result<Vec<u8>> {
    if frames.is_empty() {
        return Err(SpriteError::Catalog(
            "encode_animated_gif: at least one frame required".into(),
        ));
    }
    let width = frames[0].width() as u16;
    let height = frames[0].height() as u16;
    if frames.iter().any(|f| f.width() as u16 != width || f.height() as u16 != height) {
        return Err(SpriteError::Catalog(
            "encode_animated_gif: every frame must share the first frame's dimensions".into(),
        ));
    }

    let mut buf = Vec::new();
    {
        let mut encoder = gif::Encoder::new(Cursor::new(&mut buf), width, height, &[])
            .map_err(|e| SpriteError::Catalog(format!("gif header: {e}")))?;
        encoder
            .set_repeat(if loop_forever {
                gif::Repeat::Infinite
            } else {
                gif::Repeat::Finite(0)
            })
            .map_err(|e| SpriteError::Catalog(format!("gif set_repeat: {e}")))?;

        for (i, src) in frames.iter().enumerate() {
            // `from_rgba_speed` quantizes the RGBA pixels into a 256-color
            // palette per frame and picks a transparent index. Speed 10
            // is the highest quality the encoder supports; sprite frames
            // are tiny (32×32 typically) so the cost is negligible.
            let mut pixels: Vec<u8> = src.as_raw().clone();
            let mut frame = gif::Frame::from_rgba_speed(width, height, &mut pixels, 10);
            let ms = delays_ms.get(i).copied().unwrap_or(100);
            // GIF stores delay in centiseconds (u16). Clamp to >= 2 cs
            // because a delay of 0 is treated as "as fast as possible"
            // by most players, which looks like a still image, not an
            // animation.
            frame.delay = ((ms / 10).max(2)).min(u16::MAX as u32) as u16;
            frame.dispose = gif::DisposalMethod::Background;
            encoder
                .write_frame(&frame)
                .map_err(|e| SpriteError::Catalog(format!("gif frame {i}: {e}")))?;
        }
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn solid(width: u32, height: u32, rgba: [u8; 4]) -> RgbaImage {
        let mut img = RgbaImage::new(width, height);
        for px in img.pixels_mut() {
            *px = Rgba(rgba);
        }
        img
    }

    #[test]
    fn png_roundtrip() {
        let img = solid(32, 32, [255, 0, 0, 255]);
        let bytes = encode_png_rgba(&img).expect("encode");
        // PNG signature.
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        let decoded = image::load_from_memory(&bytes).expect("decode");
        assert_eq!(decoded.width(), 32);
        assert_eq!(decoded.height(), 32);
    }

    #[test]
    fn gif_three_frames() {
        let frames = [
            solid(16, 16, [255, 0, 0, 255]),
            solid(16, 16, [0, 255, 0, 255]),
            solid(16, 16, [0, 0, 255, 255]),
        ];
        let refs: Vec<&RgbaImage> = frames.iter().collect();
        let bytes = encode_animated_gif(&refs, &[100, 100, 100], true).expect("encode");
        // GIF87a/GIF89a magic.
        assert!(&bytes[..3] == b"GIF");
        // Sanity-check the file actually decodes.
        let dec = gif::DecodeOptions::new()
            .read_info(std::io::Cursor::new(&bytes))
            .expect("decode");
        assert_eq!(dec.width(), 16);
    }

    #[test]
    fn gif_rejects_mismatched_sizes() {
        let a = solid(16, 16, [0; 4]);
        let b = solid(32, 16, [0; 4]);
        let frames = [&a, &b];
        let err = encode_animated_gif(&frames, &[100, 100], true).unwrap_err();
        assert!(format!("{err}").contains("dimensions"));
    }
}
