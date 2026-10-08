import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSourceJson, fetchSourceText } from "@/lib/pipeline/resolvers/http";

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
