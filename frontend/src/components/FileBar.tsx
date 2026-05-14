import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  FileText,
  FolderOpen,
  Home,
  Image as ImageIcon,
  Redo2,
  Save,
  Undo2,
  X,
} from "lucide-react";

import { useWorkspace } from "../stores/workspace";
import { cn } from "../lib/utils";

function basename(path: string | null): string | null {
  if (!path) return null;
  const cleaned = path.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

interface RecentMenuProps {
  paths: string[];
  onPick: (path: string) => void;
}

function RecentMenu({ paths, onPick }: RecentMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (paths.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Recent files"
        className={cn(
          "h-full inline-flex items-center px-1.5 transition-colors",
          "text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand",
        )}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-[420px] max-w-[80vw] z-10 rounded border border-atlas-border bg-atlas-paper shadow-lg">
          <ul className="py-1 max-h-72 overflow-auto">
            {paths.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPick(p);
                  }}
                  title={p}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-atlas-sand truncate flex items-baseline gap-2"
                >
                  <span className="text-atlas-ink shrink-0">{basename(p)}</span>
                  <span className="text-xs text-atlas-muted truncate">{p}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function FileBar() {
  const summary = useWorkspace((s) => s.summary);
  const status = useWorkspace((s) => s.status);
  const error = useWorkspace((s) => s.error);
  const recent = useWorkspace((s) => s.recent);
  const openAppearancesPicker = useWorkspace((s) => s.openAppearancesPicker);
  const openOtbPicker = useWorkspace((s) => s.openOtbPicker);
  const openAppearancesPath = useWorkspace((s) => s.openAppearancesPath);
  const openOtbPath = useWorkspace((s) => s.openOtbPath);
  const closeWorkspace = useWorkspace((s) => s.closeWorkspace);
  const undo = useWorkspace((s) => s.undo);
  const redo = useWorkspace((s) => s.redo);
  const saveAppearances = useWorkspace((s) => s.saveAppearances);
  const saveOtb = useWorkspace((s) => s.saveOtb);
  const pickAssetsDir = useWorkspace((s) => s.pickAssetsDir);
  const assetsDir = useWorkspace((s) => s.assetsDir);
  const pixelFormat = useWorkspace((s) => s.pixelFormat);
  const cyclePixelFormat = useWorkspace((s) => s.cyclePixelFormat);
  const goToLauncher = useWorkspace((s) => s.goToLauncher);

  const hasAnything = summary.appearancesPath || summary.otbPath;

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo, Ctrl+S save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        void undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        void redo();
      } else if (key === "s") {
        e.preventDefault();
        if (summary.appearancesPath) void saveAppearances();
        if (summary.otbPath) void saveOtb();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, saveAppearances, saveOtb, summary.appearancesPath, summary.otbPath]);

  return (
    <header className="border-b border-atlas-border bg-atlas-paper px-4 py-3 flex items-center gap-3">
      <button
        type="button"
        onClick={() => void goToLauncher()}
        title="Back to launcher"
        className="rounded p-1.5 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
      >
        <Home className="h-4 w-4" />
      </button>

      <div className="inline-flex rounded overflow-hidden">
        <button
          type="button"
          onClick={openAppearancesPicker}
          disabled={status === "loading"}
          className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors",
            "bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft",
            "disabled:bg-atlas-sand disabled:text-atlas-muted disabled:cursor-not-allowed",
          )}
        >
          <FolderOpen className="h-4 w-4" />
          Open appearances.dat
        </button>
        <div className="bg-atlas-ink hover:bg-atlas-ink-soft text-atlas-cream border-l border-atlas-cream/20">
          <RecentMenu paths={recent.appearances} onPick={openAppearancesPath} />
        </div>
      </div>

      <div className="inline-flex rounded overflow-hidden border border-atlas-border">
        <button
          type="button"
          onClick={openOtbPicker}
          disabled={status === "loading"}
          className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors",
            "bg-atlas-cream text-atlas-ink hover:bg-atlas-sand",
            "disabled:bg-atlas-sand disabled:text-atlas-muted disabled:cursor-not-allowed",
          )}
        >
          <FileText className="h-4 w-4" />
          Open items.otb
        </button>
        <div className="border-l border-atlas-border bg-atlas-cream">
          <RecentMenu paths={recent.otb} onPick={openOtbPath} />
        </div>
      </div>

      <button
        type="button"
        onClick={() => void pickAssetsDir()}
        title={
          assetsDir
            ? `Sprite atlas: ${assetsDir.sheetCount} sheets`
            : "Pick the Tibia client's assets/ directory"
        }
        className={cn(
          "inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors border",
          assetsDir
            ? "border-emerald-700 bg-emerald-700/10 text-emerald-900 hover:bg-emerald-700/20"
            : "border-atlas-border bg-atlas-cream text-atlas-ink hover:bg-atlas-sand",
        )}
      >
        <ImageIcon className="h-4 w-4" />
        {assetsDir ? "Assets ✓" : "Open assets"}
      </button>

      {assetsDir && (
        <button
          type="button"
          onClick={() => void cyclePixelFormat()}
          title="Cycle on-disk pixel format (click until colors look right)"
          className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium border border-atlas-border bg-atlas-cream text-atlas-ink-soft hover:bg-atlas-sand uppercase tracking-wider tabular-nums"
        >
          {pixelFormat}
        </button>
      )}

      <div className="ml-3 flex-1 min-w-0 text-xs text-atlas-muted truncate">
        {summary.appearancesPath && (
          <span title={summary.appearancesPath}>
            <span className="text-atlas-muted">appearances:</span>{" "}
            <span className="text-atlas-ink">{basename(summary.appearancesPath)}</span>{" "}
            <span className="text-atlas-muted">({summary.objectCount} objects)</span>
          </span>
        )}
        {summary.appearancesPath && summary.otbPath && <span className="mx-2">·</span>}
        {summary.otbPath && (
          <span title={summary.otbPath}>
            <span className="text-atlas-muted">otb:</span>{" "}
            <span className="text-atlas-ink">{basename(summary.otbPath)}</span>{" "}
            <span className="text-atlas-muted">({summary.otbItemCount} items)</span>
          </span>
        )}
        {status === "loading" && <span className="text-amber-700">loading…</span>}
        {error && <span className="text-rose-700">{error}</span>}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void undo()}
          disabled={!summary.canUndo}
          title="Undo (Ctrl+Z)"
          className="rounded p-1.5 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void redo()}
          disabled={!summary.canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="rounded p-1.5 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        {summary.appearancesPath && (
          <button
            type="button"
            onClick={() => void saveAppearances()}
            title="Save appearances.dat (Ctrl+S also saves both)"
            className={cn(
              "ml-1 inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
              summary.dirty
                ? "bg-amber-600 text-atlas-cream hover:bg-amber-700"
                : "border border-atlas-border text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand",
            )}
          >
            <Save className="h-3.5 w-3.5" />
            .dat
          </button>
        )}
        {summary.otbPath && (
          <button
            type="button"
            onClick={() => void saveOtb()}
            title="Save items.otb"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
              summary.dirty
                ? "bg-amber-600 text-atlas-cream hover:bg-amber-700"
                : "border border-atlas-border text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand",
            )}
          >
            <Save className="h-3.5 w-3.5" />
            .otb
          </button>
        )}

        {hasAnything && (
          <button
            type="button"
            onClick={closeWorkspace}
            title="Close workspace"
            className="ml-1 rounded p-1.5 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
