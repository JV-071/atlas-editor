import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, FolderOpen, X } from "lucide-react";

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

  const hasAnything = summary.appearancesPath || summary.otbPath;

  return (
    <header className="border-b border-atlas-border bg-atlas-paper px-4 py-3 flex items-center gap-3">
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

      {hasAnything && (
        <button
          type="button"
          onClick={closeWorkspace}
          title="Close workspace"
          className="rounded p-1.5 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </header>
  );
}
