import { beforeEach, describe, expect, it, vi } from "vitest";

const limitMock = vi.fn();

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn().mockReturnValue({}) },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(function MockRatelimit() {
      return { limit: limitMock };
    }),
    { fixedWindow: vi.fn().mockReturnValue({}) },
  ),
}));

const { createUpstashRateLimiter } = await import("@/lib/rateLimit/upstashLimiter");

beforeEach(() => {
  limitMock.mockReset();
});

describe("createUpstashRateLimiter", () => {
  it("allows when the backend reports success", async () => {
    limitMock.mockResolvedValueOnce({ success: true, reset: Date.now() + 60_000 });
    const limiter = createUpstashRateLimiter();

    const result = await limiter.check("some-key");

    expect(result.allowed).toBe(true);
  });

  it("rejects when the backend reports the limit was exceeded", async () => {
    limitMock.mockResolvedValueOnce({ success: false, reset: Date.now() + 45_000 });
    const limiter = createUpstashRateLimiter();

    const result = await limiter.check("some-key");

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("FAILS CLOSED when the backend is unreachable", async () => {
    limitMock.mockRejectedValueOnce(new Error("network error"));
    const limiter = createUpstashRateLimiter();

    const result = await limiter.check("some-key");

    // This is the critical cost-protection behavior: an unreachable rate
    // limiter must never be treated as "unlimited allowed".
    expect(result.allowed).toBe(false);
  });
});
