//! Field-dispatch editor over the loaded workspace.
//!
//! The frontend sends `(scope, key, field_path, value)` tuples; this
//! module routes them to the right field on `Appearances` / `Otb` and
//! applies the change. Errors come back as strings so the frontend can
//! show them inline without a typed error envelope.

use atlas_appearances::{AppearanceInfo, Appearances, ImbueableInfo, LightInfo, MarketInfo};
use atlas_core::{ItemCategory, Vocation, WeaponType};
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
        // Boolean flags. Add new ones here as the UI grows — the schema
        // on the frontend should mirror this list exactly.
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
        // Scalar fields.
        "flags.minimum_level" => {
            a.flags.minimum_level = optional_u32(&value, field)?;
            Ok(())
        }
        "flags.weapon_type" => {
            a.flags.weapon_type = optional_enum::<WeaponType>(&value, field)?;
            Ok(())
        }
        "flags.market.category" => {
            let category = optional_enum::<ItemCategory>(&value, field)?;
            let market = a.flags.market.get_or_insert_with(MarketInfo::default);
            market.category = category;
            Ok(())
        }
        "flags.imbueable.slot_count" => {
            // `null` clears the imbueable sub-message; a number ensures
            // it exists and sets the slot count.
            match value {
                Value::Null => {
                    a.flags.imbueable = None;
                }
                Value::Number(n) => {
                    let count = n.as_u64().ok_or("imbueable.slot_count must be unsigned")? as u32;
                    a.flags.imbueable = Some(ImbueableInfo { slot_count: count });
                }
                _ => return Err(format!("{field} expects number or null")),
            }
            Ok(())
        }
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
        "flags.restrict_to_vocation" => {
            a.flags.restrict_to_vocation = enum_vec::<Vocation>(&value, field)?;
            Ok(())
        }
        _ => Err(format!("unknown appearance field: {field}")),
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
            item.group = serde_json::from_value::<ItemGroup>(value)
                .map_err(|e| format!("{field}: {e}"))?;
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
    v.as_bool().ok_or_else(|| format!("{field} expects boolean"))
}

fn require_u32(v: &Value, field: &str) -> Result<u32, String> {
    v.as_u64()
        .map(|n| n as u32)
        .ok_or_else(|| format!("{field} expects unsigned integer"))
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
        Value::Number(n) => Ok(Some(
            n.as_u64().ok_or_else(|| format!("{field} must be unsigned"))? as u8,
        )),
        _ => Err(format!("{field} expects number or null")),
    }
}

fn optional_u16(v: &Value, field: &str) -> Result<Option<u16>, String> {
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => Ok(Some(
            n.as_u64().ok_or_else(|| format!("{field} must be unsigned"))? as u16,
        )),
        _ => Err(format!("{field} expects number or null")),
    }
}

fn optional_u32(v: &Value, field: &str) -> Result<Option<u32>, String> {
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => Ok(Some(
            n.as_u64().ok_or_else(|| format!("{field} must be unsigned"))? as u32,
        )),
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
