import { useEffect } from "react";

import { AttributeEditor } from "./components/AttributeEditor";
import { FileBar } from "./components/FileBar";
import { ItemList } from "./components/ItemList";
import { Launcher } from "./components/Launcher";
import { Tabs } from "./components/Tabs";
import { useWorkspace } from "./stores/workspace";

function Editor() {
  const summary = useWorkspace((s) => s.summary);
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-atlas-cream text-atlas-ink">
      <FileBar />
      <Tabs />
      <main className="flex flex-1 min-h-0">
        <aside className="w-[360px] shrink-0 min-h-0">
          <ItemList />
        </aside>
        <AttributeEditor />
      </main>
      <footer className="border-t border-atlas-border bg-atlas-paper px-4 py-1.5 text-xs text-atlas-muted flex items-center justify-between">
        <span>
          Atlas Assets Editor · Phase 6
          {summary.dirty && (
            <span className="ml-2 text-amber-700 font-medium">· unsaved changes</span>
          )}
        </span>
        <span>
          {summary.objectCount.toLocaleString()} objects ·{" "}
          {summary.otbItemCount.toLocaleString()} otb items
        </span>
      </footer>
    </div>
  );
}

export default function App() {
  const view = useWorkspace((s) => s.view);
  const refreshRows = useWorkspace((s) => s.refreshRows);
  const refreshRecent = useWorkspace((s) => s.refreshRecent);
  const refreshAssetsDirInfo = useWorkspace((s) => s.refreshAssetsDirInfo);
  const refreshPixelFormat = useWorkspace((s) => s.refreshPixelFormat);
  const enterEditor = useWorkspace((s) => s.enterEditor);

  // On reload during `tauri dev`, the backend retains its state — refresh
  // the row cache + recent_files so the UI matches whatever is still in
  // memory. If anything is already loaded, jump straight into the editor
  // so the user doesn't have to click through the launcher again.
  useEffect(() => {
    (async () => {
      await Promise.all([
        refreshRows(),
        refreshRecent(),
        refreshAssetsDirInfo(),
        refreshPixelFormat(),
      ]);
      const summary = useWorkspace.getState().summary;
      const hasState =
        summary.appearancesPath != null ||
        summary.otbPath != null ||
        summary.objectCount > 0;
      if (hasState) await enterEditor();
    })().catch(() => {
      // Ignore — initial load failures shouldn't break the launcher.
    });
  }, [refreshRows, refreshRecent, refreshAssetsDirInfo, refreshPixelFormat, enterEditor]);

  return view === "launcher" ? <Launcher /> : <Editor />;
}
