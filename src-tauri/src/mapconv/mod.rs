//! Map Converter tool — translates item ids inside an `.otbm` map between
//! server numbering (TFS-style `items.otb`) and client numbering
//! (OTBR/Nostalrius), using the community mapping tables embedded in
//! [`atlas_otbm`]. Single-file in/out; the heavy lifting lives in the
//! crate, this module is just the IPC surface.

pub mod commands;
