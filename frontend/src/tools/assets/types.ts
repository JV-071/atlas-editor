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
export type Category = "object" | "outfit" | "effect" | "missile" | "sprites" | "sheets";

export type AppearanceCategory = "object" | "outfit" | "effect" | "missile";

export const APPEARANCE_CATEGORIES: AppearanceCategory[] = [
  "object",
  "outfit",
  "effect",
  "missile",
];

export const CATEGORIES: Category[] = [...APPEARANCE_CATEGORIES, "sprites", "sheets"];

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
  otbPath: string | null;
  objectCount: number;
  outfitCount: number;
  effectCount: number;
  missileCount: number;
  otbItemCount: number;
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
  otbPath: null,
  objectCount: 0,
  outfitCount: 0,
  effectCount: 0,
  missileCount: 0,
  otbItemCount: 0,
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

/// Numeric IDs mirror the proto enums in
/// `crates/atlas-appearances/proto/appearances.proto`. Keep these in
/// sync if the proto is ever updated. Each `*_ID` map is used by the
/// attribute editor to render dropdowns as `Name (id)` so the user can
/// see exactly what integer is stored on disk.
export const VOCATION_ID: Record<Vocation, number> = {
  Any: -1,
  None: 0,
  Knight: 1,
  Paladin: 2,
  Sorcerer: 3,
  Druid: 4,
  Monk: 5,
  Promoted: 10,
};
export const WEAPON_TYPE_ID: Record<WeaponType, number> = {
  NoWeapon: 0,
  Sword: 1,
  Axe: 2,
  Club: 3,
  Fist: 4,
  Bow: 5,
  Crossbow: 6,
  WandRod: 7,
  Throw: 8,
};

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
  /// Tibia 14+ extra pattern fields. Newer bundles populate these
  /// alongside (or instead of) the older `patternWidth`/`Height`/`Depth`/
  /// `layers`+`animation` quintet; preserve them on round-trip even when
  /// the UI doesn't surface them.
  patternSize: number | null;
  patternLayers: number | null;
  patternX: number | null;
  patternY: number | null;
  patternZ: number | null;
  patternFrames: number | null;
  isAnimation: boolean | null;
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

export type HookDirection = "South" | "East";
export const HOOK_DIRECTIONS: HookDirection[] = ["South", "East"];
export const HOOK_DIRECTION_ID: Record<HookDirection, number> = {
  South: 1,
  East: 2,
};

export type PlayerAction =
  | "None"
  | "Look"
  | "Use"
  | "Open"
  | "AutowalkHighlight";
export const PLAYER_ACTIONS: PlayerAction[] = [
  "None",
  "Look",
  "Use",
  "Open",
  "AutowalkHighlight",
];
export const PLAYER_ACTION_ID: Record<PlayerAction, number> = {
  None: 0,
  Look: 1,
  Use: 2,
  Open: 3,
  AutowalkHighlight: 4,
};

export const ITEM_CATEGORIES: ItemCategoryEnum[] = [
  "Armors",
  "Amulets",
  "Boots",
  "Containers",
  "Decoration",
  "Food",
  "HelmetsHats",
  "Legs",
  "Others",
  "Potions",
  "Rings",
  "Runes",
  "Shields",
  "Tools",
  "Valuables",
  "Ammunition",
  "Axes",
  "Clubs",
  "DistanceWeapons",
  "Swords",
  "WandsRods",
  "PremiumScrolls",
  "TibiaCoins",
  "CreatureProducts",
  "Quiver",
  "SoulCores",
  "FistWeapons",
];
export const ITEM_CATEGORY_ID: Record<ItemCategoryEnum, number> = {
  Armors: 1,
  Amulets: 2,
  Boots: 3,
  Containers: 4,
  Decoration: 5,
  Food: 6,
  HelmetsHats: 7,
  Legs: 8,
  Others: 9,
  Potions: 10,
  Rings: 11,
  Runes: 12,
  Shields: 13,
  Tools: 14,
  Valuables: 15,
  Ammunition: 16,
  Axes: 17,
  Clubs: 18,
  DistanceWeapons: 19,
  Swords: 20,
  WandsRods: 21,
  PremiumScrolls: 22,
  TibiaCoins: 23,
  CreatureProducts: 24,
  Quiver: 25,
  SoulCores: 26,
  FistWeapons: 27,
};

export interface AppearanceFlagsDto {
  // Behavior / interaction.
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

  // Stacking / visual layer.
  clip: boolean;
  bottom: boolean;
  top: boolean;
  fullbank: boolean;
  topeffect: boolean;
  lyingObject: boolean;
  translucent: boolean;
  dontHide: boolean;
  noMovementAnimation: boolean;
  animateAlways: boolean;

  // Outfit-only mirroring flags.
  reverseAddonsEast: boolean;
  reverseAddonsWest: boolean;
  reverseAddonsSouth: boolean;
  reverseAddonsNorth: boolean;

  // Expiration.
  wearout: boolean;
  clockexpire: boolean;
  expire: boolean;
  expirestop: boolean;

  // Misc.
  decoItemKit: boolean;

  // Combat / requirements.
  minimumLevel: number | null;
  weaponType: WeaponType | null;
  restrictToVocation: Vocation[];

  // Composite sub-messages.
  bank: { waypoints: number } | null;
  write: { maxTextLength: number } | null;
  writeOnce: { maxTextLengthOnce: number } | null;
  hook: { direction: HookDirection } | null;
  light: { brightness: number; color: number } | null;
  shift: { x: number; y: number } | null;
  height: { elevation: number } | null;
  automap: { color: number } | null;
  lenshelp: { id: number } | null;
  clothes: { slot: number } | null;
  defaultAction: { action: PlayerAction | null } | null;
  market: {
    category: ItemCategoryEnum | null;
    tradeAsObjectId: number | null;
    showAsObjectId: number | null;
  } | null;
  changedToExpire: { formerObjectTypeid: number } | null;
  cyclopediaItem: { cyclopediaType: number } | null;
  upgradeClassification: { upgradeClassification: number } | null;
  skillwheelGem: { gemQualityId: number | null; vocationId: number | null } | null;
  imbueable: { slotCount: number } | null;
  proficiency: { proficiencyId: number } | null;

  /// `repeated AppearanceFlagNPC` in the proto — list of NPCs that buy or
  /// sell this item. Empty array (`[]`) means no NPC trades it; the Rust
  /// model uses `Vec<NpcSaleInfo>` (never `Option<Vec>`), so the field is
  /// always present, never null.
  npcSaleData: NpcSaleInfoDto[];

  [key: string]: unknown;
}

export interface NpcSaleInfoDto {
  name: string | null;
  location: string | null;
  salePrice: number | null;
  buyPrice: number | null;
  currencyObjectTypeId: number | null;
  currencyQuestFlagDisplayName: string | null;
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

/// Output formats the export pipeline knows how to write. Stays in
/// sync with the `ExportFormat` Rust enum in `src-tauri`; both use the
/// same serde `lowercase` rename.
export type ExportFormat = "itemgif" | "outfitpngs" | "effectgif" | "missilegif";

export const EXPORT_FORMATS: ExportFormat[] = [
  "itemgif",
  "outfitpngs",
  "effectgif",
  "missilegif",
];

export function defaultExportFormat(category: AppearanceCategory): ExportFormat {
  switch (category) {
    case "object":
      return "itemgif";
    case "outfit":
      return "outfitpngs";
    case "effect":
      return "effectgif";
    case "missile":
      return "missilegif";
  }
}

export interface ExportReport {
  format: ExportFormat;
  files: string[];
}

export interface DuplicateGroup {
  spriteKey: string;
  ids: number[];
  category: string;
  displaySpriteIds: number[];
}

export interface UnmappedReport {
  appearanceOrphanIds: number[];
  otbOrphanServerIds: number[];
  collisionIds: number[];
}

/// A named bundle bookmark: assets dir + the pixel format that decodes
/// it. Mirrors the Rust `Profile` (serde camelCase).
export interface Profile {
  name: string;
  assetsPath: string;
  pixelFormat: PixelFormat;
}
