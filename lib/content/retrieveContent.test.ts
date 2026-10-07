import { beforeEach, describe, expect, it, vi } from "vitest";

const retrieveMock = vi.fn();

vi.mock("@/lib/content/instagramProvider", () => ({
  instagramProvider: { platform: "instagram", canHandle: vi.fn(), retrieve: retrieveMock },
}));

const { retrieveContent } = await import("@/lib/content/retrieveContent");

const VALID_URL = "https://www.instagram.com/reel/abc123/";

beforeEach(() => {
  retrieveMock.mockReset();
  retrieveMock.mockResolvedValue({ ok: false, reason: "no_data" });
});

describe("retrieveContent", () => {
  it("short-circuits on an invalid URL without calling the provider", async () => {
    const outcome = await retrieveContent({ url: "https://evil.com/reel/abc/" });

    expect(outcome.status).toBe("invalid_url");
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("is insufficient when nothing is retrieved and no manual content is given", async () => {
    const outcome = await retrieveContent({ url: VALID_URL });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.sufficient).toBe(false);
      expect(outcome.content.metadata.retrievedVia).toBe("unavailable");
    }
  });

  it("is sufficient when manual caption alone meets the length threshold", async () => {
    const outcome = await retrieveContent({
      url: VALID_URL,
      caption: "This is a long enough caption to pass the sufficiency threshold.",
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.sufficient).toBe(true);
      expect(outcome.content.metadata.retrievedVia).toBe("manual_only");
    }
  });

  it("is insufficient when the manual caption is too short", async () => {
    const outcome = await retrieveContent({ url: VALID_URL, caption: "short" });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.sufficient).toBe(false);
  });

  it("manual caption overrides a retrieved caption", async () => {
    retrieveMock.mockResolvedValue({
      ok: true,
      caption: "Retrieved caption that would otherwise be used here.",
      creatorUsername: "someuser",
      title: "title",
      description: "description",
      imageUrl: null,
    });

    const outcome = await retrieveContent({ url: VALID_URL, caption: "Manual caption takes priority always." });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.content.caption).toBe("Manual caption takes priority always.");
      expect(outcome.content.metadata.retrievedVia).toBe("open_graph");
    }
  });

  it("falls back to the retrieved caption when no manual caption is given", async () => {
    retrieveMock.mockResolvedValue({
      ok: true,
      caption: "Retrieved caption long enough to be sufficient on its own.",
      creatorUsername: null,
      title: null,
      description: null,
      imageUrl: null,
    });

    const outcome = await retrieveContent({ url: VALID_URL });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.content.caption).toBe("Retrieved caption long enough to be sufficient on its own.");
      expect(outcome.sufficient).toBe(true);
    }
  });

  it("extracts links found in the merged caption/transcript text", async () => {
    const outcome = await retrieveContent({
      url: VALID_URL,
      caption: "Check out https://github.com/someuser for the code and resources.",
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.content.links).toEqual(["https://github.com/someuser"]);
    }
  });

  it("reports the retrieval status distinctly for blocked_or_private vs no_data", async () => {
    retrieveMock.mockResolvedValue({ ok: false, reason: "blocked_or_private" });
    const outcome = await retrieveContent({ url: VALID_URL });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.retrieval).toBe("blocked_or_private");
  });
});
