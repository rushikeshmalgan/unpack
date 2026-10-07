import { Redis } from "@upstash/redis";

// Reuses the same Upstash Redis instance already provisioned for rate
// limiting (RATE_LIMIT_BACKEND=redis) rather than adding a second data
// store. This is the one place the pipeline intentionally breaks "nothing
// is persisted" — ingestion signals and search results are cached with a
// TTL to save retrieval/search/AI cost, never kept indefinitely. If Redis
// isn't configured (local dev default), caching just no-ops — the app
// still works, every request is simply uncached.
const INGEST_TTL_SECONDS = 7 * 24 * 60 * 60;
const SEARCH_TTL_SECONDS = 24 * 60 * 60;

let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;
  client =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;
  return client;
}

async function getCached<T>(key: string): Promise<T | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    return await redis.get<T>(key);
  } catch (err) {
    console.error("[pipeline/cache] read failed, proceeding uncached:", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.error("[pipeline/cache] write failed, continuing without caching:", err instanceof Error ? err.name : "unknown");
  }
}

export function getCachedIngestion<T>(shortcode: string): Promise<T | null> {
  return getCached<T>(`unpack:ingest:${shortcode}`);
}

export function setCachedIngestion<T>(shortcode: string, value: T): Promise<void> {
  return setCached(`unpack:ingest:${shortcode}`, value, INGEST_TTL_SECONDS);
}

function queryKey(query: string): string {
  // Cache key only — not a security boundary, just collapsing
  // case/whitespace variants of the same search query.
  return query.trim().toLowerCase();
}

export function getCachedSearch<T>(resolverId: string, query: string): Promise<T | null> {
  return getCached<T>(`unpack:search:${resolverId}:${queryKey(query)}`);
}

export function setCachedSearch<T>(resolverId: string, query: string, value: T): Promise<void> {
  return setCached(`unpack:search:${resolverId}:${queryKey(query)}`, value, SEARCH_TTL_SECONDS);
}
