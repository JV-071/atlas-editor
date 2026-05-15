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
  /// Sprite ids the row thumbnail cycles through. For outfits this is
  /// the idle frame group looking south; for objects/effects/missiles
  /// the initial frame group walked through every animation phase.
  /// Empty when the appearance has no sprite payload at all.
  displaySpriteIds: number[];
  /// Per-phase duration in milliseconds, parallel to `displaySpriteIds`.
  /// Empty when the appearance is not animated.
  displayDurationsMs: number[];
  /// Bitmask of boolean flags set on the appearance. Bit positions are
  /// defined in `FLAG_BITS` and must stay in sync with the Rust
  /// `FlagBit` enum in `src-tauri/src/assets/commands.rs`.
  flagsMask: number;
}

/// Bit positions for filterable appearance flags. Keep in sync with the
/// `FlagBit` enum on the Rust side — reordering or removing entries here
/// silently breaks the filter UI.
export const FLAG_BITS = {
  container: 1 << 0,
  cumulative: 1 << 1,
  usable: 1 << 2,
  forceuse: 1 << 3,
  multiuse: 1 << 4,
  unpass: 1 << 5,
  unmove: 1 << 6,
  unsight: 1 << 7,
  avoid: 1 << 8,
  take: 1 << 9,
  liquidcontainer: 1 << 10,
  liquidpool: 1 << 11,
  hang: 1 << 12,
  rotate: 1 << 13,
  ignoreLook: 1 << 14,
  ammo: 1 << 15,
  dualWielding: 1 << 16,
  showOffSocket: 1 << 17,
  reportable: 1 << 18,
  wrap: 1 << 19,
  unwrap: 1 << 20,
  corpse: 1 << 21,
  playerCorpse: 1 << 22,
  animateAlways: 1 << 23,
  clip: 1 << 24,
  bottom: 1 << 25,
  top: 1 << 26,
  noMovementAnimation: 1 << 27,
  translucent: 1 << 28,
  lyingObject: 1 << 29,
  fullbank: 1 << 30,
  topeffect: 1 << 31,
} as const;

export type FlagName = keyof typeof FLAG_BITS;
export const FLAG_NAMES: FlagName[] = Object.keys(FLAG_BITS) as FlagName[];

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
  frameGroups: FrameGroupInfoDto[];
  flags: AppearanceFlagsDto;
}

export type FixedFrameGroupDto = "OutfitIdle" | "OutfitMoving" | "ObjectInitial";

export interface FrameGroupInfoDto {
  fixedFrameGroup: FixedFrameGroupDto | null;
  id: number | null;
  spriteInfo: SpriteInfoDataDto | null;
}

export interface SpriteInfoDataDto {
  patternWidth: number | null;
  patternHeight: number | null;
  patternDepth: number | null;
  layers: number | null;
  spriteIds: number[];
  animation: SpriteAnimationDataDto | null;
  boundingSquare: number | null;
  isOpaque: boolean | null;
  boundingBoxPerDirection: BoundingBoxDto[];
}

export interface SpriteAnimationDataDto {
  defaultStartPhase: number | null;
  synchronized: boolean | null;
  randomStartPhase: boolean | null;
  loopType: "PingPong" | "Infinite" | "Counted" | null;
  loopCount: number | null;
  spritePhases: SpritePhaseDto[];
}

export interface SpritePhaseDto {
  durationMin: number | null;
  durationMax: number | null;
}

export interface BoundingBoxDto {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

/// Resolve pattern dimensions, falling back to 1 when the proto omits
/// the field (proto2 distinguishes absent from default-of-zero, but for
/// these dimensions both mean "single pattern column").
export function patternDims(si: SpriteInfoDataDto): {
  width: number;
  height: number;
  depth: number;
  layers: number;
  phases: number;
} {
  return {
    width: Math.max(1, si.patternWidth ?? 1),
    height: Math.max(1, si.patternHeight ?? 1),
    depth: Math.max(1, si.patternDepth ?? 1),
    layers: Math.max(1, si.layers ?? 1),
    phases: Math.max(1, si.animation?.spritePhases.length ?? 1),
  };
}

/// Index into the flat `spriteIds` for a given (phase, z, y, x, layer).
/// Returns `null` when the coordinate falls outside the declared
/// dimensions or the flat array isn't long enough.
export function spriteIndex(
  si: SpriteInfoDataDto,
  phase: number,
  z: number,
  y: number,
  x: number,
  layer: number,
): number | null {
  const { width, height, depth, layers, phases } = patternDims(si);
  if (phase >= phases || z >= depth || y >= height || x >= width || layer >= layers)
    return null;
  const idx = ((((phase * depth + z) * height + y) * width + x) * layers + layer);
  if (idx < 0 || idx >= si.spriteIds.length) return null;
  return idx;
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
