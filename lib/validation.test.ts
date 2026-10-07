import { describe, expect, it } from "vitest";
import { MAX_URL_LENGTH, describeUrlError, validateInstagramUrl } from "@/lib/validation";

describe("validateInstagramUrl", () => {
  it.each([
    ["https://www.instagram.com/reel/C1a2B3c4D5E/", "reel"],
    ["https://instagram.com/reel/C1a2B3c4D5E/", "reel"],
    ["https://www.instagram.com/reels/C1a2B3c4D5E/", "reel"],
    ["https://www.instagram.com/p/C1a2B3c4D5E/", "post"],
    ["https://www.instagram.com/tv/C1a2B3c4D5E/", "reel"],
    ["https://instagr.am/p/C1a2B3c4D5E/", "post"],
    // no trailing slash, with query params
    ["https://www.instagram.com/reel/C1a2B3c4D5E?igsh=abc123", "reel"],
    // uppercase host
    ["https://WWW.INSTAGRAM.COM/reel/C1a2B3c4D5E/", "reel"],
  ])("accepts %s as a valid %s link", (url, expectedType) => {
    const result = validateInstagramUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe(expectedType);
      expect(result.normalizedUrl).toMatch(/^https:\/\/www\.instagram\.com\//);
    }
  });

  it("normalizes to the canonical https://www.instagram.com host regardless of input host variant", () => {
    const result = validateInstagramUrl("https://instagr.am/p/C1a2B3c4D5E/");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalizedUrl).toBe("https://www.instagram.com/p/C1a2B3c4D5E/");
  });

  it("rejects an empty string", () => {
    const result = validateInstagramUrl("");
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a whitespace-only string", () => {
    const result = validateInstagramUrl("   ");
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a string longer than MAX_URL_LENGTH", () => {
    const longUrl = "https://www.instagram.com/reel/" + "a".repeat(MAX_URL_LENGTH);
    const result = validateInstagramUrl(longUrl);
    expect(result).toEqual({ ok: false, reason: "too_long" });
  });

  it("rejects a non-URL string", () => {
    const result = validateInstagramUrl("not a url at all");
    expect(result).toEqual({ ok: false, reason: "not_a_url" });
  });

  it("rejects non-http(s) protocols", () => {
    expect(validateInstagramUrl("ftp://www.instagram.com/reel/abc/")).toEqual({
      ok: false,
      reason: "not_a_url",
    });
    expect(validateInstagramUrl("javascript:alert(1)")).toEqual({ ok: false, reason: "not_a_url" });
  });

  // --- SSRF-relevant bypass attempts: these must ALL be rejected, whatever
  // the specific reason (what matters for security is ok === false) ---
  it.each([
    "https://www.instagram.com@evil.com/reel/abc/", // userinfo trick
    "https://www.instagram.com.evil.com/reel/abc/", // subdomain-suffix trick
    "https://evil.com/?x=instagram.com/reel/abc", // query-string trick
    "http://169.254.169.254/reel/abc/", // cloud metadata IP
    "http://localhost:3000/reel/abc/", // localhost
    "http://127.0.0.1/reel/abc/", // loopback
    "https://xn--instagram-fake.com/reel/abc/", // lookalike/invalid punycode domain
  ])("rejects SSRF bypass attempt: %s", (url) => {
    expect(validateInstagramUrl(url).ok).toBe(false);
  });

  it("rejects the userinfo/subdomain/query tricks specifically via unsupported_host", () => {
    for (const url of [
      "https://www.instagram.com@evil.com/reel/abc/",
      "https://www.instagram.com.evil.com/reel/abc/",
      "https://evil.com/?x=instagram.com/reel/abc",
      "http://169.254.169.254/reel/abc/",
      "http://localhost:3000/reel/abc/",
      "http://127.0.0.1/reel/abc/",
    ]) {
      const result = validateInstagramUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("unsupported_host");
    }
  });

  it("rejects a valid Instagram host with an unsupported path (e.g. profile page)", () => {
    const result = validateInstagramUrl("https://www.instagram.com/someusername/");
    expect(result).toEqual({ ok: false, reason: "unsupported_path" });
  });

  it("rejects the bare host with no path", () => {
    const result = validateInstagramUrl("https://www.instagram.com/");
    expect(result).toEqual({ ok: false, reason: "unsupported_path" });
  });

  it("rejects a reel/post path with no shortcode", () => {
    const result = validateInstagramUrl("https://www.instagram.com/reel/");
    expect(result).toEqual({ ok: false, reason: "unsupported_path" });
  });
});

describe("describeUrlError", () => {
  it("returns a distinct, non-empty message for every reason", () => {
    const reasons = ["empty", "too_long", "not_a_url", "unsupported_host", "unsupported_path"] as const;
    const messages = reasons.map(describeUrlError);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });
});
