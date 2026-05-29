import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Check, FileText, FolderOpen, Map, X } from "lucide-react";

import { useApp } from "../../appStore";
import logoUrl from "../../shared/logo.png";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";

type Direction = "serverToClient" | "clientToServer";

type MapSource = "otb" | "builtin";

interface MapPeek {
  path: string;
  otbmVersion: number;
  width: number;
  height: number;
  itemsMajor: number;
  itemsMinor: number;
  idsScanned: number;
  tableEntries: number;
  source: MapSource;
}

interface MapConvertResult {
  outputPath: string;
  idsChanged: number;
  idsScanned: number;
  source: MapSource;
}

/// Compute a default sibling output path: `name-<dir>.otbm`.
function defaultOutput(input: string, direction: Direction): string {
  const sep = input.includes("\\") ? "\\" : "/";
  const cleaned = input.replace(/\\/g, "/");
  const slash = cleaned.lastIndexOf("/");
  const dir = slash === -1 ? "" : input.slice(0, slash);
  const base = slash === -1 ? input : input.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const suffix = direction === "serverToClient" ? "client" : "server";
  const name = `${stem}-${suffix}.otbm`;
  return dir ? `${dir}${sep}${name}` : name;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-atlas-muted">{label}</span>
      <span className="font-mono tabular-nums text-atlas-ink">{value}</span>
    </div>
  );
}

export function MapConverterScreen() {
  const setTool = useApp((s) => s.setTool);
  const t = useT();

  const [inputPath, setInputPath] = useState<string | null>(null);
  const [otbPath, setOtbPath] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("serverToClient");
  const [peek, setPeek] = useState<MapPeek | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<MapConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickInput() {
    const sel = await openDialog({
      title: t("mapconv.pickFile"),
      multiple: false,
      directory: false,
      filters: [{ name: "OTBM map", extensions: ["otbm"] }],
    });
    const path = Array.isArray(sel) ? sel[0] : sel;
    if (!path) return;
    setInputPath(path);
    setPeek(null);
    setResult(null);
    setError(null);
    setOverwrite(false);
    setOutputPath(defaultOutput(path, direction));
  }

  function changeDirection(d: Direction) {
    setDirection(d);
    setResult(null);
    // Refresh the default output suffix unless the user is overwriting.
    if (inputPath && !overwrite) setOutputPath(defaultOutput(inputPath, d));
    // Table size + source depend on direction — drop the stale peek so the
    // user re-analyzes against the new direction.
    setPeek(null);
  }

  async function pickOtb() {
    const sel = await openDialog({
      title: t("mapconv.otb"),
      multiple: false,
      directory: false,
      filters: [{ name: "items.otb", extensions: ["otb"] }],
    });
    const path = Array.isArray(sel) ? sel[0] : sel;
    if (!path) return;
    setOtbPath(path);
    setPeek(null);
    setResult(null);
  }

  function clearOtb() {
    setOtbPath(null);
    setPeek(null);
    setResult(null);
  }

  async function analyze() {
    if (!inputPath) return;
    setError(null);
    setBusy(true);
    try {
      const info = await invoke<MapPeek>("map_peek", {
        path: inputPath,
        direction,
        otbPath,
      });
      setPeek(info);
    } catch (e) {
      setError(String(e));
      setPeek(null);
    } finally {
      setBusy(false);
    }
  }

  async function pickOutput() {
    const sel = await saveDialog({
      title: t("mapconv.output"),
      defaultPath: outputPath ?? undefined,
      filters: [{ name: "OTBM map", extensions: ["otbm"] }],
    });
    if (sel) {
      setOutputPath(sel);
      setOverwrite(false);
    }
  }

  function toggleOverwrite(on: boolean) {
    setOverwrite(on);
    if (on && inputPath) setOutputPath(inputPath);
    else if (!on && inputPath) setOutputPath(defaultOutput(inputPath, direction));
  }

  async function convert() {
    if (!inputPath || !outputPath) return;
    setError(null);
    setBusy(true);
    setResult(null);
    try {
      const res = await invoke<MapConvertResult>("map_convert", {
        input: inputPath,
        output: outputPath,
        direction,
        otbPath,
      });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const canConvert = inputPath != null && outputPath != null && !busy;

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

      <header className="mb-4 flex flex-col items-center shrink-0">
        <div className="mb-3 rounded-2xl border border-atlas-border bg-atlas-paper p-3 shadow-sm ring-1 ring-atlas-ink/5">
          <img src={logoUrl} alt="Atlas" className="h-12 w-12 object-contain select-none" draggable={false} />
        </div>
        <h1 className="text-xl font-bold tracking-tight inline-flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5" />
          {t("mapconv.title")}
        </h1>
        <p className="text-[11px] text-atlas-muted mt-0.5 max-w-md text-center">
          {t("mapconv.subtitle")}
        </p>
      </header>

      <div className="w-full max-w-xl space-y-3">
        {/* Input file */}
        <button
          type="button"
          onClick={() => void pickInput()}
          className={cn(
            "w-full flex items-center gap-3 rounded border p-3 text-left transition-colors",
            inputPath
              ? "border-emerald-700/40 bg-emerald-700/5 hover:bg-emerald-700/10"
              : "border-atlas-border bg-atlas-paper hover:border-atlas-ink",
          )}
        >
          <Map className="h-5 w-5 shrink-0 text-atlas-ink" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-atlas-ink">{t("mapconv.pickFile")}</div>
            <div className="text-[11px] text-atlas-muted leading-snug truncate">
              {inputPath ?? t("mapconv.pickFileHint")}
            </div>
          </div>
          {inputPath && <Check className="h-4 w-4 text-emerald-700 shrink-0" />}
        </button>

        {/* Optional items.otb for an exact, server-specific mapping */}
        <div
          className={cn(
            "w-full flex items-center gap-3 rounded border p-3 transition-colors",
            otbPath
              ? "border-emerald-700/40 bg-emerald-700/5"
              : "border-dashed border-atlas-border bg-atlas-paper",
          )}
        >
          <FileText className="h-5 w-5 shrink-0 text-atlas-ink" />
          <button
            type="button"
            onClick={() => void pickOtb()}
            className="min-w-0 flex-1 text-left"
          >
            <div className="text-sm font-semibold text-atlas-ink">{t("mapconv.otb")}</div>
            <div className="text-[11px] text-atlas-muted leading-snug truncate">
              {otbPath ?? t("mapconv.otbHint")}
            </div>
          </button>
          {otbPath && (
            <button
              type="button"
              onClick={clearOtb}
              title={t("mapconv.otbClear")}
              className="shrink-0 p-1 rounded text-atlas-muted hover:text-rose-700 hover:bg-rose-700/10"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Direction segmented control */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold mb-1">
            {t("mapconv.direction")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["serverToClient", "clientToServer"] as Direction[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => changeDirection(d)}
                className={cn(
                  "rounded border p-2 text-left transition-colors",
                  direction === d
                    ? "border-atlas-ink bg-atlas-ink text-atlas-cream"
                    : "border-atlas-border bg-atlas-paper text-atlas-ink hover:border-atlas-ink",
                )}
              >
                <div className="text-sm font-semibold">{t(`mapconv.dir.${d}`)}</div>
                <div
                  className={cn(
                    "text-[10px] leading-snug",
                    direction === d ? "text-atlas-cream/70" : "text-atlas-muted",
                  )}
                >
                  {t(`mapconv.dir.${d}Hint`)}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Analyze */}
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={inputPath == null || busy}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-semibold transition-colors",
            "border border-atlas-ink text-atlas-ink hover:bg-atlas-sand",
            "disabled:border-atlas-border disabled:text-atlas-muted disabled:cursor-not-allowed",
          )}
        >
          {busy && peek == null ? t("mapconv.analyzing") : t("mapconv.analyze")}
        </button>

        {peek && (
          <div className="rounded border border-atlas-border bg-atlas-paper/50 p-3 space-y-1 text-xs">
            <div className="font-semibold text-atlas-ink mb-1">{t("mapconv.mapInfo")}</div>
            <Stat label={t("mapconv.otbmVersion")} value={peek.otbmVersion} />
            <Stat label={t("mapconv.dimensions")} value={`${peek.width} × ${peek.height}`} />
            <Stat label={t("mapconv.itemsVersion")} value={`${peek.itemsMajor}.${peek.itemsMinor}`} />
            <Stat label={t("mapconv.idsToScan")} value={peek.idsScanned.toLocaleString()} />
            <Stat label={t("mapconv.tableEntries")} value={peek.tableEntries.toLocaleString()} />
            <Stat label={t("mapconv.source")} value={t(`mapconv.source.${peek.source}`)} />
          </div>
        )}

        {/* Output */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => void pickOutput()}
            className="w-full flex items-center gap-3 rounded border border-atlas-border bg-atlas-paper p-3 text-left hover:border-atlas-ink transition-colors"
          >
            <FolderOpen className="h-5 w-5 shrink-0 text-atlas-ink" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-atlas-ink">{t("mapconv.output")}</div>
              <div className="text-[11px] text-atlas-muted leading-snug truncate">
                {outputPath ?? t("mapconv.outputHint")}
              </div>
            </div>
          </button>
          <label className="flex items-center gap-2 text-xs text-atlas-ink-soft px-1">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => toggleOverwrite(e.target.checked)}
              disabled={inputPath == null}
              className="h-3.5 w-3.5 accent-atlas-ink cursor-pointer"
            />
            {t("mapconv.overwriteInput")}
          </label>
        </div>

        {/* Convert */}
        <button
          type="button"
          onClick={() => void convert()}
          disabled={!canConvert}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-semibold transition-colors",
            "bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft",
            "disabled:bg-atlas-sand disabled:text-atlas-muted disabled:cursor-not-allowed",
          )}
        >
          {busy && peek != null ? t("mapconv.converting") : t("mapconv.convert")}
        </button>

        {error && (
          <div className="flex items-start gap-2 rounded border border-rose-600/50 bg-rose-600/5 p-3 text-xs">
            <AlertTriangle className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-atlas-ink font-medium">{t("mapconv.error")}</p>
              <p className="text-atlas-ink-soft break-all">{error}</p>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded border border-emerald-700/40 bg-emerald-700/5 p-3 space-y-1 text-xs">
            <div className="flex items-center gap-2 font-semibold text-atlas-ink mb-1">
              <Check className="h-4 w-4 text-emerald-700" />
              {t("mapconv.done")}
            </div>
            <Stat label={t("mapconv.idsChanged")} value={result.idsChanged.toLocaleString()} />
            <Stat label={t("mapconv.idsScanned")} value={result.idsScanned.toLocaleString()} />
            <Stat label={t("mapconv.source")} value={t(`mapconv.source.${result.source}`)} />
            <div className="pt-1">
              <span className="text-atlas-muted">{t("mapconv.savedTo")}: </span>
              <span className="font-mono break-all text-atlas-ink-soft">{result.outputPath}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
