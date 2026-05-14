import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ImageOff, Search } from "lucide-react";

import { useWorkspace } from "./store";
import { cn } from "../../shared/utils";

interface Props {
  spriteIds: number[];
}

/// Lazy sprite renderer. Issues one IPC per sprite id whenever the
/// component mounts or `spriteIds` changes; results are cached at the
/// `Atlas` level on the backend so re-renders are cheap. Errors per
/// sprite are surfaced inline and do not poison the whole strip.
export function SpritePreview({ spriteIds }: Props) {
  const fetchSpritePng = useWorkspace((s) => s.fetchSpritePng);
  const assetsDir = useWorkspace((s) => s.assetsDir);
  const cacheBust = useWorkspace((s) => s.spriteCacheBust);
  const [images, setImages] = useState<(string | null)[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assetsDir) {
      setImages(new Array(spriteIds.length).fill(null));
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(spriteIds.map((id) => fetchSpritePng(id).catch(() => null)))
      .then((urls) => {
        if (!cancelled) {
          setImages(urls);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // cacheBust is intentional — bumping it forces a refetch after a
    // pixel-format change without the parent re-mounting.
  }, [spriteIds, fetchSpritePng, assetsDir, cacheBust]);

  if (spriteIds.length === 0) {
    return (
      <div className="text-xs text-atlas-muted italic">No sprite ids on this appearance.</div>
    );
  }

  if (!assetsDir) {
    return (
      <div className="text-xs text-atlas-muted italic">
        Set the client's <code>assets/</code> directory in the toolbar to render sprites.
      </div>
    );
  }

  async function inspect(id: number) {
    try {
      const info = await invoke("inspect_sprite", { spriteId: id });
      // Pretty-print to the JS console so the user can copy from DevTools.
      console.log("sprite inspection", info);
      // Also surface a copy-friendly summary in an alert as a fallback
      // (DevTools may not be open in a packaged build).
      const json = JSON.stringify(info, null, 2);
      alert(`Sprite ${id} inspection (copy this back):\n\n${json}`);
    } catch (e) {
      alert(`inspect failed: ${e}`);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {spriteIds.map((id, i) => {
        const url = images[i];
        return (
          <div
            key={`${id}-${i}`}
            className="flex flex-col items-center gap-1"
            title={`sprite_id ${id}`}
          >
            <div
              className={cn(
                "relative w-16 h-16 rounded border border-atlas-border bg-atlas-paper flex items-center justify-center overflow-hidden group",
                loading && !url && "animate-pulse",
              )}
            >
              {url ? (
                <img
                  src={url}
                  alt={`sprite ${id}`}
                  className="max-w-full max-h-full"
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                <ImageOff className="h-5 w-5 text-atlas-muted/60" />
              )}
              <button
                type="button"
                onClick={() => void inspect(id)}
                title="Inspect sheet bytes"
                className="absolute top-0.5 left-0.5 p-0.5 rounded bg-atlas-paper/80 text-atlas-muted opacity-0 group-hover:opacity-100 hover:text-atlas-ink"
              >
                <Search className="h-3 w-3" />
              </button>
            </div>
            <span className="text-[10px] text-atlas-muted font-mono tabular-nums">
              {id}
            </span>
          </div>
        );
      })}
    </div>
  );
}
