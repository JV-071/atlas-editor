import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FolderOpen,
  ImagePlus,
  RotateCcw,
  UserCog,
} from "lucide-react";

import { useApp } from "../../appStore";
import logoUrl from "../../shared/logo.png";
import { resizeWindow, useWorkspace } from "./store";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";

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

/// One-line "path · copy button" cluster.
function PathWithCopy({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
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
        title={copied ? t("common.copied") : t("common.copy")}
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
  const t = useT();
  if (!assetsDir) return null;
  return (
    <div className="rounded border border-emerald-700/50 bg-emerald-700/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Check className="h-4 w-4 text-emerald-700 shrink-0" />
        <span className="text-sm font-semibold text-atlas-ink">
          {t("launcher.bundleLoaded")}
        </span>
        {versionHint && (
          <span className="text-xs font-mono text-emerald-800 bg-emerald-700/10 px-1.5 py-0.5 rounded">
            {versionHint}
          </span>
        )}
      </div>
      <PathWithCopy path={assetsDir.path} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-atlas-ink-soft">
        <Stat label={t("launcher.stat.objects")} value={summary.objectCount} />
        <Stat label={t("launcher.stat.outfits")} value={summary.outfitCount} />
        <Stat label={t("launcher.stat.effects")} value={summary.effectCount} />
        <Stat label={t("launcher.stat.missiles")} value={summary.missileCount} />
        <Stat label={t("launcher.stat.spriteSheets")} value={assetsDir.sheetCount} span={2} />
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
  const assetsDir = useWorkspace((s) => s.assetsDir);
  const pickAssetsBundle = useWorkspace((s) => s.pickAssetsBundle);
  const openAssetsBundlePath = useWorkspace((s) => s.openAssetsBundlePath);
  const closeWorkspace = useWorkspace((s) => s.closeWorkspace);
  const enterEditor = useWorkspace((s) => s.enterEditor);
  const refreshRecent = useWorkspace((s) => s.refreshRecent);
  const profiles = useWorkspace((s) => s.profiles);
  const refreshProfiles = useWorkspace((s) => s.refreshProfiles);
  const applyProfile = useWorkspace((s) => s.applyProfile);
  const setTool = useApp((s) => s.setTool);
  const t = useT();

  useEffect(() => {
    void refreshRecent();
    void refreshProfiles();
  }, [refreshRecent, refreshProfiles]);

  const hasAssets = assetsDir != null;

  // Grow the window when an assets bundle is staged; shrink back if the
  // user discards it.
  useEffect(() => {
    void resizeWindow(hasAssets ? "launcher-staged" : "launcher-empty");
  }, [hasAssets]);

  const recentAssetsPaths = recent.appearances
    .map(dirname)
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .slice(0, 4);

  return (
    <main className="h-screen w-screen flex flex-col items-center bg-atlas-cream text-atlas-ink p-5 overflow-y-auto">
      <div className="w-full flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setTool("home")}
          className="inline-flex items-center gap-1 text-xs text-atlas-muted hover:text-atlas-ink"
        >
          <ArrowLeft className="h-3 w-3" />
          Atlas Editor
        </button>
        <LanguageSwitcher />
      </div>

      <header className="mb-5 flex flex-col items-center shrink-0">
        <div className="mb-3 rounded-2xl border border-atlas-border bg-atlas-paper p-3 shadow-sm ring-1 ring-atlas-ink/5">
          <img
            src={logoUrl}
            alt="Atlas"
            className="h-14 w-14 object-contain select-none"
            draggable={false}
          />
        </div>
        <h1 className="text-xl font-bold tracking-tight">{t("launcher.title")}</h1>
        <p className="text-[11px] text-atlas-muted mt-0.5">{t("launcher.subtitle")}</p>
      </header>

      <div className="w-full max-w-xl">
        <button
          type="button"
          onClick={() => void pickAssetsBundle()}
          disabled={status === "loading"}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg border p-4 text-left transition-all",
            hasAssets
              ? "border-emerald-700/40 bg-emerald-700/5 hover:bg-emerald-700/10"
              : "border-atlas-border bg-atlas-paper hover:border-atlas-ink hover:shadow-sm",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <ImagePlus className="h-8 w-8 text-atlas-ink shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-atlas-ink">
              {hasAssets ? t("launcher.repickFolder") : t("launcher.openFolder")}
            </div>
            <div className="text-[11px] text-atlas-muted leading-snug">
              {t("launcher.openFolderHint", { file: "catalog-content.json" })}
            </div>
          </div>
        </button>
      </div>

      {hasAssets && (
        <div className="mt-4 w-full max-w-xl space-y-3">
          <AssetsPreviewCard />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void enterEditor()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-semibold bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft"
            >
              {t("launcher.openEditor")}
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void closeWorkspace()}
              title={t("launcher.discard")}
              className="rounded p-2 text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {!hasAssets && profiles.length > 0 && (
        <section className="mt-5 w-full max-w-xl">
          <h2 className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold mb-1.5">
            {t("profiles.title")}
          </h2>
          <ul className="space-y-0.5 text-sm">
            {profiles.map((p) => (
              <li key={`profile-${p.name}`}>
                <button
                  type="button"
                  onClick={() => void applyProfile(p.name)}
                  title={p.assetsPath}
                  className="w-full text-left flex items-baseline gap-2 px-2 py-1 rounded hover:bg-atlas-sand"
                >
                  <UserCog className="h-3.5 w-3.5 shrink-0 self-center text-atlas-muted" />
                  <span className="text-atlas-ink shrink-0">{p.name}</span>
                  <span className="text-[10px] font-mono text-atlas-muted shrink-0">
                    {p.pixelFormat}
                  </span>
                  <span className="text-[11px] text-atlas-muted truncate">
                    {p.assetsPath}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hasAssets && recentAssetsPaths.length > 0 && (
        <section className="mt-5 w-full max-w-xl">
          <h2 className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold mb-1.5">
            {t("launcher.recent")}
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
          </ul>
        </section>
      )}

      {status === "loading" && (
        <p className="mt-3 text-sm text-amber-700">{t("common.loading")}</p>
      )}
      {error && (
        <p className="mt-3 text-sm text-rose-700 max-w-xl text-center">{error}</p>
      )}

      <footer className="mt-auto pt-3 text-[10px] text-atlas-muted">
        {t("launcher.footer")}
      </footer>
    </main>
  );
}
