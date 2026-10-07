import { afterEach, describe, expect, it, vi } from "vitest";
import { githubResolver } from "@/lib/pipeline/resolvers/githubResolver";
import { packageResolver } from "@/lib/pipeline/resolvers/packageResolver";
import { bookResolver } from "@/lib/pipeline/resolvers/bookResolver";
import { academicResolver } from "@/lib/pipeline/resolvers/academicResolver";
import { placesResolver } from "@/lib/pipeline/resolvers/placesResolver";
import { appStoreResolver } from "@/lib/pipeline/resolvers/appStoreResolver";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

function fixturePointer(overrides: Partial<Pointer> = {}): Pointer {
  return {
    id: "p1",
    kind: "explicit",
    resourceType: "github_repo",
    name: "excalidraw",
    attributes: { creator: null, year: null, topic: null, language: null, location: null, visibleUrl: null, price: null },
    evidence: [],
    confidence: 0.9,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("githubResolver", () => {
  it("parses a real-shaped search response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      items: [{ full_name: "excalidraw/excalidraw", html_url: "https://github.com/excalidraw/excalidraw", description: "drawing tool", stargazers_count: 90000, language: "TypeScript", owner: { login: "excalidraw" }, updated_at: "2026-01-01" }],
    })));
    const results = await githubResolver.search(fixturePointer(), {});
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://github.com/excalidraw/excalidraw");
    expect(results[0].meta?.stars).toBe(90000);
  });

  it("returns an empty array (not a throw) on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));
    expect(await githubResolver.search(fixturePointer(), {})).toEqual([]);
  });

  it("returns an empty array on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await githubResolver.search(fixturePointer(), {})).toEqual([]);
  });
});

describe("packageResolver (npm)", () => {
  it("parses a real-shaped npm search response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      objects: [{ package: { name: "@excalidraw/excalidraw", version: "0.18.1", description: "React component", date: "2026-01-01", links: { npm: "https://www.npmjs.com/package/@excalidraw/excalidraw" } } }],
    })));
    const results = await packageResolver.search(fixturePointer({ resourceType: "library_package" }), {});
    expect(results[0].url).toBe("https://www.npmjs.com/package/@excalidraw/excalidraw");
  });
});

describe("bookResolver (Open Library)", () => {
  it("parses a real-shaped search response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      docs: [{ key: "/works/OL123W", title: "Atomic Habits", author_name: ["James Clear"], first_publish_year: 2018 }],
    })));
    const results = await bookResolver.search(fixturePointer({ resourceType: "book", name: "Atomic Habits" }), {});
    expect(results[0].url).toBe("https://openlibrary.org/works/OL123W");
    expect(results[0].snippet).toContain("James Clear");
  });
});

describe("academicResolver (arXiv)", () => {
  it("parses a real-shaped Atom XML response", async () => {
    const atom = `<feed><entry><title>Attention Is All You Need</title><link href="https://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/><published>2017-06-12T00:00:00Z</published><summary>The dominant sequence transduction models...</summary></entry></feed>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => atom } as Response));
    const results = await academicResolver.search(fixturePointer({ resourceType: "research_paper", name: "attention is all you need" }), {});
    expect(results[0].url).toBe("https://arxiv.org/abs/1706.03762v7");
    expect(results[0].title).toBe("Attention Is All You Need");
  });
});

describe("placesResolver (Nominatim)", () => {
  it("parses a real-shaped search response and sends a descriptive User-Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { osm_type: "way", osm_id: 5013364, display_name: "Tour Eiffel, Paris, France", type: "tower", importance: 0.6 },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const results = await placesResolver.search(fixturePointer({ resourceType: "place", name: "Eiffel Tower" }), {});
    expect(results[0].url).toBe("https://www.openstreetmap.org/way/5013364");
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Unpack/);
  });
});

describe("appStoreResolver (iTunes)", () => {
  it("parses a real-shaped search response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      results: [{ trackName: "Excalidraw", trackViewUrl: "https://apps.apple.com/app/excalidraw/id123", artistName: "Excalidraw Inc" }],
    })));
    const results = await appStoreResolver.search(fixturePointer({ resourceType: "app_mobile", name: "Excalidraw" }), {});
    expect(results[0].url).toBe("https://apps.apple.com/app/excalidraw/id123");
  });
});
