import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateEnvironment } from "@/lib/config/validateEnv";

const ENV_KEYS = [
  "NODE_ENV",
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "RATE_LIMIT_BACKEND",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "AI_FALLBACK_PROVIDER",
] as const;

beforeEach(() => {
  for (const k of ENV_KEYS) vi.stubEnv(k, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateEnvironment", () => {
  it("passes in development with nothing configured (in-memory limiter, no key required)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => validateEnvironment()).not.toThrow();
  });

  it("throws in production when AI_PROVIDER is gemini (default) and GEMINI_API_KEY is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => validateEnvironment()).toThrow(/GEMINI_API_KEY/);
  });

  it("passes in production when GEMINI_API_KEY is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "a-real-key");
    expect(() => validateEnvironment()).not.toThrow();
  });

  it("throws when RATE_LIMIT_BACKEND=redis but Upstash credentials are missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "a-real-key");
    vi.stubEnv("RATE_LIMIT_BACKEND", "redis");
    expect(() => validateEnvironment()).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it("passes when RATE_LIMIT_BACKEND=redis and both Upstash vars are set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "a-real-key");
    vi.stubEnv("RATE_LIMIT_BACKEND", "redis");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    expect(() => validateEnvironment()).not.toThrow();
  });

  it("does not throw in production with the in-memory backend, only warns", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "a-real-key");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => validateEnvironment()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("never includes a secret value in the thrown error message", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_BACKEND", "redis");
    vi.stubEnv("GEMINI_API_KEY", "super-secret-value-should-not-leak");

    try {
      validateEnvironment();
    } catch (err) {
      expect(String(err)).not.toContain("super-secret-value-should-not-leak");
    }
  });
});
