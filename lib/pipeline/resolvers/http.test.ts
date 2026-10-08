import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSourceJson, fetchSourceText, resolverUserAgent } from "@/lib/pipeline/resolvers/http";

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("fetchSourceJson / fetchSourceText", () => {
  it("returns the parsed body and reports nothing on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, { items: [1] })));
    const reportIssue = vi.fn();
    expect(await fetchSourceJson({ reportIssue }, "GitHub search", "https://api.example/x")).toEqual({ items: [1] });
    expect(reportIssue).not.toHaveBeenCalled();
  });

  it("returns text bodies too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, "<feed/>")));
    expect(await fetchSourceText({}, "arXiv search", "https://api.example/x")).toBe("<feed/>");
  });

  it.each([
    [429, "GitHub search is rate-limited"],
    [403, "GitHub search is rate-limited"],
    [401, "GitHub search isn't set up correctly"],
    [500, "GitHub search is unavailable right now"],
    [503, "GitHub search is unavailable right now"],
  ])("reports a %i as a problem with the source and returns null (not an empty result)", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status)));
    const reportIssue = vi.fn();
    expect(await fetchSourceJson({ reportIssue }, "GitHub search", "https://api.example/x")).toBeNull();
    expect(reportIssue).toHaveBeenCalledExactlyOnceWith(message);
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const reportIssue = vi.fn();
    expect(await fetchSourceJson({ reportIssue }, "npm search", "https://api.example/x")).toBeNull();
    expect(reportIssue).toHaveBeenCalledExactlyOnceWith("npm search is unavailable right now");
  });

  it("reports a body that isn't valid JSON as unavailable rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } } as unknown as Response));
    const reportIssue = vi.fn();
    expect(await fetchSourceJson({ reportIssue }, "Open Library", "https://api.example/x")).toBeNull();
    expect(reportIssue).toHaveBeenCalledOnce();
  });

  it("aborts a request that outlives its timeout and reports it", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })),
      );
      const reportIssue = vi.fn();
      const pending = fetchSourceJson({ reportIssue }, "Open Library", "https://api.example/x", { timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toBeNull();
      expect(reportIssue).toHaveBeenCalledExactlyOnceWith("Open Library is unavailable right now");
    } finally {
      vi.useRealTimers();
    }
  });

  it("works when the caller supplies no reportIssue callback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500)));
    expect(await fetchSourceJson({}, "x", "https://api.example/x")).toBeNull();
  });

  describe("backing off a host that said no", () => {
    // Each test uses its own hostname: the back-off table is per-process state.
    const rateLimited = (headers: Record<string, string>, status = 429) =>
      ({ ok: false, status, headers: new Headers(headers), json: async () => ({}) }) as unknown as Response;

    afterEach(() => {
      vi.useRealTimers();
    });

    it("stops calling a host for the Retry-After period instead of hammering it", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const fetchMock = vi.fn().mockResolvedValue(rateLimited({ "retry-after": "4" }));
      vi.stubGlobal("fetch", fetchMock);
      const reportIssue = vi.fn();

      await fetchSourceJson({ reportIssue }, "Wikidata", "https://backoff-a.example/w/api.php?x=1");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // A second lookup — even a different URL on the same host — makes no request.
      await fetchSourceJson({ reportIssue }, "Wikidata", "https://backoff-a.example/w/api.php?x=2");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(reportIssue).toHaveBeenLastCalledWith("Wikidata is rate-limited");
    });

    it("resumes once the Retry-After period has passed", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(rateLimited({ "retry-after": "4" }))
        .mockResolvedValueOnce(response(200, { ok: true }));
      vi.stubGlobal("fetch", fetchMock);

      await fetchSourceJson({}, "Wikidata", "https://backoff-b.example/x");
      vi.setSystemTime(new Date("2026-01-01T00:00:05Z"));
      expect(await fetchSourceJson({}, "Wikidata", "https://backoff-b.example/x")).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("only blocks the host that complained", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(rateLimited({ "retry-after": "30" }))
        .mockResolvedValueOnce(response(200, { fine: true }));
      vi.stubGlobal("fetch", fetchMock);

      await fetchSourceJson({}, "A", "https://backoff-c1.example/x");
      expect(await fetchSourceJson({}, "B", "https://backoff-c2.example/x")).toEqual({ fine: true });
    });

    it("caps an absurd Retry-After at a minute", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(rateLimited({ "retry-after": "86400" }))
        .mockResolvedValueOnce(response(200, { back: true }));
      vi.stubGlobal("fetch", fetchMock);

      await fetchSourceJson({}, "x", "https://backoff-d.example/x");
      vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
      expect(await fetchSourceJson({}, "x", "https://backoff-d.example/x")).toEqual({ back: true });
    });

    it("honors GitHub's primary limit: a 403 with remaining=0 blocks until the reset time", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const resetEpochSeconds = String(Math.floor(Date.now() / 1000) + 20);
      const fetchMock = vi.fn().mockResolvedValue(
        rateLimited({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": resetEpochSeconds }, 403),
      );
      vi.stubGlobal("fetch", fetchMock);

      await fetchSourceJson({}, "GitHub search", "https://backoff-e.example/search");
      await fetchSourceJson({}, "GitHub search", "https://backoff-e.example/search");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not block on an ordinary 500, or on a 403 that isn't a rate limit", async () => {
      const fetchMock = vi.fn().mockResolvedValue(rateLimited({}, 500));
      vi.stubGlobal("fetch", fetchMock);
      await fetchSourceJson({}, "x", "https://backoff-f.example/x");
      await fetchSourceJson({}, "x", "https://backoff-f.example/x");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const forbidden = vi.fn().mockResolvedValue(rateLimited({}, 403));
      vi.stubGlobal("fetch", forbidden);
      await fetchSourceJson({}, "x", "https://backoff-g.example/x");
      await fetchSourceJson({}, "x", "https://backoff-g.example/x");
      expect(forbidden).toHaveBeenCalledTimes(2);
    });
  });

  describe("resolverUserAgent", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("identifies the app, and adds operator contact details when configured (as Wikimedia/OSM policies ask)", () => {
      vi.stubEnv("OPERATOR_CONTACT", "ops@example.com");
      expect(resolverUserAgent()).toBe("UnpackResourceFinder/1.0 (reel-to-resource lookup; ops@example.com)");
    });

    it("works without a contact", () => {
      vi.stubEnv("OPERATOR_CONTACT", "");
      expect(resolverUserAgent()).toBe("UnpackResourceFinder/1.0 (reel-to-resource lookup)");
    });

    it("strips control characters so a bad value can't inject headers", () => {
      vi.stubEnv("OPERATOR_CONTACT", "ops@example.com\r\nX-Evil: 1");
      expect(resolverUserAgent()).not.toMatch(/[\r\n]/);
    });
  });

  it("passes method, headers and body through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await fetchSourceJson({}, "Web search", "https://api.example/x", { method: "POST", headers: { A: "b" }, body: "{}" });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ A: "b" });
    expect(init.body).toBe("{}");
  });
});
