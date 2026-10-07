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
