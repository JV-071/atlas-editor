import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileDown, FolderOpen, Loader2, X } from "lucide-react";

import { useWorkspace } from "./store";
import type { AppearanceCategory } from "./types";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";

interface ObdFrameGroupPreview {
  fixedFrameGroup: string | null;
  patternWidth: number;
  patternHeight: number;
  patternDepth: number;
  layers: number;
  frames: number;
  tileW: number;
  tileH: number;
  sprites: string[]; // data URLs
}

interface ObdPreview {
  category: AppearanceCategory;
  frameGroups: ObdFrameGroupPreview[];
}

interface Props {
  onClose: () => void;
}

/// Wizard for importing a legacy `.obd` (Object Builder Data) file:
/// pick the file → preview the embedded sprites & structure → commit
/// (allocates a sheet, writes the sprites, appends the appearance and
/// saves appearances.dat).
export function ImportDialog({ onClose }: Props) {
  const t = useT();
  const setCategory = useWorkspace((s) => s.setCategory);
  const setSelected = useWorkspace((s) => s.setSelected);
  const refreshRows = useWorkspace((s) => s.refreshRows);

  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ObdPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFile() {
    const sel = await openDialog({
      title: t("import.pick"),
      multiple: false,
      directory: false,
      filters: [{ name: "OBD", extensions: ["obd"] }],
    });
    if (!sel) return;
    const p = Array.isArray(sel) ? sel[0] : sel;
    setPath(p);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      const pv = await invoke<ObdPreview>("preview_obd", { path: p });
      setPreview(pv);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!path || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const newId = await invoke<number>("import_obd", { path });
      await refreshRows();
      setCategory(preview.category);
      await setSelected(newId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const totalSprites =
    preview?.frameGroups.reduce((n, g) => n + g.sprites.length, 0) ?? 0;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-atlas-ink/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-lg border border-atlas-border bg-atlas-paper shadow-xl">
        <header className="flex items-center justify-between p-3 border-b border-atlas-border">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-atlas-muted">
            {t("import.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-atlas-muted hover:text-atlas-ink disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void pickFile()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded border border-atlas-border bg-atlas-paper px-3 py-1.5 text-sm text-atlas-ink hover:border-atlas-ink hover:bg-atlas-sand disabled:opacity-40"
            >
              <FolderOpen className="h-4 w-4" />
              {t("import.pick")}
            </button>
            {path && (
              <span
                className="text-xs font-mono text-atlas-muted truncate"
                title={path}
              >
                {path}
              </span>
            )}
          </div>

          {busy && !preview && (
            <div className="flex items-center gap-2 text-sm text-atlas-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded bg-rose-100 border border-rose-300 text-sm text-rose-900">
              {error}
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="text-sm text-atlas-ink-soft">
                <span className="font-semibold">{preview.category}</span>
                {" · "}
                {t("import.summary", {
                  groups: preview.frameGroups.length,
                  sprites: totalSprites,
                })}
              </div>
              {preview.frameGroups.map((g, i) => (
                <div
                  key={i}
                  className="rounded border border-atlas-border bg-atlas-cream/40 p-2 space-y-2"
                >
                  <div className="text-xs text-atlas-muted font-mono tabular-nums">
                    {g.fixedFrameGroup ?? `group ${i}`}
                    {" · "}
                    {g.tileW}×{g.tileH} tiles · pat {g.patternWidth}×
                    {g.patternHeight}×{g.patternDepth} · {g.layers} layer(s) ·{" "}
                    {g.frames} frame(s)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.sprites.slice(0, 64).map((src, si) => (
                      <img
                        key={si}
                        src={src}
                        alt={`sprite ${si}`}
                        className="border border-atlas-border bg-atlas-paper"
                        style={{
                          width: 32,
                          height: 32,
                          imageRendering: "pixelated",
                        }}
                        draggable={false}
                      />
                    ))}
                    {g.sprites.length > 64 && (
                      <span className="self-center text-[11px] text-atlas-muted">
                        +{g.sprites.length - 64}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 p-3 border-t border-atlas-border bg-atlas-cream/40">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm text-atlas-ink hover:bg-atlas-sand disabled:opacity-40"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void commit()}
            disabled={busy || !preview}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold",
              "bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {busy && preview ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5" />
            )}
            {t("import.commit")}
          </button>
        </footer>
      </div>
    </div>
  );
}
