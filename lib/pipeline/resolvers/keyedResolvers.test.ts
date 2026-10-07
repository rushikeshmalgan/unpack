import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { youtubeResolver } from "@/lib/pipeline/resolvers/youtubeResolver";
import { webSearchResolver } from "@/lib/pipeline/resolvers/webSearchResolver";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

function fixturePointer(overrides: Partial<Pointer> = {}): Pointer {
  return {
    id: "p1",
    kind: "explicit",
    resourceType: "video",
    name: "system design crash course",
    attributes: { creator: null, year: null, topic: null, language: null, location: null, visibleUrl: null, price: null },
    evidence: [],
    confidence: 0.9,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", undefined);
  vi.stubEnv("TAVILY_API_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("youtubeResolver", () => {
  it("returns an empty array without crashing when no API key is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const results = await youtubeResolver.search(fixturePointer(), {});
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses a real-shaped search response and builds the correct watch URL", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      items: [{ id: { videoId: "abc123" }, snippet: { title: "System Design Crash Course", channelTitle: "TechChannel", publishedAt: "2026-01-01" } }],
    })));
    const results = await youtubeResolver.search(fixturePointer(), {});
    expect(results[0].url).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("builds a channel URL for channel-type pointers", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      items: [{ id: { channelId: "UC123" }, snippet: { title: "TechChannel", channelTitle: "TechChannel", publishedAt: "2026-01-01" } }],
    })));
    const results = await youtubeResolver.search(fixturePointer({ resourceType: "channel" }), {});
    expect(results[0].url).toBe("https://www.youtube.com/channel/UC123");
  });
});

describe("webSearchResolver", () => {
  it("returns an empty array without crashing when no API key is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const results = await webSearchResolver.search(fixturePointer({ resourceType: "website" }), {});
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses a real-shaped Tavily response", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      results: [{ title: "Excalidraw", url: "https://excalidraw.com", content: "A drawing tool", published_date: "2026-01-01" }],
    })));
    const results = await webSearchResolver.search(fixturePointer({ resourceType: "web_tool", name: "Excalidraw" }), {});
    expect(results[0].url).toBe("https://excalidraw.com");
    expect(results[0].source).toBe("excalidraw.com");
  });

  it("matches every resource type as the universal fallback", () => {
    expect(webSearchResolver.handles("anything_unrecognized")).toBe(true);
  });
});
