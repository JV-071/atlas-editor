import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, Trash2, UserCog } from "lucide-react";

import { useWorkspace } from "./store";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";

/// Toolbar dropdown for named bundle profiles. Lets the user switch
/// between saved {assets dir + pixel format} bookmarks, save the
/// currently-open bundle as a new one, and rename / delete existing
/// ones. Only shown once a bundle is open (no profiles to manage on
/// the empty launcher state — the Launcher has its own list).
export function ProfileSwitcher() {
  const profiles = useWorkspace((s) => s.profiles);
  const activeProfile = useWorkspace((s) => s.activeProfile);
  const assetsDir = useWorkspace((s) => s.assetsDir);
  const applyProfile = useWorkspace((s) => s.applyProfile);
  const saveCurrentAsProfile = useWorkspace((s) => s.saveCurrentAsProfile);
  const renameProfile = useWorkspace((s) => s.renameProfile);
  const deleteProfile = useWorkspace((s) => s.deleteProfile);
  const t = useT();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setRenaming(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!assetsDir) return null;

  async function confirmCreate() {
    const name = draftName.trim();
    if (!name) return;
    await saveCurrentAsProfile(name);
    setDraftName("");
    setCreating(false);
  }

  async function confirmRename(oldName: string) {
    const name = draftName.trim();
    if (name && name !== oldName) await renameProfile(oldName, name);
    setRenaming(null);
    setDraftName("");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("profiles.title")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors max-w-[180px]",
          activeProfile
            ? "bg-atlas-sand text-atlas-ink hover:bg-atlas-sand/80"
            : "text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand",
        )}
      >
        <UserCog className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {activeProfile ?? t("profiles.none")}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 z-20 rounded border border-atlas-border bg-atlas-paper shadow-lg">
          <div className="px-3 py-2 border-b border-atlas-border text-[10px] uppercase tracking-wider text-atlas-muted font-semibold">
            {t("profiles.title")}
          </div>

          {profiles.length === 0 ? (
            <div className="px-3 py-3 text-xs text-atlas-muted italic">
              {t("profiles.empty")}
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {profiles.map((p) => {
                const isActive = p.name === activeProfile;
                const isRenaming = renaming === p.name;
                return (
                  <li
                    key={p.name}
                    className="flex items-center gap-1 px-2 py-1 hover:bg-atlas-sand/60 group"
                  >
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void confirmRename(p.name);
                          if (e.key === "Escape") {
                            setRenaming(null);
                            setDraftName("");
                          }
                        }}
                        onBlur={() => void confirmRename(p.name)}
                        className="flex-1 min-w-0 px-1.5 py-0.5 text-sm rounded border border-atlas-ink bg-atlas-cream text-atlas-ink focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          void applyProfile(p.name);
                          setOpen(false);
                        }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-1.5 text-sm text-atlas-ink">
                          {isActive && (
                            <Check className="h-3 w-3 text-emerald-700 shrink-0" />
                          )}
                          <span className="truncate">{p.name}</span>
                          <span className="text-[10px] font-mono text-atlas-muted shrink-0">
                            {p.pixelFormat}
                          </span>
                        </div>
                        <div
                          className="text-[10px] text-atlas-muted font-mono truncate"
                          title={p.assetsPath}
                        >
                          {p.assetsPath}
                        </div>
                      </button>
                    )}
                    {!isRenaming && (
                      <div className="flex items-center opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          title={t("profiles.rename")}
                          onClick={() => {
                            setRenaming(p.name);
                            setDraftName(p.name);
                          }}
                          className="p-1 text-atlas-muted hover:text-atlas-ink"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title={t("profiles.delete")}
                          onClick={() => void deleteProfile(p.name)}
                          className="p-1 text-atlas-muted hover:text-rose-700"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-atlas-border p-2">
            {creating ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void confirmCreate();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setDraftName("");
                    }
                  }}
                  placeholder={t("profiles.namePlaceholder")}
                  className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-atlas-ink bg-atlas-cream text-atlas-ink focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void confirmCreate()}
                  className="rounded bg-atlas-ink px-2 py-1 text-xs font-semibold text-atlas-cream hover:bg-atlas-ink-soft"
                >
                  {t("profiles.save")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setDraftName(activeProfile ?? "");
                }}
                className="w-full inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm text-atlas-ink hover:bg-atlas-sand"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("profiles.saveCurrent")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
