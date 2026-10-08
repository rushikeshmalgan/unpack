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

  it("says so when the key is missing, so a skipped resolver isn't mistaken for 'nothing found'", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const reportIssue = vi.fn();
    await youtubeResolver.search(fixturePointer(), { reportIssue });
    expect(reportIssue).toHaveBeenCalledExactlyOnceWith("YouTube search isn't enabled on this server");
  });

  it("reports an exhausted quota (403) instead of returning a silent empty list", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) } as Response));
    const reportIssue = vi.fn();
    expect(await youtubeResolver.search(fixturePointer(), { reportIssue })).toEqual([]);
    expect(reportIssue).toHaveBeenCalledExactlyOnceWith("YouTube search is rate-limited");
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

  it("says so when the key is missing", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const reportIssue = vi.fn();
    await webSearchResolver.search(fixturePointer({ resourceType: "website" }), { reportIssue });
    expect(reportIssue).toHaveBeenCalledExactlyOnceWith("Web search isn't enabled on this server");
  });

  it("sends the key as a Bearer token on a POST", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await webSearchResolver.search(fixturePointer({ resourceType: "web_tool", name: "Excalidraw" }), {});
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body).query).toBe("Excalidraw");
  });

  describe("query construction (checked against live Tavily results)", () => {
    async function bodySentFor(pointer: Pointer) {
      vi.stubEnv("TAVILY_API_KEY", "test-key");
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
      vi.stubGlobal("fetch", fetchMock);
      await webSearchResolver.search(pointer, {});
      return JSON.parse(fetchMock.mock.calls[0][1].body);
    }
    const withLanguage = (language: string | null) =>
      fixturePointer({
        resourceType: "library_package",
        name: "pydantic",
        attributes: { creator: null, year: null, topic: null, language, location: null, visibleUrl: null, price: null },
      });

    it("does not add 'official site' for tools or websites: it pushed linear.app out of the top five", async () => {
      expect((await bodySentFor(fixturePointer({ resourceType: "web_tool", name: "Linear" }))).query).toBe("Linear");
      expect((await bodySentFor(fixturePointer({ resourceType: "website", name: "Linear" }))).query).toBe("Linear");
    });

    it("keeps the 'course' hint, which is what surfaces cs50.harvard.edu", async () => {
      expect((await bodySentFor(fixturePointer({ resourceType: "course", name: "CS50" }))).query).toBe("CS50 course");
    });

    it("finds Python packages with include_domains, not a site: operator Tavily ignores", async () => {
      const body = await bodySentFor(withLanguage("Python"));
      expect(body.include_domains).toEqual(["pypi.org"]);
      expect(body.query).toBe("pydantic");
      expect(body.query).not.toMatch(/site:/);
    });

    it.each([null, "javascript", "rust"])("does not restrict domains for a package whose language is %s", async (language) => {
      expect((await bodySentFor(withLanguage(language))).include_domains).toBeUndefined();
    });

    it("never restricts domains for non-package pointers, whatever their language", async () => {
      const pointer = fixturePointer({
        resourceType: "web_tool",
        attributes: { creator: null, year: null, topic: null, language: "python", location: null, visibleUrl: null, price: null },
      });
      expect((await bodySentFor(pointer)).include_domains).toBeUndefined();
    });
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
