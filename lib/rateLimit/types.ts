export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const RATE_LIMIT_MAX_REQUESTS = 12;
