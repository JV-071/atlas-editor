import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

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
  emptyAppearanceRowsByCategory,
  emptyRecent,
  emptySummary,
  type AppearanceCategory,
  type AppearanceInfoDto,
  type AppearanceRow,
  type AssetsBundleResult,
  type AssetsDirInfo,
  type Category,
  type OtbItemDto,
  type OtbItemRowDto,
  type PixelFormat,
  type RecentFiles,
  type WorkspaceSummary,
} from "./types";

export type AppView = "launcher" | "editor";

type LoadStatus = "idle" | "loading" | "error";

interface WorkspaceState {
  view: AppView;
  summary: WorkspaceSummary;
  versionHint: string | null;
  rowsByCategory: Record<AppearanceCategory, AppearanceRow[]>;
  otbRows: OtbItemRowDto[];
  category: Category;
  selectedId: number | null;
  /// Full appearance payload for the editor, refreshed whenever the
  /// selection changes or a mutation lands.
  selectedAppearance: AppearanceInfoDto | null;
  /// Linked OTB item (only meaningful when category === "object" and
  /// the appearance has an `otbServerId`).
  selectedOtbItem: OtbItemDto | null;
  query: string;
  status: LoadStatus;
  error: string | null;
  recent: RecentFiles;
  assetsDir: AssetsDirInfo | null;

  setQuery: (query: string) => void;
  setSelected: (id: number | null) => Promise<void>;
  setCategory: (category: Category) => void;

  openAppearancesPicker: () => Promise<void>;
  openOtbPicker: () => Promise<void>;
  openAppearancesPath: (path: string) => Promise<void>;
  openOtbPath: (path: string) => Promise<void>;
  closeWorkspace: () => Promise<void>;
  refreshRows: () => Promise<void>;
  refreshRecent: () => Promise<void>;
  refreshSelectedDetails: () => Promise<void>;

  updateAppearanceField: (field: string, value: unknown) => Promise<void>;
  updateOtbItemField: (field: string, value: unknown) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  saveAppearances: () => Promise<void>;
  saveOtb: () => Promise<void>;

  pickAssetsDir: () => Promise<void>;
  pickAssetsBundle: () => Promise<void>;
  openAssetsBundlePath: (path: string) => Promise<void>;
  refreshAssetsDirInfo: () => Promise<void>;
  fetchSpritePng: (spriteId: number) => Promise<string | null>;
  enterEditor: () => Promise<void>;
  goToLauncher: () => Promise<void>;
  pixelFormat: PixelFormat;
  spriteCacheBust: number;
  cyclePixelFormat: () => Promise<void>;
  refreshPixelFormat: () => Promise<void>;

  createObjectAppearance: () => Promise<void>;
  createLinkedOtbItem: () => Promise<void>;
}

async function pickFile(
  title: string,
  name: string,
  extensions: string[],
): Promise<string | null> {
  const selected = await openDialog({
    title,
    multiple: false,
    directory: false,
    filters: [{ name, extensions }],
  });
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected ?? null;
}

async function fetchAllAppearanceCategories(): Promise<Record<AppearanceCategory, AppearanceRow[]>> {
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
/// staged launcher (preview cards visible), and the full editor
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
        // Big enough to show two preview cards + CTA without scrolling
        // but still smaller than the editor so the transition is
        // visible. No need to recenter — only the height grows.
        await win.setMinSize(new LogicalSize(480, 360));
        await win.setSize(new LogicalSize(680, 720));
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
  rowsByCategory: emptyAppearanceRowsByCategory,
  otbRows: [],
  category: "object",
  selectedId: null,
  selectedAppearance: null,
  selectedOtbItem: null,
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
      selectedOtbItem: null,
      query: "",
    }),

  async setSelected(id) {
    set({ selectedId: id, selectedAppearance: null, selectedOtbItem: null });
    if (id == null) return;
    await get().refreshSelectedDetails();
  },

  async openAppearancesPicker() {
    const path = await pickFile("Open appearances.dat", "appearances", ["dat"]);
    if (!path) return;
    await get().openAppearancesPath(path);
  },

  async openOtbPicker() {
    const path = await pickFile("Open items.otb", "otb", ["otb"]);
    if (!path) return;
    await get().openOtbPath(path);
  },

  async openAppearancesPath(path) {
    set({ status: "loading", error: null });
    try {
      const summary = await invoke<WorkspaceSummary>("open_appearances", { path });
      set({ summary, status: "idle" });
      await Promise.all([get().refreshRows(), get().refreshRecent()]);
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  async openOtbPath(path) {
    set({ status: "loading", error: null });
    try {
      const summary = await invoke<WorkspaceSummary>("open_otb", { path });
      set({ summary, status: "idle" });
      // Always refresh rows: even in OTB-only mode we need to populate
      // the new OTB tab; with appearances also loaded, cross-ref data
      // shifts.
      await Promise.all([get().refreshRows(), get().refreshRecent()]);
      if (get().selectedId != null) await get().refreshSelectedDetails();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  async closeWorkspace() {
    const summary = await invoke<WorkspaceSummary>("close_workspace");
    set({
      summary,
      rowsByCategory: emptyAppearanceRowsByCategory,
      otbRows: [],
      selectedId: null,
      selectedAppearance: null,
      selectedOtbItem: null,
      query: "",
      error: null,
    });
  },

  async refreshRows() {
    const [rowsByCategory, otbRows] = await Promise.all([
      fetchAllAppearanceCategories(),
      invoke<OtbItemRowDto[]>("list_otb_items"),
    ]);
    set({ rowsByCategory, otbRows });
  },

  async refreshRecent() {
    const recent = await invoke<RecentFiles>("get_recent_files");
    set({ recent });
  },

  async refreshSelectedDetails() {
    const { selectedId, category, rowsByCategory } = get();
    if (selectedId == null) {
      set({ selectedAppearance: null, selectedOtbItem: null });
      return;
    }

    if (category === "otb") {
      // selectedId is the OTB server_id. Fetch the item directly,
      // and if its client_id maps to an appearance, fetch that too.
      const otbItem = await invoke<OtbItemDto | null>("get_otb_item", {
        serverId: selectedId,
      });
      let appearance: AppearanceInfoDto | null = null;
      if (otbItem?.clientId != null && otbItem.clientId !== 0) {
        appearance = await invoke<AppearanceInfoDto | null>("get_appearance", {
          scope: "object",
          id: otbItem.clientId,
        });
      }
      set({ selectedAppearance: appearance, selectedOtbItem: otbItem });
      return;
    }

    const appearance = await invoke<AppearanceInfoDto | null>("get_appearance", {
      scope: category,
      id: selectedId,
    });
    let otbItem: OtbItemDto | null = null;
    const row = rowsByCategory[category].find((r) => r.id === selectedId);
    if (row?.otbServerId != null) {
      otbItem = await invoke<OtbItemDto | null>("get_otb_item", {
        serverId: row.otbServerId,
      });
    }
    set({ selectedAppearance: appearance, selectedOtbItem: otbItem });
  },

  async updateAppearanceField(field, value) {
    const { category, selectedId } = get();
    if (selectedId == null) return;
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

  async updateOtbItemField(field, value) {
    const { selectedOtbItem } = get();
    if (selectedOtbItem?.serverId == null) return;
    try {
      const summary = await invoke<WorkspaceSummary>("update_otb_item_field", {
        serverId: selectedOtbItem.serverId,
        field,
        value,
      });
      set({ summary, error: null });
      // OTB edits can affect the visible row (name, server_id changes
      // would shift the cross-ref). Refresh both.
      await Promise.all([get().refreshSelectedDetails(), get().refreshRows()]);
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

  async saveOtb() {
    try {
      const summary = await invoke<WorkspaceSummary>("save_otb");
      set({ summary, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async pickAssetsDir() {
    const selected = await openDialog({
      title: "Pick the Tibia client assets/ directory",
      multiple: false,
      directory: true,
    });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    try {
      const info = await invoke<AssetsDirInfo>("set_assets_dir", { path });
      set({ assetsDir: info, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async refreshAssetsDirInfo() {
    try {
      const info = await invoke<AssetsDirInfo | null>("get_assets_dir_info");
      set({ assetsDir: info });
    } catch (e) {
      set({ error: String(e) });
    }
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

  async enterEditor() {
    // Default the category to whatever side has data: appearances if
    // present, otherwise OTB. Stay on the user's last pick if both
    // sides were already loaded.
    const { summary, category } = get();
    let nextCategory: Category = category;
    const hasAppearances = summary.appearancesPath != null || summary.objectCount > 0;
    const hasOtb = summary.otbPath != null;
    if (category === "otb" && !hasOtb && hasAppearances) {
      nextCategory = "object";
    } else if (!hasAppearances && hasOtb && category !== "otb") {
      nextCategory = "otb";
    }
    await resizeWindow("editor");
    set({ view: "editor", category: nextCategory });
  },

  async goToLauncher() {
    const { summary, assetsDir } = get();
    const hasContent = summary.appearancesPath != null || summary.otbPath != null || assetsDir != null;
    await resizeWindow(hasContent ? "launcher-staged" : "launcher-empty");
    set({ view: "launcher", selectedId: null, selectedAppearance: null, selectedOtbItem: null });
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

  async createObjectAppearance() {
    try {
      const info = await invoke<{ appearanceId: number }>("create_object_appearance");
      // Refresh summary by piggy-backing on a list refresh; the
      // create command does not return a fresh summary.
      const summary = await invoke<WorkspaceSummary>("get_workspace_summary");
      set({ summary, category: "object" });
      await get().refreshRows();
      await get().setSelected(info.appearanceId);
    } catch (e) {
      set({ error: String(e) });
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

  async createLinkedOtbItem() {
    const { selectedId, category } = get();
    if (selectedId == null || category !== "object") {
      set({ error: "Select an object appearance to link the new OTB item to" });
      return;
    }
    try {
      await invoke<{ appearanceId: number; otbServerId: number | null }>(
        "create_otb_item",
        { clientId: selectedId },
      );
      const summary = await invoke<WorkspaceSummary>("get_workspace_summary");
      set({ summary });
      await Promise.all([get().refreshRows(), get().refreshSelectedDetails()]);
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
