//! Build the OTB ↔ appearances cross-reference by `client_id` ↔ `appearance.id`.

use std::collections::HashMap;

use atlas_appearances::Appearances;
use atlas_otb::Otb;
use serde::{Deserialize, Serialize};

/// Mapping between OTB items and `appearances.dat` objects.
///
/// All indices refer to positions in `Otb::items` and
/// `Appearances::objects` respectively. The cross-reference is a pure
/// view over the two source vectors — both must outlive the
/// [`CrossRef`] for the indices to remain valid.
///
/// Outfits, effects, and missiles are intentionally ignored: items.otb
/// only ever describes object appearances.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrossRef {
    otb_to_appearance: Vec<Option<usize>>,
    appearance_to_otb: Vec<Vec<usize>>,
    otb_orphans: Vec<usize>,
    appearance_orphans: Vec<usize>,
    collisions: Vec<usize>,
}

impl CrossRef {
    /// Build the cross-reference. Pure: no I/O, no mutation of the
    /// inputs. Linear in `items.len() + objects.len()`.
    pub fn build(appearances: &Appearances, otb: &Otb) -> Self {
        let mut id_to_app: HashMap<u32, usize> = HashMap::with_capacity(appearances.objects.len());
        for (idx, a) in appearances.objects.iter().enumerate() {
            // Appearance ids are unique by construction in real files; if
            // a duplicate ever appears we keep the first occurrence so
            // collision detection on the OTB side stays meaningful.
            id_to_app.entry(a.id.0).or_insert(idx);
        }

        let mut otb_to_appearance: Vec<Option<usize>> = Vec::with_capacity(otb.items.len());
        let mut appearance_to_otb: Vec<Vec<usize>> = vec![Vec::new(); appearances.objects.len()];
        let mut otb_orphans: Vec<usize> = Vec::new();

        for (otb_idx, item) in otb.items.iter().enumerate() {
            // `client_id` of `None` or `Some(0)` means the OTB item is
            // server-only (no sprite). Treat both as orphans — they have
            // no appearance counterpart by definition.
            let target = match item.client_id {
                Some(cid) if cid != 0 => id_to_app.get(&(cid as u32)).copied(),
                _ => None,
            };
            match target {
                Some(app_idx) => {
                    otb_to_appearance.push(Some(app_idx));
                    appearance_to_otb[app_idx].push(otb_idx);
                }
                None => {
                    otb_to_appearance.push(None);
                    otb_orphans.push(otb_idx);
                }
            }
        }

        let mut appearance_orphans: Vec<usize> = Vec::new();
        let mut collisions: Vec<usize> = Vec::new();
        for (app_idx, mapped) in appearance_to_otb.iter().enumerate() {
            match mapped.len() {
                0 => appearance_orphans.push(app_idx),
                1 => {}
                _ => collisions.push(app_idx),
            }
        }

        Self {
            otb_to_appearance,
            appearance_to_otb,
            otb_orphans,
            appearance_orphans,
            collisions,
        }
    }

    /// Appearance object index that the given OTB item maps to, if any.
    pub fn appearance_of(&self, otb_idx: usize) -> Option<usize> {
        self.otb_to_appearance.get(otb_idx).copied().flatten()
    }

    /// OTB item indices whose `client_id` resolves to the given
    /// appearance object. Empty slice means the appearance has no OTB
    /// entry; multiple entries means a `client_id` collision.
    pub fn otb_items_for(&self, appearance_idx: usize) -> &[usize] {
        self.appearance_to_otb
            .get(appearance_idx)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    /// OTB items with no appearance counterpart. Either `client_id` is
    /// missing/zero or the value points at an id that does not exist in
    /// `appearances.objects`.
    pub fn otb_orphans(&self) -> &[usize] {
        &self.otb_orphans
    }

    /// Appearance objects that no OTB item references.
    pub fn appearance_orphans(&self) -> &[usize] {
        &self.appearance_orphans
    }

    /// Appearance objects that two or more OTB items resolve to. In a
    /// well-formed catalog this list is empty.
    pub fn collisions(&self) -> &[usize] {
        &self.collisions
    }

    /// Convenience: every problem the cross-reference detected is
    /// somewhere in here. `true` means the catalog is fully consistent.
    pub fn is_consistent(&self) -> bool {
        self.otb_orphans.is_empty()
            && self.appearance_orphans.is_empty()
            && self.collisions.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_appearances::{AppearanceInfo, Appearances};
    use atlas_core::{AppearanceCategory, AssetId};
    use atlas_otb::{Otb, OtbHeader, OtbItem};

    fn object(id: u32) -> AppearanceInfo {
        AppearanceInfo {
            id: AssetId(id),
            category: AppearanceCategory::Object,
            ..Default::default()
        }
    }

    fn otb_item(client_id: Option<u16>) -> OtbItem {
        OtbItem {
            client_id,
            ..Default::default()
        }
    }

    fn otb_of(items: Vec<OtbItem>) -> Otb {
        Otb {
            header: OtbHeader::default(),
            items,
        }
    }

    fn appearances_of(objects: Vec<AppearanceInfo>) -> Appearances {
        Appearances {
            objects,
            ..Default::default()
        }
    }

    #[test]
    fn empty_inputs_yield_empty_crossref() {
        let xr = CrossRef::build(&Appearances::default(), &Otb::default());
        assert!(xr.is_consistent());
        assert!(xr.otb_orphans().is_empty());
        assert!(xr.appearance_orphans().is_empty());
        assert!(xr.collisions().is_empty());
    }

    #[test]
    fn happy_path_one_to_one_match() {
        let app = appearances_of(vec![object(100), object(101), object(102)]);
        let otb = otb_of(vec![
            otb_item(Some(100)),
            otb_item(Some(101)),
            otb_item(Some(102)),
        ]);

        let xr = CrossRef::build(&app, &otb);
        assert!(xr.is_consistent());
        assert_eq!(xr.appearance_of(0), Some(0));
        assert_eq!(xr.appearance_of(1), Some(1));
        assert_eq!(xr.appearance_of(2), Some(2));
        assert_eq!(xr.otb_items_for(0), &[0]);
        assert_eq!(xr.otb_items_for(1), &[1]);
        assert_eq!(xr.otb_items_for(2), &[2]);
    }

    #[test]
    fn otb_item_with_unknown_client_id_is_orphan() {
        let app = appearances_of(vec![object(100)]);
        let otb = otb_of(vec![otb_item(Some(100)), otb_item(Some(999))]);
        let xr = CrossRef::build(&app, &otb);
        assert_eq!(xr.appearance_of(0), Some(0));
        assert_eq!(xr.appearance_of(1), None);
        assert_eq!(xr.otb_orphans(), &[1]);
    }

    #[test]
    fn otb_item_without_client_id_is_orphan() {
        let app = appearances_of(vec![object(100)]);
        let otb = otb_of(vec![otb_item(None), otb_item(Some(0)), otb_item(Some(100))]);
        let xr = CrossRef::build(&app, &otb);
        assert_eq!(xr.otb_orphans(), &[0, 1]);
        assert_eq!(xr.appearance_of(2), Some(0));
    }

    #[test]
    fn appearance_without_otb_is_orphan() {
        let app = appearances_of(vec![object(100), object(200), object(300)]);
        let otb = otb_of(vec![otb_item(Some(100)), otb_item(Some(300))]);
        let xr = CrossRef::build(&app, &otb);
        assert_eq!(xr.appearance_orphans(), &[1]);
        assert!(xr.otb_orphans().is_empty());
    }

    #[test]
    fn duplicate_client_id_is_detected_as_collision() {
        let app = appearances_of(vec![object(100)]);
        let otb = otb_of(vec![otb_item(Some(100)), otb_item(Some(100))]);
        let xr = CrossRef::build(&app, &otb);
        assert_eq!(xr.collisions(), &[0]);
        assert_eq!(xr.otb_items_for(0), &[0, 1]);
        assert!(xr.otb_orphans().is_empty());
    }

    #[test]
    fn outfits_effects_and_missiles_are_ignored() {
        // Only `objects` participate; an outfit with the same id as an
        // OTB client_id must NOT match.
        let app = Appearances {
            outfits: vec![object(100)],
            ..Default::default()
        };
        let otb = otb_of(vec![otb_item(Some(100))]);
        let xr = CrossRef::build(&app, &otb);
        assert_eq!(xr.otb_orphans(), &[0]);
        assert!(xr.appearance_orphans().is_empty());
    }
}
