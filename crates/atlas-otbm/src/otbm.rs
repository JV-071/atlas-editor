//! Minimal, loss-free OTBM node-tree reader/writer.
//!
//! OTBM is a tree of nodes encoded with three control bytes:
//! `0xFE` opens a node, `0xFF` closes it, and `0xFD` escapes the next byte
//! so a literal control byte can appear inside a node body. Every node is
//! `[0xFE][type][body…][children…][0xFF]`.
//!
//! We deliberately **do not** interpret each node's attributes. Instead we
//! keep the de-escaped body bytes verbatim and re-escape them on write, so
//! the round-trip is byte-identical except for the specific item ids we
//! choose to patch. That keeps us forward-compatible with attribute kinds
//! we don't know about (newer OTBM revisions, custom server extensions)
//! and removes any risk of dropping data we didn't model.

use crate::error::{OtbmError, Result};
use crate::idmap::IdMap;

const NODE_ESC: u8 = 0xFD;
const NODE_INIT: u8 = 0xFE;
const NODE_TERM: u8 = 0xFF;

// Node type bytes we touch during conversion.
const OTBM_MAP_HEADER: u8 = 0x00;
const OTBM_TILE: u8 = 0x05;
const OTBM_ITEM: u8 = 0x06;
const OTBM_HOUSETILE: u8 = 0x0E;

// Tile/item attribute leading bytes, needed to walk a tile body and locate
// the ground-item id (OTBM_ATTR_ITEM). Lengths mirror the OpenTibia spec.
const OTBM_ATTR_DESCRIPTION: u8 = 0x01;
const OTBM_ATTR_EXT_FILE: u8 = 0x02;
const OTBM_ATTR_TILE_FLAGS: u8 = 0x03;
const OTBM_ATTR_ACTION_ID: u8 = 0x04;
const OTBM_ATTR_UNIQUE_ID: u8 = 0x05;
const OTBM_ATTR_TEXT: u8 = 0x06;
const OTBM_ATTR_DESC: u8 = 0x07;
const OTBM_ATTR_TELE_DEST: u8 = 0x08;
const OTBM_ATTR_ITEM: u8 = 0x09;
const OTBM_ATTR_DEPOT_ID: u8 = 0x0A;
const OTBM_ATTR_EXT_SPAWN_FILE: u8 = 0x0B;
const OTBM_ATTR_EXT_HOUSE_FILE: u8 = 0x0D;
const OTBM_ATTR_HOUSEDOORID: u8 = 0x0E;
const OTBM_ATTR_COUNT: u8 = 0x0F;
const OTBM_ATTR_RUNE_CHARGES: u8 = 0x16;

/// A parsed OTBM node: its de-escaped body (first byte is the node type)
/// and its child nodes, in order.
#[derive(Debug, Clone)]
pub struct Node {
    pub body: Vec<u8>,
    pub children: Vec<Node>,
}

impl Node {
    pub fn node_type(&self) -> Option<u8> {
        self.body.first().copied()
    }
}

/// A whole OTBM file: the 4-byte magic prefix plus the root node.
#[derive(Debug, Clone)]
pub struct OtbmMap {
    pub magic: u32,
    pub root: Node,
}

/// Lightweight header info pulled from the root's first child
/// (`OTBM_MAP_HEADER`). All fields are best-effort.
#[derive(Debug, Clone, Copy, Default)]
pub struct MapHeader {
    pub version: u32,
    pub width: u16,
    pub height: u16,
    pub items_major: u32,
    pub items_minor: u32,
}

fn deescape(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == NODE_ESC {
            i += 1;
            if i < raw.len() {
                out.push(raw[i]);
                i += 1;
            }
        } else {
            out.push(raw[i]);
            i += 1;
        }
    }
    out
}

fn escape(body: &[u8], out: &mut Vec<u8>) {
    for &b in body {
        if b == NODE_ESC || b == NODE_INIT || b == NODE_TERM {
            out.push(NODE_ESC);
        }
        out.push(b);
    }
}

/// Parse the node whose opening `0xFE` sits at `data[start]`. Returns the
/// node and the index just past its closing `0xFF`.
fn read_node(data: &[u8], start: usize) -> Result<(Node, usize)> {
    debug_assert_eq!(data.get(start), Some(&NODE_INIT));
    let body_start = start + 1;
    let mut i = body_start;
    let mut body_end: Option<usize> = None;
    let mut children = Vec::new();

    while i < data.len() {
        let b = data[i];

        // The body runs until the first unescaped child-open or node-close.
        if body_end.is_none() && (b == NODE_INIT || b == NODE_TERM) {
            body_end = Some(i);
        }

        match b {
            NODE_ESC => {
                // Skip the escape byte and the literal it guards.
                i += 2;
            }
            NODE_INIT => {
                let (child, next) = read_node(data, i)?;
                children.push(child);
                i = next;
            }
            NODE_TERM => {
                let end = body_end.unwrap_or(i);
                let body = deescape(&data[body_start..end]);
                return Ok((Node { body, children }, i + 1));
            }
            _ => i += 1,
        }
    }

    Err(OtbmError::Truncated)
}

fn write_node(node: &Node, out: &mut Vec<u8>) {
    out.push(NODE_INIT);
    escape(&node.body, out);
    for child in &node.children {
        write_node(child, out);
    }
    out.push(NODE_TERM);
}

impl OtbmMap {
    /// Parse an OTBM byte buffer into a node tree.
    pub fn parse(data: &[u8]) -> Result<Self> {
        if data.len() < 5 {
            return Err(OtbmError::Truncated);
        }
        let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        // NULL or ASCII "OTBM" are the two accepted magics.
        if magic != 0x0000_0000 && magic != 0x4D42_544F {
            return Err(OtbmError::BadMagic(magic));
        }
        if data[4] != NODE_INIT {
            return Err(OtbmError::MissingRoot);
        }
        let (root, _) = read_node(data, 4)?;
        Ok(OtbmMap { magic, root })
    }

    /// Serialize back to OTBM bytes. Byte-identical to the input save for
    /// any ids mutated via [`Self::convert_ids`].
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&self.magic.to_le_bytes());
        write_node(&self.root, &mut out);
        out
    }

    /// Read the map header from the root's `OTBM_MAP_HEADER` child, if any.
    pub fn header(&self) -> Option<MapHeader> {
        let h = self
            .root
            .children
            .iter()
            .find(|n| n.node_type() == Some(OTBM_MAP_HEADER))
            .or(if self.root.node_type() == Some(OTBM_MAP_HEADER) {
                Some(&self.root)
            } else {
                None
            })?;
        if h.body.len() < 17 {
            return None;
        }
        Some(MapHeader {
            version: u32::from_le_bytes([h.body[1], h.body[2], h.body[3], h.body[4]]),
            width: u16::from_le_bytes([h.body[5], h.body[6]]),
            height: u16::from_le_bytes([h.body[7], h.body[8]]),
            items_major: u32::from_le_bytes([h.body[9], h.body[10], h.body[11], h.body[12]]),
            items_minor: u32::from_le_bytes([h.body[13], h.body[14], h.body[15], h.body[16]]),
        })
    }

    /// Walk every node, translating item ids through `map`. Returns the
    /// number of ids actually changed (a value differing from its
    /// translation). Item nodes carry their id inline; tile and house-tile
    /// nodes carry an optional ground id in their attributes.
    pub fn convert_ids(&mut self, map: &IdMap) -> u32 {
        let mut changed = 0;
        convert_node(&mut self.root, map, &mut changed);
        changed
    }

    /// Count item ids the converter would walk (item nodes + tiles with a
    /// ground id). Used for the pre-conversion preview.
    pub fn count_ids(&self) -> u32 {
        let mut count = 0;
        count_node(&self.root, &mut count);
        count
    }
}

fn convert_node(node: &mut Node, map: &IdMap, changed: &mut u32) {
    match node.node_type() {
        Some(OTBM_ITEM) => patch_item_id(&mut node.body, map, changed),
        Some(OTBM_TILE) => patch_ground_id(&mut node.body, 3, map, changed),
        // House tile body is [type][x:u8][y:u8][houseId:u32], attrs after.
        Some(OTBM_HOUSETILE) => patch_ground_id(&mut node.body, 7, map, changed),
        _ => {}
    }
    for child in &mut node.children {
        convert_node(child, map, changed);
    }
}

fn count_node(node: &Node, count: &mut u32) {
    match node.node_type() {
        Some(OTBM_ITEM) => *count += 1,
        Some(OTBM_TILE) => {
            if find_ground_offset(&node.body, 3).is_some() {
                *count += 1;
            }
        }
        Some(OTBM_HOUSETILE) => {
            if find_ground_offset(&node.body, 7).is_some() {
                *count += 1;
            }
        }
        _ => {}
    }
    for child in &node.children {
        count_node(child, count);
    }
}

/// Item node body: `[0x06][id:u16 LE][attrs…]`.
fn patch_item_id(body: &mut [u8], map: &IdMap, changed: &mut u32) {
    if body.len() < 3 {
        return;
    }
    let id = u16::from_le_bytes([body[1], body[2]]);
    let new = map.convert(id);
    if new != id {
        body[1..3].copy_from_slice(&new.to_le_bytes());
        *changed += 1;
    }
}

/// Patch the ground-item id (`OTBM_ATTR_ITEM`) inside a tile/house-tile
/// body, if present. `attr_start` is the byte offset where the attribute
/// list begins (past the fixed-size header).
fn patch_ground_id(body: &mut [u8], attr_start: usize, map: &IdMap, changed: &mut u32) {
    if let Some(off) = find_ground_offset(body, attr_start) {
        let id = u16::from_le_bytes([body[off], body[off + 1]]);
        let new = map.convert(id);
        if new != id {
            body[off..off + 2].copy_from_slice(&new.to_le_bytes());
            *changed += 1;
        }
    }
}

/// Return the body offset of the ground-item id's two bytes, or `None`.
/// Walks the attribute list with the fixed length table; bails out (returns
/// `None`) on an attribute kind it doesn't recognise rather than risk
/// landing on the wrong byte.
fn find_ground_offset(body: &[u8], attr_start: usize) -> Option<usize> {
    let mut i = attr_start;
    while i < body.len() {
        let attr = body[i];
        i += 1;
        match attr {
            OTBM_ATTR_ITEM => {
                return if i + 2 <= body.len() { Some(i) } else { None };
            }
            // Fixed-width attributes.
            OTBM_ATTR_TILE_FLAGS => i += 4,
            OTBM_ATTR_ACTION_ID
            | OTBM_ATTR_UNIQUE_ID
            | OTBM_ATTR_DEPOT_ID
            | OTBM_ATTR_RUNE_CHARGES => i += 2,
            OTBM_ATTR_COUNT | OTBM_ATTR_HOUSEDOORID => i += 1,
            OTBM_ATTR_TELE_DEST => i += 5,
            // Length-prefixed (u16) string attributes.
            OTBM_ATTR_DESCRIPTION
            | OTBM_ATTR_TEXT
            | OTBM_ATTR_DESC
            | OTBM_ATTR_EXT_FILE
            | OTBM_ATTR_EXT_SPAWN_FILE
            | OTBM_ATTR_EXT_HOUSE_FILE => {
                if i + 2 > body.len() {
                    return None;
                }
                let len = u16::from_le_bytes([body[i], body[i + 1]]) as usize;
                i += 2 + len;
            }
            // Unknown attribute: stop walking to avoid corrupting the body.
            _ => return None,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a tiny but structurally valid OTBM in memory: header → map data
    /// → tile area → one tile (ground id 371) holding one item (id 372).
    fn sample_otbm() -> Vec<u8> {
        fn node(body: &[u8], children: Vec<Vec<u8>>) -> Vec<u8> {
            let mut out = vec![NODE_INIT];
            escape(body, &mut out);
            for c in children {
                out.extend_from_slice(&c);
            }
            out.push(NODE_TERM);
            out
        }

        // Item node: [0x06][id=372]
        let item = node(&[OTBM_ITEM, 372u16.to_le_bytes()[0], 372u16.to_le_bytes()[1]], vec![]);
        // Tile node: [0x05][x=1][y=2][ATTR_TILE_FLAGS + 4 bytes][ATTR_ITEM + ground=371], child item
        let mut tile_body = vec![OTBM_TILE, 1, 2, OTBM_ATTR_TILE_FLAGS, 0, 0, 0, 0, OTBM_ATTR_ITEM];
        tile_body.extend_from_slice(&371u16.to_le_bytes());
        let tile = node(&tile_body, vec![item]);
        // Tile area: [0x04][x:u16][y:u16][z:u8]
        let tile_area = node(&[0x04, 0, 0, 0, 0, 7], vec![tile]);
        // Map data: [0x02]
        let map_data = node(&[0x02], vec![tile_area]);
        // Header: [0x00][version:u32][w:u16][h:u16][major:u32][minor:u32]
        let mut header_body = vec![OTBM_MAP_HEADER];
        header_body.extend_from_slice(&2u32.to_le_bytes());
        header_body.extend_from_slice(&100u16.to_le_bytes());
        header_body.extend_from_slice(&200u16.to_le_bytes());
        header_body.extend_from_slice(&3u32.to_le_bytes());
        header_body.extend_from_slice(&57u32.to_le_bytes());
        let root = node(&header_body, vec![map_data]);

        let mut bytes = vec![0, 0, 0, 0]; // NULL magic
        bytes.extend_from_slice(&root);
        bytes
    }

    #[test]
    fn round_trip_is_byte_identical() {
        let bytes = sample_otbm();
        let map = OtbmMap::parse(&bytes).expect("parse");
        assert_eq!(map.to_bytes(), bytes);
    }

    #[test]
    fn header_is_parsed() {
        let map = OtbmMap::parse(&sample_otbm()).unwrap();
        let h = map.header().expect("header");
        assert_eq!(h.version, 2);
        assert_eq!(h.width, 100);
        assert_eq!(h.height, 200);
        assert_eq!(h.items_major, 3);
        assert_eq!(h.items_minor, 57);
    }

    #[test]
    fn count_finds_item_and_ground() {
        let map = OtbmMap::parse(&sample_otbm()).unwrap();
        // One inline item id + one tile ground id.
        assert_eq!(map.count_ids(), 2);
    }

    #[test]
    fn converts_item_and_ground_ids() {
        let mut map = OtbmMap::parse(&sample_otbm()).unwrap();
        // server 371 -> client 373, server 372 -> client 374.
        let changed = map.convert_ids(&IdMap::builtin(crate::idmap::Direction::ServerToClient));
        assert_eq!(changed, 2);

        // Re-parse the output and confirm the new ids stuck.
        let reparsed = OtbmMap::parse(&map.to_bytes()).unwrap();
        // Walk to the tile + item.
        let map_data = &reparsed.root.children[0];
        let tile_area = &map_data.children[0];
        let tile = &tile_area.children[0];
        // Ground id sits at the ATTR_ITEM offset (after [type,x,y,flags(5)]).
        let off = find_ground_offset(&tile.body, 3).unwrap();
        let ground = u16::from_le_bytes([tile.body[off], tile.body[off + 1]]);
        assert_eq!(ground, 373);
        let item = &tile.children[0];
        let item_id = u16::from_le_bytes([item.body[1], item.body[2]]);
        assert_eq!(item_id, 374);
    }

    #[test]
    fn conversion_round_trips_back() {
        let mut map = OtbmMap::parse(&sample_otbm()).unwrap();
        map.convert_ids(&IdMap::builtin(crate::idmap::Direction::ServerToClient));
        map.convert_ids(&IdMap::builtin(crate::idmap::Direction::ClientToServer));
        // server->client->server should restore the original bytes.
        assert_eq!(map.to_bytes(), sample_otbm());
    }

    #[test]
    fn rejects_bad_magic() {
        let bytes = vec![0xAA, 0xBB, 0xCC, 0xDD, NODE_INIT, 0x00, NODE_TERM];
        assert!(matches!(OtbmMap::parse(&bytes), Err(OtbmError::BadMagic(_))));
    }
}
