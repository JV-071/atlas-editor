import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, GitMerge, Plus, Search } from "lucide-react";

import { useWorkspace } from "../stores/workspace";
import type { AppearanceRow } from "../types";
import { cn } from "../lib/utils";

const ROW_HEIGHT = 32;

function matches(row: AppearanceRow, needle: string): boolean {
  if (!needle) return true;
  const lc = needle.toLowerCase();
  if (String(row.id).includes(lc)) return true;
  if (row.name && row.name.toLowerCase().includes(lc)) return true;
  if (row.otbServerId != null && String(row.otbServerId).includes(lc)) return true;
  return false;
}

export function ItemList() {
  const category = useWorkspace((s) => s.category);
  const rows = useWorkspace((s) => s.rowsByCategory[s.category]);
  const otbLoaded = useWorkspace((s) => s.summary.otbPath !== null);
  const appearancesLoaded = useWorkspace((s) => s.summary.appearancesPath !== null);
  const query = useWorkspace((s) => s.query);
  const setQuery = useWorkspace((s) => s.setQuery);
  const selectedId = useWorkspace((s) => s.selectedId);
  const setSelected = useWorkspace((s) => s.setSelected);
  const createObjectAppearance = useWorkspace((s) => s.createObjectAppearance);

  const filtered = useMemo(() => {
    if (!query) return rows;
    return rows.filter((row) => matches(row, query));
  }, [rows, query]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  const showOtbColumn = category === "object" && otbLoaded;

  return (
    <div className="flex flex-col h-full border-r border-atlas-border bg-atlas-paper">
      <div className="p-2 border-b border-atlas-border flex items-center gap-2">
        <Search className="h-4 w-4 text-atlas-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by id or name…"
          className="flex-1 bg-transparent text-sm text-atlas-ink focus:outline-none placeholder:text-atlas-muted"
        />
        <span className="text-xs text-atlas-muted tabular-nums">
          {filtered.length.toLocaleString()}
          {filtered.length !== rows.length && (
            <> / {rows.length.toLocaleString()}</>
          )}
        </span>
        {category === "object" && appearancesLoaded && (
          <button
            type="button"
            onClick={() => void createObjectAppearance()}
            title="Create new object appearance"
            className="rounded p-1 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-atlas-muted px-6 text-center">
          {category === "object"
            ? "No appearances loaded. Open an appearances.dat file to begin."
            : `No ${category}s in this file.`}
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((vrow) => {
              const row = filtered[vrow.index];
              const selected = row.id === selectedId;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelected(row.id)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${vrow.size}px`,
                    transform: `translateY(${vrow.start}px)`,
                  }}
                  className={cn(
                    "flex items-center gap-3 px-3 text-left text-sm transition-colors",
                    "hover:bg-atlas-sand",
                    selected
                      ? "bg-atlas-ink text-atlas-cream hover:bg-atlas-ink"
                      : "text-atlas-ink",
                  )}
                >
                  <span
                    className={cn(
                      "w-14 shrink-0 text-right font-mono text-xs tabular-nums",
                      selected ? "text-atlas-cream/80" : "text-atlas-muted",
                    )}
                  >
                    {row.id}
                  </span>
                  <span className="flex-1 truncate">
                    {row.name ?? (
                      <span
                        className={cn(
                          "italic",
                          selected ? "text-atlas-cream/70" : "text-atlas-muted",
                        )}
                      >
                        (unnamed)
                      </span>
                    )}
                  </span>

                  {showOtbColumn && (
                    <>
                      {row.hasOtbCollision && (
                        <GitMerge
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            selected ? "text-atlas-cream" : "text-rose-700",
                          )}
                          aria-label="Multiple OTB items map to this appearance"
                        />
                      )}
                      {row.isAppearanceOrphan && (
                        <AlertTriangle
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            selected ? "text-atlas-cream" : "text-amber-600",
                          )}
                          aria-label="No OTB entry for this appearance"
                        />
                      )}
                      {row.otbServerId != null && (
                        <span
                          className={cn(
                            "shrink-0 text-xs font-mono tabular-nums",
                            selected ? "text-atlas-cream" : "text-emerald-700",
                          )}
                          title="OTB server_id"
                        >
                          #{row.otbServerId}
                        </span>
                      )}
                    </>
                  )}

                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      selected ? "text-atlas-cream/70" : "text-atlas-muted",
                    )}
                    title={`${row.spriteCount} sprite(s)`}
                  >
                    {row.spriteCount}s
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
