import { beforeEach, describe, expect, it, vi } from "vitest";

const safeFetchTextMock = vi.fn();

vi.mock("@/lib/content/safeFetch", () => ({
  safeFetchText: safeFetchTextMock,
}));

const { instagramProvider } = await import("@/lib/content/instagramProvider");

beforeEach(() => {
  safeFetchTextMock.mockReset();
});

describe("instagramProvider.canHandle", () => {
  it("accepts a valid Instagram reel URL", () => {
    expect(instagramProvider.canHandle("https://www.instagram.com/reel/abc123/")).toBe(true);
  });

  it("rejects a non-Instagram URL", () => {
    expect(instagramProvider.canHandle("https://evil.com/reel/abc123/")).toBe(false);
  });
});

describe("instagramProvider.retrieve", () => {
  it("returns no_data for an invalid URL without ever fetching", async () => {
    const result = await instagramProvider.retrieve("https://evil.com/reel/abc/");
    expect(result).toEqual({ ok: false, reason: "no_data" });
    expect(safeFetchTextMock).not.toHaveBeenCalled();
  });

  it("passes through the fetch failure reason", async () => {
    safeFetchTextMock.mockResolvedValue({ ok: false, reason: "timeout" });

    const result = await instagramProvider.retrieve("https://www.instagram.com/reel/abc/");

    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("returns no_data when the page has none of the expected OG tags", async () => {
    safeFetchTextMock.mockResolvedValue({ ok: true, body: "<html><head></head></html>" });

    const result = await instagramProvider.retrieve("https://www.instagram.com/reel/abc/");

    expect(result).toEqual({ ok: false, reason: "no_data" });
  });

  it("extracts caption, username, title, and image from a real-shaped OG payload", async () => {
    const html = `<html><head>
      <meta property="og:title" content="someuser on Instagram" />
      <meta property="og:description" content="1.2K likes, 30 comments - someuser on Jan 1: &quot;Comment GUIDE for the roadmap&quot;" />
      <meta property="og:image" content="https://scontent.cdninstagram.com/img.jpg" />
      </head></html>`;
    safeFetchTextMock.mockResolvedValue({ ok: true, body: html });

    const result = await instagramProvider.retrieve("https://www.instagram.com/reel/abc/");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.caption).toBe("Comment GUIDE for the roadmap");
      expect(result.creatorUsername).toBe("someuser");
      expect(result.imageUrl).toBe("https://scontent.cdninstagram.com/img.jpg");
    }
  });
});
