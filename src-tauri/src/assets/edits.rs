//! Field-dispatch editor over the loaded workspace.
//!
//! The frontend sends `(scope, key, field_path, value)` tuples; this
//! module routes them to the right field on `Appearances` / `Otb` and
//! applies the change. Errors come back as strings so the frontend can
//! show them inline without a typed error envelope.

use atlas_appearances::{
    AppearanceInfo, Appearances, AutomapInfo, BankInfo, ChangedToExpireInfo, ClothesInfo,
    CyclopediaInfo, DefaultActionInfo, HeightInfo, HookInfo, ImbueableInfo, LenshelpInfo, LightInfo,
    MarketInfo, ProficiencyInfo, ShiftInfo, SkillWheelGemInfo, UpgradeClassificationInfo,
    WriteInfo, WriteOnceInfo,
};
use atlas_core::{HookType, ItemCategory, PlayerAction, Vocation, WeaponType};
use atlas_otb::{ExpireFlags, ItemGroup, Otb, OtbItem};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppearanceScope {
    Object,
    Outfit,
    Effect,
    Missile,
}

pub fn update_appearance_field(
    appearances: &mut Appearances,
    scope: AppearanceScope,
    id: u32,
    field: &str,
    value: Value,
) -> Result<(), String> {
    let list: &mut Vec<AppearanceInfo> = match scope {
        AppearanceScope::Object => &mut appearances.objects,
        AppearanceScope::Outfit => &mut appearances.outfits,
        AppearanceScope::Effect => &mut appearances.effects,
        AppearanceScope::Missile => &mut appearances.missiles,
    };
    let entry = list
        .iter_mut()
        .find(|a| a.id.0 == id)
        .ok_or_else(|| format!("appearance id {id} not found in {scope:?}"))?;
    apply_appearance_field(entry, field, value)
}

fn apply_appearance_field(a: &mut AppearanceInfo, field: &str, value: Value) -> Result<(), String> {
    match field {
        "name" => {
            a.name = optional_string(&value, field)?;
            Ok(())
        }
        "description" => {
            a.description = optional_string(&value, field)?;
            Ok(())
        }
        // Boolean flags. Order mirrors `AppearanceFlags` in atlas-appearances
        // so it's easy to spot a missing one.
        "flags.container" => set_bool(&mut a.flags.container, value, field),
        "flags.cumulative" => set_bool(&mut a.flags.cumulative, value, field),
        "flags.usable" => set_bool(&mut a.flags.usable, value, field),
        "flags.forceuse" => set_bool(&mut a.flags.forceuse, value, field),
        "flags.multiuse" => set_bool(&mut a.flags.multiuse, value, field),
        "flags.unpass" => set_bool(&mut a.flags.unpass, value, field),
        "flags.unmove" => set_bool(&mut a.flags.unmove, value, field),
        "flags.unsight" => set_bool(&mut a.flags.unsight, value, field),
        "flags.avoid" => set_bool(&mut a.flags.avoid, value, field),
        "flags.take" => set_bool(&mut a.flags.take, value, field),
        "flags.liquidcontainer" => set_bool(&mut a.flags.liquidcontainer, value, field),
        "flags.liquidpool" => set_bool(&mut a.flags.liquidpool, value, field),
        "flags.hang" => set_bool(&mut a.flags.hang, value, field),
        "flags.rotate" => set_bool(&mut a.flags.rotate, value, field),
        "flags.ignore_look" => set_bool(&mut a.flags.ignore_look, value, field),
        "flags.ammo" => set_bool(&mut a.flags.ammo, value, field),
        "flags.dual_wielding" => set_bool(&mut a.flags.dual_wielding, value, field),
        "flags.show_off_socket" => set_bool(&mut a.flags.show_off_socket, value, field),
        "flags.reportable" => set_bool(&mut a.flags.reportable, value, field),
        "flags.wrap" => set_bool(&mut a.flags.wrap, value, field),
        "flags.unwrap" => set_bool(&mut a.flags.unwrap, value, field),
        "flags.corpse" => set_bool(&mut a.flags.corpse, value, field),
        "flags.player_corpse" => set_bool(&mut a.flags.player_corpse, value, field),
        "flags.clip" => set_bool(&mut a.flags.clip, value, field),
        "flags.bottom" => set_bool(&mut a.flags.bottom, value, field),
        "flags.top" => set_bool(&mut a.flags.top, value, field),
        "flags.fullbank" => set_bool(&mut a.flags.fullbank, value, field),
        "flags.topeffect" => set_bool(&mut a.flags.topeffect, value, field),
        "flags.lying_object" => set_bool(&mut a.flags.lying_object, value, field),
        "flags.translucent" => set_bool(&mut a.flags.translucent, value, field),
        "flags.dont_hide" => set_bool(&mut a.flags.dont_hide, value, field),
        "flags.no_movement_animation" => set_bool(&mut a.flags.no_movement_animation, value, field),
        "flags.animate_always" => set_bool(&mut a.flags.animate_always, value, field),
        "flags.reverse_addons_east" => set_bool(&mut a.flags.reverse_addons_east, value, field),
        "flags.reverse_addons_west" => set_bool(&mut a.flags.reverse_addons_west, value, field),
        "flags.reverse_addons_south" => set_bool(&mut a.flags.reverse_addons_south, value, field),
        "flags.reverse_addons_north" => set_bool(&mut a.flags.reverse_addons_north, value, field),
        "flags.wearout" => set_bool(&mut a.flags.wearout, value, field),
        "flags.clockexpire" => set_bool(&mut a.flags.clockexpire, value, field),
        "flags.expire" => set_bool(&mut a.flags.expire, value, field),
        "flags.expirestop" => set_bool(&mut a.flags.expirestop, value, field),
        "flags.deco_item_kit" => set_bool(&mut a.flags.deco_item_kit, value, field),

        // Combat / requirements.
        "flags.minimum_level" => {
            a.flags.minimum_level = optional_u32(&value, field)?;
            Ok(())
        }
        "flags.weapon_type" => {
            a.flags.weapon_type = optional_enum::<WeaponType>(&value, field)?;
            Ok(())
        }
        "flags.restrict_to_vocation" => {
            a.flags.restrict_to_vocation = enum_vec::<Vocation>(&value, field)?;
            Ok(())
        }

        // Composite sub-messages — `null` clears the entry; an object
        // replaces it wholesale. The frontend always sends the full
        // current state, so we never have to merge partial updates.
        "flags.bank" => set_composite::<BankInfo>(&mut a.flags.bank, value, field),
        "flags.write" => set_composite::<WriteInfo>(&mut a.flags.write, value, field),
        "flags.write_once" => set_composite::<WriteOnceInfo>(&mut a.flags.write_once, value, field),
        "flags.hook" => set_composite::<HookInfo>(&mut a.flags.hook, value, field),
        "flags.light" => set_composite::<LightInfo>(&mut a.flags.light, value, field),
        "flags.shift" => set_composite::<ShiftInfo>(&mut a.flags.shift, value, field),
        "flags.height" => set_composite::<HeightInfo>(&mut a.flags.height, value, field),
        "flags.automap" => set_composite::<AutomapInfo>(&mut a.flags.automap, value, field),
        "flags.lenshelp" => set_composite::<LenshelpInfo>(&mut a.flags.lenshelp, value, field),
        "flags.clothes" => set_composite::<ClothesInfo>(&mut a.flags.clothes, value, field),
        "flags.default_action" => {
            set_composite::<DefaultActionInfo>(&mut a.flags.default_action, value, field)
        }
        "flags.market" => set_composite::<MarketInfo>(&mut a.flags.market, value, field),
        "flags.changed_to_expire" => {
            set_composite::<ChangedToExpireInfo>(&mut a.flags.changed_to_expire, value, field)
        }
        "flags.cyclopedia_item" => {
            set_composite::<CyclopediaInfo>(&mut a.flags.cyclopedia_item, value, field)
        }
        "flags.upgrade_classification" => set_composite::<UpgradeClassificationInfo>(
            &mut a.flags.upgrade_classification,
            value,
            field,
        ),
        "flags.skillwheel_gem" => {
            set_composite::<SkillWheelGemInfo>(&mut a.flags.skillwheel_gem, value, field)
        }
        "flags.imbueable" => set_composite::<ImbueableInfo>(&mut a.flags.imbueable, value, field),
        "flags.proficiency" => {
            set_composite::<ProficiencyInfo>(&mut a.flags.proficiency, value, field)
        }

        // Legacy per-field handlers kept for the parts of the UI that
        // haven't switched to whole-composite updates yet.
        "flags.market.category" => {
            let category = optional_enum::<ItemCategory>(&value, field)?;
            let market = a.flags.market.get_or_insert_with(MarketInfo::default);
            market.category = category;
            Ok(())
        }
        "flags.imbueable.slot_count" => match value {
            Value::Null => {
                a.flags.imbueable = None;
                Ok(())
            }
            Value::Number(n) => {
                let count = n.as_u64().ok_or("imbueable.slot_count must be unsigned")? as u32;
                a.flags.imbueable = Some(ImbueableInfo { slot_count: count });
                Ok(())
            }
            _ => Err(format!("{field} expects number or null")),
        },
        "flags.light.brightness" => {
            let n = require_u32(&value, field)?;
            let light = a.flags.light.get_or_insert_with(LightInfo::default);
            light.brightness = n;
            Ok(())
        }
        "flags.light.color" => {
            let n = require_u32(&value, field)?;
            let light = a.flags.light.get_or_insert_with(LightInfo::default);
            light.color = n;
            Ok(())
        }

        // Hook.direction needs special-casing — HookInfo is non-Default
        // because the direction is required, so we can't use the generic
        // `get_or_insert_with(HookInfo::default)` trick.
        "flags.hook.direction" => match value {
            Value::Null => {
                a.flags.hook = None;
                Ok(())
            }
            _ => {
                let direction: HookType =
                    serde_json::from_value(value).map_err(|e| format!("{field}: {e}"))?;
                a.flags.hook = Some(HookInfo { direction });
                Ok(())
            }
        },
        "flags.default_action.action" => {
            let action = optional_enum::<PlayerAction>(&value, field)?;
            let info = a
                .flags
                .default_action
                .get_or_insert_with(DefaultActionInfo::default);
            info.action = action;
            Ok(())
        }

        _ => Err(format!("unknown appearance field: {field}")),
    }
}

/// Replace an `Option<T>`-shaped sub-message with the JSON value's
/// contents. `null` clears the slot; an object is deserialized into
/// `T`. Anything else is a 400.
fn set_composite<T: DeserializeOwned>(
    slot: &mut Option<T>,
    value: Value,
    field: &str,
) -> Result<(), String> {
    match value {
        Value::Null => {
            *slot = None;
            Ok(())
        }
        v => {
            let parsed: T = serde_json::from_value(v).map_err(|e| format!("{field}: {e}"))?;
            *slot = Some(parsed);
            Ok(())
        }
    }
}

pub fn update_otb_item_field(
    otb: &mut Otb,
    server_id: u16,
    field: &str,
    value: Value,
) -> Result<(), String> {
    let item = otb
        .items
        .iter_mut()
        .find(|i| i.server_id == Some(server_id))
        .ok_or_else(|| format!("OTB item with server_id {server_id} not found"))?;
    apply_otb_field(item, field, value)
}

fn apply_otb_field(item: &mut OtbItem, field: &str, value: Value) -> Result<(), String> {
    match field {
        "name" => {
            item.name = optional_string(&value, field)?;
            Ok(())
        }
        "speed" => {
            item.speed = optional_u16(&value, field)?;
            Ok(())
        }
        "group" => {
            item.group =
                serde_json::from_value::<ItemGroup>(value).map_err(|e| format!("{field}: {e}"))?;
            Ok(())
        }
        "weapon_type" => {
            item.weapon_type = optional_enum::<WeaponType>(&value, field)?;
            Ok(())
        }
        "minimum_level" => {
            item.minimum_level = optional_u32(&value, field)?;
            Ok(())
        }
        "imbuement_slots" => {
            item.imbuement_slots = optional_u8(&value, field)?;
            Ok(())
        }
        "dual_wielding" => {
            item.dual_wielding = optional_bool(&value, field)?;
            Ok(())
        }
        "vocations" => {
            item.vocations = enum_vec::<Vocation>(&value, field)?;
            Ok(())
        }
        // Item flags (subset of the most-edited ones).
        "flags.block_solid" => set_bool(&mut item.flags.block_solid, value, field),
        "flags.block_projectile" => set_bool(&mut item.flags.block_projectile, value, field),
        "flags.block_pathfind" => set_bool(&mut item.flags.block_pathfind, value, field),
        "flags.has_height" => set_bool(&mut item.flags.has_height, value, field),
        "flags.useable" => set_bool(&mut item.flags.useable, value, field),
        "flags.pickupable" => set_bool(&mut item.flags.pickupable, value, field),
        "flags.movable" => set_bool(&mut item.flags.movable, value, field),
        "flags.stackable" => set_bool(&mut item.flags.stackable, value, field),
        "flags.rotatable" => set_bool(&mut item.flags.rotatable, value, field),
        "flags.hangable" => set_bool(&mut item.flags.hangable, value, field),
        "flags.always_on_top" => set_bool(&mut item.flags.always_on_top, value, field),
        "flags.readable" => set_bool(&mut item.flags.readable, value, field),
        "flags.allow_dist_read" => set_bool(&mut item.flags.allow_dist_read, value, field),
        "flags.look_through" => set_bool(&mut item.flags.look_through, value, field),
        "flags.animation" => set_bool(&mut item.flags.animation, value, field),
        "flags.force_use" => set_bool(&mut item.flags.force_use, value, field),
        "expire_flags.wearout" => set_expire(item, |e| &mut e.wearout, value, field),
        "expire_flags.clock_expire" => set_expire(item, |e| &mut e.clock_expire, value, field),
        "expire_flags.expire" => set_expire(item, |e| &mut e.expire, value, field),
        "expire_flags.expire_stop" => set_expire(item, |e| &mut e.expire_stop, value, field),
        _ => Err(format!("unknown OTB field: {field}")),
    }
}

// ---- value adapters ----

fn require_bool(v: &Value, field: &str) -> Result<bool, String> {
    v.as_bool()
        .ok_or_else(|| format!("{field} expects boolean"))
}

fn require_u32(v: &Value, field: &str) -> Result<u32, String> {
    let n = v
        .as_u64()
        .ok_or_else(|| format!("{field} expects unsigned integer"))?;
    u32::try_from(n).map_err(|_| format!("{field}: value {n} overflows u32"))
}

fn optional_string(v: &Value, field: &str) -> Result<Option<String>, String> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) => Ok(Some(s.clone())),
        _ => Err(format!("{field} expects string or null")),
    }
}

fn optional_bool(v: &Value, field: &str) -> Result<Option<bool>, String> {
    match v {
        Value::Null => Ok(None),
        Value::Bool(b) => Ok(Some(*b)),
        _ => Err(format!("{field} expects boolean or null")),
    }
}

fn optional_u8(v: &Value, field: &str) -> Result<Option<u8>, String> {
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => {
            let raw = n.as_u64().ok_or_else(|| format!("{field} must be unsigned"))?;
            let val = u8::try_from(raw)
                .map_err(|_| format!("{field}: value {raw} overflows u8"))?;
            Ok(Some(val))
        }
        _ => Err(format!("{field} expects number or null")),
    }
}

fn optional_u16(v: &Value, field: &str) -> Result<Option<u16>, String> {
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => {
            let raw = n.as_u64().ok_or_else(|| format!("{field} must be unsigned"))?;
            let val = u16::try_from(raw)
                .map_err(|_| format!("{field}: value {raw} overflows u16"))?;
            Ok(Some(val))
        }
        _ => Err(format!("{field} expects number or null")),
    }
}

fn optional_u32(v: &Value, field: &str) -> Result<Option<u32>, String> {
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => {
            let raw = n.as_u64().ok_or_else(|| format!("{field} must be unsigned"))?;
            let val = u32::try_from(raw)
                .map_err(|_| format!("{field}: value {raw} overflows u32"))?;
            Ok(Some(val))
        }
        _ => Err(format!("{field} expects number or null")),
    }
}

fn optional_enum<E: DeserializeOwned>(v: &Value, field: &str) -> Result<Option<E>, String> {
    match v {
        Value::Null => Ok(None),
        _ => serde_json::from_value::<E>(v.clone())
            .map(Some)
            .map_err(|e| format!("{field}: {e}")),
    }
}

fn enum_vec<E: DeserializeOwned>(v: &Value, field: &str) -> Result<Vec<E>, String> {
    serde_json::from_value::<Vec<E>>(v.clone()).map_err(|e| format!("{field}: {e}"))
}

fn set_bool(slot: &mut bool, value: Value, field: &str) -> Result<(), String> {
    *slot = require_bool(&value, field)?;
    Ok(())
}

fn set_expire(
    item: &mut OtbItem,
    select: impl FnOnce(&mut ExpireFlags) -> &mut bool,
    value: Value,
    field: &str,
) -> Result<(), String> {
    let b = require_bool(&value, field)?;
    let flags = item.expire_flags.get_or_insert_with(ExpireFlags::default);
    *select(flags) = b;
    Ok(())
}
