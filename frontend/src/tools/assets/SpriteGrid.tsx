import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, Layers, Search } from "lucide-react";

import { SpriteThumb } from "./SpriteThumb";
import { useWorkspace } from "./store";
import type { SpriteRangeDto } from "./types";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";

const TILE_PIXELS = 64; // sprite image footprint
const LABEL_GAP = 22; // id label height + gap underneath
const COL_GAP = 12; // horizontal padding between tiles
const ROW_GAP = 12; // vertical padding between rows

/// Walk the catalog's per-sheet ranges and emit the i-th sprite id, or
/// null when the index is past the end. The ranges are sorted in the
/// store, so this is O(ranges) per call — fine for a few hundred sheets.
function indexToId(ranges: SpriteRangeDto[], index: number): number | null {
  let acc = 0;
  for (const r of ranges) {
    const size = r.lastspriteid - r.firstspriteid + 1;
    if (index < acc + size) return r.firstspriteid + (index - acc);
    acc += size;
  }
  return null;
}

function totalSprites(ranges: SpriteRangeDto[]): number {
  return ranges.reduce((acc, r) => acc + (r.lastspriteid - r.firstspriteid + 1), 0);
}

/// Build the list of ids the user wants to see. If `query` is empty
/// we expose every id in the catalog. Otherwise we filter for ids
/// whose decimal form contains the query — same UX as the appearance
/// search box.
function filteredIds(ranges: SpriteRangeDto[], query: string): number[] | null {
  if (!query) return null; // null = "show everything" (lazy iteration)
  const lc = query.toLowerCase();
  const out: number[] = [];
  for (const r of ranges) {
    for (let id = r.firstspriteid; id <= r.lastspriteid; id++) {
      if (String(id).includes(lc)) out.push(id);
      if (out.length >= 5000) return out; // cap so the grid stays responsive
    }
  }
  return out;
}

/// Single grid cell. Right-click opens a small context menu offering
/// "export sprite as PNG" and "view in sheet" — both wired to the
/// Phase 5 backend commands and the Sheets tab respectively.
function SpriteTile({
  id,
  ranges,
}: {
  id: number;
  ranges: SpriteRangeDto[];
}) {
  const t = useT();
  const setCategory = useWorkspace((s) => s.setCategory);
  const setSelectedSheetFile = useWorkspace((s) => s.setSelectedSheetFile);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  async function exportSprite() {
    setMenu(null);
    const sel = await saveDialog({
      title: t("sheets.exportSprite"),
      defaultPath: `sprite-${id}.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!sel) return;
    try {
      await invoke<string>("export_sprite_png_file", {
        spriteId: id,
        outputPath: sel,
      });
    } catch {
      // Swallow — UI already surfaces errors via the global toast
      // path; one bad export shouldn't blow up the grid.
    }
  }

  function viewInSheet() {
    setMenu(null);
    const sheet = ranges.find(
      (r) => id >= r.firstspriteid && id <= r.lastspriteid,
    );
    if (!sheet) return;
    setSelectedSheetFile(sheet.sheetFile);
    setCategory("sheets");
  }

  return (
    <div
      className="flex flex-col items-center gap-1 relative"
      title={`sprite_id ${id}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <SpriteThumb ids={[id]} size={64} />
      <span className="text-[10px] text-atlas-muted font-mono tabular-nums">{id}</span>
      {menu && (
        <div
          className="fixed z-30 w-44 rounded border border-atlas-border bg-atlas-paper shadow-lg text-sm py-1"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void exportSprite()}
            className={cn(
              "w-full text-left px-3 py-1.5 flex items-center gap-2 text-atlas-ink",
              "hover:bg-atlas-sand",
            )}
          >
            <Download className="h-3.5 w-3.5" />
            {t("sheets.exportSprite")}
          </button>
          <button
            type="button"
            onClick={viewInSheet}
            className={cn(
              "w-full text-left px-3 py-1.5 flex items-center gap-2 text-atlas-ink",
              "hover:bg-atlas-sand",
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            {t("sheets.viewInSheet")}
          </button>
        </div>
      )}
    </div>
  );
}

export function SpriteGrid() {
  const spriteRanges = useWorkspace((s) => s.spriteRanges);
  const query = useWorkspace((s) => s.query);
  const setQuery = useWorkspace((s) => s.setQuery);
  const assetsDir = useWorkspace((s) => s.assetsDir);

  const total = useMemo(() => totalSprites(spriteRanges), [spriteRanges]);
  const filtered = useMemo(() => filteredIds(spriteRanges, query), [spriteRanges, query]);
  const filteredCount = filtered != null ? filtered.length : total;

  // Compute columns from the actual container width so the grid feels
  // dense on a wide editor and still readable when the user shrinks
  // the panel. Recompute on resize via ResizeObserver.
  const containerRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(6);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      // Each tile takes TILE_PIXELS + COL_GAP px (plus padding around).
      const available = Math.max(0, w - COL_GAP * 2);
      const next = Math.max(1, Math.floor((available + COL_GAP) / (TILE_PIXELS + COL_GAP)));
      setCols(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(filteredCount / cols);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TILE_PIXELS + LABEL_GAP + ROW_GAP,
    overscan: 4,
  });

  return (
    <div className="flex flex-col h-full border-r border-atlas-border bg-atlas-paper">
      <div className="p-2 border-b border-atlas-border flex items-center gap-2">
        <Search className="h-4 w-4 text-atlas-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by sprite id…"
          className="flex-1 bg-transparent text-sm text-atlas-ink focus:outline-none placeholder:text-atlas-muted"
        />
        <span className="text-xs text-atlas-muted tabular-nums">
          {filteredCount.toLocaleString()}
          {filtered != null && filteredCount !== total && (
            <> / {total.toLocaleString()}</>
          )}
        </span>
      </div>

      {!assetsDir ? (
        <div className="flex-1 flex items-center justify-center text-sm text-atlas-muted px-6 text-center">
          No assets loaded. Go back to the launcher to open a bundle.
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-atlas-muted px-6 text-center">
          Catalog has no sprite sheets.
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 min-h-0">
          <div ref={scrollRef} className="h-full overflow-auto p-3">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: "relative",
                width: "100%",
              }}
            >
              {virtualizer.getVirtualItems().map((vrow) => {
                const start = vrow.index * cols;
                const ids: number[] = [];
                for (let i = 0; i < cols; i++) {
                  const idx = start + i;
                  if (idx >= filteredCount) break;
                  const id =
                    filtered != null ? filtered[idx] : indexToId(spriteRanges, idx);
                  if (id != null) ids.push(id);
                }
                return (
                  <div
                    key={vrow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vrow.start}px)`,
                    }}
                    className="flex flex-wrap gap-3"
                  >
                    {ids.map((id) => (
                      <SpriteTile key={id} id={id} ranges={spriteRanges} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
