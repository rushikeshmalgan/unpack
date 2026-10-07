import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRateLimiter } from "@/lib/rateLimit/memoryLimiter";

describe("createMemoryRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first request", async () => {
    const limiter = createMemoryRateLimiter();
    const result = await limiter.check("ip-a");
    expect(result.allowed).toBe(true);
  });

  it("allows exactly 12 requests then rejects the 13th", async () => {
    const limiter = createMemoryRateLimiter();
    const results = [];
    for (let i = 0; i < 13; i++) {
      results.push(await limiter.check("ip-a"));
    }
    expect(results.slice(0, 12).every((r) => r.allowed)).toBe(true);
    expect(results[12].allowed).toBe(false);
    expect(results[12].retryAfterSeconds).toBeGreaterThan(0);
  });

  it("gives different IPs independent limits", async () => {
    const limiter = createMemoryRateLimiter();
    for (let i = 0; i < 12; i++) {
      await limiter.check("ip-a");
    }
    const blocked = await limiter.check("ip-a");
    const otherIp = await limiter.check("ip-b");

    expect(blocked.allowed).toBe(false);
    expect(otherIp.allowed).toBe(true);
  });

  it("resets the window after 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const limiter = createMemoryRateLimiter();
    for (let i = 0; i < 12; i++) {
      await limiter.check("ip-a");
    }
    expect((await limiter.check("ip-a")).allowed).toBe(false);

    vi.setSystemTime(60_001);
    expect((await limiter.check("ip-a")).allowed).toBe(true);
  });

  it("handles concurrent requests without over-admitting", async () => {
    const limiter = createMemoryRateLimiter();
    const results = await Promise.all(Array.from({ length: 15 }, () => limiter.check("ip-concurrent")));
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(12);
  });
});
