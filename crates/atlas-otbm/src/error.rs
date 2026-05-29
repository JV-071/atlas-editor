use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum OtbmError {
    #[error("I/O error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("file is truncated or has an unterminated node")]
    Truncated,

    #[error("unexpected OTBM magic bytes: {0:#010x}")]
    BadMagic(u32),

    #[error("OTBM root node not found (expected 0xFE after the 4-byte magic)")]
    MissingRoot,
}

pub type Result<T> = std::result::Result<T, OtbmError>;
