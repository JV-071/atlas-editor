/// One shared animation clock for every `SpriteThumb`.
///
/// Before this, each animated thumbnail ran its own recursive
/// `setTimeout` chain — a screen of outfit rows meant dozens of
/// independent timers all waking the event loop. This collapses them
/// into a single `setInterval` that ticks while at least one subscriber
/// is mounted and stops itself when the last one leaves.
///
/// Subscribers derive their current phase from the absolute elapsed
/// time (prefix-summed durations, looped) rather than accumulating per
/// tick, so a coarse tick can't drift the animation.

type Subscriber = (nowMs: number) => void;

const subscribers = new Set<Subscriber>();
let handle: ReturnType<typeof setInterval> | null = null;

/// Tick cadence. 60ms is fine: sprite phase durations are ~100ms+, and
/// the phase is computed from absolute time so the tick only controls
/// how often we *check*, not animation accuracy.
const TICK_MS = 60;

function tick() {
  const now = performance.now();
  for (const sub of subscribers) sub(now);
}

export function subscribeSpriteClock(sub: Subscriber): () => void {
  subscribers.add(sub);
  if (handle === null) {
    handle = setInterval(tick, TICK_MS);
  }
  return () => {
    subscribers.delete(sub);
    if (subscribers.size === 0 && handle !== null) {
      clearInterval(handle);
      handle = null;
    }
  };
}

/// Phase index for a cycle of `count` frames at absolute time
/// `elapsedMs`, honoring per-frame `durationsMs` (falls back to
/// `defaultMs` for any missing/zero entry). Pure — no per-thumb state.
export function phaseForElapsed(
  elapsedMs: number,
  count: number,
  durationsMs: number[] | undefined,
  defaultMs: number,
): number {
  if (count <= 1) return 0;
  let total = 0;
  const dur: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const d = durationsMs?.[i];
    dur[i] = d && d > 0 ? Math.max(40, d) : defaultMs;
    total += dur[i];
  }
  if (total <= 0) return 0;
  let t = elapsedMs % total;
  for (let i = 0; i < count; i++) {
    if (t < dur[i]) return i;
    t -= dur[i];
  }
  return count - 1;
}
