import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { runPipeline } = await import("@/lib/pipeline/pipeline");

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
});
