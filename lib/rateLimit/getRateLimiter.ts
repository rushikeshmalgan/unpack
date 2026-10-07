import type { RateLimiter } from "@/lib/rateLimit/types";
import { createMemoryRateLimiter } from "@/lib/rateLimit/memoryLimiter";
import { createUpstashRateLimiter } from "@/lib/rateLimit/upstashLimiter";

let cached: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  if (cached) return cached;

  const backend = (process.env.RATE_LIMIT_BACKEND ?? "memory").toLowerCase();
  cached = backend === "redis" ? createUpstashRateLimiter() : createMemoryRateLimiter();
  return cached;
}
