import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckSquare,
  Download,
  ListChecks,
  Loader2,
  Square,
  X,
} from "lucide-react";

import { SpriteThumb } from "./SpriteThumb";
import { queueKey, useWorkspace } from "./store";
import {
  APPEARANCE_CATEGORIES,
  FLAG_BITS,
  FLAG_NAMES,
  type AppearanceCategory,
  type AppearanceRow,
  type FlagName,
} from "./types";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";

/// Three-state pressed style for the flag picker tile. Bit gets ORed
/// into either the "required" or "forbidden" mask depending on which
/// of the three states the user lands on; clicking cycles through.
type FlagState = "ignore" | "on" | "off";

interface Filters {
  /// `null` = search every category.
  category: AppearanceCategory | null;
  name: string;
  idFrom: number | null;
  idTo: number | null;
  required: number;
  forbidden: number;
}

const EMPTY_FILTERS: Filters = {
  category: null,
  name: "",
  idFrom: null,
  idTo: null,
  required: 0,
  forbidden: 0,
};

interface MatchedRow {
  row: AppearanceRow;
  category: AppearanceCategory;
}

interface Props {
  onClose: () => void;
}

export function SearchDialog({ onClose }: Props) {
  const rowsByCategory = useWorkspace((s) => s.rowsByCategory);
  const setSelected = useWorkspace((s) => s.setSelected);
  const setCategory = useWorkspace((s) => s.setCategory);
  const toggleExportQueueEntry = useWorkspace((s) => s.toggleExportQueueEntry);
  const updateAppearanceField = useWorkspace((s) => s.updateAppearanceField);
  const t = useT();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFlag, setBulkFlag] = useState<FlagName>("container");
  const [bulkValue, setBulkValue] = useState(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !bulkBusy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, bulkBusy]);

  const matches: MatchedRow[] = useMemo(() => {
    const categories: AppearanceCategory[] = filters.category
      ? [filters.category]
      : APPEARANCE_CATEGORIES;
    const nameNeedle = filters.name.trim().toLowerCase();
    const out: MatchedRow[] = [];
    for (const cat of categories) {
      const rows = rowsByCategory[cat] ?? [];
      for (const row of rows) {
        if (
          filters.idFrom != null &&
          Number.isFinite(filters.idFrom) &&
          row.id < filters.idFrom
        )
          continue;
        if (
          filters.idTo != null &&
          Number.isFinite(filters.idTo) &&
          row.id > filters.idTo
        )
          continue;
        if (nameNeedle) {
          const haystack =
            (row.name?.toLowerCase() ?? "") + " " + String(row.id);
          if (!haystack.includes(nameNeedle)) continue;
        }
        if (
          filters.required !== 0 &&
          (row.flagsMask & filters.required) !== filters.required
        )
          continue;
        if (filters.forbidden !== 0 && (row.flagsMask & filters.forbidden) !== 0)
          continue;
        out.push({ row, category: cat });
      }
    }
    return out;
  }, [rowsByCategory, filters]);

  // Virtualize the result list — without this, opening Ctrl+F with no
  // filters tried to mount one `SpriteThumb` per appearance (30k+ on a
  // real catalog), which froze the modal for several seconds and fired
  // an avalanche of debounced IPC fetches.
  const ROW_HEIGHT = 40;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const pickedCount = picked.size;
  const allOnPageChecked =
    matches.length > 0 && matches.every((m) => picked.has(rowKey(m)));

  function cycleFlag(name: FlagName) {
    setFilters((prev) => {
      const bit = FLAG_BITS[name];
      const state = flagState(prev, bit);
      const next: Filters = {
        ...prev,
        required: prev.required & ~bit,
        forbidden: prev.forbidden & ~bit,
      };
      if (state === "ignore") next.required |= bit;
      else if (state === "on") next.forbidden |= bit;
      return next;
    });
  }

  function toggleRow(m: MatchedRow) {
    const key = rowKey(m);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllOnPage() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const m of matches) next.add(rowKey(m));
      return next;
    });
  }

  function clearSelection() {
    setPicked(new Set());
  }

  function jumpTo(m: MatchedRow) {
    setCategory(m.category);
    void setSelected(m.row.id);
    onClose();
  }

  function addPickedToQueue() {
    for (const m of pickedRows(matches, picked)) {
      // toggleExportQueueEntry adds if missing, removes if present —
      // make sure we only ever add by checking first.
      const inQueue =
        useWorkspace.getState().exportQueue.has(queueKey(m.category, m.row.id));
      if (!inQueue) toggleExportQueueEntry(m.category, m.row.id);
    }
  }

  async function applyBulkFlag() {
    const targets = pickedRows(matches, picked);
    if (targets.length === 0) return;
    const fieldPath = `flags.${snakeFromCamel(bulkFlag)}`;
    setBulkBusy(true);
    try {
      // Sequential to keep undo history coherent — running in parallel
      // would interleave snapshots and break the editor's mental model
      // of "one user action = one history entry".
      for (const m of targets) {
        setCategory(m.category);
        await setSelected(m.row.id);
        await updateAppearanceField(fieldPath, bulkValue);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-atlas-ink/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !bulkBusy) onClose();
      }}
    >
      <div className="w-full max-w-5xl h-[80vh] flex flex-col rounded-lg border border-atlas-border bg-atlas-paper shadow-xl">
        <header className="flex items-center justify-between p-3 border-b border-atlas-border">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-atlas-muted">
            {t("search.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={bulkBusy}
            className="text-atlas-muted hover:text-atlas-ink disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* Filters */}
          <aside className="w-72 shrink-0 border-r border-atlas-border overflow-y-auto p-3 space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
                {t("search.filter.category")}
              </label>
              <select
                value={filters.category ?? ""}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    category: (e.target.value || null) as
                      | AppearanceCategory
                      | null,
                  }))
                }
                className="w-full px-2 py-1 rounded border border-atlas-border bg-atlas-cream text-atlas-ink focus:outline-none focus:border-atlas-ink"
              >
                <option value="">{t("search.filter.allCategories")}</option>
                {APPEARANCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
                {t("search.filter.name")}
              </label>
              <input
                type="text"
                value={filters.name}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, name: e.target.value }))
                }
                placeholder={t("search.filter.namePlaceholder")}
                className="w-full px-2 py-1 rounded border border-atlas-border bg-atlas-cream text-atlas-ink focus:outline-none focus:border-atlas-ink"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
                {t("search.filter.idRange")}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={filters.idFrom ?? ""}
                  onChange={(e) =>
                    setFilters((p) => ({
                      ...p,
                      idFrom: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  placeholder="min"
                  className="flex-1 min-w-0 px-2 py-1 rounded border border-atlas-border bg-atlas-cream text-atlas-ink tabular-nums focus:outline-none focus:border-atlas-ink"
                />
                <span className="text-atlas-muted">–</span>
                <input
                  type="number"
                  value={filters.idTo ?? ""}
                  onChange={(e) =>
                    setFilters((p) => ({
                      ...p,
                      idTo: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  placeholder="max"
                  className="flex-1 min-w-0 px-2 py-1 rounded border border-atlas-border bg-atlas-cream text-atlas-ink tabular-nums focus:outline-none focus:border-atlas-ink"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
                  {t("search.filter.flags")}
                </label>
                {(filters.required !== 0 || filters.forbidden !== 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        required: 0,
                        forbidden: 0,
                      }))
                    }
                    className="text-[10px] text-atlas-muted hover:text-atlas-ink"
                  >
                    {t("list.filter.clear")}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-atlas-muted leading-tight">
                {t("search.filter.flagsHint")}
              </p>
              <div className="grid grid-cols-2 gap-0.5">
                {FLAG_NAMES.map((name) => {
                  const state = flagState(filters, FLAG_BITS[name]);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => cycleFlag(name)}
                      className={cn(
                        "text-left text-[11px] px-1.5 py-0.5 rounded border transition-colors font-mono",
                        state === "on" &&
                          "bg-emerald-700/15 border-emerald-700/40 text-emerald-900",
                        state === "off" &&
                          "bg-rose-700/15 border-rose-700/40 text-rose-900",
                        state === "ignore" &&
                          "bg-atlas-cream border-atlas-border text-atlas-muted hover:text-atlas-ink",
                      )}
                    >
                      {state === "on" && "✓ "}
                      {state === "off" && "✗ "}
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Results */}
          <section className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 p-2 border-b border-atlas-border bg-atlas-cream/40 text-xs">
              <div className="text-atlas-muted tabular-nums">
                {t("search.results.count", { count: matches.length })}
                {pickedCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-atlas-ink font-semibold">
                      {t("search.results.selected", { count: pickedCount })}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={
                    allOnPageChecked ? clearSelection : selectAllOnPage
                  }
                  disabled={matches.length === 0}
                  className="rounded px-2 py-1 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand disabled:opacity-40"
                >
                  {allOnPageChecked
                    ? t("search.results.deselectAll")
                    : t("search.results.selectAll")}
                </button>
              </div>
            </div>

            {matches.length === 0 ? (
              <div className="flex-1 px-4 py-10 text-center text-sm text-atlas-muted italic">
                {t("search.results.empty")}
              </div>
            ) : (
              <div ref={scrollRef} className="flex-1 overflow-y-auto">
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: "relative",
                    width: "100%",
                  }}
                >
                  {virtualizer.getVirtualItems().map((vrow) => {
                    const m = matches[vrow.index];
                    const key = rowKey(m);
                    const checked = picked.has(key);
                    return (
                      <div
                        key={key}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${vrow.size}px`,
                          transform: `translateY(${vrow.start}px)`,
                        }}
                        className="flex items-center gap-2 px-2 text-sm hover:bg-atlas-sand/60 border-b border-atlas-border/40"
                      >
                        <button
                          type="button"
                          onClick={() => toggleRow(m)}
                          className={cn(
                            "shrink-0 rounded p-0.5",
                            checked
                              ? "text-emerald-700"
                              : "text-atlas-muted hover:text-atlas-ink",
                          )}
                        >
                          {checked ? (
                            <CheckSquare className="h-3.5 w-3.5" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <span className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold w-12 shrink-0">
                          {m.category}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-atlas-muted w-14 shrink-0 text-right">
                          {m.row.id}
                        </span>
                        {m.row.displaySpriteIds.length > 0 ? (
                          <SpriteThumb
                            ids={m.row.displaySpriteIds}
                            durationsMs={m.row.displayDurationsMs}
                            size={32}
                          />
                        ) : (
                          <div className="w-8 h-8 shrink-0" />
                        )}
                        <button
                          type="button"
                          onClick={() => jumpTo(m)}
                          className="flex-1 min-w-0 text-left text-atlas-ink truncate hover:underline"
                        >
                          {m.row.name ?? (
                            <span className="italic text-atlas-muted">
                              (unnamed)
                            </span>
                          )}
                        </button>
                        <span className="text-[10px] text-atlas-muted shrink-0 tabular-nums">
                          {m.row.spriteCount}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="flex items-center gap-2 p-3 border-t border-atlas-border bg-atlas-cream/40">
          <div className="flex items-center gap-2 text-xs text-atlas-ink-soft">
            <span className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
              {t("search.bulk")}
            </span>
            <select
              value={bulkFlag}
              onChange={(e) => setBulkFlag(e.target.value as FlagName)}
              disabled={pickedCount === 0 || bulkBusy}
              className="px-2 py-1 rounded border border-atlas-border bg-atlas-cream text-atlas-ink font-mono focus:outline-none focus:border-atlas-ink disabled:opacity-40"
            >
              {FLAG_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1 text-atlas-ink-soft">
              <input
                type="checkbox"
                checked={bulkValue}
                onChange={(e) => setBulkValue(e.target.checked)}
                disabled={pickedCount === 0 || bulkBusy}
                className="h-3.5 w-3.5 accent-atlas-ink"
              />
              {bulkValue ? t("search.bulk.on") : t("search.bulk.off")}
            </label>
            <button
              type="button"
              onClick={() => void applyBulkFlag()}
              disabled={pickedCount === 0 || bulkBusy}
              className="inline-flex items-center gap-1 rounded border border-atlas-border bg-atlas-paper px-2 py-1 text-xs text-atlas-ink hover:border-atlas-ink hover:bg-atlas-sand disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {bulkBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ListChecks className="h-3 w-3" />
              )}
              {t("search.bulk.apply", { count: pickedCount })}
            </button>
          </div>

          <div className="flex-1" />

          <button
            type="button"
            onClick={addPickedToQueue}
            disabled={pickedCount === 0 || bulkBusy}
            className="inline-flex items-center gap-1 rounded bg-atlas-ink px-2.5 py-1 text-xs font-semibold text-atlas-cream hover:bg-atlas-ink-soft disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3 w-3" />
            {t("search.queue.add", { count: pickedCount })}
          </button>
        </footer>
      </div>
    </div>
  );
}

function rowKey(m: MatchedRow): string {
  return `${m.category}:${m.row.id}`;
}

function pickedRows(matches: MatchedRow[], picked: Set<string>): MatchedRow[] {
  return matches.filter((m) => picked.has(rowKey(m)));
}

function flagState(filters: Filters, bit: number): FlagState {
  if ((filters.required & bit) !== 0) return "on";
  if ((filters.forbidden & bit) !== 0) return "off";
  return "ignore";
}

/// Convert a camelCase `FlagName` (e.g. `dualWielding`) into the
/// snake_case path the backend's `update_appearance_field` expects
/// (`dual_wielding`). Keeps the FLAG_BITS table tidy without
/// duplicating both spellings.
function snakeFromCamel(name: string): string {
  return name.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}
