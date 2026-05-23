import { create } from "zustand";

/// Which tool the user is currently in. `home` is the launcher tile
/// grid; the others are the actual editors.
export type Tool = "home" | "assets" | "converter" | "mapConverter" | "map";

interface AppState {
  tool: Tool;
  setTool: (tool: Tool) => void;
}

/// Top-level navigation store. Each tool owns its own state in a
/// dedicated module (e.g. `tools/assets/store.ts`); this one only
/// remembers which tool is in the foreground so `App.tsx` can route.
export const useApp = create<AppState>((set) => ({
  tool: "home",
  setTool: (tool) => set({ tool }),
}));
