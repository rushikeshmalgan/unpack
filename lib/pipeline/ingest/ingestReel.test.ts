import { beforeEach, describe, expect, it, vi } from "vitest";

const callExtractorMock = vi.fn();
const retrieveMock = vi.fn();

vi.mock("@/lib/pipeline/ingest/extractorClient", () => ({
  callExtractor: callExtractorMock,
}));
vi.mock("@/lib/content/instagramProvider", () => ({
  instagramProvider: { retrieve: retrieveMock },
}));

const { ingestReel } = await import("@/lib/pipeline/ingest/ingestReel");

const VALID_URL = "https://www.instagram.com/reel/abc123/";

beforeEach(() => {
  callExtractorMock.mockReset().mockResolvedValue({ ok: false, reason: "not_configured" });
  retrieveMock.mockReset().mockResolvedValue({ ok: false, reason: "no_data" });
});

describe("ingestReel", () => {
  it("rejects an invalid URL without calling the extractor or metadata provider", async () => {
    const result = await ingestReel("https://evil.com/reel/abc/", {});
    expect(result.ok).toBe(false);
    expect(callExtractorMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("is status 'none' when nothing is available at all", async () => {
    const result = await ingestReel(VALID_URL, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.signals.status).toBe("none");
  });

  it("is manual_only when only the user-pasted caption is available", async () => {
    const result = await ingestReel(VALID_URL, { caption: "Check out this roadmap" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signals.status).toBe("manual_only");
      expect(result.signals.caption).toBe("Check out this roadmap");
    }
  });

  it("is partial when only Open Graph metadata is available", async () => {
    retrieveMock.mockResolvedValue({
      ok: true, caption: "Retrieved caption", creatorUsername: "someuser", title: null, description: null, imageUrl: null,
    });
    const result = await ingestReel(VALID_URL, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signals.status).toBe("partial");
      expect(result.signals.caption).toBe("Retrieved caption");
    }
  });

  it("is full when the extractor returns a transcript", async () => {
    callExtractorMock.mockResolvedValue({
      ok: true,
      data: {
        caption: "caption", transcript: "spoken words here", onScreenText: null,
        comments: null, creatorUsername: "someuser", thumbnailUrl: "https://cdn.example.com/x.jpg",
      },
    });
    const result = await ingestReel(VALID_URL, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signals.status).toBe("full");
      expect(result.signals.transcript).toBe("spoken words here");
    }
  });

  it("prioritizes manual input over extractor/metadata for caption", async () => {
    callExtractorMock.mockResolvedValue({
      ok: true,
      data: { caption: "extractor caption", transcript: null, onScreenText: null, comments: null, creatorUsername: null, thumbnailUrl: null },
    });
    const result = await ingestReel(VALID_URL, { caption: "manual caption wins" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.signals.caption).toBe("manual caption wins");
  });

  it("rejects an unsafe (http) thumbnail URL", async () => {
    callExtractorMock.mockResolvedValue({
      ok: true,
      data: { caption: null, transcript: "x", onScreenText: null, comments: null, creatorUsername: null, thumbnailUrl: "http://insecure.example.com/x.jpg" },
    });
    const result = await ingestReel(VALID_URL, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.signals.thumbnailUrl).toBeNull();
  });

  it("lists missing signals honestly", async () => {
    const result = await ingestReel(VALID_URL, { caption: "only a caption" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signals.missing).toContain("transcript");
      expect(result.signals.missing).toContain("on-screen text");
      expect(result.signals.missing).toContain("comments");
      expect(result.signals.missing).not.toContain("caption");
    }
  });
});
