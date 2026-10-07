import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const setMock = vi.fn();

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn().mockImplementation(() => ({ get: getMock, set: setMock })) },
}));

beforeEach(() => {
  vi.resetModules();
  getMock.mockReset();
  setMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pipeline cache", () => {
  it("no-ops (returns null, never calls Redis) when Upstash isn't configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", undefined);
    const { getCachedIngestion, setCachedIngestion } = await import("@/lib/pipeline/cache");

    expect(await getCachedIngestion("abc")).toBeNull();
    await setCachedIngestion("abc", { caption: "x" });
    expect(getMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("reads and writes through Redis when configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    getMock.mockResolvedValue({ caption: "cached" });
    const { getCachedIngestion, setCachedIngestion } = await import("@/lib/pipeline/cache");

    const result = await getCachedIngestion("abc");
    expect(result).toEqual({ caption: "cached" });
    expect(getMock).toHaveBeenCalledWith("unpack:ingest:abc");

    await setCachedIngestion("abc", { caption: "new" });
    expect(setMock).toHaveBeenCalledWith("unpack:ingest:abc", { caption: "new" }, { ex: expect.any(Number) });
  });

  it("degrades gracefully (returns null) when Redis read throws", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    getMock.mockRejectedValue(new Error("network error"));
    const { getCachedIngestion } = await import("@/lib/pipeline/cache");

    expect(await getCachedIngestion("abc")).toBeNull();
  });

  it("normalizes search-query cache keys (case/whitespace insensitive)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const { getCachedSearch } = await import("@/lib/pipeline/cache");

    await getCachedSearch("github", "  Excalidraw  ");
    expect(getMock).toHaveBeenCalledWith("unpack:search:github:excalidraw");
  });
});
