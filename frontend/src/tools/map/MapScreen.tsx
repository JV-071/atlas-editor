import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  ImagePlus,
  Map as MapIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { useApp } from "../../appStore";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";

const TILE = 32;
/// Must match CHUNK_TILES on the Rust side.
const CHUNK = 16;
const CHUNK_PX = CHUNK * TILE;
/// Cap the live chunk cache; far chunks are evicted to bound memory.
const MAX_CHUNKS = 200;

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

interface AssetsDirInfo {
  path: string;
  sheetCount: number;
  spriteIdRange: [number, number] | null;
}

function basename(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const i = cleaned.lastIndexOf("/");
  return i === -1 ? cleaned : cleaned.slice(i + 1);
}

export function MapScreen() {
  const setTool = useApp((s) => s.setTool);
  const t = useT();

  const [assets, setAssets] = useState<AssetsDirInfo | null>(null);
  const [info, setInfo] = useState<MapInfo | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [floor, setFloor] = useState(7);
  const [zoom, setZoom] = useState(1);
  // Camera = the map tile shown at the viewport's top-left.
  const [cam, setCam] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [tileItems, setTileItems] = useState<number[]>([]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  // Chunk image cache: key `z:cx:cy` → object URL. Refs (not state) so
  // fetches don't churn renders; a `tick` bump triggers a repaint when a
  // chunk lands.
  const chunkCache = useRef<Map<string, string>>(new Map());
  const inflight = useRef<Set<string>>(new Set());
  const [, setTick] = useState(0);
  const repaint = () => setTick((n) => n + 1);

  // Live drag offset (px), applied as a transform without re-rendering.
  const drag = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  function clearChunks() {
    for (const url of chunkCache.current.values()) URL.revokeObjectURL(url);
    chunkCache.current.clear();
    inflight.current.clear();
    repaint();
  }

  // Measure the viewport.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [info]);

  // Reflect any already-loaded assets bundle on mount.
  useEffect(() => {
    void invoke<AssetsDirInfo | null>("get_assets_dir_info")
      .then(setAssets)
      .catch(() => {});
  }, []);

  // Revoke all cached URLs on unmount.
  useEffect(() => {
    return () => {
      for (const url of chunkCache.current.values()) URL.revokeObjectURL(url);
    };
  }, []);

  async function openAssets() {
    const sel = await openDialog({
      title: t("mapedit.openAssets"),
      multiple: false,
      directory: true,
    });
    const path = Array.isArray(sel) ? sel[0] : sel;
    if (!path) return;
    setError(null);
    try {
      const result = await invoke<{ assets: AssetsDirInfo }>("open_assets_bundle", { path });
      setAssets(result.assets);
      // New bundle → cached chunks were drawn with the old sprites.
      await invoke("map_invalidate_sprites").catch(() => {});
      clearChunks();
    } catch (e) {
      setError(String(e));
    }
  }

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
    setLoading(0);
    const unlisten = await listen<{ phase: string; percent: number }>(
      "mapOpenProgress",
      (e) => setLoading(e.payload.percent),
    );
    try {
      const mi = await invoke<MapInfo>("map_open", { path });
      clearChunks();
      setInfo(mi);
      setFloor(mi.floors.includes(7) ? 7 : (mi.floors[0] ?? 7));
      setCam({
        x: Math.max(0, Math.floor((mi.minX + mi.maxX) / 2) - 8),
        y: Math.max(0, Math.floor((mi.minY + mi.maxY) / 2) - 6),
      });
      setSelected(null);
      setTileItems([]);
    } catch (e) {
      setError(String(e));
      setInfo(null);
    } finally {
      unlisten();
      setLoading(null);
    }
  }

  // Visible chunk range for the current camera + viewport + zoom.
  function visibleChunkRange() {
    const viewTilesW = Math.ceil(viewport.w / (TILE * zoom));
    const viewTilesH = Math.ceil(viewport.h / (TILE * zoom));
    const cx0 = Math.max(0, Math.floor(cam.x / CHUNK) - 1);
    const cy0 = Math.max(0, Math.floor(cam.y / CHUNK) - 1);
    const cx1 = Math.floor((cam.x + viewTilesW) / CHUNK) + 1;
    const cy1 = Math.floor((cam.y + viewTilesH) / CHUNK) + 1;
    return { cx0, cy0, cx1, cy1 };
  }

  // Fetch any visible chunks we don't have yet; evict far ones.
  useEffect(() => {
    if (!info || viewport.w === 0) return;
    const { cx0, cy0, cx1, cy1 } = visibleChunkRange();

    const wanted = new Set<string>();
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) wanted.add(`${floor}:${cx}:${cy}`);
    }

    for (const key of wanted) {
      if (chunkCache.current.has(key) || inflight.current.has(key)) continue;
      inflight.current.add(key);
      const [, cxs, cys] = key.split(":");
      void invoke<ArrayBuffer>("map_render_chunk", {
        z: floor,
        cx: Number(cxs),
        cy: Number(cys),
      })
        .then((buf) => {
          const url = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
          chunkCache.current.set(key, url);
          repaint();
        })
        .catch((e) => setError(String(e)))
        .finally(() => inflight.current.delete(key));
    }

    // Evict if over budget: drop chunks outside the wanted set.
    if (chunkCache.current.size > MAX_CHUNKS) {
      for (const [key, url] of chunkCache.current) {
        if (!wanted.has(key)) {
          URL.revokeObjectURL(url);
          chunkCache.current.delete(key);
        }
        if (chunkCache.current.size <= MAX_CHUNKS) break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, floor, zoom, cam.x, cam.y, viewport.w, viewport.h]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
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
      const tilesX = Math.round(dx / (TILE * zoom));
      const tilesY = Math.round(dy / (TILE * zoom));
      setCam((c) => ({ x: Math.max(0, c.x - tilesX), y: Math.max(0, c.y - tilesY) }));
    } else {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tileX = cam.x + Math.floor((e.clientX - rect.left) / (TILE * zoom));
      const tileY = cam.y + Math.floor((e.clientY - rect.top) / (TILE * zoom));
      setSelected({ x: tileX, y: tileY });
      void invoke<number[]>("map_tile_items", { z: floor, x: tileX, y: tileY })
        .then(setTileItems)
        .catch(() => setTileItems([]));
    }
  }

  // World container translation: map tile (0,0) → screen, offset by camera
  // and the live drag pan.
  const worldX = -cam.x * TILE * zoom + pan.x;
  const worldY = -cam.y * TILE * zoom + pan.y;

  const floors = info?.floors ?? [];
  const floorIdx = floors.indexOf(floor);

  // Build the visible chunk <img>s from cache.
  const chunkImgs: React.ReactNode[] = [];
  if (info && viewport.w > 0) {
    const { cx0, cy0, cx1, cy1 } = visibleChunkRange();
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const url = chunkCache.current.get(`${floor}:${cx}:${cy}`);
        if (!url) continue;
        chunkImgs.push(
          <img
            key={`${cx}:${cy}`}
            src={url}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left: cx * CHUNK_PX * zoom,
              top: cy * CHUNK_PX * zoom,
              width: CHUNK_PX * zoom,
              height: CHUNK_PX * zoom,
              imageRendering: "pixelated",
            }}
          />,
        );
      }
    }
  }

  return (
    <main className="h-screen w-screen flex flex-col bg-atlas-cream text-atlas-ink overflow-hidden">
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
          disabled={!assets}
          className="rounded px-2.5 py-1 text-xs font-semibold bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft disabled:bg-atlas-sand disabled:text-atlas-muted disabled:cursor-not-allowed"
        >
          {t("mapedit.openMap")}
        </button>
        {info && (
          <span className="text-[11px] text-atlas-muted truncate">
            {basename(info.path)} · {info.tileCount.toLocaleString()} {t("mapedit.tiles")} ·{" "}
            {floors.length} {t("mapedit.floors")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void openAssets()}
            title={assets?.path ?? t("mapedit.openAssets")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] border",
              assets
                ? "border-emerald-700/40 text-emerald-800 hover:bg-emerald-700/10"
                : "border-amber-600/50 text-amber-700 hover:bg-amber-600/10",
            )}
          >
            <FolderOpen className="h-3 w-3" />
            {assets ? t("mapedit.changeAssets") : t("mapedit.openAssets")}
          </button>
          <LanguageSwitcher />
        </div>
      </header>

      {loading !== null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-atlas-ink/40 backdrop-blur-sm">
          <div className="w-72 rounded-lg border border-atlas-border bg-atlas-paper p-4 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-atlas-ink inline-flex items-center gap-1.5">
                <MapIcon className="h-4 w-4" />
                {t("mapedit.loading")}
              </span>
              <span className="text-sm font-mono tabular-nums text-atlas-ink">{loading}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-atlas-sand overflow-hidden">
              <div
                className="h-full bg-atlas-ink transition-[width] duration-200 ease-out"
                style={{ width: `${loading}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {!info ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
          <MapIcon className="h-10 w-10 text-atlas-muted" />
          <p className="text-sm text-atlas-muted max-w-md text-center">{t("mapedit.subtitle")}</p>

          <div className="w-full max-w-md space-y-2">
            <button
              type="button"
              onClick={() => void openAssets()}
              className={cn(
                "w-full flex items-center gap-3 rounded border p-3 text-left transition-colors",
                assets
                  ? "border-emerald-700/40 bg-emerald-700/5 hover:bg-emerald-700/10"
                  : "border-atlas-ink bg-atlas-paper hover:bg-atlas-sand",
              )}
            >
              <ImagePlus className="h-5 w-5 shrink-0 text-atlas-ink" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-atlas-ink">{t("mapedit.step1")}</div>
                <div className="text-[11px] text-atlas-muted leading-snug truncate">
                  {assets ? assets.path : t("mapedit.step1hint")}
                </div>
              </div>
              {assets && <Check className="h-4 w-4 text-emerald-700 shrink-0" />}
            </button>

            <button
              type="button"
              onClick={() => void openMap()}
              disabled={!assets}
              className={cn(
                "w-full flex items-center gap-3 rounded border p-3 text-left transition-colors",
                "border-atlas-border bg-atlas-paper hover:border-atlas-ink",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-atlas-border",
              )}
            >
              <MapIcon className="h-5 w-5 shrink-0 text-atlas-ink" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-atlas-ink">{t("mapedit.step2")}</div>
                <div className="text-[11px] text-atlas-muted leading-snug truncate">
                  {t("mapedit.step2hint")}
                </div>
              </div>
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded border border-rose-600/50 bg-rose-600/5 p-3 text-xs max-w-md">
              <AlertTriangle className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
              <span className="text-atlas-ink-soft break-all">{error}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div
            ref={viewportRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="relative flex-1 min-w-0 overflow-hidden bg-atlas-ink/90 cursor-grab active:cursor-grabbing touch-none"
          >
            {/* World layer: chunks positioned in world space, translated by
                camera + live pan. Already-loaded chunks move instantly. */}
            <div
              style={{
                position: "absolute",
                transform: `translate3d(${worldX}px, ${worldY}px, 0)`,
                willChange: "transform",
              }}
            >
              {chunkImgs}
              {selected && (
                <div
                  className="absolute border-2 border-amber-400 pointer-events-none"
                  style={{
                    left: selected.x * TILE * zoom,
                    top: selected.y * TILE * zoom,
                    width: TILE * zoom,
                    height: TILE * zoom,
                  }}
                />
              )}
            </div>

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
