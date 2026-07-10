/**
 * Sliding Window Rate Limiter
 *
 * Tracks request timestamps per key and enforces a maximum number of
 * requests within a rolling time window.
 *
 * Usage:
 *   const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 20 });
 *   const result = limiter.allow(key);
 *   if (!result.allowed) {
 *     // Return 429 with Retry-After header
 *   }
 */

export interface RateLimiterOptions {
  /** Window size in milliseconds (default: 60_000) */
  windowMs?: number;
  /** Maximum requests per key within the window (default: 20) */
  maxRequests?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the oldest request in the window expires (0 if allowed) */
  retryAfterMs: number;
  /** Current request count in the window */
  currentCount: number;
  /** Maximum requests allowed in the window */
  maxRequests: number;
}

export class SlidingWindowRateLimiter {
  private windowMs: number;
  private maxRequests: number;
  /** key → array of request timestamps */
  private windows = new Map<string, number[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RateLimiterOptions = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxRequests = opts.maxRequests ?? 20;
  }

  /**
   * Check if a request is allowed for the given key.
   * Automatically cleans up expired entries.
   */
  allow(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get or create the timestamp window for this key
    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Prune expired timestamps
    timestamps = timestamps.filter(t => t > windowStart);
    this.windows.set(key, timestamps);

    const currentCount = timestamps.length;

    if (currentCount < this.maxRequests) {
      timestamps.push(now);
      return {
        allowed: true,
        retryAfterMs: 0,
        currentCount: currentCount + 1,
        maxRequests: this.maxRequests,
      };
    }

    // Denied — calculate retry-after from the oldest timestamp in the window
    const oldestInWindow = timestamps[0] ?? now;
    const retryAfterMs = oldestInWindow + this.windowMs - now;

    return {
      allowed: false,
      retryAfterMs: Math.max(0, retryAfterMs),
      currentCount,
      maxRequests: this.maxRequests,
    };
  }

  /** Reset all windows (useful for testing or admin flush) */
  reset(key?: string): void {
    if (key) {
      this.windows.delete(key);
    } else {
      this.windows.clear();
    }
  }

  /** Periodic cleanup of expired windows */
  startAutoCleanup(intervalMs = 60_000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const windowStart = now - this.windowMs;
      for (const [key, timestamps] of this.windows) {
        const filtered = timestamps.filter(t => t > windowStart);
        if (filtered.length === 0) {
          this.windows.delete(key);
        } else {
          this.windows.set(key, filtered);
        }
      }
    }, intervalMs);
    // Don't prevent process exit
    if (this.cleanupTimer && typeof (this.cleanupTimer as unknown as { unref?: () => void }).unref === "function") {
      (this.cleanupTimer as unknown as { unref: () => void }).unref();
    }
  }

  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
