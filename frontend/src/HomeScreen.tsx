import { useEffect } from "react";
import { ArrowRight, FileCog, ImagePlus, Map } from "lucide-react";

import logoUrl from "./shared/logo.png";
import { cn } from "./shared/utils";
import { useApp, type Tool } from "./appStore";
import { resizeWindow } from "./tools/assets/store";

interface TileProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: { label: string; tone: "active" | "muted" };
  onClick: () => void;
  disabled?: boolean;
}

function Tile({ icon, title, description, badge, onClick, disabled }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all",
        "border-atlas-border bg-atlas-paper",
        disabled
          ? "opacity-60 cursor-not-allowed"
          : "hover:border-atlas-ink hover:shadow-md hover:-translate-y-0.5",
      )}
    >
      <div className="flex w-full items-start justify-between">
        <div className="rounded-lg border border-atlas-border bg-atlas-cream p-2.5 text-atlas-ink">
          {icon}
        </div>
        {badge && (
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded",
              badge.tone === "active"
                ? "text-emerald-800 bg-emerald-700/10"
                : "text-atlas-muted bg-atlas-sand",
            )}
          >
            {badge.label}
          </span>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-atlas-ink">{title}</h3>
        <p className="text-xs text-atlas-muted leading-snug">{description}</p>
      </div>
      {!disabled && (
        <span className="mt-auto inline-flex items-center gap-1 text-[11px] text-atlas-muted group-hover:text-atlas-ink">
          Open
          <ArrowRight className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

export function HomeScreen() {
  const setTool = useApp((s) => s.setTool);

  // Compact window on the home screen; tools resize on entry.
  useEffect(() => {
    void resizeWindow("launcher-empty");
  }, []);

  function open(tool: Tool) {
    setTool(tool);
  }

  return (
    <main className="h-screen w-screen flex flex-col items-center bg-atlas-cream text-atlas-ink p-6 overflow-y-auto">
      <header className="mb-6 flex flex-col items-center shrink-0">
        <div className="mb-3 rounded-2xl border border-atlas-border bg-atlas-paper p-3 shadow-sm ring-1 ring-atlas-ink/5">
          <img
            src={logoUrl}
            alt="Atlas"
            className="h-14 w-14 object-contain select-none"
            draggable={false}
          />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Atlas Editor</h1>
        <p className="text-xs text-atlas-muted mt-0.5">
          Tibia 12+/15.x suite · pick a tool to begin
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl">
        <Tile
          icon={<Map className="h-6 w-6" />}
          title="Map Editor"
          description="Edit .otbm world maps."
          badge={{ label: "Em breve", tone: "muted" }}
          onClick={() => {}}
          disabled
        />
        <Tile
          icon={<ImagePlus className="h-6 w-6" />}
          title="Assets Editor"
          description="Open a client assets bundle and edit appearances, sprites, and item attributes."
          badge={{ label: "Ready", tone: "active" }}
          onClick={() => open("assets")}
        />
        <Tile
          icon={<FileCog className="h-6 w-6" />}
          title="OTB Converter"
          description="Turn a legacy items.otb (plus client .dat/.spr) into a modern Tibia 12+ assets bundle."
          badge={{ label: "Beta", tone: "muted" }}
          onClick={() => open("converter")}
        />
      </div>

      <footer className="mt-auto pt-6 text-[10px] text-atlas-muted">
        Atlas Editor · v0.1.0
      </footer>
    </main>
  );
}
