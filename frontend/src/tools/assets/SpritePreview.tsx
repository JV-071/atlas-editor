import { SpriteThumb } from "./SpriteThumb";
import { useWorkspace } from "./store";
import {
  type AppearanceInfoDto,
  type FixedFrameGroupDto,
  type FrameGroupInfoDto,
} from "./types";

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
