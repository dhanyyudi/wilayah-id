export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds at which the current window ends. */
  resetAt: number;
}

interface WindowEntry {
  windowStart: number;
  windowMs: number;
  count: number;
}

/**
 * In-memory fixed-window counter. State lives in one server process, which
 * matches the single-container origin deployment; counters reset on restart.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, WindowEntry>();

  constructor(private readonly maxEntries = 50_000) {}

  take(
    bucket: string,
    limit: number,
    windowMs: number,
    now: number,
  ): RateLimitResult {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;
    const key = `${windowMs}|${bucket}`;
    let entry = this.windows.get(key);

    if (!entry || entry.windowStart !== windowStart) {
      if (!entry && this.windows.size >= this.maxEntries) {
        this.prune(now);
      }
      entry = { windowStart, windowMs, count: 0 };
      this.windows.set(key, entry);
    }

    if (entry.count >= limit) {
      return { allowed: false, limit, remaining: 0, resetAt };
    }
    entry.count += 1;
    return { allowed: true, limit, remaining: limit - entry.count, resetAt };
  }

  /** Drop finished windows, then the oldest entries if still over capacity. */
  prune(now: number): void {
    for (const [key, entry] of this.windows) {
      if (entry.windowStart + entry.windowMs <= now) {
        this.windows.delete(key);
      }
    }
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxEntries) {
        break;
      }
      this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

const GLOBAL_LIMITER = Symbol.for("wilayah-id.access.limiter");

/** One limiter per process, shared across separately bundled entry points. */
export function getSharedLimiter(): FixedWindowLimiter {
  const store = globalThis as typeof globalThis & {
    [GLOBAL_LIMITER]?: FixedWindowLimiter;
  };
  store[GLOBAL_LIMITER] ??= new FixedWindowLimiter();
  return store[GLOBAL_LIMITER];
}
