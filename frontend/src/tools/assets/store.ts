import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

import { clearSpriteUrlCache } from "./SpriteThumb";

// True when the page is loaded inside the Tauri webview (which injects
// `__TAURI_INTERNALS__` on `window`). Calling `tauriInvoke` outside of
// that context throws "Cannot read properties of undefined (reading
// 'invoke')", which used to bring down the whole React tree. We treat
// missing-runtime as a soft failure instead so the layout is still
// usable in a regular browser tab for styling work.
const HAS_TAURI =
  typeof window !== "undefined" &&
  // The internals object lives at this exact key in Tauri 2.
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!HAS_TAURI) {
    throw new Error(
      `Tauri IPC is not available — this page is loaded outside the Tauri webview ` +
        `(probably plain Vite at localhost:5173). Open the desktop window via 'cargo tauri dev'.`,
    );
  }
  return tauriInvoke<T>(cmd, args);
}

import {
  APPEARANCE_CATEGORIES,
  defaultExportFormat,
  emptyRecent,
  emptyRowsByCategory,
  emptySummary,
  type AppearanceCategory,
  type AppearanceInfoDto,
  type AppearanceRow,
  type AssetsBundleResult,
  type AssetsDirInfo,
  type Category,
  type DuplicateGroup,
  type ExportFormat,
  type ExportReport,
  type PixelFormat,
  type Profile,
  type RecentFiles,
  type SpriteRangeDto,
  type UnmappedReport,
  type WorkspaceSummary,
} from "./types";

export type AppView = "launcher" | "editor";

type LoadStatus = "idle" | "loading" | "error";

/// One entry in the batch-export queue. Stored as a flat key so the
/// queue can dedupe with Set-style semantics and so lookups from
/// `ItemList` don't have to walk an array per row.
export interface ExportQueueEntry {
  category: AppearanceCategory;
  id: number;
}

export function queueKey(category: AppearanceCategory, id: number): string {
  return `${category}:${id}`;
}

/// Per-item progress event surfaced while the queue runs, so the UI can
/// render a live status list instead of guessing how far we got.
export interface ExportQueueProgress {
  index: number;
  total: number;
  entry: ExportQueueEntry;
  status: "running" | "done" | "error";
  error?: string;
  files?: number;
}

interface WorkspaceState {
  view: AppView;
  summary: WorkspaceSummary;
  versionHint: string | null;
  rowsByCategory: Record<AppearanceCategory, AppearanceRow[]>;
  spriteRanges: SpriteRangeDto[];
  category: Category;
  selectedId: number | null;
  /// Full appearance payload for the editor, refreshed whenever the
  /// selection changes or a mutation lands.
  selectedAppearance: AppearanceInfoDto | null;
  query: string;
  status: LoadStatus;
  error: string | null;
  recent: RecentFiles;
  profiles: Profile[];
  /// Name of the profile currently applied, or `null` when the user
  /// opened a folder directly (not via a profile).
  activeProfile: string | null;
  assetsDir: AssetsDirInfo | null;
  pixelFormat: PixelFormat;
  spriteCacheBust: number;

  /// Session-only batch export queue. Map (not Set) keyed by
  /// `category:id` so adding the same row twice is a no-op.
  exportQueue: Map<string, ExportQueueEntry>;
  /// Live progress for the currently running batch, or `null` when the
  /// queue is idle.
  exportProgress: ExportQueueProgress[] | null;
  /// Sheet file the Sheets tab currently shows. Shared via the store
  /// so other tabs (e.g. SpriteGrid) can deep-link into it via
  /// `setSelectedSheetFile`.
  selectedSheetFile: string | null;
  setSelectedSheetFile: (file: string | null) => void;

  /// Replace one sprite's pixels from a user-picked image file, then
  /// bust the sprite caches so every thumbnail re-fetches. Returns
  /// `true` if a file was picked and applied.
  replaceSpriteFromFile: (spriteId: number) => Promise<boolean>;
  /// Flush dirty sheets to disk. No-op when nothing is dirty.
  saveSpriteSheets: () => Promise<void>;
  /// Create a blank sheet for `spritetype`; resolves to its
  /// firstspriteid so the caller can jump to it.
  createSpriteSheet: (spritetype: number) => Promise<number | null>;

  setQuery: (query: string) => void;
  setSelected: (id: number | null) => Promise<void>;
  setCategory: (category: Category) => void;

  pickAssetsBundle: () => Promise<void>;
  openAssetsBundlePath: (path: string) => Promise<void>;
  closeWorkspace: () => Promise<void>;

  refreshProfiles: () => Promise<void>;
  /// Open the profile's bundle and apply its pixel format. Sets it as
  /// the active profile on success.
  applyProfile: (name: string) => Promise<void>;
  /// Persist the current assets dir + pixel format under `name`
  /// (upsert). No-op when no bundle is open.
  saveCurrentAsProfile: (name: string) => Promise<void>;
  renameProfile: (oldName: string, newName: string) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
  refreshRows: () => Promise<void>;
  refreshCategoryRows: (category: Category) => Promise<void>;
  refreshSpriteRanges: () => Promise<void>;
  refreshRecent: () => Promise<void>;
  refreshSelectedDetails: () => Promise<void>;
  refreshAssetsDirInfo: () => Promise<void>;
  /// Re-fetch `WorkspaceSummary` from the backend. Needed after a page
  /// reload — Vite HMR sometimes invalidates frontend modules while the
  /// backend keeps the parsed workspace alive, so `assetsDir` rehydrates
  /// but the appearance counts stay at `emptySummary` (zeros). The
  /// AssetsEditor mount effect calls this alongside the other refreshes.
  refreshSummary: () => Promise<void>;

  updateAppearanceField: (field: string, value: unknown) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  saveAppearances: () => Promise<void>;

  enterEditor: () => Promise<void>;
  goToLauncher: () => Promise<void>;
  fetchSpritePng: (spriteId: number) => Promise<string | null>;
  cyclePixelFormat: () => Promise<void>;
  refreshPixelFormat: () => Promise<void>;

  createAppearance: (category: AppearanceCategory) => Promise<void>;

  copyAppearanceJson: (category: AppearanceCategory, id: number) => Promise<string | null>;
  pasteAppearanceJson: (category: AppearanceCategory, targetId: number, json: string) => Promise<void>;
  findDuplicates: (category: AppearanceCategory) => Promise<DuplicateGroup[]>;
  getUnmappedReport: () => Promise<UnmappedReport | null>;

  toggleExportQueueEntry: (category: AppearanceCategory, id: number) => void;
  enqueueAllCategory: (category: AppearanceCategory) => void;
  clearExportQueue: () => void;
  /// Iterate the queue, calling `export_appearance` for each item.
  /// When `formatOverride` is given it overrides the per-category
  /// default (e.g. force PNG sprites for outfits instead of GIF).
  runExportQueue: (outputDir: string, formatOverride?: ExportFormat) => Promise<ExportQueueProgress[]>;
}

async function fetchAllCategories(): Promise<Record<AppearanceCategory, AppearanceRow[]>> {
  const results = await Promise.all(
    APPEARANCE_CATEGORIES.map((cat) =>
      invoke<AppearanceRow[]>("list_appearances", { category: cat }).then(
        (rows) => [cat, rows] as const,
      ),
    ),
  );
  return Object.fromEntries(results) as Record<AppearanceCategory, AppearanceRow[]>;
}

/// Adjust the Tauri window's `minSize` for the current view. Only the
/// minimum is touched — the actual size and position are the user's
/// to control. Earlier iterations called `setSize`/`center` here too,
/// but that meant any view flip or F5 reload silently shrank a
/// manually maximized window. The initial launch dimensions are now
/// driven entirely by `tauri.conf.json`'s `windows[]` block; subsequent
/// transitions just relax/tighten the minimum so the layout still has
/// breathing room.
///
/// Falls back to a no-op when the API is unavailable (e.g. running in
/// a plain browser preview).
export type WindowMode = "launcher-empty" | "launcher-staged" | "editor";

export async function resizeWindow(mode: WindowMode): Promise<void> {
  try {
    const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const minSize =
      mode === "editor"
        ? new LogicalSize(900, 600)
        : new LogicalSize(480, 360);
    await win.setMinSize(minSize);
  } catch {
    // Ignore — we're probably not inside the Tauri shell.
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  view: "launcher",
  summary: emptySummary,
  versionHint: null,
  rowsByCategory: emptyRowsByCategory,
  spriteRanges: [],
  category: "object",
  selectedId: null,
  selectedAppearance: null,
  query: "",
  status: "idle",
  error: null,
  recent: emptyRecent,
  profiles: [],
  activeProfile: null,
  assetsDir: null,
  pixelFormat: "bgra",
  spriteCacheBust: 0,
  exportQueue: new Map(),
  exportProgress: null,
  selectedSheetFile: null,
  setSelectedSheetFile: (file) => set({ selectedSheetFile: file }),

  setQuery: (query) => set({ query }),
  setCategory: (category) =>
    set({
      category,
      selectedId: null,
      selectedAppearance: null,
      query: "",
    }),

  async setSelected(id) {
    set({ selectedId: id, selectedAppearance: null });
    if (id == null) return;
    await get().refreshSelectedDetails();
  },

  async pickAssetsBundle() {
    const selected = await openDialog({
      title: "Pick the Tibia client assets/ directory",
      multiple: false,
      directory: true,
    });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    await get().openAssetsBundlePath(path);
  },

  async openAssetsBundlePath(path) {
    set({ status: "loading", error: null });
    // New bundle => sprite_ids may now point at different pixels.
    // Discard the module-level URL cache so the grid refetches.
    clearSpriteUrlCache();
    try {
      const result = await invoke<AssetsBundleResult>("open_assets_bundle", { path });
      set({
        summary: result.summary,
        assetsDir: result.assets,
        versionHint: result.versionHint,
        status: "idle",
      });
      if (result.appearancesLoaded) {
        await Promise.all([get().refreshRows(), get().refreshRecent()]);
      } else {
        await get().refreshRecent();
      }
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  async closeWorkspace() {
    const summary = await invoke<WorkspaceSummary>("close_workspace");
    // The backend wipes its workspace; mirror that on the frontend so the
    // launcher returns to the "no bundle staged" state instead of keeping
    // the green preview card around with stale path + sheet count.
    set({
      summary,
      rowsByCategory: emptyRowsByCategory,
      spriteRanges: [],
      selectedId: null,
      selectedAppearance: null,
      query: "",
      error: null,
      assetsDir: null,
      versionHint: null,
    });
  },

  async refreshRows() {
    const [rowsByCategory, spriteRanges] = await Promise.all([
      fetchAllCategories(),
      invoke<SpriteRangeDto[]>("list_sprite_ranges").catch(() => [] as SpriteRangeDto[]),
    ]);
    set({ rowsByCategory, spriteRanges });
  },

  /// Re-list a single category. Field edits and create/undo/redo are
  /// category-scoped, so refreshing one list (instead of all four +
  /// the sprite-range fetch in `refreshRows`) is the cheap path —
  /// `list_appearances` rebuilds + serializes every row, so doing 1/4
  /// of the work matters on a 45k-object catalog. "sprites"/"sheets"
  /// have no appearance rows; nothing to do.
  async refreshCategoryRows(category) {
    if (category === "sprites" || category === "sheets") return;
    const rows = await invoke<AppearanceRow[]>("list_appearances", { category });
    set((s) => ({
      rowsByCategory: { ...s.rowsByCategory, [category]: rows },
    }));
  },

  /// Re-fetch only the sprite-sheet ranges (Sprites/Sheets tabs).
  /// Creating a sheet doesn't touch appearances, so the all-four
  /// `refreshRows` was pure waste there.
  async refreshSpriteRanges() {
    const spriteRanges = await invoke<SpriteRangeDto[]>("list_sprite_ranges").catch(
      () => [] as SpriteRangeDto[],
    );
    set({ spriteRanges });
  },

  async refreshRecent() {
    const recent = await invoke<RecentFiles>("get_recent_files");
    set({ recent });
  },

  async refreshSelectedDetails() {
    const { selectedId, category } = get();
    if (selectedId == null) {
      set({ selectedAppearance: null });
      return;
    }
    // Sprites tab: selection is a sprite_id, not an appearance id, and
    // the detail panel doesn't need the appearance payload.
    if (category === "sprites") {
      set({ selectedAppearance: null });
      return;
    }
    const appearance = await invoke<AppearanceInfoDto | null>("get_appearance", {
      scope: category,
      id: selectedId,
    });
    set({ selectedAppearance: appearance });
  },

  async refreshAssetsDirInfo() {
    try {
      const info = await invoke<AssetsDirInfo | null>("get_assets_dir_info");
      set({ assetsDir: info });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async refreshSummary() {
    try {
      const summary = await invoke<WorkspaceSummary>("get_workspace_summary");
      set({ summary });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async updateAppearanceField(field, value) {
    const { category, selectedId } = get();
    if (selectedId == null || category === "sprites") return;
    try {
      const summary = await invoke<WorkspaceSummary>("update_appearance_field", {
        scope: category,
        id: selectedId,
        field,
        value,
      });
      set({ summary, error: null });
      // The edited row's name/flags can change what the list shows, so
      // refresh just the active category (cheap) plus the detail pane.
      await Promise.all([
        get().refreshCategoryRows(category),
        get().refreshSelectedDetails(),
      ]);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async undo() {
    if (!get().summary.canUndo) return;
    try {
      const summary = await invoke<WorkspaceSummary>("undo");
      set({ summary, error: null });
      // Undo/redo only ever touch one entity in the active category;
      // re-listing that one category beats the old all-four refresh.
      await Promise.all([
        get().refreshCategoryRows(get().category),
        get().refreshSelectedDetails(),
      ]);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async redo() {
    if (!get().summary.canRedo) return;
    try {
      const summary = await invoke<WorkspaceSummary>("redo");
      set({ summary, error: null });
      await Promise.all([
        get().refreshCategoryRows(get().category),
        get().refreshSelectedDetails(),
      ]);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async saveAppearances() {
    try {
      const summary = await invoke<WorkspaceSummary>("save_appearances");
      set({ summary, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async enterEditor() {
    await resizeWindow("editor");
    set({ view: "editor" });
  },

  async goToLauncher() {
    const { assetsDir } = get();
    await resizeWindow(assetsDir != null ? "launcher-staged" : "launcher-empty");
    set({ view: "launcher", selectedId: null, selectedAppearance: null });
  },

  async fetchSpritePng(spriteId) {
    try {
      // Binary IPC: the command returns raw PNG bytes (ArrayBuffer),
      // not a base64 data-URL string. Wrap in a Blob + object URL so
      // the browser decodes off the JS thread and we skip the 33%
      // base64 inflation + JSON re-encode the old path paid per tile.
      const buf = await invoke<ArrayBuffer>("get_sprite_png", { spriteId });
      if (!buf || buf.byteLength === 0) return null;
      const blob = new Blob([buf], { type: "image/png" });
      return URL.createObjectURL(blob);
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  async cyclePixelFormat() {
    const order: PixelFormat[] = ["bgra", "rgba", "argb", "abgr"];
    const current = get().pixelFormat;
    const next = order[(order.indexOf(current) + 1) % order.length];
    try {
      const applied = await invoke<PixelFormat>("set_sprite_pixel_format", {
        format: next,
      });
      // Channel order changed => every cached sprite is now wrong.
      clearSpriteUrlCache();
      set({ pixelFormat: applied, spriteCacheBust: get().spriteCacheBust + 1 });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async refreshPixelFormat() {
    try {
      const pf = await invoke<PixelFormat | null>("get_sprite_pixel_format");
      if (pf) set({ pixelFormat: pf });
    } catch {
      // Pre-assets state — ignore.
    }
  },

  async refreshProfiles() {
    try {
      const profiles = await invoke<Profile[]>("list_profiles");
      set({ profiles });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async applyProfile(name) {
    const profile = get().profiles.find((p) => p.name === name);
    if (!profile) return;
    await get().openAssetsBundlePath(profile.assetsPath);
    // openAssetsBundlePath sets status=error on failure; only apply the
    // pixel format + mark active when the bundle actually loaded.
    if (get().status === "error") return;
    if (profile.pixelFormat !== get().pixelFormat) {
      try {
        const applied = await invoke<PixelFormat>("set_sprite_pixel_format", {
          format: profile.pixelFormat,
        });
        clearSpriteUrlCache();
        set({
          pixelFormat: applied,
          spriteCacheBust: get().spriteCacheBust + 1,
        });
      } catch (e) {
        set({ error: String(e) });
      }
    }
    set({ activeProfile: name });
  },

  async saveCurrentAsProfile(name) {
    const { assetsDir, pixelFormat } = get();
    if (!assetsDir) return;
    try {
      const profiles = await invoke<Profile[]>("save_profile", {
        profile: { name, assetsPath: assetsDir.path, pixelFormat },
      });
      set({ profiles, activeProfile: name, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async renameProfile(oldName, newName) {
    try {
      const profiles = await invoke<Profile[]>("rename_profile", {
        oldName,
        newName,
      });
      set({
        profiles,
        activeProfile:
          get().activeProfile === oldName ? newName : get().activeProfile,
        error: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async deleteProfile(name) {
    try {
      const profiles = await invoke<Profile[]>("delete_profile", { name });
      set({
        profiles,
        activeProfile: get().activeProfile === name ? null : get().activeProfile,
        error: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async createAppearance(category) {
    try {
      const info = await invoke<{ appearanceId: number }>("create_appearance", {
        scope: category,
      });
      const summary = await invoke<WorkspaceSummary>("get_workspace_summary");
      set({ summary, category });
      await get().refreshCategoryRows(category);
      await get().setSelected(info.appearanceId);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async replaceSpriteFromFile(spriteId) {
    const sel = await openDialog({
      title: "Pick a replacement image",
      multiple: false,
      directory: false,
      filters: [{ name: "Image", extensions: ["png", "bmp"] }],
    });
    if (!sel) return false;
    const imagePath = Array.isArray(sel) ? sel[0] : sel;
    try {
      await invoke("replace_sprite_from_png", { spriteId, imagePath });
      // The pixels for `spriteId` (and its sheet) changed — drop both
      // the module-level URL cache and the backend PNG cache key by
      // bumping the bust counter so every visible thumbnail refetches.
      clearSpriteUrlCache();
      set({ spriteCacheBust: get().spriteCacheBust + 1, error: null });
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  async saveSpriteSheets() {
    try {
      await invoke<string[]>("save_sprite_sheets");
      set({ error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async createSpriteSheet(spritetype) {
    try {
      const firstSpriteId = await invoke<number>("create_sprite_sheet", {
        spritetype,
      });
      clearSpriteUrlCache();
      await get().refreshSpriteRanges();
      set({ spriteCacheBust: get().spriteCacheBust + 1, error: null });
      return firstSpriteId;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  async copyAppearanceJson(category, id) {
    try {
      const json = await invoke<string>("copy_appearance_json", { scope: category, id });
      return json;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  async pasteAppearanceJson(category, targetId, json) {
    try {
      const summary = await invoke<WorkspaceSummary>("paste_appearance_json", {
        scope: category,
        targetId,
        json,
      });
      set({ summary, error: null });
      await Promise.all([
        get().refreshCategoryRows(category),
        get().refreshSelectedDetails(),
      ]);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async findDuplicates(category) {
    try {
      return await invoke<DuplicateGroup[]>("find_duplicates", { scope: category });
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },

  async getUnmappedReport() {
    try {
      return await invoke<UnmappedReport>("get_unmapped_report");
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  toggleExportQueueEntry(category, id) {
    const next = new Map(get().exportQueue);
    const key = queueKey(category, id);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.set(key, { category, id });
    }
    set({ exportQueue: next });
  },

  enqueueAllCategory(category) {
    const rows = get().rowsByCategory[category] ?? [];
    const next = new Map(get().exportQueue);
    for (const row of rows) {
      const key = queueKey(category, row.id);
      if (!next.has(key)) {
        next.set(key, { category, id: row.id });
      }
    }
    set({ exportQueue: next });
  },

  clearExportQueue() {
    set({ exportQueue: new Map(), exportProgress: null });
  },

  async runExportQueue(outputDir, formatOverride?) {
    const entries = Array.from(get().exportQueue.values());
    if (entries.length === 0) return [];
    const progress: ExportQueueProgress[] = entries.map((entry, index) => ({
      index,
      total: entries.length,
      entry,
      status: "running",
    }));
    set({ exportProgress: progress.slice() });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const format: ExportFormat = formatOverride ?? defaultExportFormat(entry.category);
      const baseName = `${entry.category}-${entry.id}`;
      const outputPath =
        format === "outfitpngs"
          ? `${outputDir}/${baseName}`
          : `${outputDir}/${baseName}.gif`;
      progress[i].status = "running";
      set({ exportProgress: progress.slice() });
      try {
        const report = await invoke<ExportReport>("export_appearance", {
          scope: entry.category,
          id: entry.id,
          format,
          outputPath,
        });
        progress[i] = {
          ...progress[i],
          status: "done",
          files: report.files.length,
        };
      } catch (e) {
        progress[i] = {
          ...progress[i],
          status: "error",
          error: String(e),
        };
      }
      set({ exportProgress: progress.slice() });
    }
    return progress;
  },
}));
