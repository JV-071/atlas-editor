//! Neutral domain types for `items.otb` contents.
//!
//! The model is read-side first: every byte we currently understand on
//! disk gets a typed slot here. Unknown attributes are dropped at parse
//! time per the forward-compat clause in `docs/otb-format.md`; round-trip
//! preservation is a Phase 3 concern.

use atlas_core::{HookType, Vocation, WeaponType};
use serde::{Deserialize, Serialize};

/// Top-level parsed representation of an `items.otb` file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Otb {
    pub header: OtbHeader,
    pub items: Vec<OtbItem>,
}

/// Root version metadata. The on-disk payload is exactly 140 bytes:
/// `u32 major`, `u32 minor`, `u32 build`, `[u8; 128] csd_version`. We keep
/// `csd_version` as a `Vec<u8>` to make serde-deriving free; the length is
/// always 128 after a successful parse.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OtbHeader {
    pub major: u32,
    pub minor: u32,
    pub build: u32,
    pub csd_version: Vec<u8>,
}

impl Default for OtbHeader {
    fn default() -> Self {
        Self {
            major: 0,
            minor: 0,
            build: 0,
            csd_version: vec![0; 128],
        }
    }
}

impl OtbHeader {
    /// Atlas magic written into the first four bytes of `csd_version`.
    pub const ATLAS_TAG: &'static [u8; 4] = b"ATLA";

    /// `true` when this file was written by an Atlas-aware tool. Classic
    /// TFS readers ignore `csd_version`, so this is purely a hint for
    /// readers that want to know whether 0x80+ attributes are expected.
    pub fn is_atlas_extended(&self) -> bool {
        self.csd_version.starts_with(Self::ATLAS_TAG)
    }
}

/// OTB attribute identifier. Values < `0x80` are classic TFS attributes;
/// values >= `0x80` are reserved for Atlas extensions and are stable —
/// new entries will only ever be appended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
    HookDirection = 0x8B,
}

/// Item kind byte at the start of every item node. Mirrors classic TFS
/// `itemgroup_t`. Several values were deprecated by TFS itself and are
/// kept here only so files written by older servers still round-trip the
/// raw byte.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum ItemGroup {
    #[default]
    None = 0,
    Ground = 1,
    Container = 2,
    Weapon = 3,
    Ammunition = 4,
    Armor = 5,
    Charges = 6,
    Teleport = 7,
    MagicField = 8,
    Writeable = 9,
    Key = 10,
    Splash = 11,
    Fluid = 12,
    Door = 13,
    Deprecated = 14,
    Podium = 15,
}

impl ItemGroup {
    /// Map a raw kind byte back to the enum. Returns `None` for ids
    /// outside the current set so callers can preserve unknown forward-
    /// compatible values rather than silently demoting them to `None`.
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::None),
            1 => Some(Self::Ground),
            2 => Some(Self::Container),
            3 => Some(Self::Weapon),
            4 => Some(Self::Ammunition),
            5 => Some(Self::Armor),
            6 => Some(Self::Charges),
            7 => Some(Self::Teleport),
            8 => Some(Self::MagicField),
            9 => Some(Self::Writeable),
            10 => Some(Self::Key),
            11 => Some(Self::Splash),
            12 => Some(Self::Fluid),
            13 => Some(Self::Door),
            14 => Some(Self::Deprecated),
            15 => Some(Self::Podium),
            _ => Option::None,
        }
    }
}

/// 32-bit bitfield stored right after every item node's kind byte.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemFlags {
    pub block_solid: bool,
    pub block_projectile: bool,
    pub block_pathfind: bool,
    pub has_height: bool,
    pub useable: bool,
    pub pickupable: bool,
    pub movable: bool,
    pub stackable: bool,
    pub floor_change_down: bool,
    pub floor_change_north: bool,
    pub floor_change_east: bool,
    pub floor_change_south: bool,
    pub floor_change_west: bool,
    pub always_on_top: bool,
    pub readable: bool,
    pub rotatable: bool,
    pub hangable: bool,
    pub vertical: bool,
    pub horizontal: bool,
    pub cannot_decay: bool,
    pub allow_dist_read: bool,
    pub client_charges: bool,
    pub look_through: bool,
    pub animation: bool,
    pub full_tile: bool,
    pub force_use: bool,
}

impl ItemFlags {
    pub fn from_bits(bits: u32) -> Self {
        Self {
            block_solid: bits & 0x0000_0001 != 0,
            block_projectile: bits & 0x0000_0002 != 0,
            block_pathfind: bits & 0x0000_0004 != 0,
            has_height: bits & 0x0000_0008 != 0,
            useable: bits & 0x0000_0010 != 0,
            pickupable: bits & 0x0000_0020 != 0,
            movable: bits & 0x0000_0040 != 0,
            stackable: bits & 0x0000_0080 != 0,
            floor_change_down: bits & 0x0000_0100 != 0,
            floor_change_north: bits & 0x0000_0200 != 0,
            floor_change_east: bits & 0x0000_0400 != 0,
            floor_change_south: bits & 0x0000_0800 != 0,
            floor_change_west: bits & 0x0000_1000 != 0,
            always_on_top: bits & 0x0000_2000 != 0,
            readable: bits & 0x0000_4000 != 0,
            rotatable: bits & 0x0000_8000 != 0,
            hangable: bits & 0x0001_0000 != 0,
            vertical: bits & 0x0002_0000 != 0,
            horizontal: bits & 0x0004_0000 != 0,
            cannot_decay: bits & 0x0008_0000 != 0,
            allow_dist_read: bits & 0x0010_0000 != 0,
            client_charges: bits & 0x0040_0000 != 0,
            look_through: bits & 0x0080_0000 != 0,
            animation: bits & 0x0100_0000 != 0,
            full_tile: bits & 0x0200_0000 != 0,
            force_use: bits & 0x0400_0000 != 0,
        }
    }
}

/// Decoded payload of the 0x89 `EXPIREFLAGS` attribute.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExpireFlags {
    pub wearout: bool,
    pub clock_expire: bool,
    pub expire: bool,
    pub expire_stop: bool,
}

impl ExpireFlags {
    pub fn from_bits(bits: u8) -> Self {
        Self {
            wearout: bits & 0b0001 != 0,
            clock_expire: bits & 0b0010 != 0,
            expire: bits & 0b0100 != 0,
            expire_stop: bits & 0b1000 != 0,
        }
    }
}

/// A single item record. Every classic TFS attribute we currently
/// understand is exposed as an `Option<_>` so the absence of a byte on
/// disk is distinguishable from a default value. Atlas-extension fields
/// follow the same convention.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OtbItem {
    pub group: ItemGroup,
    pub flags: ItemFlags,

    // Classic TFS attributes (0x10..0x2F).
    pub server_id: Option<u16>,
    pub client_id: Option<u16>,
    pub name: Option<String>,
    pub speed: Option<u16>,

    // Atlas extensions (0x80..).
    pub weapon_type: Option<WeaponType>,
    pub minimum_level: Option<u32>,
    /// Vocations the item is restricted to. Unknown ids are dropped at
    /// parse time, mirroring the read-side honesty contract used by
    /// `atlas-appearances`. Empty means "no restriction".
    pub vocations: Vec<Vocation>,
    pub imbuement_slots: Option<u8>,
    pub gem_quality_id: Option<u16>,
    pub gem_vocation_id: Option<u16>,
    pub proficiency_id: Option<u16>,
    pub cyclopedia_type: Option<u16>,
    pub dual_wielding: Option<bool>,
    pub expire_flags: Option<ExpireFlags>,
    pub former_object_type_id: Option<u16>,
    pub hook_direction: Option<HookType>,
}
