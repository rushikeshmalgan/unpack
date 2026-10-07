import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetchText } from "@/lib/content/safeFetch";

const ALLOWED = new Set(["www.instagram.com"]);

function fakeBody(text: string, chunkSize = 65_536): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + chunkSize);
      offset += chunk.length;
      controller.enqueue(chunk);
    },
  });
}

function fakeResponse(opts: { status: number; location?: string; bodyText?: string }): Response {
  const headers = new Headers(opts.location ? { location: opts.location } : {});
  return {
    status: opts.status,
    ok: opts.status >= 200 && opts.status < 300,
    headers,
    body: opts.bodyText !== undefined ? fakeBody(opts.bodyText) : null,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safeFetchText", () => {
  it("returns the body on a clean 200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, bodyText: "<html>hi</html>" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: true, body: "<html>hi</html>" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects the initial URL outright if its host isn't allowlisted, without ever fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://evil.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: false, reason: "blocked_or_private" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a redirect to an allowlisted host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ status: 302, location: "https://www.instagram.com/reel/final/" }))
      .mockResolvedValueOnce(fakeResponse({ status: 200, bodyText: "final body" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: true, body: "final body" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to follow a redirect to a non-allowlisted host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ status: 302, location: "https://evil.com/steal" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: false, reason: "blocked_or_private" });
    // Must never have issued a request to the disallowed host.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ status: 302, location: "https://www.instagram.com/reel/loop/" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: false, reason: "blocked_or_private" });
    // MAX_REDIRECTS=3 -> at most 4 attempts total (hop 0..3 inclusive).
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it.each([401, 403, 404])("treats a %i response as blocked_or_private", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: false, reason: "blocked_or_private" });
  });

  it("treats a 500 response as unreachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("treats a network-level rejection as unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("treats an aborted request as a timeout", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("caps the response body instead of reading an unbounded stream", async () => {
    const oversized = "x".repeat(350_000);
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, bodyText: oversized }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchText("https://www.instagram.com/reel/abc/", ALLOWED);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.length).toBeLessThan(oversized.length);
    }
  });
});
