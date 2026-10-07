import { describe, expect, it } from "vitest";
import { enforceRateLimit } from "@/lib/rateLimit/enforce";

function requestFrom(ip: string): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: "{}",
  });
}

describe("enforceRateLimit", () => {
  it("allows the first request through (returns null)", async () => {
    const response = await enforceRateLimit(requestFrom("203.0.113.10"));
    expect(response).toBeNull();
  });

  it("shares one counter across what would be analyze/explain/steps calls from the same IP", async () => {
    const ip = "203.0.113.20";
    // Simulate 12 calls that could be any mix of the three routes — the
    // function takes no route identifier at all, so there's no way for it
    // to key them separately.
    const results = [];
    for (let i = 0; i < 13; i++) {
      results.push(await enforceRateLimit(requestFrom(ip)));
    }

    const allowedCount = results.filter((r) => r === null).length;
    const blockedCount = results.filter((r) => r !== null).length;

    expect(allowedCount).toBe(12);
    expect(blockedCount).toBe(1);
    expect(results[12]?.status).toBe(429);
  });

  it("gives a different IP its own independent budget", async () => {
    const exhaustedIp = "203.0.113.30";
    for (let i = 0; i < 12; i++) {
      await enforceRateLimit(requestFrom(exhaustedIp));
    }
    expect((await enforceRateLimit(requestFrom(exhaustedIp)))?.status).toBe(429);

    const freshIp = "203.0.113.31";
    expect(await enforceRateLimit(requestFrom(freshIp))).toBeNull();
  });
});
