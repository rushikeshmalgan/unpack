import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, rateLimitKey } from "@/lib/rateLimit/keyDerivation";

describe("clientIpFromHeaders", () => {
  it("reads the first address from x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.9" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});

describe("rateLimitKey", () => {
  it("is deterministic for the same IP", () => {
    expect(rateLimitKey("203.0.113.5")).toBe(rateLimitKey("203.0.113.5"));
  });

  it("differs for different IPs", () => {
    expect(rateLimitKey("203.0.113.5")).not.toBe(rateLimitKey("203.0.113.6"));
  });

  it("never contains the raw IP string (privacy minimization)", () => {
    const ip = "203.0.113.5";
    expect(rateLimitKey(ip)).not.toContain(ip);
  });
});
