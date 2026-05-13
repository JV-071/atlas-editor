//! TLV attribute reader for OTB node props.
//!
//! After the leading 4-byte flags field, every node's props is a stream
//! of `(type:u8, length:u16 LE, value:[u8; length])` records. This module
//! is a tiny zero-copy cursor over that stream plus typed value
//! decoders used by the higher-level item parser.

use atlas_core::{AtlasError, Result};

/// Walks a TLV stream one record at a time.
pub struct AttrCursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> AttrCursor<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    /// Read the next `(type, value)` pair, or `None` if the stream is
    /// exhausted. Returns an error if the stream is truncated mid-record.
    pub fn next_attr(&mut self) -> Result<Option<(u8, &'a [u8])>> {
        if self.pos >= self.data.len() {
            return Ok(None);
        }
        if self.pos + 3 > self.data.len() {
            return Err(AtlasError::InvalidFormat(
                "truncated TLV attribute header".into(),
            ));
        }
        let attr_type = self.data[self.pos];
        let length =
            u16::from_le_bytes([self.data[self.pos + 1], self.data[self.pos + 2]]) as usize;
        let value_start = self.pos + 3;
        let value_end = value_start + length;
        if value_end > self.data.len() {
            return Err(AtlasError::InvalidFormat(format!(
                "attribute 0x{attr_type:02x}: declared length {length} overruns remaining payload"
            )));
        }
        self.pos = value_end;
        Ok(Some((attr_type, &self.data[value_start..value_end])))
    }
}

pub fn read_u8(value: &[u8], attr_type: u8) -> Result<u8> {
    if value.len() != 1 {
        return Err(AtlasError::InvalidFormat(format!(
            "attribute 0x{attr_type:02x}: expected 1 byte, got {}",
            value.len()
        )));
    }
    Ok(value[0])
}

pub fn read_u16(value: &[u8], attr_type: u8) -> Result<u16> {
    if value.len() != 2 {
        return Err(AtlasError::InvalidFormat(format!(
            "attribute 0x{attr_type:02x}: expected 2 bytes, got {}",
            value.len()
        )));
    }
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

pub fn read_u32(value: &[u8], attr_type: u8) -> Result<u32> {
    if value.len() != 4 {
        return Err(AtlasError::InvalidFormat(format!(
            "attribute 0x{attr_type:02x}: expected 4 bytes, got {}",
            value.len()
        )));
    }
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

/// Strings are read lossily — invalid bytes are replaced with U+FFFD.
/// Legacy OTBs occasionally mix Latin-1 with UTF-8 and we want the
/// reader to keep going rather than fail the whole file. Phase 3 (write)
/// will revisit byte-exact preservation for round-trip.
pub fn read_string(value: &[u8]) -> String {
    String::from_utf8_lossy(value).into_owned()
}

/// Decode a `u8` length-prefixed list of `u8` ids, as used by the 0x82
/// `VOCATIONS` attribute.
pub fn read_u8_list(value: &[u8], attr_type: u8) -> Result<Vec<u8>> {
    if value.is_empty() {
        return Err(AtlasError::InvalidFormat(format!(
            "attribute 0x{attr_type:02x}: missing length byte"
        )));
    }
    let count = value[0] as usize;
    let rest = &value[1..];
    if rest.len() != count {
        return Err(AtlasError::InvalidFormat(format!(
            "attribute 0x{attr_type:02x}: length byte says {count}, payload has {}",
            rest.len()
        )));
    }
    Ok(rest.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tlv(attr_type: u8, value: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(3 + value.len());
        out.push(attr_type);
        out.extend_from_slice(&(value.len() as u16).to_le_bytes());
        out.extend_from_slice(value);
        out
    }

    #[test]
    fn iterates_multiple_attrs() {
        let mut stream = Vec::new();
        stream.extend_from_slice(&tlv(0x10, &7u16.to_le_bytes()));
        stream.extend_from_slice(&tlv(0x12, b"rope"));

        let mut cur = AttrCursor::new(&stream);
        let (t, v) = cur.next_attr().unwrap().unwrap();
        assert_eq!(t, 0x10);
        assert_eq!(read_u16(v, t).unwrap(), 7);

        let (t, v) = cur.next_attr().unwrap().unwrap();
        assert_eq!(t, 0x12);
        assert_eq!(read_string(v), "rope");

        assert!(cur.next_attr().unwrap().is_none());
    }

    #[test]
    fn rejects_truncated_header() {
        // type + only one of the two length bytes
        let stream = vec![0x10, 0x02];
        let mut cur = AttrCursor::new(&stream);
        let err = cur.next_attr().expect_err("truncated header should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn rejects_length_past_end_of_stream() {
        // Says 4 bytes follow but only 1 actually does.
        let stream = vec![0x10, 0x04, 0x00, 0xAB];
        let mut cur = AttrCursor::new(&stream);
        let err = cur.next_attr().expect_err("overrunning length should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }

    #[test]
    fn typed_reads_validate_size() {
        assert!(read_u16(&[0x01], 0x10).is_err());
        assert!(read_u32(&[0x01, 0x02], 0x14).is_err());
        assert!(read_u8(&[0x01, 0x02], 0x80).is_err());
    }

    #[test]
    fn u8_list_round_trips() {
        let payload = [2, 0x01, 0x05];
        let list = read_u8_list(&payload, 0x82).unwrap();
        assert_eq!(list, vec![1, 5]);
    }

    #[test]
    fn u8_list_rejects_length_mismatch() {
        // Says 3 entries but only 1 byte of payload follows.
        let payload = [3, 0x01];
        let err = read_u8_list(&payload, 0x82).expect_err("mismatch should fail");
        assert!(matches!(err, AtlasError::InvalidFormat(_)));
    }
}
