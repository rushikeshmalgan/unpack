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

  // Shapes taken from a live Tavily run, which behaves very differently from
  // the structured APIs: many domains, free-form titles, and an order that
  // puts aggregator pages ahead of the official site.
  describe("web-search results (as observed live)", () => {
    it("puts the official site first even when other pages tie it on title (linear.app vs a docs page and LinkedIn)", async () => {
      const results = await rank(fixturePointer({ resourceType: "web_tool", name: "Linear" }), [
        candidate({ url: "https://apps.make.com/linear", title: "Linear - Apps Documentation", source: "apps.make.com", snippet: "Linear is a project management tool." }),
        candidate({ url: "https://www.linkedin.com/company/linearapp", title: "Linear", source: "www.linkedin.com", snippet: "Linear | LinkedIn" }),
        candidate({ url: "https://linear.app", title: "Linear – The system for product development", source: "linear.app", snippet: "Linear is a purpose-built tool for planning and building products." }),
      ]);
      expect(results[0].url).toBe("https://linear.app");
      expect(results[0].confidence).toBe("high");
      expect(results.slice(1).every((r) => r.confidence !== "high")).toBe(true);
    });

    it("ranks an encyclopedia page below an equally good primary source (CS50: Wikipedia vs Harvard)", async () => {
      const results = await rank(fixturePointer({ resourceType: "course", name: "CS50" }), [
        candidate({ url: "https://en.wikipedia.org/wiki/CS50", title: "CS50 - Wikipedia", source: "en.wikipedia.org", snippet: "CS50 is an introductory course." }),
        candidate({ url: "https://pll.harvard.edu/course/cs50", title: "CS50: Introduction to Computer Science | Harvard University", source: "pll.harvard.edu", snippet: "An entry-level course taught by David J. Malan." }),
      ]);
      expect(results.map((r) => r.url)).toEqual(["https://pll.harvard.edu/course/cs50", "https://en.wikipedia.org/wiki/CS50"]);
    });

    it("still returns the encyclopedia page when it is the best there is", async () => {
      const results = await rank(fixturePointer({ resourceType: "course", name: "CS50" }), [
        candidate({ url: "https://en.wikipedia.org/wiki/CS50", title: "CS50 - Wikipedia", source: "en.wikipedia.org", snippet: "CS50 is an introductory course." }),
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe("high");
    });

    it("drops a page that shares one word of a three-word name and nothing else ('Blue Yeti microphone' -> 'Blue - Wikipedia')", async () => {
      const results = await rank(fixturePointer({ resourceType: "product", name: "Blue Yeti microphone" }), [
        candidate({ url: "https://en.wikipedia.org/wiki/Blue", title: "Blue - Wikipedia", source: "en.wikipedia.org", snippet: "Blue is one of the three primary colours of pigments in painting." }),
        candidate({ url: "https://www.color-meanings.com/shades-of-blue", title: "144 Shades of Blue: Color Names, Hex, RGB, CMYK Codes", source: "www.color-meanings.com", snippet: "Shades of blue and their hex codes." }),
      ]);
      expect(results).toEqual([]);
    });

    it("keeps the real product page for the same name", async () => {
      const results = await rank(fixturePointer({ resourceType: "product", name: "Blue Yeti microphone" }), [
        candidate({ url: "https://en.wikipedia.org/wiki/Blue", title: "Blue - Wikipedia", source: "en.wikipedia.org", snippet: "Blue is a colour." }),
        candidate({ url: "https://www.logitechg.com/yeti", title: "Yeti USB Microphone | Blue Microphones", source: "www.logitechg.com", snippet: "The Blue Yeti USB microphone for streaming." }),
      ]);
      expect(results.map((r) => r.url)).toEqual(["https://www.logitechg.com/yeti"]);
    });
  });

  describe("package registry pages (PyPI, as observed live)", () => {
    const pypi = (path: string) =>
      candidate({ url: `https://pypi.org/project/${path}`, title: "requests · PyPI", source: "pypi.org", snippet: "Python HTTP for Humans." });

    it("treats '·' as a title separator, so 'requests · PyPI' is a full match for 'requests'", async () => {
      const [first] = await rank(fixturePointer({ resourceType: "library_package", name: "requests" }), [pypi("requests")]);
      expect(first.confidence).toBe("high");
    });

    it("prefers the unversioned project page over equally-titled version pages", async () => {
      const results = await rank(fixturePointer({ resourceType: "library_package", name: "requests" }), [
        pypi("requests/2.17.1"),
        pypi("requests/2.14.1"),
        pypi("requests"),
      ]);
      expect(results[0].url).toBe("https://pypi.org/project/requests");
    });

    it("lets a shallower page win a tie between two pages of the same site", async () => {
      const results = await rank(fixturePointer({ resourceType: "web_tool", name: "Warp" }), [
        candidate({ url: "https://www.warp.dev/download", title: "Warp", source: "www.warp.dev" }),
        candidate({ url: "https://www.warp.dev", title: "Warp", source: "www.warp.dev" }),
      ]);
      expect(results[0].url).toBe("https://www.warp.dev");
    });

    it("does not let depth override a clearly better match", async () => {
      const results = await rank(fixturePointer({ resourceType: "web_tool", name: "Excalidraw" }), [
        candidate({ url: "https://example.com/", title: "Excalidraw alternatives, reviews and pricing compared", source: "example.com" }),
        candidate({ url: "https://excalidraw.com/app/whiteboard/draw", title: "Excalidraw", source: "excalidraw.com" }),
      ]);
      expect(results[0].url).toBe("https://excalidraw.com/app/whiteboard/draw");
    });
  });

  describe("topical (explore) results", () => {
    const topicPointer = fixturePointer({ resourceType: "other", name: "best resources to learn about self-belief" });
    const articles = [
      candidate({ url: "https://www.mind.org.uk/self-esteem", title: "How to improve self-esteem | Mind", source: "www.mind.org.uk" }),
      candidate({ url: "https://www.mayoclinic.org/self-esteem", title: "Self-esteem: Take steps to feel better about yourself", source: "www.mayoclinic.org" }),
      candidate({ url: "https://ryanzofay.com/self-esteem-books", title: "25 Best Self Esteem Books", source: "ryanzofay.com" }),
    ];

    it("keeps related pages that don't resemble the synthetic query, in the search engine's own order", async () => {
      const results = await verifyAndRank(topicPointer, articles, { checkLivenessEnabled: false, topical: true });
      expect(results.map((r) => r.url)).toEqual(articles.map((a) => a.url));
    });

    it("labels them as related reading rather than as a match for the made-up query", async () => {
      const [first] = await verifyAndRank(topicPointer, articles, { checkLivenessEnabled: false, topical: true });
      expect(first.reason).toBe("Related reading on this topic.");
      expect(first.confidence).toBe("low");
      expect(first.reason).not.toContain("best resources to learn");
    });

    it("still drops dead links and respects maxResults", async () => {
      checkLivenessMock.mockResolvedValueOnce({ ok: false, reason: "dead", status: 404 });
      const results = await verifyAndRank(topicPointer, articles, { topical: true, maxResults: 1 });
      expect(results.map((r) => r.url)).toEqual(["https://www.mayoclinic.org/self-esteem"]);
    });

    it("without topical mode the same candidates are (correctly) filtered out as non-matches", async () => {
      const results = await verifyAndRank(topicPointer, articles, { checkLivenessEnabled: false });
      expect(results.length).toBeLessThan(articles.length);
    });
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
