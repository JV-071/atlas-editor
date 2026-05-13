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
};

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
