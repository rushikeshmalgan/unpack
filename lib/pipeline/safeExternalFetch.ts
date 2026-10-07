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
// only ever does a HEAD).
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 2;

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
  | { ok: false; reason: "blocked_host" | "unreachable" | "timeout" };

export async function checkLiveness(initialUrl: string): Promise<SafeExternalFetchResult> {
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(parsed.toString(), {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, reason: "unreachable" };
        currentUrl = new URL(location, parsed).toString();
        continue;
      }

      return { ok: true, status: response.status };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reason: "unreachable" };
}
