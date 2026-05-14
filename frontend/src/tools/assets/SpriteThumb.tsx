import { memo, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { useWorkspace } from "./store";
import { cn } from "../../shared/utils";

/// Module-level data URL cache. Survives every tile mount/unmount
/// cycle, so re-visiting a sprite is a synchronous lookup with no IPC.
/// The backend keeps its own cache too — this one's purpose is purely
/// to skip the IPC round-trip on re-mount.
///
/// Cleared from `clearSpriteUrlCache` when the user opens a new
/// assets bundle or flips the pixel format (sprite_ids may now point
/// at different pixels).
const SPRITE_URL_CACHE = new Map<number, string>();

export function clearSpriteUrlCache(): void {
  SPRITE_URL_CACHE.clear();
}

interface Props {
  id: number;
  /// Side length of the tile in px. The image itself is rendered
  /// with `image-rendering: pixelated` so small sizes still look
  /// crisp.
  size?: number;
  className?: string;
}

/// Lazy sprite renderer keyed by `sprite_id`. First request goes
/// through the Tauri IPC (which the backend memoizes); the URL is
/// then stashed in `SPRITE_URL_CACHE` so every later mount renders
/// synchronously. Wrapped in `React.memo` so parent re-renders don't
/// cascade.
export const SpriteThumb = memo(function SpriteThumb({ id, size = 64, className }: Props) {
  const fetchSpritePng = useWorkspace((s) => s.fetchSpritePng);
  const cacheBust = useWorkspace((s) => s.spriteCacheBust);
  const [url, setUrl] = useState<string | null>(() => SPRITE_URL_CACHE.get(id) ?? null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const cached = SPRITE_URL_CACHE.get(id);
    if (cached) {
      setUrl(cached);
      setErrored(false);
      return;
    }
    let cancelled = false;
    setUrl(null);
    setErrored(false);
    fetchSpritePng(id)
      .then((u) => {
        if (cancelled) return;
        if (u) {
          SPRITE_URL_CACHE.set(id, u);
          setUrl(u);
        } else {
          setErrored(true);
        }
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, fetchSpritePng, cacheBust]);

  const style = { width: size, height: size };
  return (
    <div
      style={style}
      className={cn(
        "rounded border border-atlas-border bg-atlas-paper flex items-center justify-center overflow-hidden shrink-0",
        !url && !errored && "animate-pulse",
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt={`sprite ${id}`}
          className="max-w-full max-h-full"
          style={{ imageRendering: "pixelated" }}
          draggable={false}
        />
      ) : (
        <ImageOff
          className="text-atlas-muted/60"
          style={{ width: size * 0.4, height: size * 0.4 }}
        />
      )}
    </div>
  );
});
