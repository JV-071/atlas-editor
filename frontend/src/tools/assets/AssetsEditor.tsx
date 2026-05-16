import { useEffect, useMemo } from "react";

import { AttributeEditor } from "./AttributeEditor";
import { FileBar } from "./FileBar";
import { ItemList } from "./ItemList";
import { Launcher } from "./Launcher";
import { Tabs } from "./Tabs";
import { useWorkspace } from "./store";

function Editor() {
  const summary = useWorkspace((s) => s.summary);
  const category = useWorkspace((s) => s.category);
  // The Sheets tab embeds its own sidebar + main view, so giving it
  // the AttributeEditor's slot too would crush both panes. Drop the
  // attribute panel for that category only.
  const fullWidthTab = category === "sheets";
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-atlas-cream text-atlas-ink">
      <FileBar />
      <Tabs />
      <main className="flex flex-1 min-h-0">
        {fullWidthTab ? (
          <ItemList />
        ) : (
          <>
            <aside className="w-[360px] shrink-0 min-h-0">
              <ItemList />
            </aside>
            <AttributeEditor />
          </>
        )}
      </main>
      <footer className="border-t border-atlas-border bg-atlas-paper px-4 py-1.5 text-xs text-atlas-muted flex items-center justify-between">
        <span>
          Atlas Editor · Assets
          {summary.dirty && (
            <span className="ml-2 text-amber-700 font-medium">· unsaved changes</span>
          )}
        </span>
        <span>
          {summary.objectCount.toLocaleString()} objects ·{" "}
          {summary.outfitCount.toLocaleString()} outfits ·{" "}
          {summary.effectCount.toLocaleString()} effects ·{" "}
          {summary.missileCount.toLocaleString()} missiles
        </span>
      </footer>
    </div>
  );
}

export function AssetsEditor() {
  const view = useWorkspace((s) => s.view);
  const refreshRows = useWorkspace((s) => s.refreshRows);
  const refreshRecent = useWorkspace((s) => s.refreshRecent);
  const refreshAssetsDirInfo = useWorkspace((s) => s.refreshAssetsDirInfo);
  const refreshPixelFormat = useWorkspace((s) => s.refreshPixelFormat);
  const refreshProfiles = useWorkspace((s) => s.refreshProfiles);
  const enterEditor = useWorkspace((s) => s.enterEditor);

  // On mount, sync with backend state (the parsed workspace survives
  // hot-reloads in `cargo tauri dev`), then jump straight into the
  // editor if anything is already loaded.
  useEffect(() => {
    (async () => {
      await Promise.all([
        refreshRows(),
        refreshRecent(),
        refreshAssetsDirInfo(),
        refreshPixelFormat(),
        refreshProfiles(),
      ]);
      const summary = useWorkspace.getState().summary;
      const hasState = summary.appearancesPath != null || summary.objectCount > 0;
      if (hasState) await enterEditor();
    })().catch(() => {
      // Initial load failures shouldn't break the launcher.
    });
  }, [
    refreshRows,
    refreshRecent,
    refreshAssetsDirInfo,
    refreshPixelFormat,
    refreshProfiles,
    enterEditor,
  ]);

  // Memoize per-view render so React doesn't tear down/recreate the
  // whole editor tree on launcher↔editor flips when nothing else
  // changed.
  return useMemo(() => (view === "launcher" ? <Launcher /> : <Editor />), [view]);
}
