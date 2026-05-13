import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { useWorkspace } from "../stores/workspace";
import { cn } from "../lib/utils";

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
  }, [spriteIds, fetchSpritePng, assetsDir]);

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

  return (
    <div className="flex flex-wrap gap-2">
      {spriteIds.map((id, i) => {
        const url = images[i];
        return (
          <div
            key={`${id}-${i}`}
            className={cn(
              "relative w-16 h-16 rounded border border-atlas-border bg-atlas-paper flex items-center justify-center overflow-hidden",
              loading && !url && "animate-pulse",
            )}
            title={`sprite ${id}`}
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
            <span className="absolute bottom-0.5 right-1 text-[9px] text-atlas-muted font-mono bg-atlas-paper/80 px-1 rounded">
              {id}
            </span>
          </div>
        );
      })}
    </div>
  );
}
