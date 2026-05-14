// DTOs mirroring `src-tauri/src/assets/commands.rs`. Keep in sync —
// there is no codegen yet; mismatches surface as runtime `undefined`s
// in the UI.
//
// This file is scoped to the Assets Editor. OTB-specific DTOs that the
// backend still emits (e.g. `otbPath`, `otbItemCount`) are intentionally
// not surfaced here — the Assets Editor doesn't edit OTBs. They'll
// move into the Converter or a future OTB tool when the time comes.

/// Appearance categories backed by `appearances.dat`, plus the
/// catalog-level "sprites" browser. The first four come from the
/// appearance proto; "sprites" reads directly from the sprite sheet
/// ranges in `catalog-content.json`.
export type Category = "object" | "outfit" | "effect" | "missile" | "sprites";

export type AppearanceCategory = "object" | "outfit" | "effect" | "missile";

export const APPEARANCE_CATEGORIES: AppearanceCategory[] = [
  "object",
  "outfit",
  "effect",
  "missile",
];

export const CATEGORIES: Category[] = [...APPEARANCE_CATEGORIES, "sprites"];

export interface SpriteRangeDto {
  firstspriteid: number;
  lastspriteid: number;
  spritetype: number;
  width: number;
  height: number;
  sheetFile: string;
}

export interface WorkspaceSummary {
  appearancesPath: string | null;
  objectCount: number;
  outfitCount: number;
  effectCount: number;
  missileCount: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface AppearanceRow {
  id: number;
  name: string | null;
  spriteCount: number;
  /// First sprite_id of the flattened sprite list. Used as the
  /// row thumbnail; `null` for placeholder appearances with no
  /// sprites attached.
  firstSpriteId: number | null;
}

export interface RecentFiles {
  /// Most-recently-used assets directories. Stored as paths to the
  /// `appearances.dat` inside each bundle; the launcher displays the
  /// containing folder.
  appearances: string[];
}

export const emptySummary: WorkspaceSummary = {
  appearancesPath: null,
  objectCount: 0,
  outfitCount: 0,
  effectCount: 0,
  missileCount: 0,
  dirty: false,
  canUndo: false,
  canRedo: false,
};

// Enum string values mirror the Rust variant names (default serde
// behavior). Keep them PascalCase so round-trip is symmetric.

export type Vocation =
  | "Any"
  | "None"
  | "Knight"
  | "Paladin"
  | "Sorcerer"
  | "Druid"
  | "Monk"
  | "Promoted";
export type WeaponType =
  | "NoWeapon"
  | "Sword"
  | "Axe"
  | "Club"
  | "Fist"
  | "Bow"
  | "Crossbow"
  | "WandRod"
  | "Throw";
export type ItemCategoryEnum =
  | "Armors"
  | "Amulets"
  | "Boots"
  | "Containers"
  | "Decoration"
  | "Food"
  | "HelmetsHats"
  | "Legs"
  | "Others"
  | "Potions"
  | "Rings"
  | "Runes"
  | "Shields"
  | "Tools"
  | "Valuables"
  | "Ammunition"
  | "Axes"
  | "Clubs"
  | "DistanceWeapons"
  | "Swords"
  | "WandsRods"
  | "PremiumScrolls"
  | "TibiaCoins"
  | "CreatureProducts"
  | "Quiver"
  | "SoulCores"
  | "FistWeapons";

export const VOCATIONS: Vocation[] = [
  "None",
  "Knight",
  "Paladin",
  "Sorcerer",
  "Druid",
  "Monk",
  "Promoted",
  "Any",
];
export const WEAPON_TYPES: WeaponType[] = [
  "NoWeapon",
  "Sword",
  "Axe",
  "Club",
  "Fist",
  "Bow",
  "Crossbow",
  "WandRod",
  "Throw",
];

export interface AppearanceInfoDto {
  id: { 0: number } | number; // AssetId serializes as a tuple struct
  category: Category;
  name: string | null;
  description: string | null;
  spriteIds: number[];
  flags: AppearanceFlagsDto;
}

export interface AppearanceFlagsDto {
  container: boolean;
  cumulative: boolean;
  usable: boolean;
  forceuse: boolean;
  multiuse: boolean;
  unpass: boolean;
  unmove: boolean;
  unsight: boolean;
  avoid: boolean;
  take: boolean;
  liquidcontainer: boolean;
  liquidpool: boolean;
  hang: boolean;
  rotate: boolean;
  ignoreLook: boolean;
  ammo: boolean;
  dualWielding: boolean;
  showOffSocket: boolean;
  reportable: boolean;
  wrap: boolean;
  unwrap: boolean;
  corpse: boolean;
  playerCorpse: boolean;

  minimumLevel: number | null;
  weaponType: WeaponType | null;
  restrictToVocation: Vocation[];
  imbueable: { slotCount: number } | null;
  market: {
    category: ItemCategoryEnum | null;
    tradeAsObjectId: number | null;
    showAsObjectId: number | null;
  } | null;
  light: { brightness: number; color: number } | null;
  [key: string]: unknown;
}

/// Helper to read AssetId — Rust's `AssetId(pub u32)` serializes as
/// just the u32 with serde's transparent tuple struct, but
/// `AppearanceInfo.id` shows up as `{ "0": N }` in our serde defaults.
/// Normalize.
export function readAssetId(id: AppearanceInfoDto["id"]): number {
  return typeof id === "number" ? id : id[0];
}

export const emptyRecent: RecentFiles = {
  appearances: [],
};

/// Appearance row maps, indexed by appearance category only. The
/// "sprites" tab has its own data path (`spriteRanges`) and doesn't
/// share this shape.
export const emptyRowsByCategory: Record<AppearanceCategory, AppearanceRow[]> = {
  object: [],
  outfit: [],
  effect: [],
  missile: [],
};

export interface AssetsDirInfo {
  path: string;
  sheetCount: number;
  spriteIdRange: [number, number] | null;
}

export interface AssetsBundleResult {
  summary: WorkspaceSummary;
  assets: AssetsDirInfo;
  appearancesLoaded: boolean;
  versionHint: string | null;
}

export type PixelFormat = "bgra" | "rgba" | "argb" | "abgr";
export const PIXEL_FORMATS: PixelFormat[] = ["bgra", "rgba", "argb", "abgr"];
