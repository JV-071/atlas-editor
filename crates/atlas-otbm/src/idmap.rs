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

/// Translate a single item id. Ids not present in the table pass through
/// unchanged (identity), matching the reference tool's `default` arm.
pub fn convert_id(id: u16, direction: Direction) -> u16 {
    let table = match direction {
        Direction::ServerToClient => server_to_client(),
        Direction::ClientToServer => client_to_server(),
    };
    table.get(&id).copied().unwrap_or(id)
}

/// Number of non-identity entries in the active direction. Surfaced so the
/// UI can show how big the translation table is.
pub fn table_len(direction: Direction) -> usize {
    match direction {
        Direction::ServerToClient => server_to_client().len(),
        Direction::ClientToServer => client_to_server().len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_pairs_translate() {
        // From the reference tool: server 371 -> client 373, and back.
        assert_eq!(convert_id(371, Direction::ServerToClient), 373);
        assert_eq!(convert_id(373, Direction::ClientToServer), 371);
    }

    #[test]
    fn unknown_ids_pass_through() {
        // 1..=99 are not remapped in the table.
        assert_eq!(convert_id(1, Direction::ServerToClient), 1);
        assert_eq!(convert_id(64000, Direction::ClientToServer), 64000);
    }

    #[test]
    fn tables_are_populated() {
        assert!(table_len(Direction::ServerToClient) > 40_000);
        assert!(table_len(Direction::ClientToServer) > 40_000);
    }
}
