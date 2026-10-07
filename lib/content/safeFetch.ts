// Narrow, allowlist-only fetch used for public content retrieval.
// The caller must already have built `url` from validated parts (never pass
// a raw, untrusted string straight through) — this only adds defense in depth
// against redirects leading somewhere off-allowlist.

const MAX_REDIRECTS = 3;
const MAX_BYTES = 300_000; // OG tags live in <head>; no need to pull the whole page.
const TIMEOUT_MS = 6000;

export type SafeFetchResult =
  | { ok: true; body: string }
  | { ok: false; reason: "unreachable" | "blocked_or_private" | "timeout" };

export async function safeFetchText(
  initialUrl: string,
  allowedHosts: ReadonlySet<string>,
): Promise<SafeFetchResult> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname.toLowerCase())) {
      return { ok: false, reason: "blocked_or_private" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ReelDecoderBot/1.0)",
          Accept: "text/html",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "unreachable" };
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "unreachable" };
      try {
        currentUrl = new URL(location, parsed).toString();
        continue;
      } catch {
        return { ok: false, reason: "unreachable" };
      }
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { ok: false, reason: "blocked_or_private" };
    }

    if (!response.ok || !response.body) {
      return { ok: false, reason: "unreachable" };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (total < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)), total);
    return { ok: true, body: combined.toString("utf-8") };
  }

  return { ok: false, reason: "blocked_or_private" };
}
