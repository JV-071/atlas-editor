import { useEffect, useMemo } from "react";

import { FileBar } from "./components/FileBar";
import { ItemList } from "./components/ItemList";
import { CATEGORY_META, Tabs } from "./components/Tabs";
import { useWorkspace } from "./stores/workspace";
import { cn } from "./lib/utils";

function DetailPanel() {
  const selectedId = useWorkspace((s) => s.selectedId);
  const rows = useWorkspace((s) => s.rowsByCategory[s.category]);
  const category = useWorkspace((s) => s.category);
  const selected = useMemo(
    () => (selectedId == null ? null : rows.find((r) => r.id === selectedId) ?? null),
    [selectedId, rows],
  );

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center text-atlas-muted text-sm">
        Select an item from the list to inspect it.
      </div>
    );
  }

  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-5 w-5 shrink-0", meta.iconClass)} />
        <h2 className="text-xl font-semibold text-atlas-ink">
          {selected.name ?? <span className="italic text-atlas-muted">(unnamed)</span>}
        </h2>
      </div>
      <p className="text-sm text-atlas-muted font-mono">
        <span className={meta.textClass}>{category}</span> · id {selected.id}
        {selected.otbServerId != null && <> · otb server_id {selected.otbServerId}</>}
        {" · "}
        {selected.spriteCount} sprite(s)
      </p>
      {(selected.isAppearanceOrphan || selected.hasOtbCollision) && (
        <ul className="mt-3 text-xs space-y-1">
          {selected.isAppearanceOrphan && (
            <li className="text-amber-700">⚠ No OTB entry references this appearance.</li>
          )}
          {selected.hasOtbCollision && (
            <li className="text-rose-700">⚠ Multiple OTB items resolve to this appearance.</li>
          )}
        </ul>
      )}
      <p className="mt-6 text-sm text-atlas-ink-soft">
        Attribute editor lands in Phase 3.
      </p>
    </div>
  );
}

export default function App() {
  const summary = useWorkspace((s) => s.summary);
  const refreshRows = useWorkspace((s) => s.refreshRows);
  const refreshRecent = useWorkspace((s) => s.refreshRecent);

  // On reload during `tauri dev`, the backend retains its state — refresh
  // the row cache + recent_files so the UI matches whatever is still in
  // memory (and what was persisted before).
  useEffect(() => {
    void refreshRows();
    void refreshRecent();
  }, [refreshRows, refreshRecent]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-atlas-cream text-atlas-ink">
      <FileBar />
      <Tabs />
      <main className="flex flex-1 min-h-0">
        <aside className="w-[360px] shrink-0 min-h-0">
          <ItemList />
        </aside>
        <DetailPanel />
      </main>
      <footer className="border-t border-atlas-border bg-atlas-paper px-4 py-1.5 text-xs text-atlas-muted flex items-center justify-between">
        <span>Atlas Assets Editor · Phase 2</span>
        <span>
          {summary.objectCount.toLocaleString()} objects ·{" "}
          {summary.otbItemCount.toLocaleString()} otb items
        </span>
      </footer>
    </div>
  );
}
