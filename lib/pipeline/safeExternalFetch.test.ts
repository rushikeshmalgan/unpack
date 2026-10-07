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
});
