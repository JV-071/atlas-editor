//! Reader and writer for `items.otb`, including the Atlas extended attributes.
//!
//! The OTB format is the legacy server-side item catalog used by TFS-family
//! servers. Atlas extends it with new `ITEM_ATTR_*` bytes that mirror modern
//! `appearances.dat` fields (imbuements, gems, weapon type, vocation
//! restrictions, etc.). See [`docs/otb-format.md`](../../docs/otb-format.md)
//! for the full byte-level specification.
//!
//! v0 is a placeholder; the actual TLV reader/writer lands in the next phase.

#![forbid(unsafe_code)]

pub use atlas_core::AssetId;

/// OTB attribute identifier. Values < `0x80` are classic TFS attributes;
/// values >= `0x80` are reserved for Atlas extensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
#[non_exhaustive]
pub enum ItemAttr {
    // Classic TFS (0x10..0x2F). Subset; full list in docs/otb-format.md.
    ServerId = 0x10,
    ClientId = 0x11,
    Name = 0x12,
    Speed = 0x14,

    // Atlas extensions (0x80..). Stable byte assignments — do not reorder.
    WeaponType = 0x80,
    MinimumLevel = 0x81,
    Vocations = 0x82,
    ImbuementSlots = 0x83,
    GemQualityId = 0x84,
    GemVocationId = 0x85,
    ProficiencyId = 0x86,
    CyclopediaType = 0x87,
    DualWielding = 0x88,
    ExpireFlags = 0x89,
    FormerObjectTypeId = 0x8A,
}
