import type { ResolverContext } from "@/lib/pipeline/resolvers/types";

export interface SourceRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BACKOFF_MS = 60_000;

// Wikimedia and OpenStreetMap ask API clients to identify themselves with
// contact details, and throttle anonymous generic clients harder. Set
// OPERATOR_CONTACT (an email or URL) to be a well-identified client.
export function resolverUserAgent(): string {
  const contact = (process.env.OPERATOR_CONTACT ?? "").replace(/[^\x20-\x7e]/g, "").trim();
  return `UnpackResourceFinder/1.0 (reel-to-resource lookup${contact ? `; ${contact}` : ""})`;
}

// Hosts that told us to back off, and until when (epoch ms). Per-process only,
// which is enough to stop one request's parallel lookups — and the next few
// requests on a warm instance — from hammering a service that already said no.
// Hammering is what escalates a 4-second Wikidata penalty into a 21-second one.
const blockedUntil = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function noteBackoff(host: string, res: Response): void {
  if (res.status !== 429 && res.status !== 403 && res.status !== 503) return;

  let waitMs = 0;
  const retryAfterSeconds = Number(res.headers?.get("retry-after"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) waitMs = retryAfterSeconds * 1000;

  // GitHub's primary limit: 403 with remaining=0 and an epoch-seconds reset.
  if (res.headers?.get("x-ratelimit-remaining") === "0") {
    const resetSeconds = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(resetSeconds)) waitMs = Math.max(waitMs, resetSeconds * 1000 - Date.now());
  }

  if (waitMs > 0) blockedUntil.set(host, Date.now() + Math.min(waitMs, MAX_BACKOFF_MS));
}

// Shared fetch plumbing for resolvers. A resolver returning [] can mean
// "searched, nothing matched" or "couldn't search at all", and the pipeline
// must not confuse the two: it would tell the user "not found" about a rate
// limit and cache that empty answer. On failure this reports why through
// ctx.reportIssue and returns null; a resolver returns [] only for a genuine
// empty result.
async function fetchSource<T>(
  ctx: ResolverContext,
  label: string,
  url: string,
  request: SourceRequest,
  read: (res: Response) => Promise<T>,
): Promise<T | null> {
  const host = hostOf(url);
  const until = blockedUntil.get(host);
  if (until !== undefined) {
    if (Date.now() < until) {
      ctx.reportIssue?.(`${label} is rate-limited`);
      return null;
    }
    blockedUntil.delete(host);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    if (!res.ok) {
      noteBackoff(host, res);
      ctx.reportIssue?.(describeFailure(label, res.status));
      return null;
    }
    // Read the body before the timer is cleared so a stalled body is covered too.
    return await read(res);
  } catch {
    ctx.reportIssue?.(`${label} is unavailable right now`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(label: string, status: number): string {
  if (status === 429 || status === 403) return `${label} is rate-limited`;
  if (status === 401) return `${label} isn't set up correctly`;
  return `${label} is unavailable right now`;
}

export function fetchSourceJson<T>(
  ctx: ResolverContext,
  label: string,
  url: string,
  request: SourceRequest = {},
): Promise<T | null> {
  return fetchSource(ctx, label, url, request, (res) => res.json() as Promise<T>);
}

export function fetchSourceText(
  ctx: ResolverContext,
  label: string,
  url: string,
  request: SourceRequest = {},
): Promise<string | null> {
  return fetchSource(ctx, label, url, request, (res) => res.text());
}
