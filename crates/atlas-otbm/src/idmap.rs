//! Server-id ↔ client-id translation tables for OTBM item ids.
//!
//! The pairs are lifted verbatim from the community "ServerId and ClientID
//! Map Converter" (credits: Glaszcz Koldre, Peonso, Forby). Only the
//! non-identity entries are shipped — any id absent from the table maps to
//! itself, which is exactly how the original `convertId` switch behaved via
//! its `default: return id` arm. The two directions are stored as
//! independent tables because the mapping is not a clean bijection (a
//! handful of ids collapse), so we never try to invert one to get the other.

use std::collections::HashMap;
use std::sync::OnceLock;

/// `from,to` pairs, one per line. Generated from the reference tool's
/// `ServerID_to_ClientID.js` / `ClientID_to_ServerID.js`.
static SERVER_TO_CLIENT_CSV: &str = include_str!("../data/server_to_client.csv");
static CLIENT_TO_SERVER_CSV: &str = include_str!("../data/client_to_server.csv");

/// Direction of the id translation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Server ids (TFS-style items.otb) → client ids (OTBR/Nostalrius).
    ServerToClient,
    /// Client ids → server ids.
    ClientToServer,
}

fn parse_csv(raw: &str) -> HashMap<u16, u16> {
    let mut map = HashMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((from, to)) = line.split_once(',') {
            if let (Ok(from), Ok(to)) = (from.trim().parse::<u16>(), to.trim().parse::<u16>()) {
                map.insert(from, to);
            }
        }
    }
    map
}

fn server_to_client() -> &'static HashMap<u16, u16> {
    static MAP: OnceLock<HashMap<u16, u16>> = OnceLock::new();
    MAP.get_or_init(|| parse_csv(SERVER_TO_CLIENT_CSV))
}

fn client_to_server() -> &'static HashMap<u16, u16> {
    static MAP: OnceLock<HashMap<u16, u16>> = OnceLock::new();
    MAP.get_or_init(|| parse_csv(CLIENT_TO_SERVER_CSV))
}

/// An id translation table. Either the embedded community mapping
/// ([`IdMap::builtin`]) or one derived from a specific server's
/// `items.otb` ([`IdMap::from_pairs`]). Ids absent from the table pass
/// through unchanged, so the table only needs the entries that actually
/// move.
#[derive(Debug, Clone)]
pub struct IdMap {
    table: HashMap<u16, u16>,
}

impl IdMap {
    /// The community default table for `direction`, lifted from the
    /// reference converter. Use this when the user hasn't supplied an OTB.
    pub fn builtin(direction: Direction) -> Self {
        let src = match direction {
            Direction::ServerToClient => server_to_client(),
            Direction::ClientToServer => client_to_server(),
        };
        // Clone the cached map so callers own their table uniformly with
        // the `from_pairs` path. The tables are ~46k u16 pairs (~360 KB).
        Self { table: src.clone() }
    }

    /// Build a table from explicit `(from, to)` pairs — e.g. a server's
    /// `items.otb`, where each item carries both a server id and a client
    /// id. Identity pairs (`from == to`) are dropped so [`Self::len`]
    /// reflects only the ids that actually move.
    pub fn from_pairs(pairs: impl IntoIterator<Item = (u16, u16)>) -> Self {
        let table = pairs
            .into_iter()
            .filter(|(from, to)| from != to)
            .collect();
        Self { table }
    }

    /// Translate one id, passing through unmapped ids unchanged.
    pub fn convert(&self, id: u16) -> u16 {
        self.table.get(&id).copied().unwrap_or(id)
    }

    /// Number of non-identity entries.
    pub fn len(&self) -> usize {
        self.table.len()
    }

    pub fn is_empty(&self) -> bool {
        self.table.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_pairs_translate() {
        // From the reference tool: server 371 -> client 373, and back.
        let s2c = IdMap::builtin(Direction::ServerToClient);
        let c2s = IdMap::builtin(Direction::ClientToServer);
        assert_eq!(s2c.convert(371), 373);
        assert_eq!(c2s.convert(373), 371);
    }

    #[test]
    fn unknown_ids_pass_through() {
        // 1..=99 are not remapped in the table.
        let s2c = IdMap::builtin(Direction::ServerToClient);
        assert_eq!(s2c.convert(1), 1);
        assert_eq!(s2c.convert(64000), 64000);
    }

    #[test]
    fn tables_are_populated() {
        assert!(IdMap::builtin(Direction::ServerToClient).len() > 40_000);
        assert!(IdMap::builtin(Direction::ClientToServer).len() > 40_000);
    }

    #[test]
    fn from_pairs_drops_identity_and_maps_rest() {
        let map = IdMap::from_pairs([(1, 1), (100, 200), (300, 400)]);
        assert_eq!(map.len(), 2); // (1,1) dropped
        assert_eq!(map.convert(100), 200);
        assert_eq!(map.convert(1), 1); // identity / unmapped
        assert_eq!(map.convert(999), 999);
    }
}
