import type { ResolverContext } from "@/lib/pipeline/resolvers/types";

export interface SourceRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

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
