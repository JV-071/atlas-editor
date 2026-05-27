//! Neutral domain types for `appearances.dat` contents.
//!
//! These mirror the protobuf schema closely but drop the proto-specific
//! types in favor of plain Rust + serde. The `from_proto` constructor
//! preserves every flag field the schema defines today. One known source
//! of asymmetry, intentional for the v0 reader-side UX:
//!
//! - `proto2` distinguishes "scalar absent" from "scalar present with the
//!   default value"; for nested scalar-Option fields (e.g. `bank.waypoints`)
//!   the model collapses both to `0`. The outer sub-message presence is
//!   still preserved through `Option<BankInfo>` etc.
//!
//! Frame groups, including pattern dimensions and animation timings, are
//! preserved through [`AppearanceInfo::frame_groups`]; [`AppearanceInfo::sprite_ids`]
//! is a flattened convenience view computed from them in source order.

use atlas_core::{
    AnimationLoopType, AppearanceCategory, AssetId, HookType, ItemCategory, PlayerAction, Vocation,
    WeaponType,
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
#[serde(rename_all = "camelCase")]
pub struct Appearances {
    pub objects: Vec<AppearanceInfo>,
    pub outfits: Vec<AppearanceInfo>,
    pub effects: Vec<AppearanceInfo>,
    pub missiles: Vec<AppearanceInfo>,
    pub special_ids: SpecialMeaningIds,
}

/// A single appearance entry — id, optional human-readable strings, all
/// flags, the structured frame groups carrying sprite layout + animation
/// data, plus a flat convenience view of every sprite id in source order.
///
/// `sprite_ids` is derived from `frame_groups` and only kept on the model
/// so existing callers that just want a list of ids (the Sprites tab,
/// debug dumps) don't have to walk the frame group tree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceInfo {
    pub id: AssetId,
    pub category: AppearanceCategory,
    pub name: Option<String>,
    pub description: Option<String>,
    pub flags: AppearanceFlags,
    pub frame_groups: Vec<FrameGroupInfo>,
    pub sprite_ids: Vec<u32>,
}

/// One `FrameGroup` from the proto. The pair `(fixed_frame_group, id)` is
/// the proto's way of identifying which animation state this group describes
/// (e.g. outfit idle vs moving). `sprite_info` is `None` only for the
/// degenerate proto frame groups that carry no sprite payload at all.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameGroupInfo {
    pub fixed_frame_group: Option<FixedFrameGroup>,
    pub id: Option<u32>,
    pub sprite_info: Option<SpriteInfoData>,
}

/// Which animation state a frame group describes. Mirrors proto
/// `FIXED_FRAME_GROUP`. Object appearances typically use a single
/// `ObjectInitial` group; outfits use `OutfitIdle` + `OutfitMoving`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum FixedFrameGroup {
    OutfitIdle = 0,
    OutfitMoving = 1,
    ObjectInitial = 2,
}

impl FixedFrameGroup {
    pub fn from_i32(value: i32) -> Option<Self> {
        match value {
            0 => Some(Self::OutfitIdle),
            1 => Some(Self::OutfitMoving),
            2 => Some(Self::ObjectInitial),
            _ => None,
        }
    }
}

/// Payload of a single `SpriteInfo`. Pattern dimensions are stored as
/// `Option<u32>` to preserve the proto's "absent vs. present" distinction
/// — `None` is the implicit-default-of-one case (see [`SpriteInfoData::effective_pattern_width`]
/// and friends for the resolved values).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteInfoData {
    pub pattern_width: Option<u32>,
    pub pattern_height: Option<u32>,
    pub pattern_depth: Option<u32>,
    pub layers: Option<u32>,
    pub sprite_ids: Vec<u32>,
    pub animation: Option<SpriteAnimationData>,
    pub bounding_square: Option<u32>,
    pub is_opaque: Option<bool>,
    pub bounding_box_per_direction: Vec<BoundingBox>,
    /// Tibia 14+ pattern fields. Newer bundles ship a flattened
    /// representation alongside (or instead of) the older
    /// `pattern_width`/`pattern_height`/`pattern_depth`/`layers`+`animation`
    /// quintet. The client tolerates both shapes; preserve them on
    /// round-trip so saved files keep working across client versions.
    pub pattern_size: Option<u32>,
    pub pattern_layers: Option<u32>,
    pub pattern_x: Option<u32>,
    pub pattern_y: Option<u32>,
    pub pattern_z: Option<u32>,
    pub pattern_frames: Option<u32>,
    pub is_animation: Option<bool>,
}

impl SpriteInfoData {
    pub fn effective_pattern_width(&self) -> u32 {
        self.pattern_width.unwrap_or(1).max(1)
    }
    pub fn effective_pattern_height(&self) -> u32 {
        self.pattern_height.unwrap_or(1).max(1)
    }
    pub fn effective_pattern_depth(&self) -> u32 {
        self.pattern_depth.unwrap_or(1).max(1)
    }
    pub fn effective_layers(&self) -> u32 {
        self.layers.unwrap_or(1).max(1)
    }
    /// Number of animation phases (>= 1). A `SpriteInfo` without an
    /// animation block is treated as a single phase.
    pub fn phase_count(&self) -> u32 {
        self.animation
            .as_ref()
            .map(|a| a.sprite_phases.len().max(1) as u32)
            .unwrap_or(1)
    }

    /// Index into [`Self::sprite_ids`] for a given (phase, z, y, x, layer).
    /// Returns `None` when any coordinate is out of bounds or the flat list
    /// doesn't have enough entries (malformed input).
    ///
    /// Iteration order matches the proto producer convention used by Tibia
    /// 12+ clients: outermost `phase`, then `z`, `y`, `x`, innermost `layer`.
    pub fn sprite_index(&self, phase: u32, z: u32, y: u32, x: u32, layer: u32) -> Option<usize> {
        let pw = self.effective_pattern_width();
        let ph = self.effective_pattern_height();
        let pd = self.effective_pattern_depth();
        let layers = self.effective_layers();
        if x >= pw || y >= ph || z >= pd || layer >= layers || phase >= self.phase_count() {
            return None;
        }
        let idx = ((((phase * pd + z) * ph + y) * pw + x) * layers + layer) as usize;
        if idx >= self.sprite_ids.len() {
            return None;
        }
        Some(idx)
    }

    pub fn sprite_at(&self, phase: u32, z: u32, y: u32, x: u32, layer: u32) -> Option<u32> {
        self.sprite_index(phase, z, y, x, layer)
            .map(|i| self.sprite_ids[i])
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteAnimationData {
    pub default_start_phase: Option<u32>,
    pub synchronized: Option<bool>,
    pub random_start_phase: Option<bool>,
    pub loop_type: Option<AnimationLoopType>,
    pub loop_count: Option<u32>,
    pub sprite_phases: Vec<SpritePhase>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpritePhase {
    pub duration_min: Option<u32>,
    pub duration_max: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundingBox {
    pub x: Option<u32>,
    pub y: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Hard-coded protocol ids the client uses for currency, mail, supply stash, etc.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct BankInfo {
    pub waypoints: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteInfo {
    pub max_text_length: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOnceInfo {
    pub max_text_length_once: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightInfo {
    pub brightness: u32,
    pub color: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftInfo {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeightInfo {
    pub elevation: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomapInfo {
    pub color: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LenshelpInfo {
    pub id: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClothesInfo {
    pub slot: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultActionInfo {
    /// `None` when the proto submessage was present but its action id was
    /// either absent or an unknown forward-compatible value.
    pub action: Option<PlayerAction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookInfo {
    pub direction: HookType,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketInfo {
    pub category: Option<ItemCategory>,
    pub trade_as_object_id: Option<u32>,
    pub show_as_object_id: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcSaleInfo {
    pub name: Option<String>,
    pub location: Option<String>,
    pub sale_price: Option<u32>,
    pub buy_price: Option<u32>,
    pub currency_object_type_id: Option<u32>,
    pub currency_quest_flag_display_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedToExpireInfo {
    pub former_object_typeid: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CyclopediaInfo {
    pub cyclopedia_type: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeClassificationInfo {
    pub upgrade_classification: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillWheelGemInfo {
    pub gem_quality_id: Option<u32>,
    pub vocation_id: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImbueableInfo {
    pub slot_count: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

    /// Re-emit the neutral model as a proto message. Frame-group
    /// structure (pattern dimensions, animation timings, bounding boxes)
    /// is preserved end-to-end through [`AppearanceInfo::frame_groups`].
    /// As a fallback for legacy paths that only populate `sprite_ids`
    /// (e.g. brand-new appearances created in the UI), the writer
    /// collapses that flat list into a single anonymous frame group.
    pub fn to_proto(&self) -> proto::Appearances {
        proto::Appearances {
            object: self.objects.iter().map(appearance_to_proto).collect(),
            outfit: self.outfits.iter().map(appearance_to_proto).collect(),
            effect: self.effects.iter().map(appearance_to_proto).collect(),
            missile: self.missiles.iter().map(appearance_to_proto).collect(),
            special_meaning_appearance_ids: Some(self.special_ids.to_proto()),
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
    let frame_groups: Vec<FrameGroupInfo> = a
        .frame_group
        .into_iter()
        .map(frame_group_from_proto)
        .collect();
    let sprite_ids: Vec<u32> = frame_groups
        .iter()
        .filter_map(|fg| fg.sprite_info.as_ref())
        .flat_map(|si| si.sprite_ids.iter().copied())
        .collect();

    AppearanceInfo {
        id: AssetId(a.id.unwrap_or(0)),
        category,
        name: a.name.map(decode_client_string),
        description: a.description.map(decode_client_string),
        flags: a.flags.map(AppearanceFlags::from_proto).unwrap_or_default(),
        frame_groups,
        sprite_ids,
    }
}

fn frame_group_from_proto(fg: proto::FrameGroup) -> FrameGroupInfo {
    FrameGroupInfo {
        fixed_frame_group: fg.fixed_frame_group.and_then(FixedFrameGroup::from_i32),
        id: fg.id,
        sprite_info: fg.sprite_info.map(sprite_info_from_proto),
    }
}

fn sprite_info_from_proto(si: proto::SpriteInfo) -> SpriteInfoData {
    SpriteInfoData {
        pattern_width: si.pattern_width,
        pattern_height: si.pattern_height,
        pattern_depth: si.pattern_depth,
        layers: si.layers,
        sprite_ids: si.sprite_id,
        animation: si.animation.map(sprite_animation_from_proto),
        bounding_square: si.bounding_square,
        is_opaque: si.is_opaque,
        bounding_box_per_direction: si
            .bounding_box_per_direction
            .into_iter()
            .map(|b| BoundingBox {
                x: b.x,
                y: b.y,
                width: b.width,
                height: b.height,
            })
            .collect(),
        pattern_size: si.pattern_size,
        pattern_layers: si.pattern_layers,
        pattern_x: si.pattern_x,
        pattern_y: si.pattern_y,
        pattern_z: si.pattern_z,
        pattern_frames: si.pattern_frames,
        is_animation: si.is_animation,
    }
}

fn sprite_animation_from_proto(a: proto::SpriteAnimation) -> SpriteAnimationData {
    SpriteAnimationData {
        default_start_phase: a.default_start_phase,
        synchronized: a.synchronized,
        random_start_phase: a.random_start_phase,
        loop_type: a.loop_type.map(AnimationLoopType::from_i32),
        loop_count: a.loop_count,
        sprite_phases: a
            .sprite_phase
            .into_iter()
            .map(|p| SpritePhase {
                duration_min: p.duration_min,
                duration_max: p.duration_max,
            })
            .collect(),
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

    fn to_proto(&self) -> proto::AppearanceFlags {
        proto::AppearanceFlags {
            bank: self.bank.map(|b| proto::AppearanceFlagBank {
                waypoints: Some(b.waypoints),
            }),
            clip: opt_bool(self.clip),
            bottom: opt_bool(self.bottom),
            top: opt_bool(self.top),
            container: opt_bool(self.container),
            cumulative: opt_bool(self.cumulative),
            usable: opt_bool(self.usable),
            forceuse: opt_bool(self.forceuse),
            multiuse: opt_bool(self.multiuse),
            write: self.write.map(|w| proto::AppearanceFlagWrite {
                max_text_length: Some(w.max_text_length),
            }),
            write_once: self.write_once.map(|w| proto::AppearanceFlagWriteOnce {
                max_text_length_once: Some(w.max_text_length_once),
            }),
            liquidpool: opt_bool(self.liquidpool),
            unpass: opt_bool(self.unpass),
            unmove: opt_bool(self.unmove),
            unsight: opt_bool(self.unsight),
            avoid: opt_bool(self.avoid),
            no_movement_animation: opt_bool(self.no_movement_animation),
            take: opt_bool(self.take),
            liquidcontainer: opt_bool(self.liquidcontainer),
            hang: opt_bool(self.hang),
            hook: self.hook.map(|h| proto::AppearanceFlagHook {
                direction: Some(h.direction as i32),
            }),
            rotate: opt_bool(self.rotate),
            light: self.light.map(|l| proto::AppearanceFlagLight {
                brightness: Some(l.brightness),
                color: Some(l.color),
            }),
            dont_hide: opt_bool(self.dont_hide),
            translucent: opt_bool(self.translucent),
            shift: self.shift.map(|s| proto::AppearanceFlagShift {
                x: Some(s.x),
                y: Some(s.y),
            }),
            height: self.height.map(|h| proto::AppearanceFlagHeight {
                elevation: Some(h.elevation),
            }),
            lying_object: opt_bool(self.lying_object),
            animate_always: opt_bool(self.animate_always),
            automap: self.automap.map(|a| proto::AppearanceFlagAutomap {
                color: Some(a.color),
            }),
            lenshelp: self
                .lenshelp
                .map(|l| proto::AppearanceFlagLenshelp { id: Some(l.id) }),
            fullbank: opt_bool(self.fullbank),
            ignore_look: opt_bool(self.ignore_look),
            clothes: self
                .clothes
                .map(|c| proto::AppearanceFlagClothes { slot: Some(c.slot) }),
            default_action: self
                .default_action
                .map(|d| proto::AppearanceFlagDefaultAction {
                    action: d.action.map(|a| a as i32),
                }),
            market: self.market.as_ref().map(|m| proto::AppearanceFlagMarket {
                category: m.category.map(|c| c as i32),
                trade_as_object_id: m.trade_as_object_id,
                show_as_object_id: m.show_as_object_id,
            }),
            wrap: opt_bool(self.wrap),
            unwrap: opt_bool(self.unwrap),
            topeffect: opt_bool(self.topeffect),
            npcsaledata: self
                .npc_sale_data
                .iter()
                .map(|n| proto::AppearanceFlagNpc {
                    name: n.name.as_ref().map(|s| s.as_bytes().to_vec()),
                    location: n.location.as_ref().map(|s| s.as_bytes().to_vec()),
                    sale_price: n.sale_price,
                    buy_price: n.buy_price,
                    currency_object_type_id: n.currency_object_type_id,
                    currency_quest_flag_display_name: n
                        .currency_quest_flag_display_name
                        .as_ref()
                        .map(|s| s.as_bytes().to_vec()),
                })
                .collect(),
            changedtoexpire: self
                .changed_to_expire
                .map(|c| proto::AppearanceFlagChangedToExpire {
                    former_object_typeid: Some(c.former_object_typeid),
                }),
            corpse: opt_bool(self.corpse),
            player_corpse: opt_bool(self.player_corpse),
            cyclopediaitem: self
                .cyclopedia_item
                .map(|c| proto::AppearanceFlagCyclopedia {
                    cyclopedia_type: Some(c.cyclopedia_type),
                }),
            ammo: opt_bool(self.ammo),
            show_off_socket: opt_bool(self.show_off_socket),
            reportable: opt_bool(self.reportable),
            upgradeclassification: self.upgrade_classification.map(|u| {
                proto::AppearanceFlagUpgradeClassification {
                    upgrade_classification: Some(u.upgrade_classification),
                }
            }),
            reverse_addons_east: opt_bool(self.reverse_addons_east),
            reverse_addons_west: opt_bool(self.reverse_addons_west),
            reverse_addons_south: opt_bool(self.reverse_addons_south),
            reverse_addons_north: opt_bool(self.reverse_addons_north),
            wearout: opt_bool(self.wearout),
            clockexpire: opt_bool(self.clockexpire),
            expire: opt_bool(self.expire),
            expirestop: opt_bool(self.expirestop),
            deco_item_kit: opt_bool(self.deco_item_kit),
            skillwheel_gem: self
                .skillwheel_gem
                .map(|s| proto::AppearanceFlagSkillWheelGem {
                    gem_quality_id: s.gem_quality_id,
                    vocation_id: s.vocation_id,
                }),
            dual_wielding: opt_bool(self.dual_wielding),
            imbueable: self.imbueable.map(|i| proto::AppearanceFlagImbueable {
                slot_count: Some(i.slot_count),
            }),
            proficiency: self.proficiency.map(|p| proto::AppearanceFlagProficiency {
                proficiency_id: Some(p.proficiency_id),
            }),
            restrict_to_vocation: self
                .restrict_to_vocation
                .iter()
                .map(|v| *v as i32)
                .collect(),
            minimum_level: self.minimum_level,
            weapon_type: self.weapon_type.map(|w| w as i32),
        }
    }
}

/// Serialize bools that default to `false` as `None` rather than
/// `Some(false)`. Mirrors the from_proto path which collapses both to
/// `false` in the model — keeping bytes round-trip-equal across the
/// default case is impossible since the model lost that distinction.
fn opt_bool(b: bool) -> Option<bool> {
    if b {
        Some(true)
    } else {
        None
    }
}

fn appearance_to_proto(a: &AppearanceInfo) -> proto::Appearance {
    let frame_group = if !a.frame_groups.is_empty() {
        a.frame_groups.iter().map(frame_group_to_proto).collect()
    } else if a.sprite_ids.is_empty() {
        // No structure, no flat list — emit no frame groups at all so the
        // round-trip preserves the empty case.
        vec![]
    } else {
        // Legacy fallback: callers that only filled the flat `sprite_ids`
        // (brand-new appearances) get one anonymous frame group with no
        // pattern dimensions, mirroring the pre-frame-group writer.
        vec![proto::FrameGroup {
            fixed_frame_group: None,
            id: Some(0),
            sprite_info: Some(proto::SpriteInfo {
                sprite_id: a.sprite_ids.clone(),
                ..Default::default()
            }),
        }]
    };
    proto::Appearance {
        id: Some(a.id.0),
        frame_group,
        flags: Some(a.flags.to_proto()),
        name: a.name.as_ref().map(|s| s.as_bytes().to_vec()),
        description: a.description.as_ref().map(|s| s.as_bytes().to_vec()),
    }
}

fn frame_group_to_proto(fg: &FrameGroupInfo) -> proto::FrameGroup {
    proto::FrameGroup {
        fixed_frame_group: fg.fixed_frame_group.map(|f| f as i32),
        id: fg.id,
        sprite_info: fg.sprite_info.as_ref().map(sprite_info_to_proto),
    }
}

fn sprite_info_to_proto(si: &SpriteInfoData) -> proto::SpriteInfo {
    proto::SpriteInfo {
        pattern_width: si.pattern_width,
        pattern_height: si.pattern_height,
        pattern_depth: si.pattern_depth,
        layers: si.layers,
        sprite_id: si.sprite_ids.clone(),
        animation: si.animation.as_ref().map(sprite_animation_to_proto),
        bounding_square: si.bounding_square,
        is_opaque: si.is_opaque,
        bounding_box_per_direction: si
            .bounding_box_per_direction
            .iter()
            .map(|b| proto::Box {
                x: b.x,
                y: b.y,
                width: b.width,
                height: b.height,
            })
            .collect(),
        pattern_size: si.pattern_size,
        pattern_layers: si.pattern_layers,
        pattern_x: si.pattern_x,
        pattern_y: si.pattern_y,
        pattern_z: si.pattern_z,
        pattern_frames: si.pattern_frames,
        is_animation: si.is_animation,
    }
}

fn sprite_animation_to_proto(a: &SpriteAnimationData) -> proto::SpriteAnimation {
    proto::SpriteAnimation {
        default_start_phase: a.default_start_phase,
        synchronized: a.synchronized,
        random_start_phase: a.random_start_phase,
        loop_type: a.loop_type.map(|t| t as i32),
        loop_count: a.loop_count,
        sprite_phase: a
            .sprite_phases
            .iter()
            .map(|p| proto::SpritePhase {
                duration_min: p.duration_min,
                duration_max: p.duration_max,
            })
            .collect(),
    }
}

impl SpecialMeaningIds {
    fn to_proto(self) -> proto::SpecialMeaningAppearanceIds {
        proto::SpecialMeaningAppearanceIds {
            gold_coin_id: self.gold_coin.map(|a| a.0),
            platinum_coin_id: self.platinum_coin.map(|a| a.0),
            crystal_coin_id: self.crystal_coin.map(|a| a.0),
            tibia_coin_id: self.tibia_coin.map(|a| a.0),
            stamped_letter_id: self.stamped_letter.map(|a| a.0),
            supply_stash_id: self.supply_stash.map(|a| a.0),
            standard_reward_chest_id: self.standard_reward_chest.map(|a| a.0),
            blank_imbuement_scroll_id: self.blank_imbuement_scroll.map(|a| a.0),
        }
    }
}
