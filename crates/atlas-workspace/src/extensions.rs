//! Atlas-extension projection of an OTB item and diff against an
//! appearance's flags.
//!
//! The 0x80–0x8B attribute range in `items.otb` mirrors a subset of
//! `AppearanceFlags`. [`AtlasExtensions`] is a normalized view of just
//! those fields, with two constructors:
//!
//! - [`AtlasExtensions::from_otb`] — what the OTB currently says.
//! - [`AtlasExtensions::from_appearance`] — what the OTB *should* say
//!   given a set of appearance flags.
//!
//! [`ExtensionsDiff::compute`] compares the two and reports per-field
//! agreement, divergence, or one-sided presence. The mutation side
//! (applying a diff back onto an `OtbItem`) is a Phase 3 concern.

use atlas_appearances::AppearanceFlags;
use atlas_core::{HookType, Vocation, WeaponType};
use atlas_otb::{ExpireFlags, OtbItem};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::hash::Hash;

/// Projection of an OTB item to only the 0x80–0x8B Atlas extensions.
///
/// All fields use the OTB-native types so equality with
/// [`AtlasExtensions::from_otb`] is byte-faithful. The
/// [`AtlasExtensions::from_appearance`] constructor narrows wider proto
/// types (`u32` → `u16`/`u8`) and returns the canonical OTB shape; the
/// few fields where narrowing could lose information are documented on
/// the function.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AtlasExtensions {
    pub weapon_type: Option<WeaponType>,
    pub minimum_level: Option<u32>,
    pub vocations: Vec<Vocation>,
    pub imbuement_slots: Option<u8>,
    pub gem_quality_id: Option<u16>,
    pub gem_vocation_id: Option<u16>,
    pub proficiency_id: Option<u16>,
    pub cyclopedia_type: Option<u16>,
    pub dual_wielding: Option<bool>,
    pub expire_flags: Option<ExpireFlags>,
    pub former_object_type_id: Option<u16>,
    pub hook_direction: Option<HookType>,
}

impl AtlasExtensions {
    /// Project an OTB item to its Atlas-extension fields only.
    pub fn from_otb(item: &OtbItem) -> Self {
        Self {
            weapon_type: item.weapon_type,
            minimum_level: item.minimum_level,
            vocations: item.vocations.clone(),
            imbuement_slots: item.imbuement_slots,
            gem_quality_id: item.gem_quality_id,
            gem_vocation_id: item.gem_vocation_id,
            proficiency_id: item.proficiency_id,
            cyclopedia_type: item.cyclopedia_type,
            dual_wielding: item.dual_wielding,
            expire_flags: item.expire_flags,
            former_object_type_id: item.former_object_type_id,
            hook_direction: item.hook_direction,
        }
    }

    /// Derive the canonical OTB extensions from an appearance's flags.
    ///
    /// Conventions, matching the TFS writer style:
    /// - Boolean flags that are `false` produce `None` (no byte written
    ///   on disk), since unset OTB attributes are absent by default.
    /// - `ExpireFlags` collapses to `None` when every component bit is
    ///   `false`, matching the same convention.
    /// - Numeric narrowings (`u32` → `u16`/`u8`) that overflow yield
    ///   `None`. The values affected in real catalogs (gem ids,
    ///   cyclopedia type, slot count) never exceed `u16`/`u8`, so this
    ///   is a defensive path rather than an expected one.
    pub fn from_appearance(flags: &AppearanceFlags) -> Self {
        Self {
            weapon_type: flags.weapon_type,
            minimum_level: flags.minimum_level,
            vocations: flags.restrict_to_vocation.clone(),
            imbuement_slots: flags
                .imbueable
                .and_then(|i| u8::try_from(i.slot_count).ok()),
            gem_quality_id: flags
                .skillwheel_gem
                .and_then(|s| s.gem_quality_id)
                .and_then(|v| u16::try_from(v).ok()),
            gem_vocation_id: flags
                .skillwheel_gem
                .and_then(|s| s.vocation_id)
                .and_then(|v| u16::try_from(v).ok()),
            proficiency_id: flags
                .proficiency
                .and_then(|p| u16::try_from(p.proficiency_id).ok()),
            cyclopedia_type: flags
                .cyclopedia_item
                .and_then(|c| u16::try_from(c.cyclopedia_type).ok()),
            dual_wielding: if flags.dual_wielding {
                Some(true)
            } else {
                None
            },
            expire_flags: expire_flags_from_appearance(flags),
            former_object_type_id: flags
                .changed_to_expire
                .and_then(|c| u16::try_from(c.former_object_typeid).ok()),
            hook_direction: flags.hook.map(|h| h.direction),
        }
    }
}

fn expire_flags_from_appearance(flags: &AppearanceFlags) -> Option<ExpireFlags> {
    let combined = ExpireFlags {
        wearout: flags.wearout,
        clock_expire: flags.clockexpire,
        expire: flags.expire,
        expire_stop: flags.expirestop,
    };
    if combined == ExpireFlags::default() {
        None
    } else {
        Some(combined)
    }
}

/// Per-field comparison outcome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FieldDiff<T> {
    /// Both sides agree (including both absent).
    Same,
    /// OTB has a value, appearance does not.
    OtbOnly(T),
    /// Appearance has a value, OTB does not.
    AppearanceOnly(T),
    /// Both sides have a value and they disagree.
    Conflict { otb: T, appearance: T },
}

impl<T> FieldDiff<T> {
    pub fn is_same(&self) -> bool {
        matches!(self, Self::Same)
    }
}

fn diff_option<T: Clone + PartialEq>(otb: Option<T>, app: Option<T>) -> FieldDiff<T> {
    match (otb, app) {
        (None, None) => FieldDiff::Same,
        (Some(o), None) => FieldDiff::OtbOnly(o),
        (None, Some(a)) => FieldDiff::AppearanceOnly(a),
        (Some(o), Some(a)) => {
            if o == a {
                FieldDiff::Same
            } else {
                FieldDiff::Conflict {
                    otb: o,
                    appearance: a,
                }
            }
        }
    }
}

fn diff_set<T: Clone + Eq + Hash>(otb: &[T], app: &[T]) -> FieldDiff<Vec<T>> {
    match (otb.is_empty(), app.is_empty()) {
        (true, true) => FieldDiff::Same,
        (false, true) => FieldDiff::OtbOnly(otb.to_vec()),
        (true, false) => FieldDiff::AppearanceOnly(app.to_vec()),
        (false, false) => {
            let otb_set: HashSet<&T> = otb.iter().collect();
            let app_set: HashSet<&T> = app.iter().collect();
            if otb_set == app_set {
                FieldDiff::Same
            } else {
                FieldDiff::Conflict {
                    otb: otb.to_vec(),
                    appearance: app.to_vec(),
                }
            }
        }
    }
}

/// Full diff between an item's recorded extensions and what its
/// appearance flags imply.
///
/// Vocations are compared as a set (order-insensitive); every other
/// field uses straightforward optional equality.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtensionsDiff {
    pub weapon_type: FieldDiff<WeaponType>,
    pub minimum_level: FieldDiff<u32>,
    pub vocations: FieldDiff<Vec<Vocation>>,
    pub imbuement_slots: FieldDiff<u8>,
    pub gem_quality_id: FieldDiff<u16>,
    pub gem_vocation_id: FieldDiff<u16>,
    pub proficiency_id: FieldDiff<u16>,
    pub cyclopedia_type: FieldDiff<u16>,
    pub dual_wielding: FieldDiff<bool>,
    pub expire_flags: FieldDiff<ExpireFlags>,
    pub former_object_type_id: FieldDiff<u16>,
    pub hook_direction: FieldDiff<HookType>,
}

impl ExtensionsDiff {
    /// Compute the diff between the OTB-side view and the appearance-
    /// derived view.
    pub fn compute(otb: &AtlasExtensions, derived: &AtlasExtensions) -> Self {
        Self {
            weapon_type: diff_option(otb.weapon_type, derived.weapon_type),
            minimum_level: diff_option(otb.minimum_level, derived.minimum_level),
            vocations: diff_set(&otb.vocations, &derived.vocations),
            imbuement_slots: diff_option(otb.imbuement_slots, derived.imbuement_slots),
            gem_quality_id: diff_option(otb.gem_quality_id, derived.gem_quality_id),
            gem_vocation_id: diff_option(otb.gem_vocation_id, derived.gem_vocation_id),
            proficiency_id: diff_option(otb.proficiency_id, derived.proficiency_id),
            cyclopedia_type: diff_option(otb.cyclopedia_type, derived.cyclopedia_type),
            dual_wielding: diff_option(otb.dual_wielding, derived.dual_wielding),
            expire_flags: diff_option(otb.expire_flags, derived.expire_flags),
            former_object_type_id: diff_option(
                otb.former_object_type_id,
                derived.former_object_type_id,
            ),
            hook_direction: diff_option(otb.hook_direction, derived.hook_direction),
        }
    }

    /// Convenience: `true` when every field agrees.
    pub fn is_in_sync(&self) -> bool {
        self.weapon_type.is_same()
            && self.minimum_level.is_same()
            && self.vocations.is_same()
            && self.imbuement_slots.is_same()
            && self.gem_quality_id.is_same()
            && self.gem_vocation_id.is_same()
            && self.proficiency_id.is_same()
            && self.cyclopedia_type.is_same()
            && self.dual_wielding.is_same()
            && self.expire_flags.is_same()
            && self.former_object_type_id.is_same()
            && self.hook_direction.is_same()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_appearances::{
        ChangedToExpireInfo, CyclopediaInfo, HookInfo, ImbueableInfo, ProficiencyInfo,
        SkillWheelGemInfo,
    };
    use atlas_otb::OtbItem;

    fn empty_otb_item() -> OtbItem {
        OtbItem::default()
    }

    #[test]
    fn from_appearance_maps_every_extension_field() {
        let flags = AppearanceFlags {
            weapon_type: Some(WeaponType::Sword),
            minimum_level: Some(80),
            restrict_to_vocation: vec![Vocation::Knight, Vocation::Paladin],
            imbueable: Some(ImbueableInfo { slot_count: 3 }),
            skillwheel_gem: Some(SkillWheelGemInfo {
                gem_quality_id: Some(11),
                vocation_id: Some(22),
            }),
            proficiency: Some(ProficiencyInfo { proficiency_id: 33 }),
            cyclopedia_item: Some(CyclopediaInfo {
                cyclopedia_type: 44,
            }),
            dual_wielding: true,
            wearout: false,
            clockexpire: true,
            expire: false,
            expirestop: true,
            changed_to_expire: Some(ChangedToExpireInfo {
                former_object_typeid: 7777,
            }),
            hook: Some(HookInfo {
                direction: HookType::East,
            }),
            ..Default::default()
        };

        let ext = AtlasExtensions::from_appearance(&flags);
        assert_eq!(ext.weapon_type, Some(WeaponType::Sword));
        assert_eq!(ext.minimum_level, Some(80));
        assert_eq!(ext.vocations, vec![Vocation::Knight, Vocation::Paladin]);
        assert_eq!(ext.imbuement_slots, Some(3));
        assert_eq!(ext.gem_quality_id, Some(11));
        assert_eq!(ext.gem_vocation_id, Some(22));
        assert_eq!(ext.proficiency_id, Some(33));
        assert_eq!(ext.cyclopedia_type, Some(44));
        assert_eq!(ext.dual_wielding, Some(true));
        let expire = ext.expire_flags.expect("expire flags should be set");
        assert!(!expire.wearout);
        assert!(expire.clock_expire);
        assert!(!expire.expire);
        assert!(expire.expire_stop);
        assert_eq!(ext.former_object_type_id, Some(7777));
        assert_eq!(ext.hook_direction, Some(HookType::East));
    }

    #[test]
    fn dual_wielding_false_collapses_to_none() {
        let flags = AppearanceFlags::default();
        let ext = AtlasExtensions::from_appearance(&flags);
        assert_eq!(ext.dual_wielding, None);
    }

    #[test]
    fn expire_flags_all_false_collapse_to_none() {
        let flags = AppearanceFlags::default();
        let ext = AtlasExtensions::from_appearance(&flags);
        assert_eq!(ext.expire_flags, None);
    }

    #[test]
    fn imbueable_with_zero_slots_is_still_present() {
        // Imbueable submessage present with slot_count=0 is semantically
        // distinct from "not imbueable at all" — preserve that.
        let flags = AppearanceFlags {
            imbueable: Some(ImbueableInfo { slot_count: 0 }),
            ..Default::default()
        };
        let ext = AtlasExtensions::from_appearance(&flags);
        assert_eq!(ext.imbuement_slots, Some(0));
    }

    #[test]
    fn overflowing_u32_narrowing_returns_none() {
        let flags = AppearanceFlags {
            cyclopedia_item: Some(CyclopediaInfo {
                cyclopedia_type: 100_000,
            }),
            ..Default::default()
        };
        let ext = AtlasExtensions::from_appearance(&flags);
        assert_eq!(ext.cyclopedia_type, None);
    }

    #[test]
    fn matching_extensions_diff_to_same() {
        let otb_item = OtbItem {
            weapon_type: Some(WeaponType::Sword),
            minimum_level: Some(80),
            vocations: vec![Vocation::Knight, Vocation::Paladin],
            dual_wielding: Some(true),
            ..Default::default()
        };
        let flags = AppearanceFlags {
            weapon_type: Some(WeaponType::Sword),
            minimum_level: Some(80),
            restrict_to_vocation: vec![Vocation::Knight, Vocation::Paladin],
            dual_wielding: true,
            ..Default::default()
        };
        let diff = ExtensionsDiff::compute(
            &AtlasExtensions::from_otb(&otb_item),
            &AtlasExtensions::from_appearance(&flags),
        );
        assert!(diff.is_in_sync());
        assert!(diff.weapon_type.is_same());
        assert!(diff.vocations.is_same());
    }

    #[test]
    fn vocations_are_compared_order_insensitively() {
        let otb_item = OtbItem {
            vocations: vec![Vocation::Paladin, Vocation::Knight],
            ..Default::default()
        };
        let flags = AppearanceFlags {
            restrict_to_vocation: vec![Vocation::Knight, Vocation::Paladin],
            ..Default::default()
        };
        let diff = ExtensionsDiff::compute(
            &AtlasExtensions::from_otb(&otb_item),
            &AtlasExtensions::from_appearance(&flags),
        );
        assert!(diff.vocations.is_same());
    }

    #[test]
    fn otb_only_is_reported_when_appearance_lacks_field() {
        let otb_item = OtbItem {
            minimum_level: Some(50),
            ..Default::default()
        };
        let diff = ExtensionsDiff::compute(
            &AtlasExtensions::from_otb(&otb_item),
            &AtlasExtensions::from_appearance(&AppearanceFlags::default()),
        );
        assert_eq!(diff.minimum_level, FieldDiff::OtbOnly(50));
        assert!(!diff.is_in_sync());
    }

    #[test]
    fn appearance_only_is_reported_when_otb_lacks_field() {
        let flags = AppearanceFlags {
            minimum_level: Some(50),
            ..Default::default()
        };
        let diff = ExtensionsDiff::compute(
            &AtlasExtensions::from_otb(&empty_otb_item()),
            &AtlasExtensions::from_appearance(&flags),
        );
        assert_eq!(diff.minimum_level, FieldDiff::AppearanceOnly(50));
    }

    #[test]
    fn conflict_is_reported_when_values_differ() {
        let otb_item = OtbItem {
            minimum_level: Some(50),
            ..Default::default()
        };
        let flags = AppearanceFlags {
            minimum_level: Some(80),
            ..Default::default()
        };
        let diff = ExtensionsDiff::compute(
            &AtlasExtensions::from_otb(&otb_item),
            &AtlasExtensions::from_appearance(&flags),
        );
        assert_eq!(
            diff.minimum_level,
            FieldDiff::Conflict {
                otb: 50,
                appearance: 80,
            }
        );
    }

    #[test]
    fn vocations_one_sided_emptiness() {
        // OTB has restrictions, appearance does not → OtbOnly.
        let otb_item = OtbItem {
            vocations: vec![Vocation::Knight],
            ..Default::default()
        };
        let diff = ExtensionsDiff::compute(
            &AtlasExtensions::from_otb(&otb_item),
            &AtlasExtensions::from_appearance(&AppearanceFlags::default()),
        );
        assert_eq!(diff.vocations, FieldDiff::OtbOnly(vec![Vocation::Knight]));
    }
}
