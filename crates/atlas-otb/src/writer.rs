//! Encoder for `items.otb`. Inverse of `lib.rs::decode_*`.
//!
//! The on-disk shape is a binary tree of nested nodes whose props are a
//! TLV attribute stream. We re-emit only the attributes the model knows
//! about — unknown bytes read off disk are *not* preserved, mirroring
//! the read-side honesty contract documented in `docs/otb-format.md`.
//! Full byte-perfect round-trip is out of scope until the model grows a
//! "raw extras" pocket for unknown attribute payloads.

use std::path::Path;

use atlas_core::Result;

use crate::model::{ExpireFlags, ItemAttr, ItemFlags, Otb, OtbHeader, OtbItem};
use crate::tree::{NODE_END, NODE_ESC, NODE_START};
use crate::{ROOT_ATTR_VERSION, VERSION_PAYLOAD_LEN};

impl Otb {
    /// Encode the OTB to a fresh `Vec<u8>` ready to drop on disk.
    pub fn encode_to_vec(&self) -> Vec<u8> {
        let mut out = Vec::new();
        // Classic TFS writes zero in the 4-byte file identifier slot.
        out.extend_from_slice(&0u32.to_le_bytes());
        encode_root(&mut out, &self.header, &self.items);
        out
    }

    /// Atomic-ish save: write to a sibling `.tmp` then rename. Callers
    /// that want a `.bak` should snapshot the prior file before calling.
    pub fn save_to_file(&self, path: impl AsRef<Path>) -> Result<()> {
        let bytes = self.encode_to_vec();
        let path = path.as_ref();
        let tmp = path.with_extension("otb.tmp");
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

fn encode_root(out: &mut Vec<u8>, header: &OtbHeader, items: &[OtbItem]) {
    out.push(NODE_START);
    out.push(0); // root kind is always 0

    // Root props: 4 bytes of "root flags" (unused by classic TFS) +
    // the ROOT_ATTR_VERSION attribute.
    let mut root_props = Vec::with_capacity(4 + 3 + VERSION_PAYLOAD_LEN);
    root_props.extend_from_slice(&0u32.to_le_bytes());
    let mut version_payload = Vec::with_capacity(VERSION_PAYLOAD_LEN);
    version_payload.extend_from_slice(&header.major.to_le_bytes());
    version_payload.extend_from_slice(&header.minor.to_le_bytes());
    version_payload.extend_from_slice(&header.build.to_le_bytes());
    let mut csd = [0u8; 128];
    let n = header.csd_version.len().min(128);
    csd[..n].copy_from_slice(&header.csd_version[..n]);
    version_payload.extend_from_slice(&csd);
    tlv(&mut root_props, ROOT_ATTR_VERSION, &version_payload);

    write_escaped(out, &root_props);

    for item in items {
        encode_item(out, item);
    }
    out.push(NODE_END);
}

fn encode_item(out: &mut Vec<u8>, item: &OtbItem) {
    out.push(NODE_START);
    out.push(item.group as u8);

    let mut props = Vec::new();
    props.extend_from_slice(&flags_to_bits(&item.flags).to_le_bytes());

    if let Some(v) = item.server_id {
        tlv(&mut props, ItemAttr::ServerId as u8, &v.to_le_bytes());
    }
    if let Some(v) = item.client_id {
        tlv(&mut props, ItemAttr::ClientId as u8, &v.to_le_bytes());
    }
    if let Some(name) = item.name.as_ref() {
        tlv(&mut props, ItemAttr::Name as u8, name.as_bytes());
    }
    if let Some(v) = item.speed {
        tlv(&mut props, ItemAttr::Speed as u8, &v.to_le_bytes());
    }

    if let Some(v) = item.weapon_type {
        tlv(&mut props, ItemAttr::WeaponType as u8, &[v as u8]);
    }
    if let Some(v) = item.minimum_level {
        tlv(&mut props, ItemAttr::MinimumLevel as u8, &v.to_le_bytes());
    }
    if !item.vocations.is_empty() {
        let mut payload = Vec::with_capacity(1 + item.vocations.len());
        payload.push(item.vocations.len() as u8);
        for voc in &item.vocations {
            payload.push(*voc as u8);
        }
        tlv(&mut props, ItemAttr::Vocations as u8, &payload);
    }
    if let Some(v) = item.imbuement_slots {
        tlv(&mut props, ItemAttr::ImbuementSlots as u8, &[v]);
    }
    if let Some(v) = item.gem_quality_id {
        tlv(&mut props, ItemAttr::GemQualityId as u8, &v.to_le_bytes());
    }
    if let Some(v) = item.gem_vocation_id {
        tlv(&mut props, ItemAttr::GemVocationId as u8, &v.to_le_bytes());
    }
    if let Some(v) = item.proficiency_id {
        tlv(&mut props, ItemAttr::ProficiencyId as u8, &v.to_le_bytes());
    }
    if let Some(v) = item.cyclopedia_type {
        tlv(&mut props, ItemAttr::CyclopediaType as u8, &v.to_le_bytes());
    }
    if let Some(v) = item.dual_wielding {
        tlv(&mut props, ItemAttr::DualWielding as u8, &[v as u8]);
    }
    if let Some(v) = item.expire_flags {
        tlv(&mut props, ItemAttr::ExpireFlags as u8, &[expire_flags_to_bits(v)]);
    }
    if let Some(v) = item.former_object_type_id {
        tlv(
            &mut props,
            ItemAttr::FormerObjectTypeId as u8,
            &v.to_le_bytes(),
        );
    }
    if let Some(v) = item.hook_direction {
        tlv(&mut props, ItemAttr::HookDirection as u8, &[v as u8]);
    }

    write_escaped(out, &props);
    out.push(NODE_END);
}

fn tlv(out: &mut Vec<u8>, attr_type: u8, value: &[u8]) {
    out.push(attr_type);
    let len = value.len() as u16;
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(value);
}

fn write_escaped(out: &mut Vec<u8>, payload: &[u8]) {
    for &b in payload {
        if matches!(b, NODE_START | NODE_END | NODE_ESC) {
            out.push(NODE_ESC);
        }
        out.push(b);
    }
}

fn flags_to_bits(f: &ItemFlags) -> u32 {
    (f.block_solid as u32) << 0
        | (f.block_projectile as u32) << 1
        | (f.block_pathfind as u32) << 2
        | (f.has_height as u32) << 3
        | (f.useable as u32) << 4
        | (f.pickupable as u32) << 5
        | (f.movable as u32) << 6
        | (f.stackable as u32) << 7
        | (f.floor_change_down as u32) << 8
        | (f.floor_change_north as u32) << 9
        | (f.floor_change_east as u32) << 10
        | (f.floor_change_south as u32) << 11
        | (f.floor_change_west as u32) << 12
        | (f.always_on_top as u32) << 13
        | (f.readable as u32) << 14
        | (f.rotatable as u32) << 15
        | (f.hangable as u32) << 16
        | (f.vertical as u32) << 17
        | (f.horizontal as u32) << 18
        | (f.cannot_decay as u32) << 19
        | (f.allow_dist_read as u32) << 20
        | (f.client_charges as u32) << 22
        | (f.look_through as u32) << 23
        | (f.animation as u32) << 24
        | (f.full_tile as u32) << 25
        | (f.force_use as u32) << 26
}

fn expire_flags_to_bits(f: ExpireFlags) -> u8 {
    (f.wearout as u8)
        | (f.clock_expire as u8) << 1
        | (f.expire as u8) << 2
        | (f.expire_stop as u8) << 3
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ItemGroup;
    use atlas_core::{HookType, Vocation, WeaponType};

    fn sample_otb() -> Otb {
        Otb {
            header: OtbHeader {
                major: 3,
                minor: 60,
                build: 7,
                csd_version: {
                    let mut v = vec![0u8; 128];
                    v[..4].copy_from_slice(b"ATLA");
                    v
                },
            },
            items: vec![
                OtbItem {
                    group: ItemGroup::Ground,
                    flags: ItemFlags {
                        block_solid: true,
                        pickupable: true,
                        movable: true,
                        ..Default::default()
                    },
                    server_id: Some(1234),
                    client_id: Some(5678),
                    name: Some("sword of valor".to_string()),
                    speed: Some(250),
                    weapon_type: Some(WeaponType::Sword),
                    minimum_level: Some(80),
                    vocations: vec![Vocation::Knight, Vocation::Paladin],
                    imbuement_slots: Some(3),
                    gem_quality_id: Some(11),
                    gem_vocation_id: Some(22),
                    proficiency_id: Some(33),
                    cyclopedia_type: Some(44),
                    dual_wielding: Some(true),
                    expire_flags: Some(ExpireFlags {
                        clock_expire: true,
                        expire_stop: true,
                        ..Default::default()
                    }),
                    former_object_type_id: Some(7777),
                    hook_direction: Some(HookType::East),
                },
                OtbItem {
                    group: ItemGroup::None,
                    server_id: Some(2000),
                    ..Default::default()
                },
            ],
        }
    }

    #[test]
    fn round_trips_via_save_and_load() {
        let otb = sample_otb();
        let bytes = otb.encode_to_vec();
        let parsed = Otb::load_from_bytes(&bytes).expect("encoded bytes must parse");
        assert_eq!(parsed, otb);
    }

    #[test]
    fn empty_otb_round_trips() {
        let otb = Otb {
            header: OtbHeader {
                major: 3,
                minor: 60,
                build: 7,
                csd_version: vec![0; 128],
            },
            items: Vec::new(),
        };
        let bytes = otb.encode_to_vec();
        let parsed = Otb::load_from_bytes(&bytes).expect("empty OTB must parse");
        assert_eq!(parsed, otb);
    }

    #[test]
    fn payload_with_sentinel_bytes_escapes_correctly() {
        // A name containing every escape byte must round-trip cleanly.
        let otb = Otb {
            header: OtbHeader {
                major: 1,
                minor: 0,
                build: 0,
                csd_version: vec![0; 128],
            },
            items: vec![OtbItem {
                group: ItemGroup::Ground,
                server_id: Some(1),
                name: Some(format!(
                    "{}{}{}",
                    NODE_START as char, NODE_END as char, NODE_ESC as char
                )),
                ..Default::default()
            }],
        };
        let bytes = otb.encode_to_vec();
        let parsed = Otb::load_from_bytes(&bytes).expect("escaping must survive round-trip");
        assert_eq!(parsed.items[0].name, otb.items[0].name);
    }

    #[test]
    fn save_to_file_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.otb");
        let otb = sample_otb();
        otb.save_to_file(&path).expect("save should succeed");
        let parsed = Otb::load_from_file(&path).expect("file must parse");
        assert_eq!(parsed, otb);
    }
}
