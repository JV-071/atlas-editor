//! Parser and writer for Tibia 12+/15.x `appearances.dat` (Protocol Buffers).
//!
//! The on-disk format is a bare serialized `Appearances` protobuf message —
//! no header, no magic, no version prefix. The schema lives at
//! [`proto/appearances.proto`] and is compiled by `build.rs` at build time;
//! the generated Rust module is exposed below as [`proto`].
//!
//! Most callers want to work with [`Appearances`] (a neutral, serde-friendly
//! domain model) rather than the raw proto types. Use
//! [`Appearances::load_from_file`] for the disk path, [`Appearances::load_from_bytes`]
//! for buffers already in memory, or [`Appearances::from_proto`] when a decoded
//! proto value is already on hand (typical in tests).

#![forbid(unsafe_code)]

use std::path::Path;

use atlas_core::{AtlasError, Result};
use prost::Message;

pub mod model;

/// Generated protobuf types from `appearances.proto`.
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/atlas.protobuf.appearances.rs"));
}

pub use atlas_core::{AppearanceCategory, AssetId};
pub use model::{
    AppearanceFlags, AppearanceInfo, Appearances, AutomapInfo, BankInfo, ChangedToExpireInfo,
    ClothesInfo, CyclopediaInfo, DefaultActionInfo, HeightInfo, HookInfo, ImbueableInfo,
    LenshelpInfo, LightInfo, MarketInfo, NpcSaleInfo, ProficiencyInfo, ShiftInfo,
    SkillWheelGemInfo, SpecialMeaningIds, UpgradeClassificationInfo, WriteInfo, WriteOnceInfo,
};

impl Appearances {
    /// Read an `appearances.dat` file from disk and parse it.
    ///
    /// Returns [`AtlasError::Io`] on read failure and
    /// [`AtlasError::InvalidFormat`] if the bytes do not decode as a valid
    /// `Appearances` protobuf message.
    pub fn load_from_file(path: impl AsRef<Path>) -> Result<Self> {
        let bytes = std::fs::read(path.as_ref())?;
        Self::load_from_bytes(&bytes)
    }

    /// Parse an `appearances.dat` from an in-memory byte buffer.
    pub fn load_from_bytes(bytes: &[u8]) -> Result<Self> {
        let proto = proto::Appearances::decode(bytes)
            .map_err(|e| AtlasError::InvalidFormat(format!("protobuf decode: {e}")))?;
        Ok(Self::from_proto(proto))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_core::{AppearanceCategory, HookType, ItemCategory, Vocation, WeaponType};
    use prost::Message;

    fn make_appearance(id: u32, name: Option<&str>, sprite_ids: Vec<u32>) -> proto::Appearance {
        proto::Appearance {
            id: Some(id),
            frame_group: if sprite_ids.is_empty() {
                vec![]
            } else {
                vec![proto::FrameGroup {
                    fixed_frame_group: None,
                    id: Some(0),
                    sprite_info: Some(proto::SpriteInfo {
                        sprite_id: sprite_ids,
                        ..Default::default()
                    }),
                }]
            },
            flags: None,
            name: name.map(|s| s.as_bytes().to_vec()),
            description: None,
        }
    }

    fn richly_flagged_appearance(id: u32) -> proto::Appearance {
        proto::Appearance {
            id: Some(id),
            frame_group: vec![
                proto::FrameGroup {
                    sprite_info: Some(proto::SpriteInfo {
                        sprite_id: vec![10, 11, 12],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                proto::FrameGroup {
                    sprite_info: Some(proto::SpriteInfo {
                        sprite_id: vec![20, 21],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
            flags: Some(proto::AppearanceFlags {
                container: Some(true),
                take: Some(true),
                unpass: Some(true),
                light: Some(proto::AppearanceFlagLight {
                    brightness: Some(7),
                    color: Some(215),
                }),
                hook: Some(proto::AppearanceFlagHook {
                    direction: Some(proto::HookType::East as i32),
                }),
                market: Some(proto::AppearanceFlagMarket {
                    category: Some(proto::ItemCategory::Swords as i32),
                    trade_as_object_id: Some(1234),
                    show_as_object_id: Some(1234),
                }),
                restrict_to_vocation: vec![
                    proto::Vocation::Knight as i32,
                    proto::Vocation::Paladin as i32,
                ],
                minimum_level: Some(80),
                weapon_type: Some(proto::WeaponType::Sword as i32),
                imbueable: Some(proto::AppearanceFlagImbueable {
                    slot_count: Some(3),
                }),
                dual_wielding: Some(true),
                ammo: Some(false),
                ..Default::default()
            }),
            name: Some(b"sword of valor".to_vec()),
            description: Some(b"Glints in the morning light.".to_vec()),
        }
    }

    fn sample_proto() -> proto::Appearances {
        proto::Appearances {
            object: vec![
                make_appearance(100, Some("rope"), vec![1]),
                richly_flagged_appearance(101),
            ],
            outfit: vec![make_appearance(200, Some("citizen"), vec![5])],
            effect: vec![
                make_appearance(300, None, vec![]),
                make_appearance(301, None, vec![]),
                make_appearance(302, None, vec![]),
            ],
            missile: vec![make_appearance(400, None, vec![])],
            special_meaning_appearance_ids: Some(proto::SpecialMeaningAppearanceIds {
                gold_coin_id: Some(3031),
                platinum_coin_id: Some(3035),
                crystal_coin_id: Some(3043),
                tibia_coin_id: Some(24774),
                stamped_letter_id: Some(3505),
                supply_stash_id: Some(31298),
                standard_reward_chest_id: Some(31334),
                blank_imbuement_scroll_id: Some(31250),
            }),
        }
    }

    #[test]
    fn proto_compiles() {
        let _msg = proto::Appearances::default();
    }

    #[test]
    fn from_proto_maps_categories() {
        let result = Appearances::from_proto(sample_proto());
        assert_eq!(result.objects.len(), 2);
        assert_eq!(result.outfits.len(), 1);
        assert_eq!(result.effects.len(), 3);
        assert_eq!(result.missiles.len(), 1);

        assert_eq!(result.objects[0].id, AssetId(100));
        assert_eq!(result.objects[0].category, AppearanceCategory::Object);
        assert_eq!(result.outfits[0].category, AppearanceCategory::Outfit);
        assert_eq!(result.effects[0].category, AppearanceCategory::Effect);
        assert_eq!(result.missiles[0].category, AppearanceCategory::Missile);
    }

    #[test]
    fn from_proto_preserves_optional_fields() {
        let result = Appearances::from_proto(sample_proto());

        let rope = &result.objects[0];
        assert_eq!(rope.name.as_deref(), Some("rope"));
        assert_eq!(rope.description, None);
        assert!(!rope.flags.container);

        let sword = &result.objects[1];
        assert_eq!(sword.name.as_deref(), Some("sword of valor"));
        assert_eq!(
            sword.description.as_deref(),
            Some("Glints in the morning light.")
        );
        assert!(sword.flags.container);
        assert!(sword.flags.take);
        assert!(sword.flags.unpass);
        assert!(sword.flags.dual_wielding);
        assert!(!sword.flags.ammo);

        let light = sword.flags.light.expect("light should be set");
        assert_eq!(light.brightness, 7);
        assert_eq!(light.color, 215);

        let hook = sword.flags.hook.expect("hook should be set");
        assert_eq!(hook.direction, HookType::East);

        let market = sword.flags.market.as_ref().expect("market should be set");
        assert_eq!(market.category, Some(ItemCategory::Swords));
        assert_eq!(market.trade_as_object_id, Some(1234));

        assert_eq!(
            sword.flags.restrict_to_vocation,
            vec![Vocation::Knight, Vocation::Paladin]
        );
        assert_eq!(sword.flags.minimum_level, Some(80));
        assert_eq!(sword.flags.weapon_type, Some(WeaponType::Sword));
        assert_eq!(
            sword.flags.imbueable.map(|i| i.slot_count),
            Some(3),
            "imbueable slot_count should round-trip"
        );

        // Effects in the fixture have no name set.
        assert_eq!(result.effects[0].name, None);
    }

    #[test]
    fn from_proto_flattens_sprite_ids_in_order() {
        let result = Appearances::from_proto(sample_proto());
        assert_eq!(result.objects[1].sprite_ids, vec![10, 11, 12, 20, 21]);
    }

    #[test]
    fn from_proto_skips_frame_groups_with_no_sprite_info() {
        let appearance = proto::Appearance {
            id: Some(42),
            frame_group: vec![
                proto::FrameGroup {
                    sprite_info: None,
                    ..Default::default()
                },
                proto::FrameGroup {
                    sprite_info: Some(proto::SpriteInfo {
                        sprite_id: vec![7, 8],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let proto = proto::Appearances {
            object: vec![appearance],
            ..Default::default()
        };
        let result = Appearances::from_proto(proto);
        assert_eq!(result.objects[0].sprite_ids, vec![7, 8]);
    }

    #[test]
    fn from_proto_drops_unknown_vocation_ids_but_keeps_known() {
        // 99 is not a valid proto VOCATION id; it must be filtered out while
        // the known KNIGHT(1) survives. This guards Phase 1.1's read-side
        // honesty contract.
        let appearance = proto::Appearance {
            id: Some(1),
            flags: Some(proto::AppearanceFlags {
                restrict_to_vocation: vec![proto::Vocation::Knight as i32, 99],
                weapon_type: Some(99), // unknown weapon type id
                ..Default::default()
            }),
            ..Default::default()
        };
        let proto = proto::Appearances {
            object: vec![appearance],
            ..Default::default()
        };
        let result = Appearances::from_proto(proto);
        assert_eq!(
            result.objects[0].flags.restrict_to_vocation,
            vec![Vocation::Knight]
        );
        assert_eq!(result.objects[0].flags.weapon_type, None);
    }

    #[test]
    fn from_proto_maps_special_ids() {
        let result = Appearances::from_proto(sample_proto());
        let ids = result.special_ids;
        assert_eq!(ids.gold_coin, Some(AssetId(3031)));
        assert_eq!(ids.platinum_coin, Some(AssetId(3035)));
        assert_eq!(ids.crystal_coin, Some(AssetId(3043)));
        assert_eq!(ids.tibia_coin, Some(AssetId(24774)));
        assert_eq!(ids.stamped_letter, Some(AssetId(3505)));
        assert_eq!(ids.supply_stash, Some(AssetId(31298)));
        assert_eq!(ids.standard_reward_chest, Some(AssetId(31334)));
        assert_eq!(ids.blank_imbuement_scroll, Some(AssetId(31250)));
    }

    #[test]
    fn from_proto_handles_missing_special_ids() {
        let proto = proto::Appearances {
            special_meaning_appearance_ids: None,
            ..sample_proto()
        };
        let result = Appearances::from_proto(proto);
        assert_eq!(result.special_ids, SpecialMeaningIds::default());
    }

    #[test]
    fn load_from_bytes_round_trip() {
        let source = sample_proto();
        let bytes = source.encode_to_vec();

        let loaded = Appearances::load_from_bytes(&bytes).expect("decode should succeed");
        let expected = Appearances::from_proto(source);
        assert_eq!(loaded, expected);
    }

    #[test]
    fn load_from_file_round_trip() {
        use std::io::Write;

        let source = sample_proto();
        let bytes = source.encode_to_vec();

        let mut file = tempfile::NamedTempFile::new().expect("tempfile");
        file.write_all(&bytes).expect("write");

        let loaded =
            Appearances::load_from_file(file.path()).expect("loading from disk should succeed");
        let expected = Appearances::from_proto(source);
        assert_eq!(loaded, expected);
    }

    #[test]
    fn load_from_bytes_rejects_garbage() {
        let result = Appearances::load_from_bytes(&[0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
        match result {
            Err(AtlasError::InvalidFormat(msg)) => {
                assert!(
                    msg.contains("protobuf decode"),
                    "error message should mention protobuf, got: {msg}"
                );
            }
            other => panic!("expected InvalidFormat, got {other:?}"),
        }
    }

    /// Optional smoke test against a real `appearances.dat`. Skipped by default.
    /// Provide the file path via `ATLAS_APPEARANCES_DAT` and run with
    /// `cargo test -- --ignored` to opt in.
    #[test]
    #[ignore]
    fn load_real_appearances_dat() {
        let Ok(path) = std::env::var("ATLAS_APPEARANCES_DAT") else {
            eprintln!("set ATLAS_APPEARANCES_DAT to run this test");
            return;
        };
        let appearances =
            Appearances::load_from_file(&path).expect("real appearances.dat must parse");

        assert!(
            appearances.objects.len() > 1000,
            "expected >1000 objects, got {}",
            appearances.objects.len()
        );
        assert!(
            !appearances.outfits.is_empty(),
            "outfits list should not be empty"
        );
    }
}
