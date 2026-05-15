import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, ImageOff, Loader2, Search } from "lucide-react";

import { useWorkspace } from "./store";
import type { SpriteRangeDto } from "./types";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";

/// Magnifier radius (px on the rendered sheet, before zoom). 80 px
/// mirrors the WPF reference's glass widget. Below this we'd hit
/// individual pixels; above it crowds the toolbar.
const MAGNIFIER_RADIUS = 80;
/// Zoom multiplier applied inside the magnifier loupe.
const MAGNIFIER_ZOOM = 3;

/// Standalone editor for a single sprite sheet PNG. Sidebar lists every
/// sheet in the catalog; the main pane renders the decoded image with
/// a grid overlay and a hover-driven loupe for pixel inspection.
export function SheetEditor() {
  const spriteRanges = useWorkspace((s) => s.spriteRanges);
  const assetsDir = useWorkspace((s) => s.assetsDir);
  const selectedSheetFile = useWorkspace((s) => s.selectedSheetFile);
  const setSelectedSheetFile = useWorkspace((s) => s.setSelectedSheetFile);
  const t = useT();
  const [query, setQuery] = useState("");

  // Default-select the first sheet on entering the tab so the main
  // pane isn't blank.
  useEffect(() => {
    if (!selectedSheetFile && spriteRanges.length > 0) {
      setSelectedSheetFile(spriteRanges[0].sheetFile);
    }
  }, [selectedSheetFile, spriteRanges, setSelectedSheetFile]);

  const filtered = useMemo(() => {
    if (!query) return spriteRanges;
    const lc = query.toLowerCase();
    return spriteRanges.filter(
      (r) =>
        r.sheetFile.toLowerCase().includes(lc) ||
        String(r.firstspriteid).includes(lc) ||
        String(r.lastspriteid).includes(lc),
    );
  }, [spriteRanges, query]);

  const selected = useMemo(
    () => spriteRanges.find((r) => r.sheetFile === selectedSheetFile) ?? null,
    [spriteRanges, selectedSheetFile],
  );

  if (!assetsDir) {
    return (
      <div className="flex flex-col h-full border-r border-atlas-border bg-atlas-paper items-center justify-center text-sm text-atlas-muted px-6 text-center">
        {t("sheets.noAssets")}
      </div>
    );
  }

  if (spriteRanges.length === 0) {
    return (
      <div className="flex flex-col h-full border-r border-atlas-border bg-atlas-paper items-center justify-center text-sm text-atlas-muted px-6 text-center">
        {t("sheets.empty")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <aside className="w-72 shrink-0 flex flex-col border-r border-atlas-border bg-atlas-paper">
        <div className="p-2 border-b border-atlas-border flex items-center gap-2">
          <Search className="h-4 w-4 text-atlas-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sheets.searchPlaceholder")}
            className="flex-1 bg-transparent text-sm text-atlas-ink focus:outline-none placeholder:text-atlas-muted"
          />
          <span className="text-xs text-atlas-muted tabular-nums">
            {filtered.length.toLocaleString()}
            {filtered.length !== spriteRanges.length && (
              <> / {spriteRanges.length.toLocaleString()}</>
            )}
          </span>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.map((range) => {
            const isActive = range.sheetFile === selectedSheetFile;
            return (
              <li key={range.sheetFile}>
                <button
                  type="button"
                  onClick={() => setSelectedSheetFile(range.sheetFile)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs border-b border-atlas-border/40 transition-colors",
                    isActive
                      ? "bg-atlas-ink text-atlas-cream"
                      : "text-atlas-ink hover:bg-atlas-sand",
                  )}
                >
                  <div className="font-mono truncate">{range.sheetFile}</div>
                  <div
                    className={cn(
                      "flex items-baseline gap-2 mt-0.5 font-mono tabular-nums",
                      isActive ? "text-atlas-cream/70" : "text-atlas-muted",
                    )}
                  >
                    <span>
                      {range.firstspriteid.toLocaleString()}–
                      {range.lastspriteid.toLocaleString()}
                    </span>
                    <span>
                      {range.width}×{range.height}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        {selected ? (
          <SheetView range={selected} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-atlas-muted italic">
            {t("sheets.pickHint")}
          </div>
        )}
      </main>
    </div>
  );
}

/// Renders the selected sheet's PNG with overlay grid and a hover
/// magnifier. Fetched via `get_sheet_png_url` so the LZMA decompression
/// happens once per sheet on the backend; subsequent visits hit the
/// cached `Atlas` entry.
function SheetView({ range }: { range: SpriteRangeDto }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [magnify, setMagnify] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    invoke<string>("get_sheet_png_url", { sheetFile: range.sheetFile })
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.sheetFile]);

  async function exportPng() {
    const sel = await saveDialog({
      title: t("sheets.exportSheet"),
      defaultPath: `${range.sheetFile}.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!sel) return;
    try {
      await invoke<string>("export_sheet_png_file", {
        sheetFile: range.sheetFile,
        outputPath: sel,
      });
    } catch (e) {
      setError(String(e));
    }
  }

  // Sprite tile size & grid layout. The catalog gives us pixel
  // dimensions per cell; sheets are square (height == width on disk),
  // and the cell count follows from the actual decoded PNG size.
  const cols = imgSize ? Math.max(1, Math.floor(imgSize.w / range.width)) : 0;
  const rows = imgSize ? Math.max(1, Math.floor(imgSize.h / range.height)) : 0;

  // Loupe positioning: snap to the cell the cursor is on so the magnifier
  // doesn't jump around per pixel — much easier to inspect that way.
  const hoverCell = hover && imgSize
    ? {
        col: Math.min(cols - 1, Math.max(0, Math.floor(hover.x / range.width))),
        row: Math.min(rows - 1, Math.max(0, Math.floor(hover.y / range.height))),
      }
    : null;
  const hoverSpriteId = hoverCell
    ? range.firstspriteid + hoverCell.row * cols + hoverCell.col
    : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-atlas-border bg-atlas-paper text-xs">
        <span className="font-mono text-atlas-ink truncate flex-1" title={range.sheetFile}>
          {range.sheetFile}
        </span>
        <span className="text-atlas-muted font-mono tabular-nums shrink-0">
          {range.firstspriteid}–{range.lastspriteid} · {range.width}×{range.height}
        </span>
        <label className="inline-flex items-center gap-1 text-atlas-muted">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
            className="h-3 w-3 accent-atlas-ink"
          />
          {t("sheets.grid")}
        </label>
        <label className="inline-flex items-center gap-1 text-atlas-muted">
          <input
            type="checkbox"
            checked={magnify}
            onChange={(e) => setMagnify(e.target.checked)}
            className="h-3 w-3 accent-atlas-ink"
          />
          {t("sheets.magnifier")}
        </label>
        <button
          type="button"
          onClick={() => void exportPng()}
          disabled={loading || error != null}
          className="inline-flex items-center gap-1 rounded border border-atlas-border bg-atlas-paper px-2 py-1 text-atlas-ink hover:border-atlas-ink hover:bg-atlas-sand disabled:opacity-40"
        >
          <Download className="h-3 w-3" />
          {t("sheets.exportSheet")}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-auto bg-atlas-cream p-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-atlas-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        )}
        {error && (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded bg-rose-100 border border-rose-300 text-sm text-rose-900">
            <ImageOff className="h-4 w-4" /> {error}
          </div>
        )}
        {url && (
          <div
            ref={containerRef}
            className="relative inline-block bg-atlas-paper border border-atlas-border shadow-sm"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHover({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
              });
            }}
          >
            <img
              ref={imgRef}
              src={url}
              alt={range.sheetFile}
              className="block max-w-none select-none"
              style={{ imageRendering: "pixelated" }}
              draggable={false}
              onLoad={(e) => {
                const target = e.currentTarget;
                setImgSize({
                  w: target.naturalWidth,
                  h: target.naturalHeight,
                });
              }}
            />
            {showGrid && imgSize && (
              <svg
                className="absolute inset-0 pointer-events-none"
                width={imgSize.w}
                height={imgSize.h}
              >
                {Array.from({ length: cols + 1 }, (_, i) => (
                  <line
                    key={`v${i}`}
                    x1={i * range.width}
                    y1={0}
                    x2={i * range.width}
                    y2={imgSize.h}
                    stroke="rgba(0,0,0,0.18)"
                    strokeWidth={1}
                  />
                ))}
                {Array.from({ length: rows + 1 }, (_, i) => (
                  <line
                    key={`h${i}`}
                    x1={0}
                    y1={i * range.height}
                    x2={imgSize.w}
                    y2={i * range.height}
                    stroke="rgba(0,0,0,0.18)"
                    strokeWidth={1}
                  />
                ))}
                {hoverCell && (
                  <rect
                    x={hoverCell.col * range.width}
                    y={hoverCell.row * range.height}
                    width={range.width}
                    height={range.height}
                    fill="rgba(20,184,166,0.18)"
                    stroke="rgba(15,118,110,0.9)"
                    strokeWidth={1.5}
                  />
                )}
              </svg>
            )}
            {magnify && hover && imgSize && (
              <div
                aria-hidden
                className="absolute pointer-events-none rounded-full border-2 border-atlas-ink/70 bg-atlas-paper shadow-lg overflow-hidden"
                style={{
                  width: MAGNIFIER_RADIUS * 2,
                  height: MAGNIFIER_RADIUS * 2,
                  left: Math.min(
                    Math.max(hover.x - MAGNIFIER_RADIUS, 0),
                    imgSize.w - MAGNIFIER_RADIUS * 2,
                  ),
                  top: Math.min(
                    Math.max(hover.y - MAGNIFIER_RADIUS, 0),
                    imgSize.h - MAGNIFIER_RADIUS * 2,
                  ),
                }}
              >
                <div
                  style={{
                    width: imgSize.w * MAGNIFIER_ZOOM,
                    height: imgSize.h * MAGNIFIER_ZOOM,
                    backgroundImage: `url(${url})`,
                    backgroundSize: `${imgSize.w * MAGNIFIER_ZOOM}px ${imgSize.h * MAGNIFIER_ZOOM}px`,
                    backgroundRepeat: "no-repeat",
                    imageRendering: "pixelated",
                    transform: `translate(${MAGNIFIER_RADIUS - hover.x * MAGNIFIER_ZOOM}px, ${MAGNIFIER_RADIUS - hover.y * MAGNIFIER_ZOOM}px)`,
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {hoverSpriteId != null && (
        <footer className="border-t border-atlas-border bg-atlas-paper px-3 py-1 text-xs text-atlas-muted font-mono tabular-nums">
          {t("sheets.hover", {
            spriteId: hoverSpriteId,
            col: hoverCell!.col,
            row: hoverCell!.row,
          })}
        </footer>
      )}
    </div>
  );
}
