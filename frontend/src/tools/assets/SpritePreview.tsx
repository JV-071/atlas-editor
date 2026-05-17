import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Download, FolderOpen } from "lucide-react";

import { SpriteThumb } from "./SpriteThumb";
import { useWorkspace } from "./store";
import {
  readAssetId,
  type AppearanceInfoDto,
  type ExportReport,
  type FixedFrameGroupDto,
  type FrameGroupInfoDto,
} from "./types";
import { cn } from "../../shared/utils";

interface Props {
  appearance: AppearanceInfoDto;
}

const FRAME_GROUP_LABELS: Record<FixedFrameGroupDto, string> = {
  OutfitIdle: "Idle",
  OutfitMoving: "Moving",
  ObjectInitial: "Initial",
};

function frameGroupTitle(fg: FrameGroupInfoDto, fallbackIdx: number): string {
  if (fg.fixedFrameGroup) return FRAME_GROUP_LABELS[fg.fixedFrameGroup];
  if (fg.id != null) return `Group #${fg.id}`;
  return `Group ${fallbackIdx}`;
}

type SpriteExportFormat = "png" | "gif";

function ExportAllButton({ appearance }: { appearance: AppearanceInfoDto }) {
  const category = useWorkspace((s) => s.category);
  const [running, setRunning] = useState(false);
  const [format, setFormat] = useState<SpriteExportFormat>("png");

  async function run() {
    if (format === "png") {
      const dir = await openDialog({
        title: "Export all sprites as PNG",
        directory: true,
        multiple: false,
      });
      if (!dir) return;
      const dest = Array.isArray(dir) ? dir[0] : dir;
      setRunning(true);
      try {
        await invoke<ExportReport>("export_appearance_sprites", {
          scope: category,
          id: readAssetId(appearance.id),
          outputPath: dest,
        });
      } finally {
        setRunning(false);
      }
    } else {
      const scope = category as "object" | "outfit" | "effect" | "missile";
      const id = readAssetId(appearance.id);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({
        title: "Export appearance as GIF",
        defaultPath: `${scope}-${id}.gif`,
        filters: [{ name: "GIF", extensions: ["gif"] }],
      });
      if (!dest) return;
      setRunning(true);
      try {
        const formatMap: Record<string, string> = {
          object: "itemgif",
          outfit: "itemgif",
          effect: "effectgif",
          missile: "missilegif",
        };
        await invoke<ExportReport>("export_appearance", {
          scope,
          id,
          format: formatMap[scope] ?? "itemgif",
          outputPath: dest,
        });
      } finally {
        setRunning(false);
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded border border-atlas-border overflow-hidden">
        <button
          type="button"
          onClick={() => setFormat("png")}
          className={cn(
            "px-2 py-1 text-[11px] font-medium transition-colors",
            format === "png"
              ? "bg-atlas-ink text-atlas-cream"
              : "bg-atlas-cream text-atlas-muted hover:text-atlas-ink",
          )}
        >
          PNG
        </button>
        <button
          type="button"
          onClick={() => setFormat("gif")}
          className={cn(
            "px-2 py-1 text-[11px] font-medium transition-colors",
            format === "gif"
              ? "bg-atlas-ink text-atlas-cream"
              : "bg-atlas-cream text-atlas-muted hover:text-atlas-ink",
          )}
        >
          GIF
        </button>
      </div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-atlas-border bg-atlas-paper text-xs text-atlas-ink hover:border-atlas-ink hover:bg-atlas-sand disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {format === "png" ? (
          <FolderOpen className="h-3.5 w-3.5" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {running ? "Exporting…" : "Export all"}
      </button>
    </div>
  );
}

export function SpritePreview({ appearance }: Props) {
  const assetsDir = useWorkspace((s) => s.assetsDir);

  if (!assetsDir) {
    return (
      <div className="text-xs text-atlas-muted italic">
        Set the client's <code>assets/</code> directory in the toolbar to render sprites.
      </div>
    );
  }

  const sections = appearance.frameGroups
    .map((fg, idx) => ({ fg, idx }))
    .filter(({ fg }) => fg.spriteInfo && fg.spriteInfo.spriteIds.length > 0);

  if (sections.length === 0) {
    return (
      <div className="text-xs text-atlas-muted italic">
        No sprite payload on this appearance.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ExportAllButton appearance={appearance} />
      {sections.map(({ fg, idx }) => {
        const si = fg.spriteInfo!;
        return (
          <div key={`fg-${idx}`} className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs uppercase tracking-wider text-atlas-muted font-semibold">
                {frameGroupTitle(fg, idx)}
              </h4>
              <span className="text-[10px] text-atlas-muted font-mono tabular-nums">
                {si.spriteIds.length} sprite{si.spriteIds.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {si.spriteIds.map((id, i) => (
                <div
                  key={`${id}-${i}`}
                  className="flex flex-col items-center gap-1"
                  title={`sprite_id ${id}`}
                >
                  <SpriteThumb ids={[id]} size={64} />
                  <span className="text-[10px] text-atlas-muted font-mono tabular-nums">
                    {id}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
