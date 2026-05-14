import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

import { clearSpriteUrlCache } from "./SpriteGrid";

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
  emptyRecent,
  emptyRowsByCategory,
  emptySummary,
  type AppearanceCategory,
  type AppearanceInfoDto,
  type AppearanceRow,
  type AssetsBundleResult,
  type AssetsDirInfo,
  type Category,
  type PixelFormat,
  type RecentFiles,
  type SpriteRangeDto,
  type WorkspaceSummary,
} from "./types";

export type AppView = "launcher" | "editor";

type LoadStatus = "idle" | "loading" | "error";

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
  assetsDir: AssetsDirInfo | null;
  pixelFormat: PixelFormat;
  spriteCacheBust: number;

  setQuery: (query: string) => void;
  setSelected: (id: number | null) => Promise<void>;
  setCategory: (category: Category) => void;

  pickAssetsBundle: () => Promise<void>;
  openAssetsBundlePath: (path: string) => Promise<void>;
  closeWorkspace: () => Promise<void>;
  refreshRows: () => Promise<void>;
  refreshRecent: () => Promise<void>;
  refreshSelectedDetails: () => Promise<void>;
  refreshAssetsDirInfo: () => Promise<void>;

  updateAppearanceField: (field: string, value: unknown) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  saveAppearances: () => Promise<void>;

  enterEditor: () => Promise<void>;
  goToLauncher: () => Promise<void>;
  fetchSpritePng: (spriteId: number) => Promise<string | null>;
  cyclePixelFormat: () => Promise<void>;
  refreshPixelFormat: () => Promise<void>;

  createObjectAppearance: () => Promise<void>;
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

/// Resize the current Tauri window between the compact launcher,
/// staged launcher (preview card visible), and the full editor
/// footprint. Falls back to a no-op when the API is unavailable
/// (e.g. running in a plain browser preview).
export type WindowMode = "launcher-empty" | "launcher-staged" | "editor";

export async function resizeWindow(mode: WindowMode): Promise<void> {
  try {
    const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    switch (mode) {
      case "editor":
        await win.setMinSize(new LogicalSize(900, 600));
        await win.setSize(new LogicalSize(1280, 800));
        break;
      case "launcher-staged":
        // Big enough to show the preview card + CTA without scrolling
        // but still smaller than the editor so the transition is
        // visible. No need to recenter — only the height grows.
        await win.setMinSize(new LogicalSize(480, 360));
        await win.setSize(new LogicalSize(680, 640));
        break;
      case "launcher-empty":
      default:
        await win.setMinSize(new LogicalSize(480, 360));
        await win.setSize(new LogicalSize(640, 480));
        break;
    }
    if (mode !== "launcher-staged") await win.center();
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
  assetsDir: null,
  pixelFormat: "bgra",
  spriteCacheBust: 0,

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
    set({
      summary,
      rowsByCategory: emptyRowsByCategory,
      spriteRanges: [],
      selectedId: null,
      selectedAppearance: null,
      query: "",
      error: null,
    });
  },

  async refreshRows() {
    const [rowsByCategory, spriteRanges] = await Promise.all([
      fetchAllCategories(),
      invoke<SpriteRangeDto[]>("list_sprite_ranges").catch(() => [] as SpriteRangeDto[]),
    ]);
    set({ rowsByCategory, spriteRanges });
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
      await get().refreshSelectedDetails();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async undo() {
    if (!get().summary.canUndo) return;
    try {
      const summary = await invoke<WorkspaceSummary>("undo");
      set({ summary, error: null });
      await Promise.all([get().refreshRows(), get().refreshSelectedDetails()]);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async redo() {
    if (!get().summary.canRedo) return;
    try {
      const summary = await invoke<WorkspaceSummary>("redo");
      set({ summary, error: null });
      await Promise.all([get().refreshRows(), get().refreshSelectedDetails()]);
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
      const dataUrl = await invoke<string | null>("get_sprite_png", { spriteId });
      return dataUrl;
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

  async createObjectAppearance() {
    try {
      const info = await invoke<{ appearanceId: number }>("create_object_appearance");
      const summary = await invoke<WorkspaceSummary>("get_workspace_summary");
      set({ summary, category: "object" });
      await get().refreshRows();
      await get().setSelected(info.appearanceId);
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
