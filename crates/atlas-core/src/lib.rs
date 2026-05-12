//! Shared types and utilities used across the Atlas Assets Editor crates.
//!
//! This crate holds neutral domain types (item identifiers, weapon enums,
//! vocation enums, etc.) that both `atlas-appearances` and `atlas-otb` map
//! to and from their native formats.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors that can occur in any Atlas Assets Editor crate.
#[derive(Debug, Error)]
pub enum AtlasError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid format: {0}")]
    InvalidFormat(String),

    #[error("unsupported version: {0}")]
    UnsupportedVersion(String),
}

pub type Result<T> = std::result::Result<T, AtlasError>;

/// Stable identifier for an item, sprite, outfit, effect or missile.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AssetId(pub u32);

impl std::fmt::Display for AssetId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Logical category of an appearance entry in `appearances.dat`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppearanceCategory {
    #[default]
    Object,
    Outfit,
    Effect,
    Missile,
}

/// Player vocation. Values mirror the protobuf `VOCATION` enum so callers can
/// round-trip without renumbering.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Vocation {
    Any = -1,
    #[default]
    None = 0,
    Knight = 1,
    Paladin = 2,
    Sorcerer = 3,
    Druid = 4,
    Monk = 5,
    Promoted = 10,
}

impl Vocation {
    /// Map a raw proto-encoded vocation id back to the enum. Returns `None`
    /// for ids that are not part of the current enum so callers can detect
    /// and preserve forward-compatible values rather than silently demoting
    /// them to a fixed default.
    pub fn from_i32(value: i32) -> Option<Self> {
        match value {
            -1 => Some(Self::Any),
            0 => Some(Self::None),
            1 => Some(Self::Knight),
            2 => Some(Self::Paladin),
            3 => Some(Self::Sorcerer),
            4 => Some(Self::Druid),
            5 => Some(Self::Monk),
            10 => Some(Self::Promoted),
            _ => None,
        }
    }
}

/// Weapon type. Mirrors protobuf `WEAPON_TYPE`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum WeaponType {
    #[default]
    NoWeapon = 0,
    Sword = 1,
    Axe = 2,
    Club = 3,
    Fist = 4,
    Bow = 5,
    Crossbow = 6,
    WandRod = 7,
    Throw = 8,
}

impl WeaponType {
    /// Map a raw proto-encoded id back to the enum. Returns `None` for ids
    /// outside the current enum so callers can preserve unknown values
    /// rather than silently collapsing them to `NoWeapon`.
    pub fn from_i32(value: i32) -> Option<Self> {
        match value {
            0 => Some(Self::NoWeapon),
            1 => Some(Self::Sword),
            2 => Some(Self::Axe),
            3 => Some(Self::Club),
            4 => Some(Self::Fist),
            5 => Some(Self::Bow),
            6 => Some(Self::Crossbow),
            7 => Some(Self::WandRod),
            8 => Some(Self::Throw),
            _ => None,
        }
    }
}

/// Wall-hook direction. Mirrors protobuf `HOOK_TYPE`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum HookType {
    South = 1,
    East = 2,
}

impl HookType {
    pub fn from_i32(value: i32) -> Option<Self> {
        match value {
            1 => Some(Self::South),
            2 => Some(Self::East),
            _ => None,
        }
    }
}

/// Market category. Mirrors protobuf `ITEM_CATEGORY`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum ItemCategory {
    Armors = 1,
    Amulets = 2,
    Boots = 3,
    Containers = 4,
    Decoration = 5,
    Food = 6,
    HelmetsHats = 7,
    Legs = 8,
    Others = 9,
    Potions = 10,
    Rings = 11,
    Runes = 12,
    Shields = 13,
    Tools = 14,
    Valuables = 15,
    Ammunition = 16,
    Axes = 17,
    Clubs = 18,
    DistanceWeapons = 19,
    Swords = 20,
    WandsRods = 21,
    PremiumScrolls = 22,
    TibiaCoins = 23,
    CreatureProducts = 24,
    Quiver = 25,
    SoulCores = 26,
    FistWeapons = 27,
}

impl ItemCategory {
    pub fn from_i32(value: i32) -> Option<Self> {
        match value {
            1 => Some(Self::Armors),
            2 => Some(Self::Amulets),
            3 => Some(Self::Boots),
            4 => Some(Self::Containers),
            5 => Some(Self::Decoration),
            6 => Some(Self::Food),
            7 => Some(Self::HelmetsHats),
            8 => Some(Self::Legs),
            9 => Some(Self::Others),
            10 => Some(Self::Potions),
            11 => Some(Self::Rings),
            12 => Some(Self::Runes),
            13 => Some(Self::Shields),
            14 => Some(Self::Tools),
            15 => Some(Self::Valuables),
            16 => Some(Self::Ammunition),
            17 => Some(Self::Axes),
            18 => Some(Self::Clubs),
            19 => Some(Self::DistanceWeapons),
            20 => Some(Self::Swords),
            21 => Some(Self::WandsRods),
            22 => Some(Self::PremiumScrolls),
            23 => Some(Self::TibiaCoins),
            24 => Some(Self::CreatureProducts),
            25 => Some(Self::Quiver),
            26 => Some(Self::SoulCores),
            27 => Some(Self::FistWeapons),
            _ => None,
        }
    }
}

/// Sprite animation loop policy. Mirrors protobuf `ANIMATION_LOOP_TYPE`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum AnimationLoopType {
    PingPong = -1,
    #[default]
    Infinite = 0,
    Counted = 1,
}

impl AnimationLoopType {
    pub fn from_i32(value: i32) -> Self {
        match value {
            -1 => Self::PingPong,
            1 => Self::Counted,
            _ => Self::Infinite,
        }
    }
}

/// Default action when a player clicks an appearance. Mirrors protobuf `PLAYER_ACTION`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum PlayerAction {
    #[default]
    None = 0,
    Look = 1,
    Use = 2,
    Open = 3,
    AutowalkHighlight = 4,
}

impl PlayerAction {
    /// Map a raw proto-encoded id back to the enum. Returns `None` for ids
    /// outside the current enum so callers can preserve unknown values
    /// rather than silently collapsing them to `None`.
    pub fn from_i32(value: i32) -> Option<Self> {
        match value {
            0 => Some(Self::None),
            1 => Some(Self::Look),
            2 => Some(Self::Use),
            3 => Some(Self::Open),
            4 => Some(Self::AutowalkHighlight),
            _ => Option::None,
        }
    }
}
