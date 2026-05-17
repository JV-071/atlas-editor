import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { useWorkspace } from "./store";
import { SpriteThumb } from "./SpriteThumb";
import {
  APPEARANCE_CATEGORIES,
  type AppearanceCategory,
  type DuplicateGroup,
} from "./types";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";

interface Props {
  onClose: () => void;
}

export function DuplicateDialog({ onClose }: Props) {
  const t = useT();
  const findDuplicates = useWorkspace((s) => s.findDuplicates);
  const setCategory = useWorkspace((s) => s.setCategory);
  const setSelected = useWorkspace((s) => s.setSelected);

  const [scope, setScope] = useState<AppearanceCategory>("object");
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function search(cat: AppearanceCategory) {
    setScope(cat);
    setLoading(true);
    setSearched(false);
    try {
      const result = await findDuplicates(cat);
      setGroups(result);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  useEffect(() => {
    void search("object");
  }, []);

  function goTo(cat: AppearanceCategory, id: number) {
    setCategory(cat);
    void setSelected(id);
    onClose();
  }

  const totalDuplicates = groups.reduce((n, g) => n + g.ids.length, 0);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-atlas-ink/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-lg border border-atlas-border bg-atlas-paper shadow-xl">
        <header className="flex items-center justify-between p-3 border-b border-atlas-border">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-atlas-muted">
            {t("duplicates.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-atlas-muted hover:text-atlas-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-3 border-b border-atlas-border flex items-center gap-2">
          {APPEARANCE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => void search(cat)}
              disabled={loading}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium capitalize",
                cat === scope
                  ? "bg-atlas-ink text-atlas-cream"
                  : "text-atlas-ink hover:bg-atlas-sand",
                "disabled:opacity-40",
              )}
            >
              {cat}
            </button>
          ))}
          {searched && !loading && (
            <span className="ml-auto text-xs text-atlas-muted tabular-nums">
              {t("duplicates.summary", {
                groups: groups.length,
                total: totalDuplicates,
              })}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px]">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-atlas-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          )}

          {searched && !loading && groups.length === 0 && (
            <div className="flex items-center justify-center py-8 text-sm text-atlas-muted">
              {t("duplicates.none")}
            </div>
          )}

          {!loading &&
            groups.map((group) => (
              <div
                key={group.spriteKey}
                className="rounded border border-atlas-border bg-atlas-cream/40 p-2"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {group.displaySpriteIds.length > 0 && (
                    <SpriteThumb ids={group.displaySpriteIds} durationsMs={[]} size={32} />
                  )}
                  <span className="text-xs text-atlas-muted">
                    {t("duplicates.groupCount", { count: group.ids.length })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => goTo(scope, id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-atlas-paper border border-atlas-border hover:border-atlas-ink hover:bg-atlas-sand"
                    >
                      #{id}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>

        <footer className="flex items-center justify-end p-3 border-t border-atlas-border bg-atlas-cream/40">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm text-atlas-ink hover:bg-atlas-sand"
          >
            {t("common.cancel")}
          </button>
        </footer>
      </div>
    </div>
  );
}
