import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ImageOff, Search } from "lucide-react";

import { useWorkspace } from "./store";
import type { SpriteRangeDto } from "./types";
import { cn } from "../../shared/utils";

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

/// Lazy per-tile renderer. Each tile fetches its own PNG (the backend
/// already caches the decoded sheet, so the marginal cost is just the
/// PNG encode), and renders pixelated. Keeps a small per-instance
/// state to track loading vs loaded vs error.
function SpriteTile({ id }: { id: number }) {
  const fetchSpritePng = useWorkspace((s) => s.fetchSpritePng);
  const cacheBust = useWorkspace((s) => s.spriteCacheBust);
  const [url, setUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setErrored(false);
    fetchSpritePng(id)
      .then((u) => {
        if (cancelled) return;
        if (u) setUrl(u);
        else setErrored(true);
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, fetchSpritePng, cacheBust]);

  return (
    <div
      className="flex flex-col items-center gap-1"
      title={`sprite_id ${id}`}
    >
      <div
        className={cn(
          "w-16 h-16 rounded border border-atlas-border bg-atlas-paper flex items-center justify-center overflow-hidden",
          !url && !errored && "animate-pulse",
        )}
      >
        {url ? (
          <img
            src={url}
            alt={`sprite ${id}`}
            className="max-w-full max-h-full"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <ImageOff className="h-5 w-5 text-atlas-muted/60" />
        )}
      </div>
      <span className="text-[10px] text-atlas-muted font-mono tabular-nums">{id}</span>
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
                      <SpriteTile key={id} id={id} />
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
