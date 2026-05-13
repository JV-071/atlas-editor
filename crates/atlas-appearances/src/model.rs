//! Neutral domain types for `appearances.dat` contents.
//!
//! These mirror the protobuf schema closely but drop the proto-specific
//! types in favor of plain Rust + serde. The `from_proto` constructor
//! preserves every flag field the schema defines today. Two known sources
//! of asymmetry, both intentional for the v0 reader-side UX:
//!
//! - `proto2` distinguishes "scalar absent" from "scalar present with the
//!   default value"; for nested scalar-Option fields (e.g. `bank.waypoints`)
//!   the model collapses both to `0`. The outer sub-message presence is
//!   still preserved through `Option<BankInfo>` etc.
//! - Frame groups are flattened into [`AppearanceInfo::sprite_ids`] in source
//!   order; the per-`FrameGroup` metadata (animation timings, bounding
//!   boxes, pattern dimensions) is not surfaced yet. Phase 4 (sprite
//!   rendering) and Phase 3 (round-trip save) will revisit this.

use atlas_core::{
    AppearanceCategory, AssetId, HookType, ItemCategory, PlayerAction, Vocation, WeaponType,
};
use serde::{Deserialize, Serialize};

use crate::proto;

/// Decode a name/description blob as written by the Tibia client. Real
/// files mix ASCII with Latin-1 (CP-1252) bytes, so a strict UTF-8 parse
/// would reject most non-English entries. Strategy: try UTF-8 first (the
/// common case for ASCII), and on failure fall back to Latin-1 — every
/// byte 0x00..=0xFF maps to the same Unicode code point, so the fallback
/// always succeeds without producing replacement characters.
fn decode_client_string(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => e.into_bytes().into_iter().map(char::from).collect(),
    }
}

/// Top-level neutral representation of an `appearances.dat` file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Appearances {
    pub objects: Vec<AppearanceInfo>,
    pub outfits: Vec<AppearanceInfo>,
    pub effects: Vec<AppearanceInfo>,
    pub missiles: Vec<AppearanceInfo>,
    pub special_ids: SpecialMeaningIds,
}

/// A single appearance entry — id, optional human-readable strings, all
/// flags, and a flat list of sprite ids gathered from every frame group in
/// source order.
///
/// The flattening of `frame_group` is lossy with respect to the original
/// proto: animation timings and bounding boxes are dropped. Phase 3
/// (round-trip save) will restore that data by either keeping the source
/// proto alongside the neutral view, or by extending the model.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppearanceInfo {
    pub id: AssetId,
    pub category: AppearanceCategory,
    pub name: Option<String>,
    pub description: Option<String>,
    pub flags: AppearanceFlags,
    pub sprite_ids: Vec<u32>,
}

/// Hard-coded protocol ids the client uses for currency, mail, supply stash, etc.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpecialMeaningIds {
    pub gold_coin: Option<AssetId>,
    pub platinum_coin: Option<AssetId>,
    pub crystal_coin: Option<AssetId>,
    pub tibia_coin: Option<AssetId>,
    pub stamped_letter: Option<AssetId>,
    pub supply_stash: Option<AssetId>,
    pub standard_reward_chest: Option<AssetId>,
    pub blank_imbuement_scroll: Option<AssetId>,
}

/// All appearance flags. Every field defined in the proto schema is
/// surfaced here. Note that unknown proto enum values (forward-compatible
/// ids not yet in our enums) are read as `None` for optional enum fields
/// and dropped from repeated enum fields — see the call sites in
/// `from_proto` for details.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppearanceFlags {
    pub bank: Option<BankInfo>,
    pub clip: bool,
    pub bottom: bool,
    pub top: bool,
    pub container: bool,
    pub cumulative: bool,
    pub usable: bool,
    pub forceuse: bool,
    pub multiuse: bool,
    pub write: Option<WriteInfo>,
    pub write_once: Option<WriteOnceInfo>,
    pub liquidpool: bool,
    pub unpass: bool,
    pub unmove: bool,
    pub unsight: bool,
    pub avoid: bool,
    pub no_movement_animation: bool,
    pub take: bool,
    pub liquidcontainer: bool,
    pub hang: bool,
    pub hook: Option<HookInfo>,
    pub rotate: bool,
    pub light: Option<LightInfo>,
    pub dont_hide: bool,
    pub translucent: bool,
    pub shift: Option<ShiftInfo>,
    pub height: Option<HeightInfo>,
    pub lying_object: bool,
    pub animate_always: bool,
    pub automap: Option<AutomapInfo>,
    pub lenshelp: Option<LenshelpInfo>,
    pub fullbank: bool,
    pub ignore_look: bool,
    pub clothes: Option<ClothesInfo>,
    pub default_action: Option<DefaultActionInfo>,
    pub market: Option<MarketInfo>,
    pub wrap: bool,
    pub unwrap: bool,
    pub topeffect: bool,
    pub npc_sale_data: Vec<NpcSaleInfo>,
    pub changed_to_expire: Option<ChangedToExpireInfo>,
    pub corpse: bool,
    pub player_corpse: bool,
    pub cyclopedia_item: Option<CyclopediaInfo>,
    pub ammo: bool,
    pub show_off_socket: bool,
    pub reportable: bool,
    pub upgrade_classification: Option<UpgradeClassificationInfo>,
    pub reverse_addons_east: bool,
    pub reverse_addons_west: bool,
    pub reverse_addons_south: bool,
    pub reverse_addons_north: bool,
    pub wearout: bool,
    pub clockexpire: bool,
    pub expire: bool,
    pub expirestop: bool,
    pub deco_item_kit: bool,
    pub skillwheel_gem: Option<SkillWheelGemInfo>,
    pub dual_wielding: bool,
    pub imbueable: Option<ImbueableInfo>,
    pub proficiency: Option<ProficiencyInfo>,
    pub restrict_to_vocation: Vec<Vocation>,
    pub minimum_level: Option<u32>,
    pub weapon_type: Option<WeaponType>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BankInfo {
    pub waypoints: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteInfo {
    pub max_text_length: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteOnceInfo {
    pub max_text_length_once: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LightInfo {
    pub brightness: u32,
    pub color: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShiftInfo {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeightInfo {
    pub elevation: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutomapInfo {
    pub color: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LenshelpInfo {
    pub id: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClothesInfo {
    pub slot: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DefaultActionInfo {
    /// `None` when the proto submessage was present but its action id was
    /// either absent or an unknown forward-compatible value.
    pub action: Option<PlayerAction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookInfo {
    pub direction: HookType,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketInfo {
    pub category: Option<ItemCategory>,
    pub trade_as_object_id: Option<u32>,
    pub show_as_object_id: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NpcSaleInfo {
    pub name: Option<String>,
    pub location: Option<String>,
    pub sale_price: Option<u32>,
    pub buy_price: Option<u32>,
    pub currency_object_type_id: Option<u32>,
    pub currency_quest_flag_display_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedToExpireInfo {
    pub former_object_typeid: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CyclopediaInfo {
    pub cyclopedia_type: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpgradeClassificationInfo {
    pub upgrade_classification: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillWheelGemInfo {
    pub gem_quality_id: Option<u32>,
    pub vocation_id: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImbueableInfo {
    pub slot_count: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProficiencyInfo {
    pub proficiency_id: u32,
}

impl Appearances {
    /// Build a neutral `Appearances` from a decoded proto message.
    pub fn from_proto(proto: proto::Appearances) -> Self {
        Self {
            objects: convert_category(proto.object, AppearanceCategory::Object),
            outfits: convert_category(proto.outfit, AppearanceCategory::Outfit),
            effects: convert_category(proto.effect, AppearanceCategory::Effect),
            missiles: convert_category(proto.missile, AppearanceCategory::Missile),
            special_ids: proto
                .special_meaning_appearance_ids
                .map(SpecialMeaningIds::from_proto)
                .unwrap_or_default(),
        }
    }
}

fn convert_category(
    entries: Vec<proto::Appearance>,
    category: AppearanceCategory,
) -> Vec<AppearanceInfo> {
    entries
        .into_iter()
        .map(|a| appearance_from_proto(a, category))
        .collect()
}

fn appearance_from_proto(a: proto::Appearance, category: AppearanceCategory) -> AppearanceInfo {
    let sprite_ids: Vec<u32> = a
        .frame_group
        .into_iter()
        .filter_map(|fg| fg.sprite_info)
        .flat_map(|si| si.sprite_id)
        .collect();

    AppearanceInfo {
        id: AssetId(a.id.unwrap_or(0)),
        category,
        name: a.name.map(decode_client_string),
        description: a.description.map(decode_client_string),
        flags: a.flags.map(AppearanceFlags::from_proto).unwrap_or_default(),
        sprite_ids,
    }
}

impl SpecialMeaningIds {
    fn from_proto(p: proto::SpecialMeaningAppearanceIds) -> Self {
        Self {
            gold_coin: p.gold_coin_id.map(AssetId),
            platinum_coin: p.platinum_coin_id.map(AssetId),
            crystal_coin: p.crystal_coin_id.map(AssetId),
            tibia_coin: p.tibia_coin_id.map(AssetId),
            stamped_letter: p.stamped_letter_id.map(AssetId),
            supply_stash: p.supply_stash_id.map(AssetId),
            standard_reward_chest: p.standard_reward_chest_id.map(AssetId),
            blank_imbuement_scroll: p.blank_imbuement_scroll_id.map(AssetId),
        }
    }
}

impl AppearanceFlags {
    fn from_proto(p: proto::AppearanceFlags) -> Self {
        Self {
            bank: p.bank.map(|b| BankInfo {
                waypoints: b.waypoints.unwrap_or(0),
            }),
            clip: p.clip.unwrap_or(false),
            bottom: p.bottom.unwrap_or(false),
            top: p.top.unwrap_or(false),
            container: p.container.unwrap_or(false),
            cumulative: p.cumulative.unwrap_or(false),
            usable: p.usable.unwrap_or(false),
            forceuse: p.forceuse.unwrap_or(false),
            multiuse: p.multiuse.unwrap_or(false),
            write: p.write.map(|w| WriteInfo {
                max_text_length: w.max_text_length.unwrap_or(0),
            }),
            write_once: p.write_once.map(|w| WriteOnceInfo {
                max_text_length_once: w.max_text_length_once.unwrap_or(0),
            }),
            liquidpool: p.liquidpool.unwrap_or(false),
            unpass: p.unpass.unwrap_or(false),
            unmove: p.unmove.unwrap_or(false),
            unsight: p.unsight.unwrap_or(false),
            avoid: p.avoid.unwrap_or(false),
            no_movement_animation: p.no_movement_animation.unwrap_or(false),
            take: p.take.unwrap_or(false),
            liquidcontainer: p.liquidcontainer.unwrap_or(false),
            hang: p.hang.unwrap_or(false),
            hook: p
                .hook
                .and_then(|h| h.direction.and_then(HookType::from_i32))
                .map(|direction| HookInfo { direction }),
            rotate: p.rotate.unwrap_or(false),
            light: p.light.map(|l| LightInfo {
                brightness: l.brightness.unwrap_or(0),
                color: l.color.unwrap_or(0),
            }),
            dont_hide: p.dont_hide.unwrap_or(false),
            translucent: p.translucent.unwrap_or(false),
            shift: p.shift.map(|s| ShiftInfo {
                x: s.x.unwrap_or(0),
                y: s.y.unwrap_or(0),
            }),
            height: p.height.map(|h| HeightInfo {
                elevation: h.elevation.unwrap_or(0),
            }),
            lying_object: p.lying_object.unwrap_or(false),
            animate_always: p.animate_always.unwrap_or(false),
            automap: p.automap.map(|a| AutomapInfo {
                color: a.color.unwrap_or(0),
            }),
            lenshelp: p.lenshelp.map(|l| LenshelpInfo {
                id: l.id.unwrap_or(0),
            }),
            fullbank: p.fullbank.unwrap_or(false),
            ignore_look: p.ignore_look.unwrap_or(false),
            clothes: p.clothes.map(|c| ClothesInfo {
                slot: c.slot.unwrap_or(0),
            }),
            default_action: p.default_action.map(|d| DefaultActionInfo {
                action: d.action.and_then(PlayerAction::from_i32),
            }),
            market: p.market.map(|m| MarketInfo {
                category: m.category.and_then(ItemCategory::from_i32),
                trade_as_object_id: m.trade_as_object_id,
                show_as_object_id: m.show_as_object_id,
            }),
            wrap: p.wrap.unwrap_or(false),
            unwrap: p.unwrap.unwrap_or(false),
            topeffect: p.topeffect.unwrap_or(false),
            npc_sale_data: p
                .npcsaledata
                .into_iter()
                .map(|n| NpcSaleInfo {
                    name: n.name.map(decode_client_string),
                    location: n.location.map(decode_client_string),
                    sale_price: n.sale_price,
                    buy_price: n.buy_price,
                    currency_object_type_id: n.currency_object_type_id,
                    currency_quest_flag_display_name: n
                        .currency_quest_flag_display_name
                        .map(decode_client_string),
                })
                .collect(),
            changed_to_expire: p.changedtoexpire.map(|c| ChangedToExpireInfo {
                former_object_typeid: c.former_object_typeid.unwrap_or(0),
            }),
            corpse: p.corpse.unwrap_or(false),
            player_corpse: p.player_corpse.unwrap_or(false),
            cyclopedia_item: p.cyclopediaitem.map(|c| CyclopediaInfo {
                cyclopedia_type: c.cyclopedia_type.unwrap_or(0),
            }),
            ammo: p.ammo.unwrap_or(false),
            show_off_socket: p.show_off_socket.unwrap_or(false),
            reportable: p.reportable.unwrap_or(false),
            upgrade_classification: p.upgradeclassification.map(|u| UpgradeClassificationInfo {
                upgrade_classification: u.upgrade_classification.unwrap_or(0),
            }),
            reverse_addons_east: p.reverse_addons_east.unwrap_or(false),
            reverse_addons_west: p.reverse_addons_west.unwrap_or(false),
            reverse_addons_south: p.reverse_addons_south.unwrap_or(false),
            reverse_addons_north: p.reverse_addons_north.unwrap_or(false),
            wearout: p.wearout.unwrap_or(false),
            clockexpire: p.clockexpire.unwrap_or(false),
            expire: p.expire.unwrap_or(false),
            expirestop: p.expirestop.unwrap_or(false),
            deco_item_kit: p.deco_item_kit.unwrap_or(false),
            skillwheel_gem: p.skillwheel_gem.map(|s| SkillWheelGemInfo {
                gem_quality_id: s.gem_quality_id,
                vocation_id: s.vocation_id,
            }),
            dual_wielding: p.dual_wielding.unwrap_or(false),
            imbueable: p.imbueable.map(|i| ImbueableInfo {
                slot_count: i.slot_count.unwrap_or(0),
            }),
            proficiency: p.proficiency.map(|pr| ProficiencyInfo {
                proficiency_id: pr.proficiency_id.unwrap_or(0),
            }),
            // Unknown vocation ids are dropped here. Today every value is
            // known; if the client adds new ones we will need to upgrade
            // `Vocation` (and consider preserving the raw `i32` for
            // round-trip on save).
            restrict_to_vocation: p
                .restrict_to_vocation
                .into_iter()
                .filter_map(Vocation::from_i32)
                .collect(),
            minimum_level: p.minimum_level,
            weapon_type: p.weapon_type.and_then(WeaponType::from_i32),
        }
    }
}
