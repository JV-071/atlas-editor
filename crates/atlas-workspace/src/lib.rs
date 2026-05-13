//! Cross-format glue between `atlas-appearances` and `atlas-otb`.
//!
//! Phase 1.3 surface area — read-only, pure functions:
//!
//! - [`CrossRef`] links OTB items to appearance objects by
//!   `client_id` ↔ `appearance.id` and reports orphans on either side
//!   plus `client_id` collisions.
//! - [`AtlasExtensions`] is the 0x80–0x8B subset of an OTB item,
//!   reachable from either the OTB itself
//!   ([`AtlasExtensions::from_otb`]) or canonically derived from a set
//!   of appearance flags ([`AtlasExtensions::from_appearance`]).
//! - [`ExtensionsDiff`] is a per-field comparison of the two.
//! - [`Workspace`] is the minimal container that holds an optional
//!   `Appearances` and `Otb` side by side; mutation and persistence are
//!   Phase 3 concerns.

#![forbid(unsafe_code)]

use atlas_appearances::Appearances;
use atlas_otb::Otb;
use serde::{Deserialize, Serialize};

mod crossref;
mod extensions;

pub use crossref::CrossRef;
pub use extensions::{AtlasExtensions, ExtensionsDiff, FieldDiff};

/// A loaded editor session. Either side can be absent — the user may
/// open just one file before pulling in its counterpart.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Workspace {
    pub appearances: Option<Appearances>,
    pub otb: Option<Otb>,
}

impl Workspace {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a fresh [`CrossRef`] over the two parsed sources. Returns
    /// `None` when either side has not been loaded yet.
    pub fn cross_ref(&self) -> Option<CrossRef> {
        match (&self.appearances, &self.otb) {
            (Some(app), Some(otb)) => Some(CrossRef::build(app, otb)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cross_ref_requires_both_sides_loaded() {
        let mut ws = Workspace::new();
        assert!(ws.cross_ref().is_none());

        ws.appearances = Some(Appearances::default());
        assert!(ws.cross_ref().is_none());

        ws.otb = Some(Otb::default());
        let xr = ws.cross_ref().expect("both sides loaded");
        assert!(xr.is_consistent());
    }
}
