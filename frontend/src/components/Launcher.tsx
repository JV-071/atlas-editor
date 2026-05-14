import { useEffect } from "react";
import { FileText, FolderOpen, ImagePlus } from "lucide-react";

import { useWorkspace } from "../stores/workspace";
import { cn } from "../lib/utils";

function basename(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

interface CardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}

function Card({ icon, title, subtitle, onClick, disabled }: CardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex flex-col items-center justify-center gap-2 rounded-lg border p-5 text-center transition-all",
        "border-atlas-border bg-atlas-paper hover:border-atlas-ink hover:shadow-sm",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <div className="text-atlas-ink">{icon}</div>
      <div className="text-base font-semibold text-atlas-ink">{title}</div>
      <div className="text-xs text-atlas-muted leading-snug">{subtitle}</div>
    </button>
  );
}

export function Launcher() {
  const status = useWorkspace((s) => s.status);
  const error = useWorkspace((s) => s.error);
  const recent = useWorkspace((s) => s.recent);
  const pickAssetsBundle = useWorkspace((s) => s.pickAssetsBundle);
  const openOtbPicker = useWorkspace((s) => s.openOtbPicker);
  const openOtbPath = useWorkspace((s) => s.openOtbPath);
  const refreshRecent = useWorkspace((s) => s.refreshRecent);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  const recentAssetsPaths = recent.appearances
    .map((p) => {
      // Recent `.dat` paths live inside the assets folder; surface
      // the containing directory as the launcher option so the user
      // can jump straight back into a bundle.
      const cleaned = p.replace(/\\/g, "/");
      const idx = cleaned.lastIndexOf("/");
      return idx === -1 ? cleaned : cleaned.slice(0, idx);
    })
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .slice(0, 4);

  return (
    <main className="h-screen w-screen flex flex-col items-center justify-center bg-atlas-cream text-atlas-ink p-6">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Atlas Assets Editor</h1>
        <p className="text-xs text-atlas-muted mt-1">
          Tibia 12+/15.x · appearances.dat ⇄ items.otb
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
        <Card
          icon={<ImagePlus className="h-8 w-8" />}
          title="Open assets"
          subtitle="Folder with catalog-content.json (sprites + appearances)"
          onClick={() => void pickAssetsBundle()}
          disabled={status === "loading"}
        />
        <Card
          icon={<FileText className="h-8 w-8" />}
          title="Open items.otb"
          subtitle="Legacy or Atlas-extended OTB file"
          onClick={() => void openOtbPicker()}
          disabled={status === "loading"}
        />
      </div>

      {(recentAssetsPaths.length > 0 || recent.otb.length > 0) && (
        <section className="mt-6 w-full max-w-lg">
          <h2 className="text-[10px] uppercase tracking-wider text-atlas-muted font-semibold mb-2">
            Recent
          </h2>
          <ul className="space-y-0.5 text-sm">
            {recentAssetsPaths.map((dir) => (
              <li key={`assets-${dir}`}>
                <button
                  type="button"
                  onClick={() => {
                    // Re-enter via the bundle path which also picks up the
                    // appearances.dat referenced by the catalog.
                    const { openAssetsBundlePath } = useWorkspace.getState();
                    void openAssetsBundlePath(dir);
                  }}
                  title={dir}
                  className="w-full text-left flex items-baseline gap-2 px-2 py-1 rounded hover:bg-atlas-sand"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 self-center text-atlas-muted" />
                  <span className="text-atlas-ink shrink-0">{basename(dir)}</span>
                  <span className="text-xs text-atlas-muted truncate">{dir}</span>
                </button>
              </li>
            ))}
            {recent.otb.slice(0, 4).map((p) => (
              <li key={`otb-${p}`}>
                <button
                  type="button"
                  onClick={() => void openOtbPath(p)}
                  title={p}
                  className="w-full text-left flex items-baseline gap-2 px-2 py-1 rounded hover:bg-atlas-sand"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 self-center text-atlas-muted" />
                  <span className="text-atlas-ink shrink-0">{basename(p)}</span>
                  <span className="text-xs text-atlas-muted truncate">{p}</span>
                </button>
              </li>
            ))}
          </ul>
          {recent.appearances.some((p) => {
            const cleaned = p.replace(/\\/g, "/");
            const dir = cleaned.slice(0, cleaned.lastIndexOf("/"));
            return !recentAssetsPaths.includes(dir);
          }) && (
            <p className="text-[10px] text-atlas-muted mt-2 italic">
              Older entries hidden — open from "Open assets" to refresh the list.
            </p>
          )}
        </section>
      )}

      {status === "loading" && (
        <p className="mt-4 text-sm text-amber-700">Loading…</p>
      )}
      {error && (
        <p className="mt-4 text-sm text-rose-700 max-w-lg text-center">{error}</p>
      )}

      <footer className="mt-auto text-[10px] text-atlas-muted">
        Open standalone <button
          type="button"
          onClick={() => {
            const { openAppearancesPicker } = useWorkspace.getState();
            void openAppearancesPicker();
          }}
          className="underline hover:text-atlas-ink"
        >
          appearances.dat
        </button> · Phase 6
      </footer>
    </main>
  );
}
