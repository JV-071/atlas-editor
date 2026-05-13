//! Reader for `items.otb`, including the Atlas extended attributes.
//!
//! The OTB format is the legacy server-side item catalog used by TFS-family
//! servers. It is a binary tree of nested nodes whose props are a TLV
//! attribute stream. Atlas extends it with new `ITEM_ATTR_*` bytes that
//! mirror modern `appearances.dat` fields (imbuements, gems, weapon type,
//! vocation restrictions, etc.). See [`docs/otb-format.md`](../../docs/otb-format.md)
//! for the full byte-level specification.
//!
//! Most callers want to work with [`Otb`] (a neutral, serde-friendly
//! domain model). Use [`Otb::load_from_file`] for the disk path or
//! [`Otb::load_from_bytes`] for buffers already in memory. The writer
//! lands in Phase 3 alongside the editor's save flow; this module is
//! read-only.

#![forbid(unsafe_code)]

use std::path::Path;

use atlas_core::{AtlasError, HookType, Result, Vocation, WeaponType};

mod attrs;
pub mod model;
mod tree;
mod writer;

pub use atlas_core::AssetId;
pub use model::{ExpireFlags, ItemAttr, ItemFlags, ItemGroup, Otb, OtbHeader, OtbItem};

pub(crate) const ROOT_ATTR_VERSION: u8 = 0x01;
pub(crate) const VERSION_PAYLOAD_LEN: usize = 4 + 4 + 4 + 128;

impl Otb {
    /// Read an `items.otb` file from disk and parse it.
    ///
    /// Returns [`AtlasError::Io`] on read failure and
    /// [`AtlasError::InvalidFormat`] if the bytes do not decode as a valid
    /// OTB tree.
    pub fn load_from_file(path: impl AsRef<Path>) -> Result<Self> {
        let bytes = std::fs::read(path.as_ref())?;
        Self::load_from_bytes(&bytes)
    }

    /// Parse an `items.otb` from an in-memory byte buffer.
    pub fn load_from_bytes(bytes: &[u8]) -> Result<Self> {
        let root = tree::parse(bytes)?;
        decode_root(root)
    }
}

fn decode_root(root: tree::Node) -> Result<Otb> {
    if root.props.len() < 4 {
        return Err(AtlasError::InvalidFormat(
            "OTB root props too short to contain the flags prefix".into(),
        ));
    }
    // Root flags are unused by classic TFS; skip the 4-byte prefix.
    let attr_bytes = &root.props[4..];

    let mut header: Option<OtbHeader> = None;
    let mut cursor = attrs::AttrCursor::new(attr_bytes);
    while let Some((attr_type, value)) = cursor.next_attr()? {
        match attr_type {
            ROOT_ATTR_VERSION => {
                if value.len() != VERSION_PAYLOAD_LEN {
                    return Err(AtlasError::InvalidFormat(format!(
                        "ROOT_ATTR_VERSION expected {VERSION_PAYLOAD_LEN} bytes, got {}",
                        value.len()
                    )));
                }
                let major = u32::from_le_bytes([value[0], value[1], value[2], value[3]]);
                let minor = u32::from_le_bytes([value[4], value[5], value[6], value[7]]);
                let build = u32::from_le_bytes([value[8], value[9], value[10], value[11]]);
                let csd_version = value[12..VERSION_PAYLOAD_LEN].to_vec();
                header = Some(OtbHeader {
                    major,
                    minor,
                    build,
                    csd_version,
                });
            }
            _ => {
                // Unknown root attribute — skip per the forward-compat spec.
            }
        }
    }

    let header = header
        .ok_or_else(|| AtlasError::InvalidFormat("OTB root missing version attribute".into()))?;

    let items = root
        .children
        .into_iter()
        .map(decode_item)
        .collect::<Result<Vec<_>>>()?;

    Ok(Otb { header, items })
}

fn decode_item(node: tree::Node) -> Result<OtbItem> {
    if node.props.len() < 4 {
        return Err(AtlasError::InvalidFormat(
            "OTB item props too short to contain the flags prefix".into(),
        ));
    }
    // Unknown kind bytes default to `ItemGroup::None`. We do not error
    // out here so files written by newer servers — which may invent
    // additional group ids — still load and surface every item we can.
    let group = ItemGroup::from_u8(node.kind).unwrap_or_default();
    let flags = ItemFlags::from_bits(u32::from_le_bytes([
        node.props[0],
        node.props[1],
        node.props[2],
        node.props[3],
    ]));

    let mut item = OtbItem {
        group,
        flags,
        ..Default::default()
    };

    let mut cursor = attrs::AttrCursor::new(&node.props[4..]);
    while let Some((attr_type, value)) = cursor.next_attr()? {
        match attr_type {
            // Classic TFS attributes.
            a if a == ItemAttr::ServerId as u8 => {
                item.server_id = Some(attrs::read_u16(value, a)?);
            }
            a if a == ItemAttr::ClientId as u8 => {
                item.client_id = Some(attrs::read_u16(value, a)?);
            }
            a if a == ItemAttr::Name as u8 => {
                item.name = Some(attrs::read_string(value));
            }
            a if a == ItemAttr::Speed as u8 => {
                item.speed = Some(attrs::read_u16(value, a)?);
            }
            // Atlas extensions (0x80..).
            a if a == ItemAttr::WeaponType as u8 => {
                item.weapon_type = WeaponType::from_i32(attrs::read_u8(value, a)? as i32);
            }
            a if a == ItemAttr::MinimumLevel as u8 => {
                item.minimum_level = Some(attrs::read_u32(value, a)?);
            }
            a if a == ItemAttr::Vocations as u8 => {
                let raw = attrs::read_u8_list(value, a)?;
                item.vocations = raw
                    .into_iter()
                    .filter_map(|v| Vocation::from_i32(v as i32))
                    .collect();
            }
            a if a == ItemAttr::ImbuementSlots as u8 => {
                item.imbuement_slots = Some(attrs::read_u8(value, a)?);
            }
            a if a == ItemAttr::GemQualityId as u8 => {
                item.gem_quality_id = Some(attrs::read_u16(value, a)?);
            }
            a if a == ItemAttr::GemVocationId as u8 => {
                item.gem_vocation_id = Some(attrs::read_u16(value, a)?);
            }
            a if a == ItemAttr::ProficiencyId as u8 => {
                item.proficiency_id = Some(attrs::read_u16(value, a)?);
            }
            a if a == ItemAttr::CyclopediaType as u8 => {
                item.cyclopedia_type = Some(attrs::read_u16(value, a)?);
            }
            a if a == ItemAttr::DualWielding as u8 => {
                item.dual_wielding = Some(attrs::read_u8(value, a)? != 0);
            }
            a if a == ItemAttr::ExpireFlags as u8 => {
                item.expire_flags = Some(ExpireFlags::from_bits(attrs::read_u8(value, a)?));
            }
            a if a == ItemAttr::FormerObjectTypeId as u8 => {
                item.former_object_type_id = Some(attrs::read_u16(value, a)?);
            }
            a if a == ItemAttr::HookDirection as u8 => {
                item.hook_direction = HookType::from_i32(attrs::read_u8(value, a)? as i32);
            }
            _ => {
                // Unknown attribute — skip per the forward-compat spec.
            }
        }
    }

    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ----- builders that produce raw OTB byte streams for round-trip tests -----

    const NODE_START: u8 = 0xFE;
    const NODE_END: u8 = 0xFF;
    const NODE_ESC: u8 = 0xFD;

    fn escape_into(out: &mut Vec<u8>, src: &[u8]) {
        for &b in src {
            if matches!(b, NODE_START | NODE_END | NODE_ESC) {
                out.push(NODE_ESC);
            }
            out.push(b);
        }
    }

    fn tlv(attr_type: u8, value: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(3 + value.len());
        out.push(attr_type);
        out.extend_from_slice(&(value.len() as u16).to_le_bytes());
        out.extend_from_slice(value);
        out
    }

    fn version_payload(major: u32, minor: u32, build: u32, csd: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(VERSION_PAYLOAD_LEN);
        out.extend_from_slice(&major.to_le_bytes());
        out.extend_from_slice(&minor.to_le_bytes());
        out.extend_from_slice(&build.to_le_bytes());
        let mut buf = [0u8; 128];
        let n = csd.len().min(128);
        buf[..n].copy_from_slice(&csd[..n]);
        out.extend_from_slice(&buf);
        out
    }

    /// Build a minimal valid OTB: header + root node with version attr and
    /// `items` as already-encoded child nodes (one Vec<u8> per item).
    fn build_otb(major: u32, minor: u32, build: u32, csd: &[u8], items: Vec<Vec<u8>>) -> Vec<u8> {
        let mut root_props = Vec::new();
        // Root flags (unused).
        root_props.extend_from_slice(&0u32.to_le_bytes());
        // Version attribute.
        root_props.extend_from_slice(&tlv(
            ROOT_ATTR_VERSION,
            &version_payload(major, minor, build, csd),
        ));

        let mut out = Vec::new();
        // 4-byte file identifier (classic TFS writes zero).
        out.extend_from_slice(&0u32.to_le_bytes());
        // NODE_START + root kind (always 0 for the root).
        out.push(NODE_START);
        out.push(0);
        escape_into(&mut out, &root_props);
        for item in items {
            out.extend_from_slice(&item);
        }
        out.push(NODE_END);
        out
    }

    /// Build an encoded item node (NODE_START + kind + escaped(flags+attrs) + NODE_END).
    fn build_item(group: ItemGroup, flag_bits: u32, attrs_stream: &[u8]) -> Vec<u8> {
        let mut item_props = Vec::new();
        item_props.extend_from_slice(&flag_bits.to_le_bytes());
        item_props.extend_from_slice(attrs_stream);

        let mut out = Vec::new();
        out.push(NODE_START);
        out.push(group as u8);
        escape_into(&mut out, &item_props);
        out.push(NODE_END);
        out
    }

    // ----- tests -----

    #[test]
    fn parses_header_and_no_items() {
        let bytes = build_otb(3, 60, 7, b"ATLA", vec![]);
        let otb = Otb::load_from_bytes(&bytes).expect("parse should succeed");
        assert_eq!(otb.header.major, 3);
        assert_eq!(otb.header.minor, 60);
        assert_eq!(otb.header.build, 7);
        assert_eq!(otb.header.csd_version.len(), 128);
        assert_eq!(&otb.header.csd_version[..4], b"ATLA");
        assert!(otb.header.is_atlas_extended());
        assert!(otb.items.is_empty());
    }

    #[test]
    fn detects_classic_csd_buffer() {
        let bytes = build_otb(3, 60, 7, b"OTServ build 1234", vec![]);
        let otb = Otb::load_from_bytes(&bytes).expect("parse should succeed");
        assert!(!otb.header.is_atlas_extended());
    }

    #[test]
    fn parses_classic_item_attributes() {
        let mut attrs_stream = Vec::new();
        attrs_stream.extend_from_slice(&tlv(ItemAttr::ServerId as u8, &1234u16.to_le_bytes()));
        attrs_stream.extend_from_slice(&tlv(ItemAttr::ClientId as u8, &5678u16.to_le_bytes()));
        attrs_stream.extend_from_slice(&tlv(ItemAttr::Name as u8, b"sword of valor"));
        attrs_stream.extend_from_slice(&tlv(ItemAttr::Speed as u8, &250u16.to_le_bytes()));

        let item_bytes = build_item(
            ItemGroup::Ground,
            // block_solid | block_pathfind | pickupable | movable
            0x0000_0001 | 0x0000_0004 | 0x0000_0020 | 0x0000_0040,
            &attrs_stream,
        );
        let bytes = build_otb(3, 60, 7, b"ATLA", vec![item_bytes]);

        let otb = Otb::load_from_bytes(&bytes).expect("parse should succeed");
        assert_eq!(otb.items.len(), 1);
        let item = &otb.items[0];
        assert_eq!(item.group, ItemGroup::Ground);
        assert!(item.flags.block_solid);
        assert!(item.flags.block_pathfind);
        assert!(item.flags.pickupable);
        assert!(item.flags.movable);
        assert!(!item.flags.block_projectile);
        assert_eq!(item.server_id, Some(1234));
        assert_eq!(item.client_id, Some(5678));
        assert_eq!(item.name.as_deref(), Some("sword of valor"));
        assert_eq!(item.speed, Some(250));
    }

    #[test]
    fn parses_all_atlas_extension_attributes() {
        let mut s = Vec::new();
        s.extend_from_slice(&tlv(ItemAttr::WeaponType as u8, &[WeaponType::Sword as u8]));
        s.extend_from_slice(&tlv(ItemAttr::MinimumLevel as u8, &80u32.to_le_bytes()));
        s.extend_from_slice(&tlv(
            ItemAttr::Vocations as u8,
            &[2u8, Vocation::Knight as u8, Vocation::Paladin as u8],
        ));
        s.extend_from_slice(&tlv(ItemAttr::ImbuementSlots as u8, &[3]));
        s.extend_from_slice(&tlv(ItemAttr::GemQualityId as u8, &11u16.to_le_bytes()));
        s.extend_from_slice(&tlv(ItemAttr::GemVocationId as u8, &22u16.to_le_bytes()));
        s.extend_from_slice(&tlv(ItemAttr::ProficiencyId as u8, &33u16.to_le_bytes()));
        s.extend_from_slice(&tlv(ItemAttr::CyclopediaType as u8, &44u16.to_le_bytes()));
        s.extend_from_slice(&tlv(ItemAttr::DualWielding as u8, &[1]));
        s.extend_from_slice(&tlv(ItemAttr::ExpireFlags as u8, &[0b1010])); // clock_expire | expire_stop
        s.extend_from_slice(&tlv(
            ItemAttr::FormerObjectTypeId as u8,
            &7777u16.to_le_bytes(),
        ));
        s.extend_from_slice(&tlv(ItemAttr::HookDirection as u8, &[HookType::East as u8]));

        let item_bytes = build_item(ItemGroup::Weapon, 0, &s);
        let bytes = build_otb(3, 60, 7, b"ATLA", vec![item_bytes]);

        let otb = Otb::load_from_bytes(&bytes).expect("parse should succeed");
        let item = &otb.items[0];
        assert_eq!(item.weapon_type, Some(WeaponType::Sword));
        assert_eq!(item.minimum_level, Some(80));
        assert_eq!(item.vocations, vec![Vocation::Knight, Vocation::Paladin]);
        assert_eq!(item.imbuement_slots, Some(3));
        assert_eq!(item.gem_quality_id, Some(11));
        assert_eq!(item.gem_vocation_id, Some(22));
        assert_eq!(item.proficiency_id, Some(33));
        assert_eq!(item.cyclopedia_type, Some(44));
        assert_eq!(item.dual_wielding, Some(true));
        let ef = item.expire_flags.expect("expire flags present");
        assert!(!ef.wearout);
        assert!(ef.clock_expire);
        assert!(!ef.expire);
        assert!(ef.expire_stop);
        assert_eq!(item.former_object_type_id, Some(7777));
        assert_eq!(item.hook_direction, Some(HookType::East));
    }

    #[test]
    fn drops_unknown_vocations_and_weapon_types() {
        // 99 is not a valid vocation id; Knight survives, 99 is dropped.
        // 99 is also not a valid weapon type; the field becomes None.
        let mut s = Vec::new();
        s.extend_from_slice(&tlv(ItemAttr::WeaponType as u8, &[99]));
        s.extend_from_slice(&tlv(
            ItemAttr::Vocations as u8,
            &[2u8, Vocation::Knight as u8, 99],
        ));
        let item_bytes = build_item(ItemGroup::Weapon, 0, &s);
        let bytes = build_otb(3, 60, 7, b"ATLA", vec![item_bytes]);

        let otb = Otb::load_from_bytes(&bytes).expect("parse should succeed");
        let item = &otb.items[0];
        assert_eq!(item.weapon_type, None);
        assert_eq!(item.vocations, vec![Vocation::Knight]);
    }

    #[test]
    fn skips_unknown_attribute_bytes() {
        // 0x7F is reserved but not assigned; the parser must skip it.
        let mut s = Vec::new();
        s.extend_from_slice(&tlv(0x7F, &[0xDE, 0xAD, 0xBE, 0xEF]));
        s.extend_from_slice(&tlv(ItemAttr::ServerId as u8, &42u16.to_le_bytes()));
        let item_bytes = build_item(ItemGroup::Ground, 0, &s);
        let bytes = build_otb(3, 60, 7, b"ATLA", vec![item_bytes]);

        let otb = Otb::load_from_bytes(&bytes).expect("parse should succeed");
        assert_eq!(otb.items[0].server_id, Some(42));
    }

    #[test]
    fn rejects_missing_version_attribute() {
        // Build a root node with the flags prefix but no version attr.
        let mut out = Vec::new();
        out.extend_from_slice(&0u32.to_le_bytes()); // file identifier
        out.push(NODE_START);
        out.push(0); // root kind
        let mut root_props = Vec::new();
        root_props.extend_from_slice(&0u32.to_le_bytes()); // root flags
        escape_into(&mut out, &root_props);
        out.push(NODE_END);

        let err = Otb::load_from_bytes(&out).expect_err("missing version should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn rejects_version_with_wrong_size() {
        let mut root_props = Vec::new();
        root_props.extend_from_slice(&0u32.to_le_bytes());
        root_props.extend_from_slice(&tlv(ROOT_ATTR_VERSION, &[0; 16])); // way too short

        let mut out = Vec::new();
        out.extend_from_slice(&0u32.to_le_bytes());
        out.push(NODE_START);
        out.push(0);
        escape_into(&mut out, &root_props);
        out.push(NODE_END);

        let err = Otb::load_from_bytes(&out).expect_err("wrong size version should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn rejects_garbage() {
        let err = Otb::load_from_bytes(&[0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
            .expect_err("garbage should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn load_from_file_round_trip() {
        use std::io::Write;

        let bytes = build_otb(
            3,
            60,
            7,
            b"ATLA",
            vec![build_item(
                ItemGroup::Ground,
                0,
                &tlv(ItemAttr::ServerId as u8, &100u16.to_le_bytes()),
            )],
        );
        let mut file = tempfile::NamedTempFile::new().expect("tempfile");
        file.write_all(&bytes).expect("write");

        let otb = Otb::load_from_file(file.path()).expect("loading should succeed");
        assert_eq!(otb.items.len(), 1);
        assert_eq!(otb.items[0].server_id, Some(100));
    }

    /// Optional smoke test against a real `items.otb`. Skipped by default.
    /// Provide the file path via `ATLAS_ITEMS_OTB` and run with
    /// `cargo test -- --ignored` to opt in.
    #[test]
    #[ignore]
    fn load_real_items_otb() {
        let Ok(path) = std::env::var("ATLAS_ITEMS_OTB") else {
            eprintln!("set ATLAS_ITEMS_OTB to run this test");
            return;
        };
        let otb = Otb::load_from_file(&path).expect("real items.otb must parse");
        assert!(
            otb.items.len() > 100,
            "expected >100 items, got {}",
            otb.items.len()
        );
        // Real files always carry both server_id and client_id on every item.
        let with_ids = otb
            .items
            .iter()
            .filter(|i| i.server_id.is_some() && i.client_id.is_some())
            .count();
        assert_eq!(with_ids, otb.items.len());
    }
}
