//! Converter tool — turns a legacy server bundle (`items.otb` + Tibia
//! 7.x–10.x `.dat`/`.spr`) into a modern Tibia 12+ assets bundle
//! (`appearances.dat` + LZMA-compressed sprite sheets +
//! `catalog-content.json`).
//!
//! Today this module is a stub: it exposes the IPC surface the
//! Converter UI will use, but the real conversion path depends on:
//!
//! - a legacy `.dat` reader (Tibia 7.x–10.x format, pre-protobuf)
//! - a legacy `.spr` reader (already specced in `docs/spr-legacy.md`)
//! - a modern sprite-sheet writer (BMP+LZMA, 384×384 packing) — the
//!   write path itself is already in `atlas-sprites::pack`, only the
//!   legacy decoders are missing.
//!
//! Each function therefore returns `Err("not implemented")` for now,
//! so the UI can be wired up against the real signatures while the
//! logic catches up.

pub mod commands;
