import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Candidate URLs for the resource-finder come from search-provider results —
// unlike the Instagram-only fetch in lib/content/safeFetch.ts, we can't use
// an allowlist here (the whole point is fetching arbitrary public sites), so
// this is a blocklist: reject loopback/private/link-local/metadata ranges by
// resolving DNS ourselves and checking the actual IP, not just the hostname
// (defeats a bare "use a private IP as the hostname" trick, though a
// resolve-then-reconnect DNS-rebinding attack would still need the fetch
// itself to re-resolve — acceptable residual risk for a liveness check that
// only ever reads a status line: a HEAD, or a GET whose body is discarded
// unread.
// One deadline for the whole check (all hops and both HEAD/GET probes), so a
// slow site can't stack per-hop timeouts and drag out the request.
const TOTAL_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 2;
const USER_AGENT = "Mozilla/5.0 (compatible; UnpackLinkCheck/1.0)";

// The server answered but won't serve an automated client (bot wall, rate
// limit, geo/legal block). The page exists, so dropping it would throw away a
// real, officially-sourced link — only 404/410/5xx-style answers mean "dead".
const EXISTS_BUT_BLOCKED = new Set([401, 403, 429, 451, 999]);

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique local
    if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.replace("::ffff:", ""));
    return false;
  }
  return true; // couldn't parse — refuse rather than guess
}

export type SafeExternalFetchResult =
  | { ok: true; status: number }
  | { ok: false; reason: "blocked_host" | "unreachable" | "timeout" }
  | { ok: false; reason: "dead"; status: number };

async function probe(url: string, method: "HEAD" | "GET", signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, {
    method,
    redirect: "manual",
    signal,
    headers: { "User-Agent": USER_AGENT },
  });
  // Only the status line and headers matter; don't download a GET body.
  try {
    await response.body?.cancel();
  } catch {
    // body already consumed/closed — nothing to release
  }
  return response;
}

export async function checkLiveness(initialUrl: string): Promise<SafeExternalFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  try {
    return await followHops(initialUrl, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function followHops(initialUrl: string, signal: AbortSignal): Promise<SafeExternalFetchResult> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, reason: "blocked_host" };
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, reason: "blocked_host" };
    }
    if (parsed.hostname === "localhost") {
      return { ok: false, reason: "blocked_host" };
    }

    try {
      const { address } = await lookup(parsed.hostname);
      if (isPrivateOrReservedIp(address)) {
        return { ok: false, reason: "blocked_host" };
      }
    } catch {
      return { ok: false, reason: "unreachable" };
    }

    try {
      let response = await probe(parsed.toString(), "HEAD", signal);

      // Plenty of real sites refuse or mishandle HEAD (npmjs.com -> 403,
      // amazon.com -> 405) while serving GET fine, so a non-OK HEAD gets one
      // GET retry before we judge the link.
      if (!isSuccess(response.status) && !isRedirect(response.status)) {
        response = await probe(parsed.toString(), "GET", signal);
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, reason: "unreachable" };
        currentUrl = new URL(location, parsed).toString();
        continue;
      }

      if (isSuccess(response.status) || EXISTS_BUT_BLOCKED.has(response.status)) {
        return { ok: true, status: response.status };
      }
      return { ok: false, reason: "dead", status: response.status };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "unreachable" };
    }
  }

  return { ok: false, reason: "unreachable" };
}
