import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

import {
  CATEGORIES,
  emptyRecent,
  emptyRowsByCategory,
  emptySummary,
  type AppearanceRow,
  type Category,
  type RecentFiles,
  type WorkspaceSummary,
} from "../types";

type LoadStatus = "idle" | "loading" | "error";

interface WorkspaceState {
  summary: WorkspaceSummary;
  rowsByCategory: Record<Category, AppearanceRow[]>;
  category: Category;
  selectedId: number | null;
  query: string;
  status: LoadStatus;
  error: string | null;
  recent: RecentFiles;

  setQuery: (query: string) => void;
  setSelected: (id: number | null) => void;
  setCategory: (category: Category) => void;

  openAppearancesPicker: () => Promise<void>;
  openOtbPicker: () => Promise<void>;
  openAppearancesPath: (path: string) => Promise<void>;
  openOtbPath: (path: string) => Promise<void>;
  closeWorkspace: () => Promise<void>;
  refreshRows: () => Promise<void>;
  refreshRecent: () => Promise<void>;
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
  // Pull each category in parallel — total payload for a real
  // appearances.dat is a few MB and the virtualizer handles 30k rows
  // fine, so eager-load all four and let tab switching be instant.
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
  query: "",
  status: "idle",
  error: null,
  recent: emptyRecent,

  setQuery: (query) => set({ query }),
  setSelected: (id) => set({ selectedId: id }),
  setCategory: (category) => set({ category, selectedId: null, query: "" }),

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
      // OTB load enriches existing object rows with cross-ref data;
      // refresh so badges + server_id show up.
      const tasks: Promise<unknown>[] = [get().refreshRecent()];
      if (summary.objectCount > 0) tasks.push(get().refreshRows());
      await Promise.all(tasks);
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
}));
