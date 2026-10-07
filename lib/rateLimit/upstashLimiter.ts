import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { RateLimiter } from "@/lib/rateLimit/types";
import { RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS } from "@/lib/rateLimit/types";

export function createUpstashRateLimiter(): RateLimiter {
  const redis = Redis.fromEnv();
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(RATE_LIMIT_MAX_REQUESTS, `${RATE_LIMIT_WINDOW_SECONDS} s`),
    prefix: "reeldecoder:ratelimit",
    analytics: false,
  });

  return {
    async check(key: string) {
      try {
        const result = await ratelimit.limit(key);
        return {
          allowed: result.success,
          retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
        };
      } catch (err) {
        // Fail CLOSED: this endpoint triggers a paid AI call, so if we can't
        // confirm the caller is under their limit, we don't guess "allow".
        console.error("[upstashLimiter] rate-limit backend unreachable, failing closed:", err);
        return { allowed: false, retryAfterSeconds: 30 };
      }
    },
  };
}
