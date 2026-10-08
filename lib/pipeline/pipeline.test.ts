import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnderstandingResult } from "@/lib/schemas/pipeline/understanding";

const ingestReelMock = vi.fn();
const understandReelMock = vi.fn();
const resolversForMock = vi.fn();
const verifyAndRankMock = vi.fn();
const checkLivenessMock = vi.fn();
const getCachedIngestionMock = vi.fn();
const setCachedIngestionMock = vi.fn();
const getCachedSearchMock = vi.fn();
const setCachedSearchMock = vi.fn();

vi.mock("@/lib/pipeline/ingest/ingestReel", () => ({ ingestReel: ingestReelMock }));
vi.mock("@/lib/pipeline/understand", () => ({ understandReel: understandReelMock }));
vi.mock("@/lib/pipeline/resolvers/registry", () => ({ resolversFor: resolversForMock }));
vi.mock("@/lib/pipeline/resolvers/webSearchResolver", () => ({ webSearchResolver: { id: "web_search", handles: () => true, search: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/lib/pipeline/verify", () => ({
  verifyAndRank: verifyAndRankMock,
  dedupeCandidates: (c: unknown[]) => c,
}));
vi.mock("@/lib/pipeline/safeExternalFetch", () => ({ checkLiveness: checkLivenessMock }));
vi.mock("@/lib/pipeline/cache", () => ({
  getCachedIngestion: getCachedIngestionMock,
  setCachedIngestion: setCachedIngestionMock,
  getCachedSearch: getCachedSearchMock,
  setCachedSearch: setCachedSearchMock,
}));

const { runPipeline, PIPELINE_BUDGET_MS } = await import("@/lib/pipeline/pipeline");

const VALID_URL = "https://www.instagram.com/reel/abc123/";

function baseSignals(overrides = {}) {
  return {
    sourceUrl: VALID_URL,
    contentType: "reel" as const,
    creatorUsername: "someuser",
    caption: "Check out Excalidraw for diagramming, it's great.",
    transcript: null,
    onScreenText: null,
    comments: null,
    bioLink: null,
    thumbnailUrl: null,
    status: "manual_only" as const,
    missing: ["transcript", "on-screen text", "comments"],
    ...overrides,
  };
}

function baseUnderstanding(overrides: Partial<UnderstandingResult> = {}): UnderstandingResult {
  return {
    reelType: "recommendation_list",
    creatorPromise: null,
    ctaDetected: { type: "none", keyword: null },
    pointers: [],
    topicIfNoPointers: null,
    searchPlans: [],
    ...overrides,
  };
}

beforeEach(() => {
  ingestReelMock.mockReset();
  understandReelMock.mockReset();
  resolversForMock.mockReset().mockReturnValue([]);
  verifyAndRankMock.mockReset().mockResolvedValue([]);
  checkLivenessMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  getCachedIngestionMock.mockReset().mockResolvedValue(null);
  setCachedIngestionMock.mockReset();
  getCachedSearchMock.mockReset().mockResolvedValue(null);
  setCachedSearchMock.mockReset();
});

describe("runPipeline", () => {
  it("short-circuits on an invalid URL", async () => {
    const outcome = await runPipeline({ url: "https://evil.com/reel/x/", manual: {}, mode: "exact" });
    expect(outcome.status).toBe("invalid_url");
    expect(ingestReelMock).not.toHaveBeenCalled();
  });

  it("returns 'insufficient' when ingested signal is too short", async () => {
    ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals({ caption: "hi", status: "none", missing: ["caption", "transcript", "on-screen text", "comments"] }) });
    const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
    expect(outcome.status).toBe("insufficient");
    expect(understandReelMock).not.toHaveBeenCalled();
  });

  it("passes through an AI error without crashing", async () => {
    ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals() });
    understandReelMock.mockResolvedValue({ ok: false, error: { type: "QUOTA_EXCEEDED", retryable: false, message: "quota" } });
    const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
    expect(outcome.status).toBe("ai_error");
    if (outcome.status === "ai_error") expect(outcome.error.type).toBe("QUOTA_EXCEEDED");
  });

  it("routes a gated+template pointer to creatorOwned, not results", async () => {
    ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals() });
    understandReelMock.mockResolvedValue({
      ok: true,
      data: baseUnderstanding({
        pointers: [{
          id: "p1", kind: "gated", resourceType: "template", name: "my Notion template",
          attributes: { creator: null, year: null, topic: "productivity", language: null, location: null, visibleUrl: null, price: null },
          evidence: [], confidence: 0.8,
        }],
      }),
    });

    const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.creatorOwned).toHaveLength(1);
      expect(outcome.result.results).toHaveLength(0);
    }
  });

  it("lists a pointer as unresolved when verification returns no links", async () => {
    ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals() });
    understandReelMock.mockResolvedValue({
      ok: true,
      data: baseUnderstanding({
        pointers: [{
          id: "p1", kind: "explicit", resourceType: "web_tool", name: "SomeObscureTool",
          attributes: { creator: null, year: null, topic: null, language: null, location: null, visibleUrl: null, price: null },
          evidence: [], confidence: 0.5,
        }],
      }),
    });
    verifyAndRankMock.mockResolvedValue([]);

    const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.unresolved).toHaveLength(1);
      expect(outcome.result.unresolved[0].name).toBe("SomeObscureTool");
    }
  });

  it("populates results when verification finds a link", async () => {
    ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals() });
    understandReelMock.mockResolvedValue({
      ok: true,
      data: baseUnderstanding({
        pointers: [{
          id: "p1", kind: "explicit", resourceType: "web_tool", name: "Excalidraw",
          attributes: { creator: null, year: null, topic: null, language: null, location: null, visibleUrl: null, price: null },
          evidence: [], confidence: 0.9,
        }],
      }),
    });
    verifyAndRankMock.mockResolvedValue([
      { title: "Excalidraw", url: "https://excalidraw.com", source: "excalidraw.com", reason: "match", confidence: "high" },
    ]);

    const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.results).toHaveLength(1);
      expect(outcome.result.results[0].links[0].url).toBe("https://excalidraw.com");
    }
  });

  it("triggers explore mode automatically when there are no pointers", async () => {
    ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals() });
    understandReelMock.mockResolvedValue({
      ok: true,
      data: baseUnderstanding({ reelType: "motivational", topicIfNoPointers: "self-belief", pointers: [] }),
    });
    verifyAndRankMock.mockResolvedValue([
      { title: "Article", url: "https://example.com/a", source: "example.com", reason: "related", confidence: "medium" },
    ]);

    const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.explore).not.toBeNull();
      expect(outcome.result.explore).toHaveLength(1);
    }
  });

  it("uses cached ingestion signals instead of re-ingesting", async () => {
    getCachedIngestionMock.mockResolvedValue(baseSignals());
    understandReelMock.mockResolvedValue({ ok: true, data: baseUnderstanding() });

    await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
    expect(ingestReelMock).not.toHaveBeenCalled();
  });

  describe("ordering, time budget and containment", () => {
    const attrs = { creator: null, year: null, topic: null, language: null, location: null, visibleUrl: null, price: null };
    const pointerNamed = (name: string) => ({
      id: name, kind: "explicit" as const, resourceType: "web_tool", name, attributes: attrs, evidence: [], confidence: 0.9,
    });
    const linkFor = (name: string) => [
      { title: name, url: `https://${name.toLowerCase()}.example`, source: `${name.toLowerCase()}.example`, reason: "match", confidence: "high" as const },
    ];
    const understandingOf = (...names: string[]) => ({
      ok: true, data: baseUnderstanding({ pointers: names.map(pointerNamed) }),
    });
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    beforeEach(() => {
      ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals() });
      resolversForMock.mockReturnValue([{ id: "r", handles: () => true, search: vi.fn(async () => []) }]);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("lists results in the order the reel mentioned them, not the order the lookups finished", async () => {
      // "First" is the slowest lookup and "Third" the fastest, so completion order is the reverse.
      verifyAndRankMock.mockImplementation(async (p: { name: string }) => {
        await delay({ First: 40, Second: 20, Third: 1 }[p.name] ?? 1);
        return linkFor(p.name);
      });
      understandReelMock.mockResolvedValue(understandingOf("First", "Second", "Third"));

      const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(outcome.result.results.map((r) => r.name)).toEqual(["First", "Second", "Third"]);
    });

    it("returns partial results on time instead of running past the platform limit", async () => {
      vi.useFakeTimers();
      verifyAndRankMock.mockImplementation((p: { name: string }) =>
        p.name === "Hangs" ? new Promise(() => {}) : Promise.resolve(linkFor(p.name)),
      );
      understandReelMock.mockResolvedValue(understandingOf("Fine", "Hangs"));

      const pending = runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
      await vi.advanceTimersByTimeAsync(PIPELINE_BUDGET_MS + 1);
      const outcome = await pending;

      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(outcome.result.results.map((r) => r.name)).toEqual(["Fine"]);
      expect(outcome.result.unresolved).toEqual([
        { pointerId: "Hangs", name: "Hangs", reason: "Ran out of time while searching for this one — try again." },
      ]);
      expect(outcome.result.warnings).toContain("Some links took too long to look up and were skipped — try again for those.");
    });

    it("doesn't even start looking when a slow AI call already used up the budget", async () => {
      vi.useFakeTimers();
      understandReelMock.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + PIPELINE_BUDGET_MS + 1);
        return understandingOf("A", "B");
      });

      const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });

      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(resolversForMock).not.toHaveBeenCalled();
      expect(outcome.result.unresolved.map((u) => u.name)).toEqual(["A", "B"]);
      expect(outcome.result.results).toEqual([]);
    });

    it("keeps the other results when one pointer blows up unexpectedly", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      verifyAndRankMock.mockImplementation(async (p: { name: string }) => {
        if (p.name === "Boom") throw new Error("unexpected");
        return linkFor(p.name);
      });
      understandReelMock.mockResolvedValue(understandingOf("Good", "Boom", "AlsoGood"));

      const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });

      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(outcome.result.results.map((r) => r.name)).toEqual(["Good", "AlsoGood"]);
      expect(outcome.result.unresolved).toEqual([
        { pointerId: "Boom", name: "Boom", reason: "Something went wrong while searching for this one." },
      ]);
    });

    describe("a reel that points to nothing", () => {
      const noPointers = (overrides = {}) => ({
        ok: true,
        data: baseUnderstanding({ reelType: "motivational", topicIfNoPointers: "self-belief", pointers: [], ...overrides }),
      });

      it("reports the topic the model identified, so the user is told something true", async () => {
        understandReelMock.mockResolvedValue(noPointers());
        const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
        if (outcome.status !== "ok") throw new Error("expected ok");
        expect(outcome.result.reel.topic).toBe("self-belief");
      });

      it("distinguishes 'looked for related reading and found none' (empty list) from 'didn't look' (null), and says why", async () => {
        resolversForMock.mockReturnValue([
          {
            id: "web_search",
            handles: () => true,
            search: vi.fn(async (_p: unknown, ctx: { reportIssue?: (m: string) => void }) => {
              ctx.reportIssue?.("Web search isn't enabled on this server");
              return [];
            }),
          },
        ]);
        understandReelMock.mockResolvedValue(noPointers());

        const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
        if (outcome.status !== "ok") throw new Error("expected ok");
        expect(outcome.result.explore).toEqual([]);
        expect(outcome.result.warnings).toContain(
          "Couldn't find related reading for this topic (Web search isn't enabled on this server).",
        );
      });

      it("leaves explore as null, with no explore warning, when the reel has pointers and exact mode was asked for", async () => {
        verifyAndRankMock.mockResolvedValue(linkFor("Tool"));
        understandReelMock.mockResolvedValue(understandingOf("Tool"));

        const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
        if (outcome.status !== "ok") throw new Error("expected ok");
        expect(outcome.result.explore).toBeNull();
        expect(outcome.result.warnings.some((w) => w.includes("related reading"))).toBe(false);
      });

      it("reports a timed-out explore search as such", async () => {
        vi.useFakeTimers();
        understandReelMock.mockImplementation(async () => {
          vi.setSystemTime(Date.now() + PIPELINE_BUDGET_MS + 1);
          return noPointers();
        });
        const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
        if (outcome.status !== "ok") throw new Error("expected ok");
        expect(outcome.result.explore).toEqual([]);
        expect(outcome.result.warnings).toContain("Couldn't find related reading for this topic (it ran out of time).");
      });
    });
  });

  describe("resolver failures vs. genuine misses", () => {
    function pointerFixture(overrides: Record<string, unknown> = {}) {
      return {
        id: "p1", kind: "explicit" as const, resourceType: "github_repo", name: "react",
        attributes: { creator: null, year: null, topic: null, language: null, location: null, visibleUrl: null, price: null },
        evidence: [], confidence: 0.9,
        ...overrides,
      };
    }
    const understandingWith = (pointer: ReturnType<typeof pointerFixture>) =>
      ({ ok: true, data: baseUnderstanding({ pointers: [pointer] }) });

    // A resolver that behaves like GitHub when rate-limited: reports why, returns [].
    const rateLimited = {
      id: "github",
      handles: () => true,
      search: vi.fn(async (_p: unknown, ctx: { reportIssue?: (m: string) => void }) => {
        ctx.reportIssue?.("GitHub search is rate-limited");
        return [];
      }),
    };
    // A resolver that searched fine and simply found nothing.
    const genuineMiss = { id: "npm", handles: () => true, search: vi.fn(async () => []) };

    beforeEach(() => {
      rateLimited.search.mockClear();
      genuineMiss.search.mockClear();
      ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals() });
    });

    it("tells the user a source couldn't be searched, instead of just claiming nothing was found", async () => {
      resolversForMock.mockReturnValue([rateLimited]);
      understandReelMock.mockResolvedValue(understandingWith(pointerFixture()));

      const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(outcome.result.unresolved[0].reason).toBe(
        "Not found, and some sources couldn't be searched (GitHub search is rate-limited).",
      );
    });

    it("keeps the plain reason when every source searched fine and nothing matched", async () => {
      resolversForMock.mockReturnValue([genuineMiss]);
      understandReelMock.mockResolvedValue(understandingWith(pointerFixture()));

      const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(outcome.result.unresolved[0].reason).toBe("No verified, live match was found.");
    });

    it("does not cache the empty answer of a call that failed, but does cache a genuine miss", async () => {
      resolversForMock.mockReturnValue([rateLimited, genuineMiss]);
      understandReelMock.mockResolvedValue(understandingWith(pointerFixture()));

      await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });

      const cachedFor = setCachedSearchMock.mock.calls.map((c) => c[0]);
      expect(cachedFor).toEqual(["npm"]);
    });

    it("survives a resolver that throws, and says which source failed", async () => {
      const exploding = { id: "arxiv", handles: () => true, search: vi.fn(async () => { throw new Error("boom"); }) };
      resolversForMock.mockReturnValue([exploding]);
      understandReelMock.mockResolvedValue(understandingWith(pointerFixture({ resourceType: "research_paper" })));

      const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(outcome.result.unresolved[0].reason).toContain("arxiv failed unexpectedly");
    });

    it("does not mention a failed source when another source did find links", async () => {
      resolversForMock.mockReturnValue([rateLimited]);
      verifyAndRankMock.mockResolvedValue([
        { title: "react", url: "https://www.npmjs.com/package/react", source: "npmjs.com", reason: "match", confidence: "high" },
      ]);
      understandReelMock.mockResolvedValue(understandingWith(pointerFixture()));

      const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(outcome.result.results).toHaveLength(1);
      expect(outcome.result.unresolved).toHaveLength(0);
    });

    it("keys the search cache on everything the query depends on, so 'Cafe Zoe' in Goa never gets Paris's cached answer", async () => {
      resolversForMock.mockReturnValue([genuineMiss]);
      const keys: string[] = [];
      getCachedSearchMock.mockImplementation(async (_id: string, key: string) => { keys.push(key); return null; });

      for (const location of ["Goa", "Paris"]) {
        understandReelMock.mockResolvedValue(understandingWith(pointerFixture({ resourceType: "place", name: "Cafe Zoe", attributes: { creator: null, year: null, topic: null, language: null, location, visibleUrl: null, price: null } })));
        await runPipeline({ url: VALID_URL, manual: {}, mode: "exact", locale: "en" });
      }

      expect(keys).toEqual(["Cafe Zoe|place|Goa|en", "Cafe Zoe|place|Paris|en"]);
    });

    it("also separates the same name searched as a different resource type", async () => {
      resolversForMock.mockReturnValue([genuineMiss]);
      const keys: string[] = [];
      getCachedSearchMock.mockImplementation(async (_id: string, key: string) => { keys.push(key); return null; });

      for (const resourceType of ["github_repo", "library_package"]) {
        understandReelMock.mockResolvedValue(understandingWith(pointerFixture({ resourceType })));
        await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });
      }

      expect(new Set(keys).size).toBe(2);
    });
  });

  describe("ingestion cache vs. user-pasted text", () => {
    it("never reads the shared cache when the user pasted something, so a stale entry cannot override their input", async () => {
      getCachedIngestionMock.mockResolvedValue(baseSignals({ caption: "SOMEONE ELSE'S CACHED CAPTION" }));
      ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals({ caption: "my own pasted caption text" }) });
      understandReelMock.mockResolvedValue({ ok: true, data: baseUnderstanding() });

      await runPipeline({ url: VALID_URL, manual: { caption: "my own pasted caption text" }, mode: "exact" });

      expect(getCachedIngestionMock).not.toHaveBeenCalled();
      expect(ingestReelMock).toHaveBeenCalledOnce();
      const signalsSentToAi = understandReelMock.mock.calls[0][0];
      expect(signalsSentToAi.caption).toBe("my own pasted caption text");
    });

    it("never writes user-pasted content to the shared cache", async () => {
      ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals({ caption: "private pasted text about me" }) });
      understandReelMock.mockResolvedValue({ ok: true, data: baseUnderstanding() });

      await runPipeline({ url: VALID_URL, manual: { transcript: "private pasted text about me" }, mode: "exact" });

      expect(setCachedIngestionMock).not.toHaveBeenCalled();
    });

    it("treats whitespace-only fields as no input", async () => {
      ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals({ status: "partial" }) });
      understandReelMock.mockResolvedValue({ ok: true, data: baseUnderstanding() });

      await runPipeline({ url: VALID_URL, manual: { caption: "   ", comments: "" }, mode: "exact" });

      expect(getCachedIngestionMock).toHaveBeenCalledOnce();
      expect(setCachedIngestionMock).toHaveBeenCalledOnce();
    });

    it("caches automatically retrieved signals for a bare link", async () => {
      ingestReelMock.mockResolvedValue({ ok: true, signals: baseSignals({ status: "partial" }) });
      understandReelMock.mockResolvedValue({ ok: true, data: baseUnderstanding() });

      await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });

      expect(setCachedIngestionMock).toHaveBeenCalledOnce();
      expect(setCachedIngestionMock.mock.calls[0][0]).toBe("abc123");
    });

    it("does not cache a 'none' result, so a transient retrieval failure isn't remembered for the full TTL", async () => {
      ingestReelMock.mockResolvedValue({
        ok: true,
        signals: baseSignals({ caption: null, status: "none", missing: ["caption", "transcript", "on-screen text", "comments"] }),
      });

      const outcome = await runPipeline({ url: VALID_URL, manual: {}, mode: "exact" });

      expect(outcome.status).toBe("insufficient");
      expect(setCachedIngestionMock).not.toHaveBeenCalled();
    });
  });
});
