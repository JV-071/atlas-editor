# Legacy `.spr` Format — Reference Notes

These notes describe the **legacy Tibia `.spr` sprite container** used by
clients 3.0 through 10.56. Atlas Assets Editor targets Tibia 12+/15.x,
which dropped this format in favour of LZMA-compressed `sprites-N.bin`
sheets referenced by `appearances.dat`. The legacy format is therefore
**not** parsed by the `atlas-sprites` crate today.

This document exists for two future use cases:

1. **Optional legacy import** — converting sprites from a classic `.spr`
   into the modern catalog (post-Phase 7 stretch goal).
2. **Sprite editor UX inspiration** for Phase 7.

The facts below are re-derived from the publicly available
[spreditor.online](https://github.com/V0RT4C/spreditor.online) project
(MIT). The byte layouts themselves are a property of the CIP client and
are not copyrightable; any Atlas implementation will be written from
scratch.

## Eras

Three byte-level variants exist; the reader picks the right one from
the file signature.

| Era         | Versions          | Color model         | Count width | Header size |
|-------------|-------------------|---------------------|-------------|-------------|
| Paletted    | pre-7.00          | 256-color palette   | u16         | 2 bytes     |
| RGB         | 7.00 – ~9.50      | 24-bit RGB + chroma | u16         | 6 bytes     |
| Extended    | ~9.60 – 10.56     | 24-bit RGB + chroma | u32         | 8 bytes     |

"Extended" only widens the sprite-count field; the per-sprite layout is
identical to RGB. The boundary is detected via the file signature, not
a version field on disk.

## RGB / Extended layout (≥ 7.00)

### File header

| Offset | Field         | Type     |
|--------|---------------|----------|
| 0      | signature     | u32 LE   |
| 4      | sprite count  | u16 LE (RGB) / u32 LE (extended) |
| 6 / 8  | index table   | `count × u32 LE` |

The `signature` is a 4-byte build tag — every client release uses a
distinct value (e.g. `0x542143DE` = 10.56). Matching it back to a
human-readable version requires a lookup table; the spreditor.online
project ships one with ~80 entries
([versions.ts](https://github.com/V0RT4C/spreditor.online/blob/main/src/lib/versions.ts)),
which would have to be re-built from public client notes if Atlas ever
implements the legacy reader.

The index table holds one `u32 LE` per sprite ID (IDs are 1-based).
Each entry is a **file offset** to that sprite's data block. `0` means
the sprite slot is empty — no data exists for that ID.

### Per-sprite block

At each non-zero address:

| Offset | Field             | Type      | Notes                              |
|--------|-------------------|-----------|------------------------------------|
| +0     | chroma marker     | 3 bytes   | Always `FF 00 FF` (magenta); skip. |
| +3     | payload length    | u16 LE    | Bytes of RLE that follow.          |
| +5     | RLE chunks        | variable  | See below.                         |

The magenta marker is a vestige of the original chroma-key transparency
scheme; the reader skips it without validating.

### RLE encoding

Each sprite is exactly **32×32 pixels** (1024 total). The decoder walks
the destination buffer left-to-right, top-to-bottom, advancing a pixel
cursor. The RLE stream is a sequence of chunks, each:

```
u16 LE  transparent_count   // skip this many destination pixels
u16 LE  colored_count       // then read this many RGB triples
[u8 r, u8 g, u8 b] × colored_count
```

Loop until the consumed byte count equals the declared payload length.
A sprite with all-transparent pixels has a zero-length payload but
still occupies a slot in the index table.

There is **no alpha channel on disk** in this era — transparency is
purely positional (the `transparent_count` runs). Atlas, which assumes
RGBA8888 internally, would set alpha to 255 for every emitted pixel.

## Paletted layout (pre-7.00)

### File header

No signature, no version magic:

| Offset | Field        | Type   |
|--------|--------------|--------|
| 0      | sprite count | u16 LE |

### Per-sprite block

Sprites follow the header back-to-back, each preceded by its ID:

| Field            | Type   |
|------------------|--------|
| sprite id        | u16 LE |
| payload length   | u16 LE |
| RLE chunks       | variable |

### Paletted RLE

Same skip/run shape as the modern format, but the colored-pixel count
is a `u8` and each colored pixel is a **single palette index byte**:

```
u16 LE  transparent_count
u8      colored_count
u8      palette_index × colored_count
```

The palette is a hard-coded 256-entry RGB table; see
[oldSpritePalette.ts](https://github.com/V0RT4C/spreditor.online/blob/main/src/lib/sprite/oldSpritePalette.ts)
for the exact triples. The first 8 entries form a green ramp
(0/0/0 → 0/255/0), suggesting an HSV-derived ordering rather than a
sorted palette. Atlas would either embed an identical table or derive
one from a reference client.

### Vertical flip

Pre-7.00 sprite rows are stored **bottom-up** on disk. The reader
flips the rasterized 32×32 buffer top-down before handing it off.

## Modern Atlas comparison

For completeness, the format Atlas does parse:

| Aspect          | Legacy `.spr`        | Modern Tibia 12+                       |
|-----------------|----------------------|----------------------------------------|
| File unit       | one large `.spr`     | many `sprites-N.bin` sheets            |
| Compression     | none                 | LZMA per sheet                         |
| Color           | RGB or paletted      | RGBA8888 in a BMP-style 32-bit bitmap  |
| Indexing        | u32 offset table     | `catalog-content.json` mapping         |
| Sprite size     | fixed 32×32          | 32×32 packed into 384×384 / 512×512 sheets |

There is **no shared code path** with the legacy reader — it would be a
separate crate (e.g. `atlas-sprites-legacy`) gated behind an optional
feature so it never bloats the default build.

## Implementation budget (if/when we add it)

Rough size estimate based on the spreditor.online reference:

- RGB/extended reader: ~80 lines of Rust
- Paletted reader + flip: ~70 lines
- Palette table: 256 const RGB triples
- Signature → version lookup: only needed for the UI; pure data table

Phase 7 stretch goal at the earliest. Not on the critical path for any
current roadmap item.

## UX patterns worth borrowing for Phase 7

From the spreditor.online editor (independent of file format):

- **Pagination over virtualization** — they render 16–55 sprites per
  page depending on viewport width. Atlas's catalog will be larger
  (the modern client ships >100k entries), so we likely want a true
  virtualized grid; their breakpoints are still useful as a reference
  for thumbnail size vs viewport.
- **Web Workers for compile and bulk export** — Atlas runs in Tauri so
  we use `rayon`/`tokio` instead, but the message-driven progress
  pattern (`update`, `progress`, `completed` events) maps cleanly onto
  Tauri events.
- **Erase = zero RGBA, not delete** — they keep the ID slot live and
  wipe pixels. Useful when the catalog must keep ID slots stable for
  references in `appearances.dat`.
