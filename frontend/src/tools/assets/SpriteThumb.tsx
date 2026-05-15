import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  /// One sprite id, or several to cycle through as an animation.
  /// Empty array renders the missing-image placeholder.
  ids: number[];
  /// Per-frame duration in ms, parallel to `ids`. Empty (or shorter
  /// than `ids`) falls back to `DEFAULT_PHASE_MS` for the remainder.
  durationsMs?: number[];
  /// Side length of the tile in px. The image itself is rendered
  /// with `image-rendering: pixelated` so small sizes still look
  /// crisp.
  size?: number;
  className?: string;
}

/// Delay before firing the actual fetch on mount. The virtualizer
/// mounts/unmounts tiles aggressively during fast scroll; tiles that
/// disappear within this window never trigger an IPC call, which
/// keeps the backend's request queue from exploding into the
/// thousands when the user flings the list.
const FETCH_DEBOUNCE_MS = 90;

/// Fallback frame duration when the appearance carries no animation
/// timings (objects with multi-phase initial groups but no
/// SpriteAnimation block, or a malformed file). 180ms keeps the loop
/// recognisable without being distracting.
const DEFAULT_PHASE_MS = 180;

/// Lazy sprite renderer keyed by a list of sprite ids. The first id
/// drives the initial fetch; subsequent ids are fetched lazily as the
/// animation advances. Wrapped in `React.memo` so parent re-renders
/// don't cascade.
export const SpriteThumb = memo(function SpriteThumb({
  ids,
  durationsMs,
  size = 64,
  className,
}: Props) {
  const fetchSpritePng = useWorkspace((s) => s.fetchSpritePng);
  const cacheBust = useWorkspace((s) => s.spriteCacheBust);
  const [phase, setPhase] = useState(0);
  const [urls, setUrls] = useState<(string | null)[]>(() =>
    ids.map((id) => SPRITE_URL_CACHE.get(id) ?? null),
  );
  const [errored, setErrored] = useState(false);

  // `ids` from props is typically a fresh array each render even if
  // contents are unchanged — memoise by stringified key so the fetch
  // effect doesn't re-run on every parent render.
  const idsKey = ids.join(",");
  const stableIds = useMemo(() => ids, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPhase(0);
    setErrored(false);
    setUrls(stableIds.map((id) => SPRITE_URL_CACHE.get(id) ?? null));
    if (stableIds.length === 0) return;

    let cancelled = false;
    const pending = new Set<number>();
    stableIds.forEach((id, idx) => {
      if (SPRITE_URL_CACHE.has(id)) return;
      pending.add(idx);
    });
    if (pending.size === 0) return;

    // Debounce the first fetch the same way as a single-id thumb so
    // a fast scroll doesn't fan out into N×phases IPC calls.
    const timeout = setTimeout(() => {
      if (cancelled) return;
      stableIds.forEach((id, idx) => {
        if (!pending.has(idx)) return;
        fetchSpritePng(id)
          .then((u) => {
            if (cancelled) return;
            if (u) {
              SPRITE_URL_CACHE.set(id, u);
              setUrls((prev) => {
                if (prev[idx] === u) return prev;
                const next = prev.slice();
                next[idx] = u;
                return next;
              });
            } else if (idx === 0) {
              // Only treat a failure on phase 0 as an error indicator —
              // missing later phases just stalls the animation there.
              setErrored(true);
            }
          })
          .catch(() => {
            if (!cancelled && idx === 0) setErrored(true);
          });
      });
    }, FETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [stableIds, fetchSpritePng, cacheBust]);

  // Drive the animation phase off a stable interval. Re-enter every
  // time the cycle length or per-phase duration changes.
  const durationsKey = (durationsMs ?? []).join(",");
  const phaseRef = useRef(0);
  phaseRef.current = phase;
  useEffect(() => {
    if (stableIds.length <= 1) return;
    let cancelled = false;
    const schedule = () => {
      const current = phaseRef.current;
      const ms = durationsMs?.[current] ?? DEFAULT_PHASE_MS;
      const timeout = setTimeout(() => {
        if (cancelled) return;
        setPhase((p) => (p + 1) % stableIds.length);
        schedule();
      }, Math.max(40, ms));
      return timeout;
    };
    const handle = schedule();
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableIds, durationsKey]);

  const activeUrl = urls[phase] ?? urls[0] ?? null;
  const stillLoading = activeUrl === null && !errored;

  const style = { width: size, height: size };
  return (
    <div
      style={style}
      className={cn(
        "rounded border border-atlas-border bg-atlas-paper flex items-center justify-center overflow-hidden shrink-0",
        stillLoading && "animate-pulse",
        className,
      )}
    >
      {activeUrl ? (
        <img
          src={activeUrl}
          alt={`sprite ${stableIds[phase] ?? stableIds[0]}`}
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
