import { useEffect, useState } from "react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Download, FolderOpen, X } from "lucide-react";

import { cn } from "../../shared/utils";
import { useT } from "../../i18n";
import {
  EXPORT_FORMATS,
  defaultExportFormat,
  readAssetId,
  type AppearanceInfoDto,
  type ExportFormat,
  type ExportReport,
} from "./types";

interface Props {
  appearance: AppearanceInfoDto;
  category: "object" | "outfit" | "effect" | "missile";
  onClose: () => void;
}

/// Modal that drives the appearance export pipeline. Picks the format
/// sensible for the category, lets the user override, fires up a Tauri
/// save/open dialog for the destination, then calls `export_appearance`.
export function ExportDialog({ appearance, category, onClose }: Props) {
  const t = useT();
  const [format, setFormat] = useState<ExportFormat>(() => defaultExportFormat(category));
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  // OutfitPngs writes many files into a directory; the others produce
  // a single .gif. Pick the right Tauri dialog accordingly.
  async function pickDestination(): Promise<string | null> {
    if (format === "outfitpngs") {
      const sel = await openDialog({
        title: t("export.pickFolder"),
        directory: true,
        multiple: false,
      });
      if (!sel) return null;
      return Array.isArray(sel) ? sel[0] : sel;
    }
    const id = readAssetId(appearance.id);
    const sel = await saveDialog({
      title: t("export.pickFile"),
      defaultPath: `${category}-${id}.gif`,
      filters: [{ name: "GIF", extensions: ["gif"] }],
    });
    return sel ?? null;
  }

  async function run() {
    setError(null);
    setReport(null);
    const dest = await pickDestination();
    if (!dest) return;
    setRunning(true);
    try {
      const id = readAssetId(appearance.id);
      const r = await invoke<ExportReport>("export_appearance", {
        scope: category,
        id,
        format,
        outputPath: dest,
      });
      setReport(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-atlas-ink/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-atlas-border bg-atlas-paper shadow-xl">
        <div className="flex items-center justify-between p-3 border-b border-atlas-border">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-atlas-muted">
            {t("export.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="text-atlas-muted hover:text-atlas-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="text-sm text-atlas-ink-soft">
            <span className="font-semibold">{category}</span>
            {" · "}id {readAssetId(appearance.id)}
            {appearance.name && (
              <>
                {" · "}
                <span className="italic">{appearance.name}</span>
              </>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
              {t("export.format")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {EXPORT_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  aria-pressed={format === f}
                  className={cn(
                    "rounded border px-2 py-1.5 text-sm text-left transition-colors",
                    format === f
                      ? "border-atlas-ink bg-atlas-ink text-atlas-cream"
                      : "border-atlas-border bg-atlas-cream text-atlas-ink hover:border-atlas-ink",
                  )}
                >
                  {t(`export.format.${f}` as const)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-atlas-muted leading-snug">
              {t(`export.hint.${format}` as const)}
            </p>
          </div>

          {error && (
            <div className="px-2 py-1.5 rounded bg-rose-100 border border-rose-300 text-xs text-rose-900">
              {error}
            </div>
          )}
          {report && (
            <div className="px-2 py-1.5 rounded bg-emerald-700/10 border border-emerald-700/40 text-xs text-emerald-900">
              {t("export.wrote", { count: report.files.length })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t border-atlas-border bg-atlas-cream/50 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="px-3 py-1.5 rounded text-sm text-atlas-ink hover:bg-atlas-sand disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {format === "outfitpngs" ? (
              <FolderOpen className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {running ? t("common.loading") : t("export.run")}
          </button>
        </div>
      </div>
    </div>
  );
}
