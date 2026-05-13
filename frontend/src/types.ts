// DTOs mirroring `src-tauri/src/commands.rs`. Keep in sync — there is no
// codegen yet; mismatches surface as runtime `undefined`s in the UI.

export type Category = "object" | "outfit" | "effect" | "missile";

export const CATEGORIES: Category[] = ["object", "outfit", "effect", "missile"];

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
  otbServerId: number | null;
  isAppearanceOrphan: boolean;
  hasOtbCollision: boolean;
}

export interface RecentFiles {
  appearances: string[];
  otb: string[];
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

// Full DTOs returned by get_appearance / get_otb_item — superset of the
// row shape with every field the model carries so the attribute editor
// can render without follow-up calls.

// Enum string values mirror the Rust variant names (default serde
// behavior). Keep them PascalCase so round-trip is symmetric.

export type Vocation = "Any" | "None" | "Knight" | "Paladin" | "Sorcerer" | "Druid" | "Monk" | "Promoted";
export type WeaponType = "NoWeapon" | "Sword" | "Axe" | "Club" | "Fist" | "Bow" | "Crossbow" | "WandRod" | "Throw";
export type HookType = "South" | "East";
export type ItemCategoryEnum =
  | "Armors" | "Amulets" | "Boots" | "Containers" | "Decoration" | "Food"
  | "HelmetsHats" | "Legs" | "Others" | "Potions" | "Rings" | "Runes"
  | "Shields" | "Tools" | "Valuables" | "Ammunition" | "Axes" | "Clubs"
  | "DistanceWeapons" | "Swords" | "WandsRods" | "PremiumScrolls"
  | "TibiaCoins" | "CreatureProducts" | "Quiver" | "SoulCores" | "FistWeapons";
export type ItemGroupEnum =
  | "None" | "Ground" | "Container" | "Weapon" | "Ammunition" | "Armor"
  | "Charges" | "Teleport" | "MagicField" | "Writeable" | "Key" | "Splash"
  | "Fluid" | "Door" | "Deprecated" | "Podium";

export const VOCATIONS: Vocation[] = [
  "None", "Knight", "Paladin", "Sorcerer", "Druid", "Monk", "Promoted", "Any",
];
export const WEAPON_TYPES: WeaponType[] = [
  "NoWeapon", "Sword", "Axe", "Club", "Fist", "Bow", "Crossbow", "WandRod", "Throw",
];
export const ITEM_GROUPS: ItemGroupEnum[] = [
  "None", "Ground", "Container", "Weapon", "Ammunition", "Armor", "Charges",
  "Teleport", "MagicField", "Writeable", "Key", "Splash", "Fluid", "Door",
  "Deprecated", "Podium",
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

export interface OtbItemDto {
  group: ItemGroupEnum;
  flags: OtbItemFlagsDto;
  serverId: number | null;
  clientId: number | null;
  name: string | null;
  speed: number | null;
  weaponType: WeaponType | null;
  minimumLevel: number | null;
  vocations: Vocation[];
  imbuementSlots: number | null;
  gemQualityId: number | null;
  gemVocationId: number | null;
  proficiencyId: number | null;
  cyclopediaType: number | null;
  dualWielding: boolean | null;
  expireFlags: { wearout: boolean; clockExpire: boolean; expire: boolean; expireStop: boolean } | null;
  formerObjectTypeId: number | null;
  hookDirection: HookType | null;
}

export interface OtbItemFlagsDto {
  blockSolid: boolean;
  blockProjectile: boolean;
  blockPathfind: boolean;
  hasHeight: boolean;
  useable: boolean;
  pickupable: boolean;
  movable: boolean;
  stackable: boolean;
  floorChangeDown: boolean;
  floorChangeNorth: boolean;
  floorChangeEast: boolean;
  floorChangeSouth: boolean;
  floorChangeWest: boolean;
  alwaysOnTop: boolean;
  readable: boolean;
  rotatable: boolean;
  hangable: boolean;
  vertical: boolean;
  horizontal: boolean;
  cannotDecay: boolean;
  allowDistRead: boolean;
  clientCharges: boolean;
  lookThrough: boolean;
  animation: boolean;
  fullTile: boolean;
  forceUse: boolean;
}

// Helper to read AssetId — Rust's `AssetId(pub u32)` serializes as just
// the u32 with serde's transparent tuple struct, but `AppearanceInfo.id`
// already shows up as `{ "0": N }` in our serde defaults. Normalize.
export function readAssetId(id: AppearanceInfoDto["id"]): number {
  return typeof id === "number" ? id : id[0];
}

export const emptyRecent: RecentFiles = {
  appearances: [],
  otb: [],
};

export const emptyRowsByCategory: Record<Category, AppearanceRow[]> = {
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
