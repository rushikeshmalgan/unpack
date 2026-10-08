import { afterEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

const { checkLiveness } = await import("@/lib/pipeline/safeExternalFetch");

afterEach(() => {
  vi.unstubAllGlobals();
  lookupMock.mockReset();
});

function headResponse(status: number, location?: string): Response {
  const headers = new Headers(location ? { location } : {});
  return { status, headers } as unknown as Response;
}

describe("checkLiveness", () => {
  it("returns ok for a public site that resolves and responds 200", async () => {
    lookupMock.mockResolvedValue({ address: "93.184.216.34" }); // public (example.com-range)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(headResponse(200)));

    const result = await checkLiveness("https://example.com/page");
    expect(result).toEqual({ ok: true, status: 200 });
  });

  it("rejects localhost outright, without a DNS lookup or fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkLiveness("http://localhost:3000/internal");
    expect(result).toEqual({ ok: false, reason: "blocked_host" });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["10.0.0.5", "RFC1918"],
    ["127.0.0.1", "loopback"],
    ["169.254.169.254", "cloud metadata"],
    ["192.168.1.1", "RFC1918"],
    ["172.16.0.1", "RFC1918"],
  ])("blocks a hostname that resolves to %s (%s)", async (ip) => {
    lookupMock.mockResolvedValue({ address: ip });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkLiveness("https://looks-public.example/x");
    expect(result).toEqual({ ok: false, reason: "blocked_host" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks an IPv6 loopback/unique-local resolution", async () => {
    lookupMock.mockResolvedValue({ address: "::1" });
    const result = await checkLiveness("https://looks-public.example/x");
    expect(result).toEqual({ ok: false, reason: "blocked_host" });
  });

  it("rejects non-http(s) protocols", async () => {
    const result = await checkLiveness("ftp://example.com/x");
    expect(result).toEqual({ ok: false, reason: "blocked_host" });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("follows a redirect to another public host", async () => {
    lookupMock.mockResolvedValue({ address: "93.184.216.34" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(headResponse(301, "https://final.example/page"))
      .mockResolvedValueOnce(headResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkLiveness("https://redirector.example/x");
    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("blocks a redirect that resolves to a private IP on the second hop", async () => {
    lookupMock.mockResolvedValueOnce({ address: "93.184.216.34" }).mockResolvedValueOnce({ address: "127.0.0.1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(headResponse(301, "https://internal.example/x")));

    const result = await checkLiveness("https://redirector.example/x");
    expect(result).toEqual({ ok: false, reason: "blocked_host" });
  });

  it("treats a DNS lookup failure as unreachable", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    const result = await checkLiveness("https://does-not-exist.example/x");
    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("treats an aborted request as a timeout", async () => {
    lookupMock.mockResolvedValue({ address: "93.184.216.34" });
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await checkLiveness("https://slow.example/x");
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  describe("HTTP status semantics", () => {
    function stubStatuses(...statuses: number[]) {
      lookupMock.mockResolvedValue({ address: "93.184.216.34" });
      const fetchMock = vi.fn();
      for (const s of statuses) fetchMock.mockResolvedValueOnce(headResponse(s));
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("drops a page that answers 404 to both HEAD and GET (a dead link is not alive)", async () => {
      const fetchMock = stubStatuses(404, 404);
      const result = await checkLiveness("https://github.com/someone/deleted-repo");
      expect(result).toEqual({ ok: false, reason: "dead", status: 404 });
      expect(fetchMock.mock.calls.map((c) => c[1].method)).toEqual(["HEAD", "GET"]);
    });

    it.each([410, 500, 503])("drops a page that answers %i", async (status) => {
      stubStatuses(status, status);
      expect(await checkLiveness("https://broken.example/x")).toEqual({ ok: false, reason: "dead", status });
    });

    it("retries with GET when HEAD is refused, and accepts the page if GET works (npmjs.com answers HEAD 403 but GET 200)", async () => {
      const fetchMock = stubStatuses(403, 200);
      const result = await checkLiveness("https://www.npmjs.com/package/lodash");
      expect(result).toEqual({ ok: true, status: 200 });
      expect(fetchMock.mock.calls.map((c) => c[1].method)).toEqual(["HEAD", "GET"]);
    });

    it("retries with GET on 405 Method Not Allowed (amazon.com answers HEAD 405 but GET 200)", async () => {
      stubStatuses(405, 200);
      expect(await checkLiveness("https://www.amazon.com/dp/0735211299")).toEqual({ ok: true, status: 200 });
    });

    it.each([401, 403, 429, 451])(
      "keeps a page that answers %i to both probes: the server exists but blocks bots, so dropping it would discard a real link",
      async (status) => {
        stubStatuses(status, status);
        expect(await checkLiveness("https://protected.example/x")).toEqual({ ok: true, status });
      },
    );

    it("does not spend a second request when HEAD already succeeded", async () => {
      const fetchMock = stubStatuses(200);
      await checkLiveness("https://example.com/");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("judges the final hop of a redirect chain, not the first", async () => {
      lookupMock.mockResolvedValue({ address: "93.184.216.34" });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(headResponse(301, "https://moved.example/gone"))
        .mockResolvedValueOnce(headResponse(404))
        .mockResolvedValueOnce(headResponse(404));
      vi.stubGlobal("fetch", fetchMock);

      expect(await checkLiveness("https://old.example/x")).toEqual({ ok: false, reason: "dead", status: 404 });
    });

    it("identifies itself with an honest User-Agent and never follows redirects automatically", async () => {
      const fetchMock = stubStatuses(200);
      await checkLiveness("https://example.com/");
      const init = fetchMock.mock.calls[0][1];
      expect(init.headers["User-Agent"]).toContain("UnpackLinkCheck");
      expect(init.redirect).toBe("manual");
    });

    it("still blocks a private IP on the GET fallback path (SSRF guard applies before any probe)", async () => {
      lookupMock.mockResolvedValue({ address: "169.254.169.254" });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect(await checkLiveness("https://metadata.example/latest")).toEqual({ ok: false, reason: "blocked_host" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
