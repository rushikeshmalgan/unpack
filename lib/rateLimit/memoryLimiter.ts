import type { RateLimiter } from "@/lib/rateLimit/types";
import { RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS } from "@/lib/rateLimit/types";

// Per-process, in-memory only — resets on deploy/restart and does not share
// state across instances. Fine for a single long-running process (local dev,
// a single container); unsafe as the *only* limiter across multiple
// instances, which is why the redis backend exists (see getRateLimiter.ts).
const WINDOW_MS = RATE_LIMIT_WINDOW_SECONDS * 1000;

export function createMemoryRateLimiter(): RateLimiter {
  const buckets = new Map<string, { count: number; windowStart: number }>();

  return {
    async check(key: string) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
        buckets.set(key, { count: 1, windowStart: now });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000),
        };
      }

      bucket.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
