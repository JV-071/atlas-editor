import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckSquare, Filter, Plus, Search, Square, X } from "lucide-react";

import { SheetEditor } from "./SheetEditor";
import { SpriteGrid } from "./SpriteGrid";
import { SpriteThumb } from "./SpriteThumb";
import { queueKey, useWorkspace } from "./store";
import {
  FLAG_BITS,
  FLAG_NAMES,
  type AppearanceCategory,
  type AppearanceRow,
  type FlagName,
} from "./types";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";

const ROW_HEIGHT = 48;
const THUMB_SIZE = 36;

function matches(row: AppearanceRow, needle: string): boolean {
  if (!needle) return true;
  const lc = needle.toLowerCase();
  if (String(row.id).includes(lc)) return true;
  if (row.name && row.name.toLowerCase().includes(lc)) return true;
  return false;
}

/// Popover-style filter that gates rows by appearance flags. AND
/// semantics: a row passes only when every selected flag bit is set
/// on it. Closes on outside click and on Escape.
function FlagFilter({
  requiredMask,
  setRequiredMask,
}: {
  requiredMask: number;
  setRequiredMask: (mask: number) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeCount = useMemo(() => {
    let n = 0;
    for (const name of FLAG_NAMES) {
      if (requiredMask & FLAG_BITS[name]) n++;
    }
    return n;
  }, [requiredMask]);

  function toggle(name: FlagName) {
    setRequiredMask(requiredMask ^ FLAG_BITS[name]);
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        title={t("list.filter")}
        className={cn(
          "rounded p-1 hover:bg-atlas-sand",
          activeCount > 0
            ? "text-atlas-ink bg-atlas-sand"
            : "text-atlas-muted hover:text-atlas-ink",
        )}
      >
        <Filter className="h-4 w-4" />
        {activeCount > 0 && (
          <span className="ml-0.5 text-[10px] font-semibold tabular-nums">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 z-20 mt-1 w-72 rounded border border-atlas-border bg-atlas-paper p-2 shadow-lg"
          role="dialog"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
              {t("list.filter")}
            </span>
            <button
              type="button"
              onClick={() => setRequiredMask(0)}
              disabled={activeCount === 0}
              className="text-[11px] inline-flex items-center gap-0.5 text-atlas-muted hover:text-atlas-ink disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X className="h-3 w-3" />
              {t("list.filter.clear")}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 max-h-72 overflow-y-auto">
            {FLAG_NAMES.map((name) => {
              const on = (requiredMask & FLAG_BITS[name]) !== 0;
              return (
                <label
                  key={name}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-1 py-0.5 rounded cursor-pointer",
                    on ? "text-atlas-ink" : "text-atlas-ink-soft",
                    "hover:bg-atlas-sand",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(name)}
                    className="accent-atlas-ink"
                  />
                  <span className="font-mono">{name}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/// Stable empty array reused when the category is "sprites" so the
/// appearance-row selector doesn't churn (returning `[]` inline trips
/// Zustand's strict-equality re-render loop).
const EMPTY_APPEARANCE_ROWS: AppearanceRow[] = [];

export function ItemList() {
  const category = useWorkspace((s) => s.category);
  // Sprites and Sheets tabs have completely different layouts — bail
  // before we touch any appearance-row state.
  if (category === "sprites") {
    return <SpriteGrid />;
  }
  if (category === "sheets") {
    return <SheetEditor />;
  }
  return <AppearanceList category={category} />;
}

function AppearanceList({ category }: { category: AppearanceCategory }) {
  const rows = useWorkspace((s) => s.rowsByCategory[category] ?? EMPTY_APPEARANCE_ROWS);
  const appearancesLoaded = useWorkspace((s) => s.summary.appearancesPath !== null);
  const query = useWorkspace((s) => s.query);
  const setQuery = useWorkspace((s) => s.setQuery);
  const selectedId = useWorkspace((s) => s.selectedId);
  const setSelected = useWorkspace((s) => s.setSelected);
  const createObjectAppearance = useWorkspace((s) => s.createObjectAppearance);
  const exportQueue = useWorkspace((s) => s.exportQueue);
  const toggleExportQueueEntry = useWorkspace((s) => s.toggleExportQueueEntry);
  const t = useT();

  // Flag filter is per-category — switching tabs shouldn't drag the
  // previous tab's flag selection along.
  const [flagsMaskByCategory, setFlagsMaskByCategory] = useState<
    Record<AppearanceCategory, number>
  >({ object: 0, outfit: 0, effect: 0, missile: 0 });
  const requiredMask = flagsMaskByCategory[category];
  const setRequiredMask = (mask: number) =>
    setFlagsMaskByCategory((prev) => ({ ...prev, [category]: mask }));

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !matches(row, query)) return false;
      if (requiredMask !== 0 && (row.flagsMask & requiredMask) !== requiredMask) {
        return false;
      }
      return true;
    });
  }, [rows, query, requiredMask]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  return (
    <div className="flex flex-col h-full border-r border-atlas-border bg-atlas-paper">
      <div className="p-2 border-b border-atlas-border flex items-center gap-2">
        <Search className="h-4 w-4 text-atlas-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("list.searchPlaceholder")}
          className="flex-1 bg-transparent text-sm text-atlas-ink focus:outline-none placeholder:text-atlas-muted"
        />
        <span className="text-xs text-atlas-muted tabular-nums">
          {filtered.length.toLocaleString()}
          {filtered.length !== rows.length && <> / {rows.length.toLocaleString()}</>}
        </span>
        <FlagFilter requiredMask={requiredMask} setRequiredMask={setRequiredMask} />
        {category === "object" && appearancesLoaded && (
          <button
            type="button"
            onClick={() => void createObjectAppearance()}
            title={t("list.newObject")}
            className="rounded p-1 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-atlas-muted px-6 text-center">
          {!appearancesLoaded
            ? "No assets loaded. Go back to the launcher to open a bundle."
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
              const queued = exportQueue.has(queueKey(category, row.id));
              const canQueue = row.displaySpriteIds.length > 0;
              return (
                <div
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${vrow.size}px`,
                    transform: `translateY(${vrow.start}px)`,
                  }}
                  className={cn(
                    "flex items-center gap-2 px-2 text-left text-sm transition-colors group",
                    "hover:bg-atlas-sand",
                    selected
                      ? "bg-atlas-ink text-atlas-cream hover:bg-atlas-ink"
                      : "text-atlas-ink",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => canQueue && toggleExportQueueEntry(category, row.id)}
                    disabled={!canQueue}
                    title={
                      queued ? t("queue.removeFromQueue") : t("queue.addToQueue")
                    }
                    className={cn(
                      "shrink-0 rounded p-0.5 transition-opacity",
                      queued
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus:opacity-100",
                      selected
                        ? queued
                          ? "text-atlas-cream"
                          : "text-atlas-cream/70 hover:text-atlas-cream"
                        : queued
                          ? "text-emerald-700"
                          : "text-atlas-muted hover:text-atlas-ink",
                      "disabled:opacity-0 disabled:cursor-not-allowed",
                    )}
                  >
                    {queued ? (
                      <CheckSquare className="h-3.5 w-3.5" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void setSelected(row.id)}
                    className="flex flex-1 items-center gap-2 min-w-0 text-left"
                  >
                  <span
                    className={cn(
                      "w-12 shrink-0 text-right font-mono text-xs tabular-nums",
                      selected ? "text-atlas-cream/80" : "text-atlas-muted",
                    )}
                  >
                    {row.id}
                  </span>
                  {row.displaySpriteIds.length > 0 ? (
                    <SpriteThumb
                      ids={row.displaySpriteIds}
                      durationsMs={row.displayDurationsMs}
                      size={THUMB_SIZE}
                    />
                  ) : (
                    <div
                      style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
                      className="shrink-0"
                    />
                  )}
                  <span className="flex-1 truncate">
                    {category === "object" ? (
                      row.name ?? (
                        <span
                          className={cn(
                            "italic",
                            selected ? "text-atlas-cream/70" : "text-atlas-muted",
                          )}
                        >
                          (unnamed)
                        </span>
                      )
                    ) : (
                      row.name
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      selected ? "text-atlas-cream/70" : "text-atlas-muted",
                    )}
                    title={`${row.spriteCount} sprite(s)`}
                  >
                    {row.spriteCount}
                  </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
