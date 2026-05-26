import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, FileDown, Home, MoreHorizontal, Redo2, Save, Search, Undo2, X } from "lucide-react";

import logoUrl from "../../shared/logo.png";
import { useWorkspace } from "./store";
import { cn } from "../../shared/utils";
import { DuplicateDialog } from "./DuplicateDialog";
import { ExportQueueButton } from "./ExportQueueButton";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { SearchDialog } from "./SearchDialog";
import { ImportDialog } from "./ImportDialog";
import { UnmappedDialog } from "./UnmappedDialog";
import { useT } from "../../i18n";

function basename(path: string | null): string | null {
  if (!path) return null;
  const cleaned = path.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

/// Last-resort knobs that don't deserve real estate on the toolbar.
/// Today this is just the pixel-format cycler (the BMP-wrap auto-detect
/// handles every known client format, but a future Cipsoft refresh
/// could break that and we'd want a quick override).
function OverflowMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showUnmapped, setShowUnmapped] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const assetsDir = useWorkspace((s) => s.assetsDir);
  const summary = useWorkspace((s) => s.summary);
  const pixelFormat = useWorkspace((s) => s.pixelFormat);
  const cyclePixelFormat = useWorkspace((s) => s.cyclePixelFormat);

  const hasOtb = summary.otbPath != null;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!assetsDir) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="More"
        className="rounded p-1.5 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 z-10 rounded border border-atlas-border bg-atlas-paper shadow-lg p-2 text-sm">
          {summary.appearancesPath && (
            <>
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
                {t("tools.title")}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setShowDuplicates(true);
                }}
                className="w-full flex items-center gap-2 rounded px-2 py-1.5 hover:bg-atlas-sand"
              >
                <Copy className="h-3.5 w-3.5 text-atlas-muted" />
                <span className="text-atlas-ink-soft">{t("duplicates.title")}</span>
              </button>
              {hasOtb && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setShowUnmapped(true);
                  }}
                  className="w-full flex items-center gap-2 rounded px-2 py-1.5 hover:bg-atlas-sand"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-atlas-muted" />
                  <span className="text-atlas-ink-soft">{t("unmapped.title")}</span>
                </button>
              )}
              <div className="my-1 border-t border-atlas-border" />
            </>
          )}
          <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
            Debug
          </div>
          <button
            type="button"
            onClick={() => void cyclePixelFormat()}
            title="Cycle on-disk pixel format (only needed if sprites render with wrong colors)"
            className="w-full flex items-center justify-between rounded px-2 py-1.5 hover:bg-atlas-sand"
          >
            <span className="text-atlas-ink-soft">Sprite pixel format</span>
            <span className="font-mono text-xs uppercase tracking-wider tabular-nums text-atlas-muted">
              {pixelFormat}
            </span>
          </button>
        </div>
      )}
      {showDuplicates && <DuplicateDialog onClose={() => setShowDuplicates(false)} />}
      {showUnmapped && <UnmappedDialog onClose={() => setShowUnmapped(false)} />}
    </div>
  );
}

export function FileBar() {
  const summary = useWorkspace((s) => s.summary);
  const versionHint = useWorkspace((s) => s.versionHint);
  const status = useWorkspace((s) => s.status);
  const error = useWorkspace((s) => s.error);
  const closeWorkspace = useWorkspace((s) => s.closeWorkspace);
  const undo = useWorkspace((s) => s.undo);
  const redo = useWorkspace((s) => s.redo);
  const saveAppearances = useWorkspace((s) => s.saveAppearances);
  const goToLauncher = useWorkspace((s) => s.goToLauncher);
  const t = useT();
  const [showSearch, setShowSearch] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const hasAnything = summary.appearancesPath != null;

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo,
  // Ctrl+S save, Ctrl+F open search.
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
      } else if (key === "f" && summary.appearancesPath) {
        e.preventDefault();
        setShowSearch(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, saveAppearances, summary.appearancesPath]);

  return (
    <header className="border-b border-atlas-border bg-atlas-paper px-4 py-2 flex items-center gap-3">
      <button
        type="button"
        onClick={() => void goToLauncher()}
        title="Back to launcher"
        className="inline-flex items-center gap-2 rounded p-1 pr-2 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
      >
        <img
          src={logoUrl}
          alt="Atlas"
          className="h-6 w-6 object-contain select-none"
          draggable={false}
        />
        <Home className="h-3.5 w-3.5" />
      </button>

      <div className="flex-1 min-w-0 text-xs text-atlas-muted truncate">
        {summary.appearancesPath && (
          <span className="text-atlas-ink" title={summary.appearancesPath}>
            {versionHint ? `Tibia ${versionHint}` : basename(summary.appearancesPath)}
          </span>
        )}
        {status === "loading" && <span className="text-amber-700 ml-2">loading…</span>}
        {error && <span className="text-rose-700 ml-2">{error}</span>}
      </div>

      <div className="flex items-center gap-1">
        <ProfileSwitcher />
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
            onClick={() => setShowSearch(true)}
            title={`${t("search.title")} (Ctrl+F)`}
            className="rounded p-1.5 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
          >
            <Search className="h-4 w-4" />
          </button>
        )}

        {summary.appearancesPath && (
          <button
            type="button"
            onClick={() => setShowImport(true)}
            title={t("import.title")}
            className="rounded p-1.5 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
          >
            <FileDown className="h-4 w-4" />
          </button>
        )}

        <ExportQueueButton />

        {summary.appearancesPath && (
          <button
            type="button"
            onClick={() => void saveAppearances()}
            title="Save appearances.dat (Ctrl+S)"
            className={cn(
              "ml-1 inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
              summary.dirty
                ? "bg-amber-600 text-atlas-cream hover:bg-amber-700"
                : "border border-atlas-border text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand",
            )}
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
        )}

        <OverflowMenu />

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
      {showSearch && <SearchDialog onClose={() => setShowSearch(false)} />}
      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
    </header>
  );
}
