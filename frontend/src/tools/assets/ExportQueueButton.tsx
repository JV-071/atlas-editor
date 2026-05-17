import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Download,
  Layers,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";

import { cn } from "../../shared/utils";
import { useT } from "../../i18n";
import { queueKey, useWorkspace, type ExportQueueEntry } from "./store";
import type { AppearanceCategory, AppearanceRow, ExportFormat } from "./types";

const EMPTY_ROWS: AppearanceRow[] = [];

/// Button in the global toolbar that surfaces the batch-export queue.
/// Stays hidden when the queue is empty so it doesn't clutter the
/// toolbar; once the user marks at least one row it appears with a
/// live count badge. The popover lists every queued item, lets the
/// user remove individual entries or clear everything, and fires up
/// the actual export pipeline through a folder picker.
export function ExportQueueButton() {
  const queue = useWorkspace((s) => s.exportQueue);
  const rawCategory = useWorkspace((s) => s.category);
  const isAppearanceCategory = rawCategory === "object" || rawCategory === "outfit" || rawCategory === "effect" || rawCategory === "missile";
  const category = rawCategory as AppearanceCategory;
  const rows = useWorkspace((s) => {
    const c = s.category;
    if (c === "object" || c === "outfit" || c === "effect" || c === "missile") {
      return s.rowsByCategory[c];
    }
    return EMPTY_ROWS;
  });
  const toggleExportQueueEntry = useWorkspace((s) => s.toggleExportQueueEntry);
  const enqueueAllCategory = useWorkspace((s) => s.enqueueAllCategory);
  const clearExportQueue = useWorkspace((s) => s.clearExportQueue);
  const runExportQueue = useWorkspace((s) => s.runExportQueue);
  const progress = useWorkspace((s) => s.exportProgress);
  const t = useT();

  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [queueFormat, setQueueFormat] = useState<"png" | "gif">("png");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const entries = useMemo(() => Array.from(queue.values()), [queue]);
  if (entries.length === 0 && !progress && !isAppearanceCategory) return null;

  const doneCount =
    progress?.filter((p) => p.status === "done").length ?? 0;
  const errorCount =
    progress?.filter((p) => p.status === "error").length ?? 0;
  const total = progress?.length ?? entries.length;

  async function run() {
    const sel = await openDialog({
      title: t("queue.pickFolder"),
      directory: true,
      multiple: false,
    });
    if (!sel) return;
    const outputDir = Array.isArray(sel) ? sel[0] : sel;
    const formatMap: Record<string, ExportFormat> = {
      "object:png": "outfitpngs",
      "object:gif": "itemgif",
      "outfit:png": "outfitpngs",
      "outfit:gif": "itemgif",
      "effect:png": "outfitpngs",
      "effect:gif": "effectgif",
      "missile:png": "outfitpngs",
      "missile:gif": "missilegif",
    };
    const formatOverride = formatMap[`${category}:${queueFormat}`] ?? "outfitpngs";
    setRunning(true);
    try {
      await runExportQueue(outputDir, formatOverride);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("queue.title")}
        className={cn(
          "ml-1 inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors",
          running
            ? "bg-amber-500 text-atlas-cream"
            : entries.length > 0
              ? "bg-atlas-sand text-atlas-ink hover:bg-atlas-sand/80"
              : "text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand",
        )}
      >
        <Layers className="h-3.5 w-3.5" />
        <span className="tabular-nums">
          {running && progress
            ? `${doneCount}/${total}`
            : entries.length.toLocaleString()}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 z-20 rounded border border-atlas-border bg-atlas-paper shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-atlas-border">
            <span className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
              {t("queue.title")}
            </span>
            <span className="text-[11px] text-atlas-muted tabular-nums">
              {t("queue.count", { count: entries.length })}
            </span>
          </div>
          {entries.length === 0 ? (
            <div className="p-4 text-xs text-atlas-muted italic">
              {t("queue.empty")}
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {entries.map((entry) => {
                const prog = progress?.find(
                  (p) =>
                    p.entry.category === entry.category &&
                    p.entry.id === entry.id,
                );
                return (
                  <li
                    key={queueKey(entry.category, entry.id)}
                    className="flex items-center gap-2 px-3 py-1 text-sm hover:bg-atlas-sand/60"
                  >
                    <QueueStatusIcon status={prog?.status ?? "idle"} />
                    <EntryLabel entry={entry} />
                    <span className="text-[10px] text-atlas-muted tabular-nums shrink-0">
                      {prog?.status === "done" && prog.files != null
                        ? prog.files
                        : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        toggleExportQueueEntry(entry.category, entry.id)
                      }
                      disabled={running}
                      title={t("queue.removeFromQueue")}
                      className="shrink-0 text-atlas-muted hover:text-rose-700 disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {progress && (
            <div className="px-3 py-2 border-t border-atlas-border text-[11px] text-atlas-muted tabular-nums">
              {t("queue.summary", {
                done: doneCount,
                total,
                errors: errorCount,
              })}
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-atlas-border">
            <span className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">Format</span>
            <div className="flex rounded border border-atlas-border overflow-hidden">
              <button
                type="button"
                onClick={() => setQueueFormat("png")}
                className={cn(
                  "px-2 py-0.5 text-[11px] font-medium transition-colors",
                  queueFormat === "png"
                    ? "bg-atlas-ink text-atlas-cream"
                    : "bg-atlas-cream text-atlas-muted hover:text-atlas-ink",
                )}
              >
                PNG
              </button>
              <button
                type="button"
                onClick={() => setQueueFormat("gif")}
                className={cn(
                  "px-2 py-0.5 text-[11px] font-medium transition-colors",
                  queueFormat === "gif"
                    ? "bg-atlas-ink text-atlas-cream"
                    : "bg-atlas-cream text-atlas-muted hover:text-atlas-ink",
                )}
              >
                GIF
              </button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1 p-2 border-t border-atlas-border bg-atlas-cream/50 rounded-b">
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => enqueueAllCategory(category)}
                disabled={running}
                className="rounded px-2 py-1 text-xs text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand disabled:opacity-40 disabled:cursor-not-allowed mr-auto"
              >
                + All {category}s ({rows.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                clearExportQueue();
                setOpen(false);
              }}
              disabled={running || entries.length === 0}
              className="rounded px-2 py-1 text-xs text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("queue.clear")}
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || entries.length === 0}
              className="inline-flex items-center gap-1 rounded bg-atlas-ink px-2.5 py-1 text-xs font-semibold text-atlas-cream hover:bg-atlas-ink-soft disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {t("queue.runAll")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EntryLabel({ entry }: { entry: ExportQueueEntry }) {
  return (
    <span className="flex-1 min-w-0 flex items-baseline gap-1.5 text-atlas-ink-soft">
      <span className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold shrink-0">
        {entry.category}
      </span>
      <span className="font-mono text-xs tabular-nums truncate">
        #{entry.id}
      </span>
    </span>
  );
}

function QueueStatusIcon({
  status,
}: {
  status: "idle" | "running" | "done" | "error";
}) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 text-amber-600 animate-spin shrink-0" />;
  }
  if (status === "done") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />;
  }
  if (status === "error") {
    return <XCircle className="h-3.5 w-3.5 text-rose-700 shrink-0" />;
  }
  return <Layers className="h-3.5 w-3.5 text-atlas-muted shrink-0" />;
}
