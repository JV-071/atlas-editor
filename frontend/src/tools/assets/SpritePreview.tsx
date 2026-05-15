import { useMemo } from "react";

import { SpriteThumb } from "./SpriteThumb";
import { useWorkspace } from "./store";
import {
  patternDims,
  spriteIndex,
  type AppearanceInfoDto,
  type FrameGroupInfoDto,
  type FixedFrameGroupDto,
  type SpriteInfoDataDto,
} from "./types";

interface Props {
  appearance: AppearanceInfoDto;
}

/// Tibia outfits use `pattern_x` for direction in NESW order:
/// 0 = North, 1 = East, 2 = South, 3 = West.
const OUTFIT_DIRECTIONS: Array<{ x: number; label: string }> = [
  { x: 2, label: "South" },
  { x: 1, label: "East" },
  { x: 0, label: "North" },
  { x: 3, label: "West" },
];

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

/// Per-phase animation timings, parallel to a phase cycle. Empty array
/// if the SpriteInfo has no animation block.
function buildDurations(si: SpriteInfoDataDto): number[] {
  return (
    si.animation?.spritePhases.map((p) => {
      const lo = p.durationMin ?? 0;
      const hi = p.durationMax ?? lo;
      return (lo + hi) / 2;
    }) ?? []
  );
}

/// Build the animated cycle for a single (z, y, x) cell at layer 0.
function buildCellIds(si: SpriteInfoDataDto, z: number, y: number, x: number): number[] {
  const { phases } = patternDims(si);
  const ids: number[] = [];
  for (let phase = 0; phase < phases; phase++) {
    const idx = spriteIndex(si, phase, z, y, x, 0);
    if (idx == null) break;
    ids.push(si.spriteIds[idx]);
  }
  return ids;
}

interface CellSpec {
  key: string;
  label: string | null;
  ids: number[];
}

/// Build the grid layout for one frame group: rows are (z, y) blocks,
/// columns are the x direction (outfit-friendly NESW order for outfits,
/// raw pattern order otherwise). Layers are collapsed to layer 0 — the
/// extra layers in outfits are template tints that need client-side
/// blending we don't do here.
function buildFrameGroupGrid(
  si: SpriteInfoDataDto,
  category: AppearanceInfoDto["category"],
): { columns: { x: number; label: string | null }[]; rows: { z: number; y: number; cells: CellSpec[] }[] } {
  const { width, height, depth } = patternDims(si);
  const isOutfit = category === "outfit";

  const xColumns = (() => {
    if (isOutfit) {
      return OUTFIT_DIRECTIONS.filter((d) => d.x < width).map((d) => ({
        x: d.x,
        label: d.label as string | null,
      }));
    }
    // For non-outfits we don't have a meaningful direction label.
    return Array.from({ length: width }, (_, x) => ({
      x,
      label: width > 1 ? `x=${x}` : null,
    }));
  })();

  const rows: { z: number; y: number; cells: CellSpec[] }[] = [];
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      const cells: CellSpec[] = xColumns.map(({ x }) => ({
        key: `${z}-${y}-${x}`,
        label: null,
        ids: buildCellIds(si, z, y, x),
      }));
      rows.push({ z, y, cells });
    }
  }
  return { columns: xColumns, rows };
}

function rowLabel(
  z: number,
  y: number,
  depth: number,
  height: number,
  category: AppearanceInfoDto["category"],
): string | null {
  const isOutfit = category === "outfit";
  if (depth <= 1 && height <= 1) return null;
  const parts: string[] = [];
  if (depth > 1) parts.push(isOutfit ? `Addon ${z}` : `z=${z}`);
  if (height > 1) parts.push(`y=${y}`);
  return parts.join(" · ");
}

export function SpritePreview({ appearance }: Props) {
  const assetsDir = useWorkspace((s) => s.assetsDir);

  // Memoise so that scrolling the editor doesn't reshape the grid every
  // render — the SpriteThumb cycle ids would otherwise reset to phase 0.
  const sections = useMemo(() => {
    return appearance.frameGroups
      .map((fg, idx) => ({ fg, idx, si: fg.spriteInfo }))
      .filter((s): s is { fg: FrameGroupInfoDto; idx: number; si: SpriteInfoDataDto } => s.si !== null)
      .map(({ fg, idx, si }) => {
        const { height, depth } = patternDims(si);
        const grid = buildFrameGroupGrid(si, appearance.category);
        return {
          key: `fg-${idx}`,
          title: frameGroupTitle(fg, idx),
          durations: buildDurations(si),
          grid,
          rowMeta: { height, depth },
          phaseCount: patternDims(si).phases,
          spriteCount: si.spriteIds.length,
        };
      });
  }, [appearance]);

  if (sections.length === 0) {
    return (
      <div className="text-xs text-atlas-muted italic">
        No sprite payload on this appearance.
      </div>
    );
  }

  if (!assetsDir) {
    return (
      <div className="text-xs text-atlas-muted italic">
        Set the client's <code>assets/</code> directory in the toolbar to render sprites.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => {
        const { columns, rows } = section.grid;
        const showColumnHeader = columns.some((c) => c.label != null);
        const cellSize = appearance.category === "outfit" ? 64 : 72;
        return (
          <div key={section.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs uppercase tracking-wider text-atlas-muted font-semibold">
                {section.title}
              </h4>
              <span className="text-[10px] text-atlas-muted font-mono tabular-nums">
                {section.phaseCount} phase{section.phaseCount === 1 ? "" : "s"}
                {" · "}
                {section.spriteCount} sprite{section.spriteCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="inline-block overflow-x-auto">
              <table className="border-separate border-spacing-2">
                {showColumnHeader && (
                  <thead>
                    <tr>
                      {rows.length > 1 && <th />}
                      {columns.map((col) => (
                        <th
                          key={col.x}
                          className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold text-center"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {rows.map((row) => {
                    const label = rowLabel(
                      row.z,
                      row.y,
                      section.rowMeta.depth,
                      section.rowMeta.height,
                      appearance.category,
                    );
                    return (
                      <tr key={`${row.z}-${row.y}`}>
                        {rows.length > 1 && (
                          <td className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold pr-2 align-middle whitespace-nowrap">
                            {label ?? ""}
                          </td>
                        )}
                        {row.cells.map((cell) =>
                          cell.ids.length === 0 ? (
                            <td key={cell.key}>
                              <div
                                style={{ width: cellSize, height: cellSize }}
                                className="rounded border border-dashed border-atlas-border bg-atlas-paper"
                              />
                            </td>
                          ) : (
                            <td key={cell.key}>
                              <SpriteThumb
                                ids={cell.ids}
                                durationsMs={section.durations}
                                size={cellSize}
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
