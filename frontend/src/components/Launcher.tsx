import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  FileText,
  FolderOpen,
  ImagePlus,
  RotateCcw,
} from "lucide-react";

import logoUrl from "../assets/logo.png";
import { useWorkspace } from "../stores/workspace";
import { cn } from "../lib/utils";

function basename(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

function dirname(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  return idx === -1 ? cleaned : cleaned.slice(0, idx);
}

interface ChoiceProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}

function ChoiceCard({ icon, title, subtitle, onClick, disabled }: ChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border p-4 text-center transition-all",
        "border-atlas-border bg-atlas-paper hover:border-atlas-ink hover:shadow-sm",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <div className="text-atlas-ink">{icon}</div>
      <div className="text-sm font-semibold text-atlas-ink">{title}</div>
      <div className="text-[11px] text-atlas-muted leading-snug">{subtitle}</div>
    </button>
  );
}

/// One-line "path · copy button" cluster. Shows the basename, falls
/// back to the full string when the path is too short to split.
function PathWithCopy({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail in restricted contexts — ignore.
    }
  }
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono">
      <span className="truncate text-atlas-ink-soft" title={path}>
        {path}
      </span>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied" : "Copy path"}
        className="shrink-0 p-1 rounded text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

function AssetsPreviewCard() {
  const summary = useWorkspace((s) => s.summary);
  const assetsDir = useWorkspace((s) => s.assetsDir);
  const versionHint = useWorkspace((s) => s.versionHint);
  if (!assetsDir) return null;
  return (
    <div className="rounded border border-emerald-700/50 bg-emerald-700/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Check className="h-4 w-4 text-emerald-700 shrink-0" />
        <span className="text-sm font-semibold text-atlas-ink">Assets bundle loaded</span>
        {versionHint && (
          <span className="text-xs font-mono text-emerald-800 bg-emerald-700/10 px-1.5 py-0.5 rounded">
            {versionHint}
          </span>
        )}
      </div>
      <PathWithCopy path={assetsDir.path} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-atlas-ink-soft">
        <Stat label="Objects" value={summary.objectCount} />
        <Stat label="Outfits" value={summary.outfitCount} />
        <Stat label="Effects" value={summary.effectCount} />
        <Stat label="Missiles" value={summary.missileCount} />
        <Stat label="Sprite sheets" value={assetsDir.sheetCount} span={2} />
      </div>
    </div>
  );
}

function OtbPreviewCard() {
  const summary = useWorkspace((s) => s.summary);
  if (!summary.otbPath) return null;
  const ver = summary.otbVersion;
  return (
    <div className="rounded border border-emerald-700/50 bg-emerald-700/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Check className="h-4 w-4 text-emerald-700 shrink-0" />
        <span className="text-sm font-semibold text-atlas-ink">items.otb loaded</span>
        {ver && (
          <span className="text-xs font-mono text-emerald-800 bg-emerald-700/10 px-1.5 py-0.5 rounded">
            v{ver.major}.{ver.minor}.{ver.build}
            {ver.atlasExtended && " · Atlas"}
          </span>
        )}
      </div>
      <PathWithCopy path={summary.otbPath} />
      <div className="text-xs text-atlas-ink-soft">
        <Stat label="Items" value={summary.otbItemCount} />
      </div>
    </div>
  );
}

function Stat({ label, value, span }: { label: string; value: number; span?: 1 | 2 }) {
  return (
    <div className={cn("flex items-baseline gap-1.5", span === 2 && "col-span-2")}>
      <span className="text-atlas-muted">{label}:</span>
      <span className="font-mono tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

export function Launcher() {
  const status = useWorkspace((s) => s.status);
  const error = useWorkspace((s) => s.error);
  const recent = useWorkspace((s) => s.recent);
  const summary = useWorkspace((s) => s.summary);
  const assetsDir = useWorkspace((s) => s.assetsDir);
  const pickAssetsBundle = useWorkspace((s) => s.pickAssetsBundle);
  const openOtbPicker = useWorkspace((s) => s.openOtbPicker);
  const openOtbPath = useWorkspace((s) => s.openOtbPath);
  const openAssetsBundlePath = useWorkspace((s) => s.openAssetsBundlePath);
  const closeWorkspace = useWorkspace((s) => s.closeWorkspace);
  const enterEditor = useWorkspace((s) => s.enterEditor);
  const refreshRecent = useWorkspace((s) => s.refreshRecent);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  const hasAssets = assetsDir != null;
  const hasOtb = summary.otbPath != null;
  const hasAnything = hasAssets || hasOtb;

  const recentAssetsPaths = recent.appearances
    .map(dirname)
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .slice(0, 3);

  return (
    <main className="h-screen w-screen flex flex-col items-center bg-atlas-cream text-atlas-ink p-5 overflow-y-auto">
      <header className="mb-5 flex flex-col items-center shrink-0">
        <div className="mb-3 rounded-2xl border border-atlas-border bg-atlas-paper p-3 shadow-sm ring-1 ring-atlas-ink/5">
          <img
            src={logoUrl}
            alt="Atlas"
            className="h-14 w-14 object-contain select-none"
            draggable={false}
          />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Atlas Assets Editor</h1>
        <p className="text-[11px] text-atlas-muted mt-0.5">
          Tibia 12+/15.x · appearances.dat ⇄ items.otb
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 w-full max-w-xl">
        <ChoiceCard
          icon={<ImagePlus className="h-7 w-7" />}
          title={hasAssets ? "Re-pick assets" : "Open assets"}
          subtitle="Folder with catalog-content.json"
          onClick={() => void pickAssetsBundle()}
          disabled={status === "loading"}
        />
        <ChoiceCard
          icon={<FileText className="h-7 w-7" />}
          title={hasOtb ? "Re-pick .otb" : "Open items.otb"}
          subtitle="Legacy or Atlas-extended OTB"
          onClick={() => void openOtbPicker()}
          disabled={status === "loading"}
        />
      </div>

      {hasAnything && (
        <div className="mt-4 w-full max-w-xl space-y-3">
          <AssetsPreviewCard />
          <OtbPreviewCard />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void enterEditor()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-semibold bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft"
            >
              Open editor
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void closeWorkspace()}
              title="Discard the staged files and start over"
              className="rounded p-2 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {!hasAnything && (recentAssetsPaths.length > 0 || recent.otb.length > 0) && (
        <section className="mt-5 w-full max-w-xl">
          <h2 className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold mb-1.5">
            Recent
          </h2>
          <ul className="space-y-0.5 text-sm">
            {recentAssetsPaths.map((dir) => (
              <li key={`assets-${dir}`}>
                <button
                  type="button"
                  onClick={() => void openAssetsBundlePath(dir)}
                  title={dir}
                  className="w-full text-left flex items-baseline gap-2 px-2 py-1 rounded hover:bg-atlas-sand"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 self-center text-atlas-muted" />
                  <span className="text-atlas-ink shrink-0">{basename(dir)}</span>
                  <span className="text-[11px] text-atlas-muted truncate">{dir}</span>
                </button>
              </li>
            ))}
            {recent.otb.slice(0, 3).map((p) => (
              <li key={`otb-${p}`}>
                <button
                  type="button"
                  onClick={() => void openOtbPath(p)}
                  title={p}
                  className="w-full text-left flex items-baseline gap-2 px-2 py-1 rounded hover:bg-atlas-sand"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 self-center text-atlas-muted" />
                  <span className="text-atlas-ink shrink-0">{basename(p)}</span>
                  <span className="text-[11px] text-atlas-muted truncate">{p}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status === "loading" && (
        <p className="mt-3 text-sm text-amber-700">Loading…</p>
      )}
      {error && (
        <p className="mt-3 text-sm text-rose-700 max-w-xl text-center">{error}</p>
      )}

      <footer className="mt-auto pt-3 text-[10px] text-atlas-muted">
        Open standalone{" "}
        <button
          type="button"
          onClick={() => {
            const { openAppearancesPicker } = useWorkspace.getState();
            void openAppearancesPicker();
          }}
          className="underline hover:text-atlas-ink"
        >
          appearances.dat
        </button>{" "}
        · Phase 6
      </footer>
    </main>
  );
}
