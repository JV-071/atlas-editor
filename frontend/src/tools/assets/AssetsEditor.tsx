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
  const refreshSummary = useWorkspace((s) => s.refreshSummary);
  const refreshPixelFormat = useWorkspace((s) => s.refreshPixelFormat);
  const refreshProfiles = useWorkspace((s) => s.refreshProfiles);

  // On mount, sync with backend state (the parsed workspace survives
  // hot-reloads in `cargo tauri dev`, F5, and home↔assets navigation).
  // We deliberately do NOT auto-enter the editor here: the launcher's
  // job is to let the user confirm or replace the staged bundle before
  // committing. `refreshSummary` is critical so the preview card shows
  // real appearance counts (not zeros) when the backend already has a
  // bundle but the frontend store was just re-initialized.
  useEffect(() => {
    (async () => {
      await Promise.all([
        refreshRows(),
        refreshRecent(),
        refreshAssetsDirInfo(),
        refreshSummary(),
        refreshPixelFormat(),
        refreshProfiles(),
      ]);
      const state = useWorkspace.getState();
      const { summary, assetsDir } = state;
      const totalAppearances =
        summary.objectCount +
        summary.outfitCount +
        summary.effectCount +
        summary.missileCount;
      // Real Tibia bundles always have thousands of objects + at least a
      // few outfits/effects/missiles. Zero across all four categories
      // with a non-null path is a sentinel for a corrupted or
      // partially-hydrated workspace (e.g. backend was restarted mid-edit
      // or the appearances file moved on disk). Tear it down so the
      // launcher renders the empty pick prompt instead of a green card
      // pointing at unusable data.
      if (totalAppearances === 0 && (summary.appearancesPath != null || assetsDir != null)) {
        await state.closeWorkspace();
      }
    })().catch(() => {
      // Initial load failures shouldn't break the launcher.
    });
  }, [
    refreshRows,
    refreshRecent,
    refreshAssetsDirInfo,
    refreshSummary,
    refreshPixelFormat,
    refreshProfiles,
  ]);

  // Memoize per-view render so React doesn't tear down/recreate the
  // whole editor tree on launcher↔editor flips when nothing else
  // changed.
  return useMemo(() => (view === "launcher" ? <Launcher /> : <Editor />), [view]);
}
