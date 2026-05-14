import { Grid3X3, Package, Sparkles, Target, User, type LucideIcon } from "lucide-react";

import { useWorkspace } from "./store";
import type { Category } from "./types";
import { cn } from "../../shared/utils";

interface TabDef {
  id: Category;
  label: string;
  icon: LucideIcon;
  /// Tailwind text/border/bg color tokens for this tab's accent.
  iconClass: string;
  activeBorderClass: string;
  activeBgClass: string;
}

const TABS: TabDef[] = [
  {
    id: "object",
    label: "Objects",
    icon: Package,
    iconClass: "text-amber-700",
    activeBorderClass: "border-amber-700",
    activeBgClass: "bg-amber-700/10",
  },
  {
    id: "outfit",
    label: "Outfits",
    icon: User,
    iconClass: "text-sky-700",
    activeBorderClass: "border-sky-700",
    activeBgClass: "bg-sky-700/10",
  },
  {
    id: "effect",
    label: "Effects",
    icon: Sparkles,
    iconClass: "text-fuchsia-700",
    activeBorderClass: "border-fuchsia-700",
    activeBgClass: "bg-fuchsia-700/10",
  },
  {
    id: "missile",
    label: "Missiles",
    icon: Target,
    iconClass: "text-rose-700",
    activeBorderClass: "border-rose-700",
    activeBgClass: "bg-rose-700/10",
  },
  {
    id: "sprites",
    label: "Sprites",
    icon: Grid3X3,
    iconClass: "text-emerald-700",
    activeBorderClass: "border-emerald-700",
    activeBgClass: "bg-emerald-700/10",
  },
];

function tabCount(id: Category, summary: ReturnType<typeof useWorkspace.getState>["summary"], spriteCount: number): number {
  switch (id) {
    case "object":
      return summary.objectCount;
    case "outfit":
      return summary.outfitCount;
    case "effect":
      return summary.effectCount;
    case "missile":
      return summary.missileCount;
    case "sprites":
      return spriteCount;
  }
}

export function Tabs() {
  const active = useWorkspace((s) => s.category);
  const summary = useWorkspace((s) => s.summary);
  const setCategory = useWorkspace((s) => s.setCategory);
  const spriteCount = useWorkspace((s) =>
    s.spriteRanges.reduce((acc, r) => acc + (r.lastspriteid - r.firstspriteid + 1), 0),
  );

  return (
    <div className="flex border-b border-atlas-border bg-atlas-paper">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const count = tabCount(tab.id, summary, spriteCount);
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCategory(tab.id)}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5",
              isActive
                ? cn(tab.activeBorderClass, tab.activeBgClass, "text-atlas-ink")
                : "border-transparent text-atlas-muted hover:text-atlas-ink-soft hover:bg-atlas-sand/60",
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", tab.iconClass)} />
            <span>{tab.label}</span>
            <span
              className={cn(
                "ml-0.5 text-xs tabular-nums",
                isActive ? "text-atlas-muted" : "text-atlas-muted/70",
              )}
            >
              {count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/// Per-category accent tokens, exported for reuse in the detail panel
/// or anywhere else that needs to color content by category.
export const CATEGORY_META: Record<
  Category,
  { icon: LucideIcon; iconClass: string; textClass: string }
> = {
  object: { icon: Package, iconClass: "text-amber-700", textClass: "text-amber-700" },
  outfit: { icon: User, iconClass: "text-sky-700", textClass: "text-sky-700" },
  effect: { icon: Sparkles, iconClass: "text-fuchsia-700", textClass: "text-fuchsia-700" },
  missile: { icon: Target, iconClass: "text-rose-700", textClass: "text-rose-700" },
  sprites: { icon: Grid3X3, iconClass: "text-emerald-700", textClass: "text-emerald-700" },
};
