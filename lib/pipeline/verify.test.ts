import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/pipeline/resolvers/types";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";
import type { LinkResult } from "@/lib/schemas/pipeline/response";

const checkLivenessMock = vi.fn();
vi.mock("@/lib/pipeline/safeExternalFetch", () => ({ checkLiveness: checkLivenessMock }));

const { verifyAndRank, dedupeCandidates, stripUnretrievedUrls } = await import("@/lib/pipeline/verify");

function fixturePointer(overrides: Partial<Pointer> = {}): Pointer {
  return {
    id: "p1",
    kind: "explicit",
    resourceType: "web_tool",
    name: "Excalidraw",
    attributes: { creator: null, year: null, topic: null, language: null, location: null, visibleUrl: null, price: null },
    evidence: [],
    confidence: 0.9,
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return { url: "https://example.com/x", title: "x", source: "example.com", ...overrides };
}

beforeEach(() => {
  checkLivenessMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
});

describe("dedupeCandidates", () => {
  it("keeps only the first occurrence of each host+path", () => {
    const result = dedupeCandidates([
      candidate({ url: "https://a.com/x" }),
      candidate({ url: "https://a.com/x/" }), // trailing slash, same path
      candidate({ url: "https://a.com/y" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("drops candidates with unparseable URLs rather than keeping them", () => {
    const result = dedupeCandidates([candidate({ url: "not a url" }), candidate({ url: "https://a.com/x" })]);
    expect(result).toHaveLength(1);
  });
});

describe("stripUnretrievedUrls", () => {
  it("removes any link whose URL isn't in the retrieved candidate set", () => {
    const links: LinkResult[] = [
      { title: "a", url: "https://a.com", source: "a.com", reason: "", confidence: "high" },
      { title: "fabricated", url: "https://never-retrieved.com", source: "x", reason: "", confidence: "high" },
    ];
    const retrieved = [candidate({ url: "https://a.com" })];
    const result = stripUnretrievedUrls(links, retrieved);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://a.com");
  });
});

describe("verifyAndRank", () => {
  it("ranks a name+source match above an unrelated candidate", async () => {
    const results = await verifyAndRank(
      fixturePointer(),
      [
        candidate({ url: "https://excalidraw.com", title: "Excalidraw — virtual whiteboard", source: "excalidraw.com" }),
        candidate({ url: "https://unrelated.com/post", title: "Some blog post about drawing", source: "unrelated.com" }),
      ],
      { checkLivenessEnabled: false },
    );

    expect(results[0].url).toBe("https://excalidraw.com");
    expect(results[0].confidence).toBe("high");
  });

  it("drops candidates with zero relation to the pointer name", async () => {
    const results = await verifyAndRank(
      fixturePointer(),
      [candidate({ url: "https://totally-unrelated.com", title: "Completely different thing", source: "totally-unrelated.com" })],
      { checkLivenessEnabled: false },
    );
    expect(results).toHaveLength(0);
  });

  it("filters out candidates that fail the liveness check", async () => {
    checkLivenessMock.mockResolvedValueOnce({ ok: false, reason: "unreachable" });
    const results = await verifyAndRank(
      fixturePointer(),
      [candidate({ url: "https://excalidraw.com", title: "Excalidraw", source: "excalidraw.com" })],
      { checkLivenessEnabled: true },
    );
    expect(results).toHaveLength(0);
  });

  it("respects maxResults", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      candidate({ url: `https://excalidraw.com/${i}`, title: "Excalidraw", source: "excalidraw.com" }),
    );
    const results = await verifyAndRank(fixturePointer(), candidates, { checkLivenessEnabled: false, maxResults: 2 });
    expect(results).toHaveLength(2);
  });

  it("never returns a URL that wasn't in the input candidates", async () => {
    const candidates = [candidate({ url: "https://excalidraw.com", title: "Excalidraw", source: "excalidraw.com" })];
    const results = await verifyAndRank(fixturePointer(), candidates, { checkLivenessEnabled: false });
    const retrievedUrls = new Set(candidates.map((c) => c.url));
    for (const r of results) expect(retrievedUrls.has(r.url)).toBe(true);
  });
});

describe("verifyAndRank: ranking quality on real-world shapes", () => {
  const rank = (pointer: Pointer, candidates: Candidate[]) =>
    verifyAndRank(pointer, candidates, { checkLivenessEnabled: false });

  // Real GitHub results for the query "react": three repos literally named
  // "react", which previously all scored a perfect "high".
  const githubReact = [
    candidate({ url: "https://github.com/typescript-cheatsheets/react", title: "typescript-cheatsheets/react", aliases: ["react"], popularity: 47094, source: "github.com" }),
    candidate({ url: "https://github.com/react/react", title: "react/react", aliases: ["react"], popularity: 250918, source: "github.com" }),
    candidate({ url: "https://github.com/duxianwei520/react", title: "duxianwei520/react", aliases: ["react"], popularity: 5341, source: "github.com" }),
  ];

  it("breaks ties between equally named repos by stars, so the canonical one comes first regardless of API order", async () => {
    const results = await rank(fixturePointer({ resourceType: "github_repo", name: "react" }), githubReact);
    expect(results.map((r) => r.url)).toEqual([
      "https://github.com/react/react",
      "https://github.com/typescript-cheatsheets/react",
      "https://github.com/duxianwei520/react",
    ]);
  });

  it("lets only the best result claim 'high' — same-named lookalikes are downgraded, not all marked high", async () => {
    const results = await rank(fixturePointer({ resourceType: "github_repo", name: "react" }), githubReact);
    expect(results.map((r) => r.confidence)).toEqual(["high", "medium", "medium"]);
  });

  it("matches a repo by its short name or its owner/repo name, whichever fits", async () => {
    const results = await rank(
      fixturePointer({ resourceType: "github_repo", name: "shadcn/ui" }),
      [candidate({ url: "https://github.com/shadcn-ui/ui", title: "shadcn-ui/ui", aliases: ["ui"], source: "github.com" })],
    );
    expect(results[0].confidence).toBe("high");
  });

  it("lists the package registry page before same-named GitHub repos for a library_package, even though GitHub has far more 'popularity'", async () => {
    // Candidates arrive in registry order: npm first, then GitHub.
    const results = await rank(fixturePointer({ resourceType: "library_package", name: "lodash" }), [
      candidate({ url: "https://www.npmjs.com/package/lodash", title: "lodash", source: "npmjs.com" }),
      candidate({ url: "https://github.com/lodash/lodash", title: "lodash/lodash", aliases: ["lodash"], popularity: 61346, source: "github.com" }),
      candidate({ url: "https://github.com/wll8/lodash-utils", title: "wll8/lodash-utils", aliases: ["lodash-utils"], popularity: 527, source: "github.com" }),
    ]);
    expect(results[0].url).toBe("https://www.npmjs.com/package/lodash");
    expect(results.map((r) => r.url)).toContain("https://github.com/lodash/lodash");
  });

  it("ranks an exact name above a longer title that merely contains it", async () => {
    const results = await rank(fixturePointer({ resourceType: "app_mobile", name: "Notion" }), [
      candidate({ url: "https://apps.apple.com/app/notion-calendar", title: "Notion Calendar", popularity: 90000, source: "apps.apple.com" }),
      candidate({ url: "https://apps.apple.com/app/notion", title: "Notion: Notes, Tasks, AI", popularity: 7590, source: "apps.apple.com" }),
    ]);
    expect(results[0].url).toBe("https://apps.apple.com/app/notion");
    expect(results[0].confidence).toBe("high");
    expect(results[1].confidence).toBe("medium");
  });

  it("ignores a catalogue subtitle: 'Deep Work: Rules for Focused Success...' matches 'Deep Work'", async () => {
    const results = await rank(fixturePointer({ resourceType: "book", name: "Deep Work" }), [
      candidate({ url: "https://openlibrary.org/works/OL1W", title: "Deep Work: Rules for Focused Success in a Distracted World", source: "openlibrary.org" }),
    ]);
    expect(results[0].confidence).toBe("high");
  });

  it("does not split hyphenated names like react-hook-form", async () => {
    const results = await rank(fixturePointer({ resourceType: "library_package", name: "react-hook-form" }), [
      candidate({ url: "https://www.npmjs.com/package/react-hook-form", title: "react-hook-form", source: "npmjs.com" }),
    ]);
    expect(results[0].confidence).toBe("high");
  });

  it("drops candidates that share only a stray word with a long, unrelated title", async () => {
    const results = await rank(fixturePointer({ resourceType: "book", name: "Linear" }), [
      candidate({ url: "https://example.com/algebra", title: "Linear Algebra and Its Applications, Fourth Edition", source: "example.com" }),
    ]);
    expect(results).toHaveLength(0);
  });

  it("uses creator evidence to separate otherwise similar books", async () => {
    const results = await rank(
      fixturePointer({ resourceType: "book", name: "Deep Work", attributes: { creator: "Cal Newport", year: null, topic: null, language: null, location: null, visibleUrl: null, price: null } }),
      [
        candidate({ url: "https://openlibrary.org/works/OL2W", title: "Deep Work Planner", snippet: "by Someone Else", source: "openlibrary.org" }),
        candidate({ url: "https://openlibrary.org/works/OL3W", title: "Deep Work Journal", snippet: "by Cal Newport", source: "openlibrary.org" }),
      ],
    );
    expect(results[0].url).toBe("https://openlibrary.org/works/OL3W");
  });

  it("boosts a candidate served from the pointer's own domain", async () => {
    const results = await rank(fixturePointer({ resourceType: "web_tool", name: "Raycast" }), [
      candidate({ url: "https://blog.example/raycast-alternatives", title: "Raycast alternatives and 6 more launchers compared", source: "blog.example" }),
      candidate({ url: "https://www.raycast.com/", title: "Home | Raycast", source: "raycast.com" }),
    ]);
    expect(results[0].url).toBe("https://www.raycast.com/");
  });

  describe("non-English names", () => {
    it("matches Devanagari names (an ASCII-only tokenizer erases them and drops every candidate)", async () => {
      const results = await rank(fixturePointer({ resourceType: "place", name: "कैफ़े कॉफ़ी हाउस" }), [
        candidate({ url: "https://www.openstreetmap.org/node/1", title: "कैफ़े कॉफ़ी हाउस", source: "openstreetmap.org" }),
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe("high");
    });

    it("treats accented and unaccented Latin spellings as the same word", async () => {
      const results = await rank(fixturePointer({ resourceType: "place", name: "Café Zoe" }), [
        candidate({ url: "https://www.openstreetmap.org/node/2", title: "Cafe Zoe", source: "openstreetmap.org" }),
      ]);
      expect(results[0].confidence).toBe("high");
    });
  });
});
