//! Low-level OTB container reader.
//!
//! OTB is a stream of nested nodes delimited by three sentinel bytes:
//! `NODE_START`, `NODE_END`, and `NODE_ESC`. Any payload byte that
//! happens to collide with one of these markers is escaped on disk by
//! prepending `NODE_ESC`. This module pulls a flat `&[u8]` apart into a
//! [`Node`] tree with the escape bytes already removed from `props`.

use atlas_core::{AtlasError, Result};

pub const NODE_START: u8 = 0xFE;
pub const NODE_END: u8 = 0xFF;
pub const NODE_ESC: u8 = 0xFD;

/// Defensive cap on nesting depth. Real OTBs only have two levels (root +
/// items); this guards us from crafted inputs that would otherwise blow
/// the stack via runaway `NODE_START` markers.
const MAX_DEPTH: usize = 32;

/// A parsed OTB node. `props` holds the raw payload with all escape
/// bytes already removed; higher layers split out the 4-byte flags
/// prefix and walk the TLV attribute stream that follows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub kind: u8,
    pub props: Vec<u8>,
    pub children: Vec<Node>,
}

/// Parse an OTB byte stream into its root node.
///
/// The first four bytes are a file identifier (classic TFS writes zero
/// here) followed by exactly one root node. Trailing data after the
/// root's `NODE_END` is rejected.
pub fn parse(bytes: &[u8]) -> Result<Node> {
    if bytes.len() < 4 {
        return Err(AtlasError::InvalidFormat(
            "OTB shorter than the 4-byte identifier header".into(),
        ));
    }
    // First four bytes are an identifier; classic TFS writes 0. We do
    // not validate the value because some tools write other constants
    // there and the format does not give it a defined meaning.
    let mut cursor = 4;

    if cursor >= bytes.len() || bytes[cursor] != NODE_START {
        return Err(AtlasError::InvalidFormat(
            "expected NODE_START byte after identifier header".into(),
        ));
    }
    cursor += 1;

    let (root, end) = read_node(bytes, cursor, 0)?;
    if end != bytes.len() {
        return Err(AtlasError::InvalidFormat(format!(
            "{} trailing byte(s) after root NODE_END",
            bytes.len() - end
        )));
    }
    Ok(root)
}

fn read_node(bytes: &[u8], start: usize, depth: usize) -> Result<(Node, usize)> {
    if depth >= MAX_DEPTH {
        return Err(AtlasError::InvalidFormat(format!(
            "OTB node nesting exceeds {MAX_DEPTH} levels"
        )));
    }
    let mut cursor = start;
    if cursor >= bytes.len() {
        return Err(AtlasError::InvalidFormat(
            "EOF before reading node kind byte".into(),
        ));
    }
    let kind = bytes[cursor];
    cursor += 1;

    let mut props: Vec<u8> = Vec::new();
    let mut children: Vec<Node> = Vec::new();
    let mut props_sealed = false;

    while cursor < bytes.len() {
        let b = bytes[cursor];
        match b {
            NODE_END => {
                cursor += 1;
                return Ok((
                    Node {
                        kind,
                        props,
                        children,
                    },
                    cursor,
                ));
            }
            NODE_START => {
                props_sealed = true;
                cursor += 1;
                let (child, next) = read_node(bytes, cursor, depth + 1)?;
                children.push(child);
                cursor = next;
            }
            NODE_ESC => {
                if props_sealed {
                    return Err(AtlasError::InvalidFormat(
                        "props byte found after a child node opened".into(),
                    ));
                }
                cursor += 1;
                if cursor >= bytes.len() {
                    return Err(AtlasError::InvalidFormat("EOF after escape byte".into()));
                }
                props.push(bytes[cursor]);
                cursor += 1;
            }
            _ => {
                if props_sealed {
                    return Err(AtlasError::InvalidFormat(
                        "props byte found after a child node opened".into(),
                    ));
                }
                props.push(b);
                cursor += 1;
            }
        }
    }

    Err(AtlasError::InvalidFormat("EOF before NODE_END".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Encode a single node, escaping any sentinel bytes in `props`.
    /// Children are pre-encoded byte slices that already include their
    /// own NODE_START/NODE_END markers.
    fn encode_node(kind: u8, props: &[u8], children: &[Vec<u8>]) -> Vec<u8> {
        let mut out = Vec::new();
        out.push(NODE_START);
        out.push(kind);
        for &b in props {
            if matches!(b, NODE_START | NODE_END | NODE_ESC) {
                out.push(NODE_ESC);
            }
            out.push(b);
        }
        for child in children {
            out.extend_from_slice(child);
        }
        out.push(NODE_END);
        out
    }

    fn wrap_file(root: Vec<u8>) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&root);
        out
    }

    #[test]
    fn parses_empty_root_with_no_children() {
        let bytes = wrap_file(encode_node(0, &[1, 2, 3, 4], &[]));
        let root = parse(&bytes).expect("parse should succeed");
        assert_eq!(root.kind, 0);
        assert_eq!(root.props, vec![1, 2, 3, 4]);
        assert!(root.children.is_empty());
    }

    #[test]
    fn unescapes_props_with_sentinel_bytes() {
        // All three sentinels appear in the payload and must be escaped.
        let payload = [NODE_START, NODE_END, NODE_ESC, 0x42];
        let bytes = wrap_file(encode_node(7, &payload, &[]));
        let root = parse(&bytes).expect("parse should succeed");
        assert_eq!(root.props, payload);
    }

    #[test]
    fn parses_nested_children() {
        let child_a = encode_node(1, &[0xAA], &[]);
        let child_b = encode_node(2, &[0xBB, 0xCC], &[]);
        let bytes = wrap_file(encode_node(0, &[0u8; 4], &[child_a, child_b]));
        let root = parse(&bytes).expect("parse should succeed");
        assert_eq!(root.children.len(), 2);
        assert_eq!(root.children[0].kind, 1);
        assert_eq!(root.children[0].props, vec![0xAA]);
        assert_eq!(root.children[1].kind, 2);
        assert_eq!(root.children[1].props, vec![0xBB, 0xCC]);
    }

    #[test]
    fn rejects_file_shorter_than_header() {
        let err = parse(&[0, 0, 0]).expect_err("3-byte file should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn rejects_missing_root_node_start() {
        let bytes = vec![0, 0, 0, 0, 0x00]; // header then a non-NODE_START byte
        let err = parse(&bytes).expect_err("missing NODE_START should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn rejects_trailing_bytes_after_root() {
        let mut bytes = wrap_file(encode_node(0, &[1, 2, 3, 4], &[]));
        bytes.push(0xAB);
        let err = parse(&bytes).expect_err("trailing bytes should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn rejects_escape_at_eof() {
        let mut bytes = wrap_file(encode_node(0, &[1, 2], &[]));
        // Replace the final NODE_END with an orphan NODE_ESC.
        let last = bytes.len() - 1;
        bytes[last] = NODE_ESC;
        let err = parse(&bytes).expect_err("orphan escape should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn rejects_props_after_child() {
        // Manually craft a malformed node: NODE_START kind=0, valid child,
        // then a stray prop byte before NODE_END.
        let child = encode_node(1, &[0xAA], &[]);
        let mut malformed = Vec::new();
        malformed.push(NODE_START);
        malformed.push(0); // kind
        malformed.extend_from_slice(&child);
        malformed.push(0x42); // stray prop byte
        malformed.push(NODE_END);
        let bytes = wrap_file(malformed);
        let err = parse(&bytes).expect_err("prop after child should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }
}
