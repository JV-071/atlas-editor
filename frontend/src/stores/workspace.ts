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
  CATEGORIES,
  emptyRecent,
  emptyRowsByCategory,
  emptySummary,
  type AppearanceInfoDto,
  type AppearanceRow,
  type AssetsDirInfo,
  type Category,
  type OtbItemDto,
  type PixelFormat,
  type RecentFiles,
  type WorkspaceSummary,
} from "../types";

type LoadStatus = "idle" | "loading" | "error";

interface WorkspaceState {
  summary: WorkspaceSummary;
  rowsByCategory: Record<Category, AppearanceRow[]>;
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
  refreshAssetsDirInfo: () => Promise<void>;
  fetchSpritePng: (spriteId: number) => Promise<string | null>;
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

async function fetchAllCategories(): Promise<Record<Category, AppearanceRow[]>> {
  const results = await Promise.all(
    CATEGORIES.map((cat) =>
      invoke<AppearanceRow[]>("list_appearances", { category: cat }).then(
        (rows) => [cat, rows] as const,
      ),
    ),
  );
  return Object.fromEntries(results) as Record<Category, AppearanceRow[]>;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  summary: emptySummary,
  rowsByCategory: emptyRowsByCategory,
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
      const tasks: Promise<unknown>[] = [get().refreshRecent()];
      if (summary.objectCount > 0) tasks.push(get().refreshRows());
      await Promise.all(tasks);
      // If something was already selected, refresh the linked OTB side.
      if (get().selectedId != null) await get().refreshSelectedDetails();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  async closeWorkspace() {
    const summary = await invoke<WorkspaceSummary>("close_workspace");
    set({
      summary,
      rowsByCategory: emptyRowsByCategory,
      selectedId: null,
      selectedAppearance: null,
      selectedOtbItem: null,
      query: "",
      error: null,
    });
  },

  async refreshRows() {
    const rowsByCategory = await fetchAllCategories();
    set({ rowsByCategory });
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
