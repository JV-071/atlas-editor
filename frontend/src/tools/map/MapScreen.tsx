import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Map as MapIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { useApp } from "../../appStore";
import { useT } from "../../i18n";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";

const TILE = 32;
/// Extra tiles rendered around the viewport so a drag reveals real
/// pixels at the edges before the region re-renders on release.
const PAD = 6;

interface MapInfo {
  path: string;
  width: number;
  height: number;
  otbmVersion: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  floors: number[];
  tileCount: number;
}

function basename(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const i = cleaned.lastIndexOf("/");
  return i === -1 ? cleaned : cleaned.slice(i + 1);
}

export function MapScreen() {
  const setTool = useApp((s) => s.setTool);
  const t = useT();

  const [info, setInfo] = useState<MapInfo | null>(null);
  const [floor, setFloor] = useState(7);
  const [zoom, setZoom] = useState(1);
  // Camera = the map tile shown at the viewport's top-left.
  const [cam, setCam] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  // Where the rendered region's top-left sits, so we can position the img
  // and translate a tile coordinate back from a click.
  const regionRef = useRef({ x0: 0, y0: 0, w: 0, h: 0 });

  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [tileItems, setTileItems] = useState<number[]>([]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  // Live drag offset (px), applied as a transform without re-rendering.
  const drag = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Measure the viewport.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [info]);

  async function openMap() {
    const sel = await openDialog({
      title: t("mapedit.openMap"),
      multiple: false,
      directory: false,
      filters: [{ name: "OTBM map", extensions: ["otbm"] }],
    });
    const path = Array.isArray(sel) ? sel[0] : sel;
    if (!path) return;
    setError(null);
    try {
      const mi = await invoke<MapInfo>("map_open", { path });
      setInfo(mi);
      setFloor(mi.floors.includes(7) ? 7 : (mi.floors[0] ?? 7));
      // Center the camera on the map's bounds.
      setCam({
        x: Math.floor((mi.minX + mi.maxX) / 2) - 8,
        y: Math.floor((mi.minY + mi.maxY) / 2) - 6,
      });
      setSelected(null);
      setTileItems([]);
    } catch (e) {
      setError(String(e));
      setInfo(null);
    }
  }

  // Render the visible region whenever the view parameters change.
  const renderRegion = useCallback(async () => {
    if (!info || viewport.w === 0) return;
    const viewTilesW = Math.ceil(viewport.w / (TILE * zoom));
    const viewTilesH = Math.ceil(viewport.h / (TILE * zoom));
    const x0 = Math.max(0, cam.x - PAD);
    const y0 = Math.max(0, cam.y - PAD);
    const w = Math.min(64, viewTilesW + 2 * PAD);
    const h = Math.min(64, viewTilesH + 2 * PAD);
    try {
      const buf = await invoke<ArrayBuffer>("map_render_region", {
        z: floor,
        x0,
        y0,
        wTiles: w,
        hTiles: h,
      });
      const url = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
      regionRef.current = { x0, y0, w, h };
      setImgUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [info, viewport.w, viewport.h, zoom, cam.x, cam.y, floor]);

  useEffect(() => {
    void renderRegion();
  }, [renderRegion]);

  // Clean up the last object URL on unmount.
  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { active: true, startX: e.clientX, startY: e.clientY, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current?.active) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.current.moved = true;
    setPan({ x: dx, y: dy });
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setPan({ x: 0, y: 0 });
    if (d.moved) {
      // Commit the drag as a whole-tile camera move.
      const tilesX = Math.round(dx / (TILE * zoom));
      const tilesY = Math.round(dy / (TILE * zoom));
      setCam((c) => ({ x: Math.max(0, c.x - tilesX), y: Math.max(0, c.y - tilesY) }));
    } else {
      // A click: figure out which tile and inspect it.
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const tileX = cam.x + Math.floor(px / (TILE * zoom));
      const tileY = cam.y + Math.floor(py / (TILE * zoom));
      setSelected({ x: tileX, y: tileY });
      void invoke<number[]>("map_tile_items", { z: floor, x: tileX, y: tileY })
        .then(setTileItems)
        .catch(() => setTileItems([]));
    }
  }

  // The img's top-left in viewport px: region origin offset by camera,
  // scaled by zoom, plus the live drag pan.
  const imgLeft = -(cam.x - regionRef.current.x0) * TILE * zoom + pan.x;
  const imgTop = -(cam.y - regionRef.current.y0) * TILE * zoom + pan.y;

  const floors = info?.floors ?? [];
  const floorIdx = floors.indexOf(floor);

  return (
    <main className="h-screen w-screen flex flex-col bg-atlas-cream text-atlas-ink overflow-hidden">
      {/* Header */}
      <header className="border-b border-atlas-border bg-atlas-paper px-4 py-2 flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => setTool("home")}
          className="inline-flex items-center gap-1 text-xs text-atlas-muted hover:text-atlas-ink"
        >
          <ArrowLeft className="h-3 w-3" />
          Atlas Editor
        </button>
        <span className="text-sm font-semibold inline-flex items-center gap-1.5">
          <MapIcon className="h-4 w-4" />
          {t("mapedit.title")}
        </span>
        <button
          type="button"
          onClick={() => void openMap()}
          className="rounded px-2.5 py-1 text-xs font-semibold bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft"
        >
          {t("mapedit.openMap")}
        </button>
        {info && (
          <span className="text-[11px] text-atlas-muted truncate">
            {basename(info.path)} · {info.width}×{info.height} ·{" "}
            {info.tileCount.toLocaleString()} {t("mapedit.tiles")} · {floors.length}{" "}
            {t("mapedit.floors")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <LanguageSwitcher />
        </div>
      </header>

      {!info ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
          <MapIcon className="h-10 w-10 text-atlas-muted" />
          <p className="text-sm text-atlas-muted max-w-md">{t("mapedit.subtitle")}</p>
          <button
            type="button"
            onClick={() => void openMap()}
            className="rounded px-4 py-2 text-sm font-semibold bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft"
          >
            {t("mapedit.openMap")}
          </button>
          {error && (
            <div className="flex items-start gap-2 rounded border border-rose-600/50 bg-rose-600/5 p-3 text-xs max-w-md">
              <AlertTriangle className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
              <span className="text-atlas-ink-soft break-all">{error}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Map viewport */}
          <div
            ref={viewportRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="relative flex-1 min-w-0 overflow-hidden bg-atlas-ink/90 cursor-grab active:cursor-grabbing touch-none"
          >
            {imgUrl && (
              <img
                src={imgUrl}
                alt="map"
                draggable={false}
                style={{
                  position: "absolute",
                  left: imgLeft,
                  top: imgTop,
                  width: regionRef.current.w * TILE * zoom,
                  height: regionRef.current.h * TILE * zoom,
                  imageRendering: "pixelated",
                }}
              />
            )}

            {/* Selection highlight */}
            {selected && (
              <div
                className="absolute border-2 border-amber-400 pointer-events-none"
                style={{
                  left: (selected.x - cam.x) * TILE * zoom + pan.x,
                  top: (selected.y - cam.y) * TILE * zoom + pan.y,
                  width: TILE * zoom,
                  height: TILE * zoom,
                }}
              />
            )}

            {/* Floating controls */}
            <div className="absolute top-2 left-2 flex flex-col gap-1.5">
              <div className="flex items-center gap-1 rounded bg-atlas-paper/90 border border-atlas-border px-1 py-0.5 shadow">
                <button
                  type="button"
                  title={t("mapedit.floorUp")}
                  onClick={() => floorIdx > 0 && setFloor(floors[floorIdx - 1])}
                  disabled={floorIdx <= 0}
                  className="p-1 rounded text-atlas-muted hover:text-atlas-ink disabled:opacity-30"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <span className="text-xs font-mono tabular-nums w-14 text-center">
                  {t("mapedit.floor")} {floor}
                </span>
                <button
                  type="button"
                  title={t("mapedit.floorDown")}
                  onClick={() => floorIdx < floors.length - 1 && setFloor(floors[floorIdx + 1])}
                  disabled={floorIdx >= floors.length - 1}
                  className="p-1 rounded text-atlas-muted hover:text-atlas-ink disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-1 rounded bg-atlas-paper/90 border border-atlas-border px-1 py-0.5 shadow">
                <button
                  type="button"
                  title={t("mapedit.zoomOut")}
                  onClick={() => setZoom((z) => Math.max(1, z - 1))}
                  disabled={zoom <= 1}
                  className="p-1 rounded text-atlas-muted hover:text-atlas-ink disabled:opacity-30"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-xs font-mono tabular-nums w-8 text-center">{zoom}×</span>
                <button
                  type="button"
                  title={t("mapedit.zoomIn")}
                  onClick={() => setZoom((z) => Math.min(4, z + 1))}
                  disabled={zoom >= 4}
                  className="p-1 rounded text-atlas-muted hover:text-atlas-ink disabled:opacity-30"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>
            </div>

            {error && (
              <div className="absolute bottom-2 left-2 right-2 flex items-start gap-2 rounded border border-rose-600/60 bg-atlas-paper/95 p-2 text-[11px]">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-700 shrink-0 mt-0.5" />
                <span className="text-atlas-ink-soft break-all">
                  {error.includes("appearances") || error.includes("atlas")
                    ? t("mapedit.needAssets")
                    : `${t("mapedit.error")}: ${error}`}
                </span>
              </div>
            )}
          </div>

          {/* Inspector */}
          <aside className="w-56 shrink-0 border-l border-atlas-border bg-atlas-paper p-3 overflow-y-auto">
            <h3 className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold mb-2">
              {t("mapedit.tileItems")}
            </h3>
            {selected ? (
              <>
                <div className="text-xs font-mono text-atlas-muted mb-2">
                  {t("mapedit.position")}: {selected.x}, {selected.y}, {floor}
                </div>
                {tileItems.length === 0 ? (
                  <p className="text-xs text-atlas-muted">{t("mapedit.emptyTile")}</p>
                ) : (
                  <ul className="space-y-1">
                    {tileItems.map((id, i) => (
                      <li
                        key={`${id}-${i}`}
                        className="text-xs font-mono flex items-center justify-between rounded bg-atlas-cream px-2 py-1"
                      >
                        <span className="text-atlas-ink">#{id}</span>
                        {i === 0 && <span className="text-[10px] text-atlas-muted">ground</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-xs text-atlas-muted">{t("mapedit.noTile")}</p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
