import { ArrowLeft, Map as MapIcon } from "lucide-react";

import { useApp } from "../../appStore";
import logoUrl from "../../shared/logo.png";

export function MapScreen() {
  const setTool = useApp((s) => s.setTool);
  return (
    <main className="h-screen w-screen flex flex-col items-center justify-center bg-atlas-cream text-atlas-ink p-6">
      <button
        type="button"
        onClick={() => setTool("home")}
        className="absolute top-5 left-5 inline-flex items-center gap-1 text-xs text-atlas-muted hover:text-atlas-ink"
      >
        <ArrowLeft className="h-3 w-3" />
        Atlas Editor
      </button>

      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <div className="rounded-2xl border border-atlas-border bg-atlas-paper p-4 shadow-sm ring-1 ring-atlas-ink/5">
          <img
            src={logoUrl}
            alt="Atlas"
            className="h-14 w-14 object-contain select-none"
            draggable={false}
          />
        </div>
        <h1 className="text-2xl font-bold tracking-tight inline-flex items-center gap-2">
          <MapIcon className="h-6 w-6" />
          Map Editor
        </h1>
        <p className="text-sm text-atlas-muted">
          Em breve — edição de mapas <code>.otbm</code> com camadas, paleta de
          tiles, e cross-reference com o catálogo de items.
        </p>
        <button
          type="button"
          onClick={() => setTool("home")}
          className="mt-2 rounded px-4 py-2 text-sm font-medium border border-atlas-border bg-atlas-paper hover:bg-atlas-sand"
        >
          Back to Atlas Editor
        </button>
      </div>
    </main>
  );
}
