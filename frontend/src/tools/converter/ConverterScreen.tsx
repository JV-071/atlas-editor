import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileCog,
  FileText,
  FolderOpen,
} from "lucide-react";

import { useApp } from "../../appStore";
import logoUrl from "../../shared/logo.png";
import { cn } from "../../shared/utils";

interface ConverterInputs {
  otbPath: string | null;
  datPath: string | null;
  sprPath: string | null;
}

interface ConverterPreview {
  otbItemCount: number;
  datAppearanceCount: number;
  sprSpriteCount: number;
  unmappedOtbCount: number;
}

interface FilePickerRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  required: boolean;
  path: string | null;
  onPick: () => void;
}

function FilePickerRow({
  icon,
  label,
  description,
  required,
  path,
  onPick,
}: FilePickerRowProps) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "w-full flex items-center gap-3 rounded border p-3 text-left transition-colors",
        path
          ? "border-emerald-700/40 bg-emerald-700/5 hover:bg-emerald-700/10"
          : "border-atlas-border bg-atlas-paper hover:border-atlas-ink",
      )}
    >
      <div className="text-atlas-ink shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-atlas-ink">{label}</span>
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider font-semibold",
              required ? "text-amber-700" : "text-atlas-muted",
            )}
          >
            {required ? "Required" : "Optional"}
          </span>
        </div>
        <div className="text-[11px] text-atlas-muted leading-snug truncate">
          {path ?? description}
        </div>
      </div>
      {path && <Check className="h-4 w-4 text-emerald-700 shrink-0" />}
    </button>
  );
}

export function ConverterScreen() {
  const setTool = useApp((s) => s.setTool);
  const [inputs, setInputs] = useState<ConverterInputs>({
    otbPath: null,
    datPath: null,
    sprPath: null,
  });
  const [preview, setPreview] = useState<ConverterPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(name: string, ext: string): Promise<string | null> {
    const sel = await openDialog({
      title: `Pick ${name}`,
      multiple: false,
      directory: false,
      filters: [{ name, extensions: [ext] }],
    });
    if (Array.isArray(sel)) return sel[0] ?? null;
    return sel ?? null;
  }

  async function pickOtb() {
    const p = await pick("items.otb", "otb");
    if (p) setInputs((i) => ({ ...i, otbPath: p }));
  }
  async function pickDat() {
    const p = await pick("legacy .dat", "dat");
    if (p) setInputs((i) => ({ ...i, datPath: p }));
  }
  async function pickSpr() {
    const p = await pick("legacy .spr", "spr");
    if (p) setInputs((i) => ({ ...i, sprPath: p }));
  }

  async function runPreview() {
    setError(null);
    setBusy(true);
    try {
      const result = await invoke<ConverterPreview>("converter_peek", { inputs });
      setPreview(result);
    } catch (e) {
      setError(String(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const canPreview = inputs.otbPath != null && !busy;

  return (
    <main className="h-screen w-screen flex flex-col items-center bg-atlas-cream text-atlas-ink p-5 overflow-y-auto">
      <button
        type="button"
        onClick={() => setTool("home")}
        className="self-start mb-2 inline-flex items-center gap-1 text-xs text-atlas-muted hover:text-atlas-ink"
      >
        <ArrowLeft className="h-3 w-3" />
        Atlas Editor
      </button>

      <header className="mb-4 flex flex-col items-center shrink-0">
        <div className="mb-3 rounded-2xl border border-atlas-border bg-atlas-paper p-3 shadow-sm ring-1 ring-atlas-ink/5">
          <img
            src={logoUrl}
            alt="Atlas"
            className="h-12 w-12 object-contain select-none"
            draggable={false}
          />
        </div>
        <h1 className="text-xl font-bold tracking-tight inline-flex items-center gap-2">
          <FileCog className="h-5 w-5" />
          OTB Converter
        </h1>
        <p className="text-[11px] text-atlas-muted mt-0.5 max-w-md text-center">
          Build a Tibia 12+/15.x assets bundle from a legacy server's{" "}
          <code>items.otb</code> plus the matching client <code>.dat</code> and{" "}
          <code>.spr</code> files.
        </p>
      </header>

      <div className="w-full max-w-xl space-y-2">
        <FilePickerRow
          icon={<FileText className="h-5 w-5" />}
          label="items.otb"
          required
          description="Server-side catalog with item attributes and client_id pointers."
          path={inputs.otbPath}
          onPick={() => void pickOtb()}
        />
        <FilePickerRow
          icon={<FolderOpen className="h-5 w-5" />}
          label="legacy .dat"
          required
          description="Client appearance metadata (Tibia 7.x–10.x). Provides flags + sprite_id lists."
          path={inputs.datPath}
          onPick={() => void pickDat()}
        />
        <FilePickerRow
          icon={<FolderOpen className="h-5 w-5" />}
          label="legacy .spr"
          required
          description="Raw 32×32 sprite tiles. Re-packed into modern BMP+LZMA sheets."
          path={inputs.sprPath}
          onPick={() => void pickSpr()}
        />
      </div>

      <div className="w-full max-w-xl mt-3 space-y-3">
        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={!canPreview}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-semibold transition-colors",
            "bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft",
            "disabled:bg-atlas-sand disabled:text-atlas-muted disabled:cursor-not-allowed",
          )}
        >
          {busy ? "Working…" : "Preview conversion"}
        </button>

        {error && (
          <div className="flex items-start gap-2 rounded border border-amber-600/50 bg-amber-600/5 p-3 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-atlas-ink font-medium">Converter not ready</p>
              <p className="text-atlas-ink-soft">{error}</p>
            </div>
          </div>
        )}

        {preview && (
          <div className="rounded border border-emerald-700/40 bg-emerald-700/5 p-3 space-y-1 text-xs">
            <div className="font-semibold text-atlas-ink mb-1">Conversion preview</div>
            <div>OTB items: {preview.otbItemCount.toLocaleString()}</div>
            <div>Legacy appearances (.dat): {preview.datAppearanceCount.toLocaleString()}</div>
            <div>Legacy sprites (.spr): {preview.sprSpriteCount.toLocaleString()}</div>
            <div>
              Unmapped OTB items: {preview.unmappedOtbCount.toLocaleString()} (no
              matching legacy appearance)
            </div>
          </div>
        )}

        <p className="text-[10px] text-atlas-muted italic text-center">
          Conversion logic is scaffolded but not implemented yet. The UI exercises
          the IPC; the writer crate is the next milestone.
        </p>
      </div>
    </main>
  );
}
